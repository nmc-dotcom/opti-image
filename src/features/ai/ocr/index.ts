import type Tesseract from 'tesseract.js'
import type { AiPlugin } from '../types'
import { PSM, getOcrWorker, setOcrProgressListener } from './engine'
import type { OcrOptions, OcrTextRegion } from './types'
import type { Rect } from '@/types/editing'

const DEFAULT_MIN_CONFIDENCE = 40
/** Words below this confidence in the mixed-language pass get a Korean/English-only second look. */
const RECHECK_CONFIDENCE = 75
/** A gap wider than this many word-heights splits one Tesseract "line" into separate regions. */
const SPLIT_GAP_RATIO = 1.5

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

/** Copies a padded rectangle of `source` (upscaled when small, which Tesseract prefers). */
function cropForRecheck(source: OffscreenCanvas, rect: Rect) {
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
  return canvas
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
async function recheckLowConfidence(source: OffscreenCanvas, segment: Token[]): Promise<Token[]> {
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
    const crop = cropForRecheck(source, rect)
    const before = run.reduce((sum, t) => sum + t.confidence, 0) / run.length
    let best: Token | null = null
    if (crop) {
      for (const lang of ['kor', 'eng'] as const) {
        const worker = await getOcrWorker(lang, PSM.SINGLE_LINE)
        const { data } = await worker.recognize(crop, {}, { text: true })
        const text = data.text.replace(/\s+/g, ' ').trim()
        if (!text || (lang === 'kor' && !isMostlyHangul(text))) continue
        if (!best || data.confidence > best.confidence) {
          best = { text, confidence: data.confidence, bbox: rect }
        }
      }
    }
    if (best && best.confidence > before + 10) out.push(best)
    else out.push(...run)
  }
  return out
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
    const minConfidence = options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D context unavailable for OCR')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()

    setOcrProgressListener(onProgress ?? null)
    try {
      let worker: Tesseract.Worker
      try {
        // Sparse-text mode suits photos/graphics: text is found wherever it is, without
        // forcing a document column layout.
        worker = await getOcrWorker(lang, PSM.SPARSE_TEXT)
      } catch {
        throw new Error(
          'OCR 엔진을 불러오지 못했습니다. 네트워크 연결을 확인하거나 광고 차단 확장 프로그램을 꺼보세요.',
        )
      }

      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false })
      setOcrProgressListener(null)

      const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      const regions: OcrTextRegion[] = []
      for (const line of lines) {
        const words: Token[] = line.words
          .map((w) => ({ text: w.text.trim(), confidence: w.confidence, bbox: toRect(w.bbox) }))
          .filter((w) => w.text && w.bbox.width > 0 && w.bbox.height > 0)

        for (let segment of splitAtGaps(words)) {
          if (lang === 'kor+eng') segment = await recheckLowConfidence(canvas, segment)
          const groups = granularity === 'word' ? segment.map((t) => [t]) : [segment]
          for (const group of groups) {
            const confidence = group.reduce((s, t) => s + t.confidence, 0) / group.length
            if (confidence < minConfidence) continue
            regions.push({
              id: crypto.randomUUID(),
              text: group.map((t) => t.text).join(' '),
              confidence: Math.round(confidence),
              bbox: union(group.map((t) => t.bbox)),
            })
          }
        }
      }
      onProgress?.(100)
      return regions
    } finally {
      setOcrProgressListener(null)
    }
  },
}
