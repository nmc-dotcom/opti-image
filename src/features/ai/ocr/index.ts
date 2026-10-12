import type Tesseract from 'tesseract.js'
import type { AiPlugin } from '../types'
import { PSM, getOcrWorker, setOcrProgressListener } from './engine'
import { renderPass, scaleFor, type OcrPass } from './preprocess'
import type { OcrOptions, OcrTextRegion } from './types'
import type { Rect } from '@/types/editing'

const DEFAULT_MIN_CONFIDENCE = 40
/** Words below this confidence in the mixed-language pass get a Korean/English-only second look. */
const RECHECK_CONFIDENCE = 75
/** A gap wider than this many word-heights splits one Tesseract "line" into separate regions. */
const SPLIT_GAP_RATIO = 1.5
/** Text shorter than this (px, in the input image) is unreadable and not worth editing. */
const MIN_TEXT_HEIGHT = 10
/**
 * Very short strings are where mascots, outlines and texture pass as "text" ("8 77"): they must
 * be very confident to count, and more so when they come from a locally-thresholded pass.
 */
const SHORT_TEXT_CHARS = 4
const SHORT_TEXT_CONFIDENCE = { gray: 85, ink: 90 }
/**
 * Passes, in priority order. The locally-thresholded passes also produce plenty of junk on
 * textured areas, so their results must clear a higher confidence bar to be kept.
 */
const PASSES: { pass: OcrPass; minConfidence: number }[] = [
  { pass: 'gray', minConfidence: DEFAULT_MIN_CONFIDENCE },
  { pass: 'light-ink', minConfidence: 70 },
  // A 'dark-ink' pass exists in preprocess.ts but is not used: on the banner and photo test
  // images it found nothing the other two missed and only added junk and a third of the run time.
]

interface Token {
  text: string
  confidence: number
  bbox: Rect
}

function toRect(b: Tesseract.Bbox): Rect {
  return { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 }
}

function union(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.width))
  const y1 = Math.max(...rects.map((r) => r.y + r.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/**
 * Tesseract happily chains words that merely share a baseline ("2026. 10. 3." ... "LOGO" on the
 * other side of the photo) into one line. Editing such a line would erase everything between,
 * so lines are split wherever the horizontal gap is much larger than the text height.
 */
function splitAtGaps(words: Token[]): Token[][] {
  if (words.length === 0) return []
  const sorted = [...words].sort((a, b) => a.bbox.x - b.bbox.x)
  const height = median(sorted.map((w) => w.bbox.height))
  const segments: Token[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].bbox
    const gap = sorted[i].bbox.x - (prev.x + prev.width)
    if (gap > height * SPLIT_GAP_RATIO) segments.push([])
    segments[segments.length - 1].push(sorted[i])
  }
  return segments
}

/**
 * Drops short words at the ends of a line that are clearly less confident than the rest of it.
 * Binarization artefacts at the edge of a button or outline read as stray 1-2 character "words"
 * ("누 공지 바로가기"); a real word at the end of a line is long or about as confident as its
 * neighbours.
 */
function trimEdgeNoise(segment: Token[]): Token[] {
  const out = [...segment]
  const isNoise = (t: Token, others: Token[]) => {
    if (t.text.length > 2 || others.length === 0) return false
    const mean = others.reduce((sum, o) => sum + o.confidence, 0) / others.length
    return t.confidence < mean - 15
  }
  while (out.length > 1 && isNoise(out[0], out.slice(1))) out.shift()
  while (out.length > 1 && isNoise(out[out.length - 1], out.slice(0, -1))) out.pop()
  return out
}

interface Crop {
  canvas: OffscreenCanvas
  /** Top-left of the crop in `source` pixels, and the enlargement applied to it. */
  x: number
  y: number
  scale: number
}

/** Copies a padded rectangle of `source` (upscaled when small, which Tesseract prefers). */
function cropForRecheck(source: OffscreenCanvas, rect: Rect): Crop | null {
  const pad = Math.round(rect.height * 0.25)
  const x = Math.max(0, Math.floor(rect.x - pad))
  const y = Math.max(0, Math.floor(rect.y - pad))
  const w = Math.min(source.width, Math.ceil(rect.x + rect.width + pad)) - x
  const h = Math.min(source.height, Math.ceil(rect.y + rect.height + pad)) - y
  const scale = rect.height < 32 ? 2 : 1
  const canvas = new OffscreenCanvas(Math.max(1, w * scale), Math.max(1, h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, x, y, w, h, 0, 0, canvas.width, canvas.height)
  return { canvas, x, y, scale }
}

/**
 * The Korean-only model happily "reads" Latin words as Hangul + digits ("OptiImage" → "00 비
 * 00396") with a deceptively high confidence, so its answer is only accepted when it really is
 * Korean text: at least 60% of its non-space characters must be Hangul syllables.
 */
function isMostlyHangul(text: string): boolean {
  const chars = text.replace(/\s/g, '')
  if (!chars) return false
  const hangul = chars.match(/[가-힣]/g)?.length ?? 0
  return hangul / chars.length >= 0.6
}

/**
 * With the combined `kor+eng` model, which script wins on a mixed line depends on the rest of the
 * page: the same line can come out as "OHASIM| 2 OptiImage" (Hangul lost) on one image and as
 * "안녕하세요 00 비 00396" (Latin lost) on another. Each run of low-confidence words is therefore
 * re-read on just its crop by a Korean-only AND an English-only single-line worker, and the more
 * confident reading replaces the original if it is clearly better. A Korean reading must really be
 * Hangul (see isMostlyHangul), and an English reading cannot contain Hangul by construction.
 */
async function recheckLowConfidence(
  source: OffscreenCanvas,
  segment: Token[],
  minHeight: number,
): Promise<Token[]> {
  const out: Token[] = []
  let i = 0
  while (i < segment.length) {
    if (segment[i].confidence >= RECHECK_CONFIDENCE) {
      out.push(segment[i++])
      continue
    }
    const run: Token[] = []
    while (i < segment.length && segment[i].confidence < RECHECK_CONFIDENCE) run.push(segment[i++])

    const rect = union(run.map((t) => t.bbox))
    // Junk blobs (texture, outlines) are tiny; re-reading them only burns time.
    if (rect.height < minHeight) {
      out.push(...run)
      continue
    }
    const crop = cropForRecheck(source, rect)
    const before = run.reduce((sum, t) => sum + t.confidence, 0) / run.length
    let best: { confidence: number; tokens: Token[] } | null = null
    if (crop) {
      for (const lang of ['kor', 'eng'] as const) {
        const worker = await getOcrWorker(lang, PSM.SINGLE_LINE)
        const { data } = await worker.recognize(crop.canvas, {}, { blocks: true, text: false })
        // Keep the words (with their own confidence and position, mapped back to `source`) so
        // that stray low-confidence words at the ends can still be trimmed afterwards.
        const tokens: Token[] = (data.blocks ?? [])
          .flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
          .map((w) => {
            const box = toRect(w.bbox)
            return {
              text: w.text.trim(),
              confidence: w.confidence,
              bbox: {
                x: crop.x + box.x / crop.scale,
                y: crop.y + box.y / crop.scale,
                width: box.width / crop.scale,
                height: box.height / crop.scale,
              },
            }
          })
          .filter((t) => t.text && t.bbox.width > 0 && t.bbox.height > 0)
          // The crop is padded, so it can contain the neighbouring words too — and those are
          // already in the segment. Only words that sit inside the re-read run are taken.
          .filter((t) => {
            const cx = t.bbox.x + t.bbox.width / 2
            const cy = t.bbox.y + t.bbox.height / 2
            return (
              cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height
            )
          })
        const text = tokens.map((t) => t.text).join(' ')
        if (!text || (lang === 'kor' && !isMostlyHangul(text))) continue
        if (!best || data.confidence > best.confidence) {
          best = { confidence: data.confidence, tokens }
        }
      }
    }
    if (best && best.confidence > before + 10) out.push(...best.tokens)
    else out.push(...run)
  }
  return out
}

/**
 * A re-read can legitimately cover words that are also in the segment (the first pass may have
 * drawn one low-confidence word's box far wider than the word), which then appear twice
 * ("2026. 10. 3. 10. 3."). Only a word with the SAME text as a more confident one at (nearly)
 * the same place is dropped — overlap alone is not enough, because first-pass boxes of distinct
 * neighbouring words ("10." / "3.") can overlap too.
 */
function dedupeTokens(segment: Token[]): Token[] {
  const kept: Token[] = []
  for (const token of [...segment].sort((a, b) => b.confidence - a.confidence)) {
    if (kept.some((k) => k.text === token.text && overlapRatio(k.bbox, token.bbox) > 0.3)) continue
    kept.push(token)
  }
  return kept.sort((a, b) => a.bbox.x - b.bbox.x)
}

/** Letters, digits and Hangul — what a real piece of text is made of. */
const WORD_CHAR = /[0-9A-Za-z가-힣]/g

/**
 * Rejects regions that are not text: mascots, outlines and texture come out as "© ×", "®—©0" or a
 * lone "7". A region needs mostly real characters, and a single character must be very confident.
 */
function isPlausibleText(text: string, confidence: number): boolean {
  const chars = text.replace(/\s/g, '')
  if (!chars) return false
  const wordChars = chars.match(WORD_CHAR)?.length ?? 0
  if (wordChars / chars.length < 0.5) return false
  if (chars.length === 1 && confidence < 85) return false
  return true
}

function overlapRatio(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  return (w * h) / Math.min(a.width * a.height, b.width * b.height)
}

/**
 * Merges the regions found by different passes. Overlapping candidates are the same text read
 * twice; the one with the best confidence × √length wins, so a full line beats a confident
 * fragment of itself.
 */
function mergeRegions(candidates: OcrTextRegion[]): OcrTextRegion[] {
  const score = (r: OcrTextRegion) => r.confidence * Math.sqrt(r.text.replace(/\s/g, '').length)
  const kept: OcrTextRegion[] = []
  for (const candidate of [...candidates].sort((a, b) => score(b) - score(a))) {
    if (kept.some((k) => overlapRatio(k.bbox, candidate.bbox) > 0.5)) continue
    kept.push(candidate)
  }
  // Reading order: top to bottom, then left to right.
  return kept.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
}

interface PassContext {
  lang: string
  granularity: 'line' | 'word'
  minConfidence: number
}

/** Runs one preprocessing pass and returns its regions in the INPUT image's coordinates. */
async function recognizePass(
  source: OffscreenCanvas,
  pass: OcrPass,
  { lang, granularity, minConfidence }: PassContext,
): Promise<OcrTextRegion[]> {
  const scale = scaleFor(source.width, source.height, pass)
  const canvas = renderPass(source, pass, scale)
  // Sparse-text mode suits photos/graphics: text is found wherever it is, without forcing a
  // document column layout.
  const worker = await getOcrWorker(lang, PSM.SPARSE_TEXT)
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false })

  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
  const regions: OcrTextRegion[] = []
  for (const line of lines) {
    const words: Token[] = line.words
      .map((w) => ({ text: w.text.trim(), confidence: w.confidence, bbox: toRect(w.bbox) }))
      .filter((w) => w.text && w.bbox.width > 0 && w.bbox.height > 0)

    for (let segment of splitAtGaps(words)) {
      if (lang === 'kor+eng') {
        segment = dedupeTokens(await recheckLowConfidence(canvas, segment, MIN_TEXT_HEIGHT * scale))
      }
      segment = trimEdgeNoise(segment)
      const groups = granularity === 'word' ? segment.map((t) => [t]) : [segment]
      for (const group of groups) {
        const confidence = group.reduce((s, t) => s + t.confidence, 0) / group.length
        const text = group.map((t) => t.text).join(' ')
        if (confidence < minConfidence || !isPlausibleText(text, confidence)) continue
        const box = union(group.map((t) => t.bbox))
        if (box.height / scale < MIN_TEXT_HEIGHT) continue
        const shortLimit = pass === 'gray' ? SHORT_TEXT_CONFIDENCE.gray : SHORT_TEXT_CONFIDENCE.ink
        if (text.replace(/\s/g, '').length <= SHORT_TEXT_CHARS && confidence < shortLimit) continue
        regions.push({
          id: crypto.randomUUID(),
          text,
          confidence: Math.round(confidence),
          bbox: { x: box.x / scale, y: box.y / scale, width: box.width / scale, height: box.height / scale },
        })
      }
    }
  }
  return regions
}

/**
 * Tesseract.js OCR plugin. Returns line (or word) regions with bounding boxes in the input
 * bitmap's pixel coordinates; callers that pass a downscaled bitmap scale them back.
 */
export const ocrPlugin: AiPlugin<OcrOptions, OcrTextRegion[]> = {
  id: 'ocr',
  name: '텍스트 인식(OCR)',
  description: 'Tesseract.js로 이미지 속 한국어/영어 텍스트와 위치를 브라우저에서 인식합니다.',
  isReady: true,
  run: async ({ bitmap, options, onProgress }) => {
    const lang = options?.lang ?? 'kor+eng'
    const granularity = options?.granularity ?? 'line'
    const floor = options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE

    const source = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = source.getContext('2d')
    if (!ctx) throw new Error('2D context unavailable for OCR')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()

    try {
      // Fail early (and with a helpful message) if the engine itself cannot be loaded.
      try {
        await getOcrWorker(lang, PSM.SPARSE_TEXT)
      } catch {
        throw new Error(
          'OCR 엔진을 불러오지 못했습니다. 네트워크 연결을 확인하거나 광고 차단 확장 프로그램을 꺼보세요.',
        )
      }

      const all: OcrTextRegion[] = []
      for (let i = 0; i < PASSES.length; i++) {
        const { pass, minConfidence } = PASSES[i]
        // Tesseract reports 0-100 for each pass; spread that over the whole run.
        setOcrProgressListener(
          onProgress ? (p) => onProgress(Math.round(((i + p / 100) / PASSES.length) * 100)) : null,
        )
        all.push(...(await recognizePass(source, pass, { lang, granularity, minConfidence: Math.max(floor, minConfidence) })))
      }
      onProgress?.(100)
      return mergeRegions(all)
    } finally {
      setOcrProgressListener(null)
    }
  },
}
