import type * as Ort from 'onnxruntime-web'
import type { Rect } from '@/types/editing'

/**
 * PP-OCRv5 inference, written against the models' own inference.yml:
 *   detection    DetResizeForTest, BGR, ImageNet mean/std → DB post-process
 *                (thresh 0.3, box_thresh 0.6, unclip_ratio 1.5)
 *   recognition  RecResizeImg 3×48×W (aspect kept, zero padded), (x/255−0.5)/0.5 → CTC decode
 * Pure functions over an onnxruntime-web session, so they run unchanged inside a Web Worker.
 */

type OrtModule = typeof Ort
type Session = Ort.InferenceSession

// ---- detection parameters ---------------------------------------------------------------------
/**
 * The detector is trained around a 960px long edge and groups LARGE text best there: fed the
 * image at 1600-2048px it starts merging neighbouring lines into one blob or dropping them (and
 * runs 3-5x slower). Small text in a big image, on the other hand, is only found at a higher
 * resolution. So big images are searched at both scales and the results combined.
 */
const DET_BASE_LONG = 960
const DET_FINE_LONG = 1600
/** Only images whose long edge reaches this get the second, finer pass. */
const DET_FINE_MIN_SOURCE = 1300
const DET_THRESH = 0.3
const DET_BOX_THRESH = 0.6
const DET_UNCLIP_RATIO = 1.5
const DET_MIN_SIDE = 3
/** Boxes on the same line closer than this (× line height) are one line of text. */
const LINE_MERGE_GAP = 1.0

// ---- recognition parameters -------------------------------------------------------------------
const REC_HEIGHT = 48
const REC_MIN_WIDTH = 320
const REC_MAX_WIDTH = 3200
/** The recognizer downsamples width by 8: one output step covers 8 input pixels. */
const REC_STRIDE = 8

export interface RecognizedChar {
  ch: string
  /** Probability of this character (0-1). */
  prob: number
  /** Horizontal extent in the INPUT line's pixels (relative to the line box's left edge). */
  x0: number
  x1: number
}

export interface RecognizedLine {
  text: string
  /** Mean character probability, 0-100. */
  confidence: number
  chars: RecognizedChar[]
}

// -----------------------------------------------------------------------------------------------
// dictionary

/**
 * The recognizer's dictionary lives in its inference.yml as a `character_dict:` list. Entries may
 * be bare, single-quoted (`'''` is an apostrophe) or double-quoted; nothing else follows the list
 * but other top-level keys, so the first non-list line ends it.
 */
export function parseDictionary(yml: string): string[] {
  const lines = yml.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() === 'character_dict:')
  if (start < 0) throw new Error('OCR 사전을 찾을 수 없습니다.')
  const chars: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*- (.*)$/)
    if (!m) break
    let value = m[1]
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replace(/''/g, "'")
    } else if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = JSON.parse(value) as string
    }
    chars.push(value)
  }
  return chars
}

// -----------------------------------------------------------------------------------------------
// helpers

function scaled(source: OffscreenCanvas, width: number, height: number): ImageData {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D context unavailable for OCR')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

function overlapRatio(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  return (w * h) / Math.min(a.width * a.height, b.width * b.height)
}
export { overlapRatio }

// -----------------------------------------------------------------------------------------------
// detection

/**
 * Text-line boxes (axis-aligned, in `source` pixels), reading order. Connected components of the
 * probability map above the threshold are boxes; each is grown by the DB "unclip" distance, and
 * boxes that sit on one line are merged — a detector often splits a title at an outline, a wide
 * gap or an icon, and an edit must erase and replace the whole line, not half of it.
 */
export async function detectText(
  ort: OrtModule,
  session: Session,
  source: OffscreenCanvas,
  /** Long edge (px) the detector should see. */
  targetLong: number,
): Promise<Rect[]> {
  const W = source.width
  const H = source.height
  const long = Math.max(W, H)
  const factor = targetLong / long
  const rw = Math.max(32, Math.round((W * factor) / 32) * 32)
  const rh = Math.max(32, Math.round((H * factor) / 32) * 32)

  const rgba = scaled(source, rw, rh).data
  const plane = rw * rh
  const input = new Float32Array(3 * plane)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  for (let i = 0; i < plane; i++) {
    // The models were trained on BGR images: channel 0 is blue, and mean/std follow that order.
    input[i] = (rgba[i * 4 + 2] / 255 - mean[0]) / std[0]
    input[plane + i] = (rgba[i * 4 + 1] / 255 - mean[1]) / std[1]
    input[2 * plane + i] = (rgba[i * 4] / 255 - mean[2]) / std[2]
  }

  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, rh, rw]),
  })
  const prob = out[session.outputNames[0]].data as Float32Array

  const visited = new Uint8Array(plane)
  const stack = new Int32Array(plane)
  const sx = W / rw
  const sy = H / rh
  const boxes: Rect[] = []

  for (let seed = 0; seed < plane; seed++) {
    if (visited[seed] || prob[seed] <= DET_THRESH) continue
    let top = 0
    stack[top++] = seed
    visited[seed] = 1
    let minX = rw
    let minY = rh
    let maxX = 0
    let maxY = 0
    let sum = 0
    let count = 0
    while (top > 0) {
      const p = stack[--top]
      const x = p % rw
      const y = (p - x) / rw
      sum += prob[p]
      count++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && !visited[p - 1] && prob[p - 1] > DET_THRESH) {
        visited[p - 1] = 1
        stack[top++] = p - 1
      }
      if (x < rw - 1 && !visited[p + 1] && prob[p + 1] > DET_THRESH) {
        visited[p + 1] = 1
        stack[top++] = p + 1
      }
      if (y > 0 && !visited[p - rw] && prob[p - rw] > DET_THRESH) {
        visited[p - rw] = 1
        stack[top++] = p - rw
      }
      if (y < rh - 1 && !visited[p + rw] && prob[p + rw] > DET_THRESH) {
        visited[p + rw] = 1
        stack[top++] = p + rw
      }
    }

    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    if (Math.min(bw, bh) < DET_MIN_SIDE || sum / count < DET_BOX_THRESH) continue

    // DB unclip: offset = area × ratio / perimeter.
    const d = (bw * bh * DET_UNCLIP_RATIO) / (2 * (bw + bh))
    const x0 = Math.max(0, (minX - d) * sx)
    const y0 = Math.max(0, (minY - d) * sy)
    const x1 = Math.min(W, (maxX + 1 + d) * sx)
    const y1 = Math.min(H, (maxY + 1 + d) * sy)
    boxes.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
  }

  return mergeLines(boxes).sort((a, b) => a.y - b.y || a.x - b.x)
}

export interface DetectionPasses {
  /** Boxes from the detector's native scale: the better grouped ones. */
  base: Rect[]
  /**
   * Boxes from a finer scale (large images only), which can see small text the native pass
   * misses. They must only be used where the native pass produced nothing readable — a native
   * box can be a garbage blob that overlaps, and would otherwise hide, perfectly good fine boxes.
   * That decision needs recognition results, so it is left to the caller.
   */
  fine: Rect[]
}

/** Detection passes for a whole image (see {@link DetectionPasses}). */
export async function detectPasses(
  ort: OrtModule,
  session: Session,
  source: OffscreenCanvas,
): Promise<DetectionPasses> {
  const base = await detectText(ort, session, source, DET_BASE_LONG)
  if (Math.max(source.width, source.height) < DET_FINE_MIN_SOURCE) return { base, fine: [] }
  return { base, fine: await detectText(ort, session, source, DET_FINE_LONG) }
}

/** Merges boxes that sit on the same text line and are close enough to be one phrase. */
export function mergeLines(boxes: Rect[]): Rect[] {
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const vOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      const minH = Math.min(a.height, b.height)
      if (vOverlap < minH * 0.5) continue
      const gap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)
      if (gap <= minH * LINE_MERGE_GAP) parent[find(i)] = find(j)
    }
  }

  const groups = new Map<number, Rect>()
  boxes.forEach((box, i) => {
    const root = find(i)
    const g = groups.get(root)
    if (!g) {
      groups.set(root, { ...box })
      return
    }
    const x0 = Math.min(g.x, box.x)
    const y0 = Math.min(g.y, box.y)
    const x1 = Math.max(g.x + g.width, box.x + box.width)
    const y1 = Math.max(g.y + g.height, box.y + box.height)
    groups.set(root, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
  })
  return [...groups.values()]
}

// -----------------------------------------------------------------------------------------------
// recognition

/**
 * Reads one line of text from `box` of `source`. Besides the text it returns every character with
 * its horizontal position (taken from the CTC time step that emitted it), which is what makes
 * word-level boxes possible without a separate model.
 */
export async function recognizeLine(
  ort: OrtModule,
  session: Session,
  dictionary: string[],
  source: OffscreenCanvas,
  box: Rect,
): Promise<RecognizedLine> {
  const bx = Math.max(0, Math.floor(box.x))
  const by = Math.max(0, Math.floor(box.y))
  const bw = Math.max(1, Math.min(source.width - bx, Math.ceil(box.width)))
  const bh = Math.max(1, Math.min(source.height - by, Math.ceil(box.height)))

  const crop = new OffscreenCanvas(bw, bh)
  const cropCtx = crop.getContext('2d')
  if (!cropCtx) throw new Error('2D context unavailable for OCR')
  cropCtx.drawImage(source, bx, by, bw, bh, 0, 0, bw, bh)

  const contentWidth = Math.min(REC_MAX_WIDTH, Math.max(1, Math.ceil((REC_HEIGHT * bw) / bh)))
  const width = Math.max(REC_MIN_WIDTH, contentWidth)
  const rgba = scaled(crop, contentWidth, REC_HEIGHT).data
  const plane = REC_HEIGHT * width
  const input = new Float32Array(3 * plane) // padding stays 0 (= mid-grey after normalisation)
  for (let y = 0; y < REC_HEIGHT; y++) {
    for (let x = 0; x < contentWidth; x++) {
      const s = (y * contentWidth + x) * 4
      const d = y * width + x
      input[d] = (rgba[s + 2] / 255 - 0.5) / 0.5
      input[plane + d] = (rgba[s + 1] / 255 - 0.5) / 0.5
      input[2 * plane + d] = (rgba[s] / 255 - 0.5) / 0.5
    }
  }

  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, REC_HEIGHT, width]),
  })
  const tensor = out[session.outputNames[0]]
  const steps = tensor.dims[1]
  const classes = tensor.dims[2]
  const probs = tensor.data as Float32Array

  // Pixels of the line box covered by one time step.
  const pxPerStep = (REC_STRIDE * bw) / contentWidth
  const chars: RecognizedChar[] = []
  let previous = 0
  let current: RecognizedChar | null = null
  for (let t = 0; t < steps; t++) {
    let best = 0
    let bestProb = -1
    const row = t * classes
    for (let c = 0; c < classes; c++) {
      if (probs[row + c] > bestProb) {
        bestProb = probs[row + c]
        best = c
      }
    }
    if (best !== previous) {
      if (current) current.x1 = Math.min(bw, t * pxPerStep)
      current = null
      if (best !== 0) {
        // Class 0 = blank, 1..N = dictionary, N+1 = space.
        const ch = best - 1 < dictionary.length ? dictionary[best - 1] : ' '
        current = { ch, prob: bestProb, x0: Math.min(bw, t * pxPerStep), x1: bw }
        chars.push(current)
      }
    } else if (current && best !== 0 && bestProb > current.prob) {
      current.prob = bestProb
    }
    previous = best
  }

  // Trim blanks at both ends; a space is only meaningful between characters.
  while (chars.length > 0 && chars[0].ch.trim() === '') chars.shift()
  while (chars.length > 0 && chars[chars.length - 1].ch.trim() === '') chars.pop()

  const text = chars.map((c) => c.ch).join('')
  const confidence = chars.length
    ? Math.round((chars.reduce((s, c) => s + c.prob, 0) / chars.length) * 100)
    : 0
  return { text, confidence, chars }
}

/** Splits a recognized line at spaces into words with their own text, confidence and x-range. */
export function splitWords(line: RecognizedLine): RecognizedLine[] {
  const words: RecognizedChar[][] = []
  let current: RecognizedChar[] = []
  for (const c of line.chars) {
    if (c.ch.trim() === '') {
      if (current.length) words.push(current)
      current = []
    } else {
      current.push(c)
    }
  }
  if (current.length) words.push(current)
  return words.map((chars) => ({
    text: chars.map((c) => c.ch).join(''),
    confidence: Math.round((chars.reduce((s, c) => s + c.prob, 0) / chars.length) * 100),
    chars,
  }))
}

/**
 * Rejects results that are not text: mascots, outlines and texture come out as symbols or a
 * lone low-confidence character. A region needs mostly real characters (letters, digits, Hangul).
 */
export function isPlausibleText(text: string, confidence: number): boolean {
  const chars = text.replace(/\s/g, '')
  if (!chars) return false
  const real = chars.match(/[0-9A-Za-z가-힣]/g)?.length ?? 0
  if (real / chars.length < 0.5) return false
  if (chars.length === 1 && confidence < 85) return false
  return true
}
