import { fontString } from './textRendering'
import type { Rect, TextLayer } from '@/types/editing'

let measureCtx: OffscreenCanvasRenderingContext2D | null = null
function getMeasureCtx() {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d')
  return measureCtx
}

/**
 * Font size whose rendered ink height for `text` equals `inkHeight` (e.g. an OCR bbox height).
 * Measured with the real font via TextMetrics, so it adapts to Hangul vs. digits vs. descenders.
 */
export function estimateFontSize(
  text: string,
  inkHeight: number,
  fontFamily: string,
  fontWeight: TextLayer['fontWeight'],
): number {
  const ctx = getMeasureCtx()
  if (!ctx) return Math.max(8, Math.round(inkHeight))
  ctx.font = fontString({ fontFamily, fontWeight, fontSize: 100 })
  const m = ctx.measureText(text || 'H')
  const ink = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  if (!(ink > 0)) return Math.max(8, Math.round(inkHeight))
  return Math.max(6, Math.round((inkHeight * 100) / ink))
}

function toHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Estimates text and background colors inside a text bounding box. Background = per-channel
 * median of the box border (text rarely touches all edges); text = mean of the pixels farthest
 * from that background, which picks the glyph strokes and ignores their anti-aliased edges.
 */
export function estimateTextColors(image: ImageData): { text: string; background: string } {
  const { width, height, data } = image
  const border: [number[], number[], number[]] = [[], [], []]
  const pushPixel = (x: number, y: number) => {
    const p = (y * width + x) * 4
    border[0].push(data[p])
    border[1].push(data[p + 1])
    border[2].push(data[p + 2])
  }
  for (let x = 0; x < width; x++) {
    pushPixel(x, 0)
    pushPixel(x, height - 1)
  }
  for (let y = 1; y < height - 1; y++) {
    pushPixel(0, y)
    pushPixel(width - 1, y)
  }
  const bg = border.map(median) as [number, number, number]

  const distances = new Float32Array(width * height)
  let maxDist = 0
  for (let i = 0; i < width * height; i++) {
    const p = i * 4
    const d = Math.hypot(data[p] - bg[0], data[p + 1] - bg[1], data[p + 2] - bg[2])
    distances[i] = d
    if (d > maxDist) maxDist = d
  }

  if (maxDist < 24) {
    // No clear ink: fall back to black/white by background luminance.
    const lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]
    return { text: lum > 128 ? '#000000' : '#ffffff', background: toHex(...bg) }
  }

  let r = 0
  let g = 0
  let b = 0
  let n = 0
  const threshold = maxDist * 0.6
  for (let i = 0; i < distances.length; i++) {
    if (distances[i] < threshold) continue
    const p = i * 4
    r += data[p]
    g += data[p + 1]
    b += data[p + 2]
    n++
  }
  return { text: toHex(r / n, g / n, b / n), background: toHex(...bg) }
}

/**
 * Tightens an OCR box to the actual glyph ink inside it. Tesseract's boxes can be noticeably
 * loose (e.g. 72px tall for 48px digits); a loose box both oversizes the estimated font and
 * makes the removal mask reach into neighbouring lines. Shrink-only, so it never grows into
 * adjacent text. `image` is the full image the box coordinates refer to.
 */
export function refineTextBox(image: ImageData, box: Rect): Rect {
  const x0 = Math.max(0, Math.floor(box.x))
  const y0 = Math.max(0, Math.floor(box.y))
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width))
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height))
  const w = x1 - x0
  const h = y1 - y0
  if (w < 3 || h < 3) return box

  const { data, width } = image
  const border: [number[], number[], number[]] = [[], [], []]
  const push = (x: number, y: number) => {
    const p = (y * width + x) * 4
    border[0].push(data[p])
    border[1].push(data[p + 1])
    border[2].push(data[p + 2])
  }
  for (let x = x0; x < x1; x++) {
    push(x, y0)
    push(x, y1 - 1)
  }
  for (let y = y0; y < y1; y++) {
    push(x0, y)
    push(x1 - 1, y)
  }
  const bg = border.map(median)

  let maxDist = 0
  const dist = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = ((y0 + y) * width + x0 + x) * 4
      const d = Math.hypot(data[p] - bg[0], data[p + 1] - bg[1], data[p + 2] - bg[2])
      dist[y * w + x] = d
      if (d > maxDist) maxDist = d
    }
  }
  // Busy or low-contrast background: no reliable ink/background split, keep Tesseract's box.
  if (maxDist < 40) return box
  const threshold = Math.max(30, maxDist * 0.4)

  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (dist[y * w + x] < threshold) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return box
  return { x: x0 + minX, y: y0 + minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}
