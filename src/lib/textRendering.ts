import type { Rect, TextLayer } from '@/types/editing'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export const LINE_HEIGHT = 1.2

export interface FontOption {
  label: string
  value: string
}

/**
 * Locally installed font stacks only — no web-font download, and the same names resolve both
 * on the page and inside the worker's OffscreenCanvas, so preview and export match.
 */
export const FONT_OPTIONS: FontOption[] = [
  {
    label: '고딕 (Sans)',
    value:
      '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "Segoe UI", Arial, sans-serif',
  },
  {
    label: '명조 (Serif)',
    value: '"Batang", "AppleMyungjo", "Noto Serif KR", "Noto Serif CJK KR", Georgia, "Times New Roman", serif',
  },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
]

export function fontString(layer: Pick<TextLayer, 'fontWeight' | 'fontSize' | 'fontFamily'>) {
  return `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`
}

/** Glyphs spanning cap height in Latin, digits and Hangul, used as a stable vertical reference. */
const CAP_REFERENCE = 'H0가'
const capRatioCache = new Map<string, number>()

/**
 * Cap/Hangul ink height as a fraction of the font size for a family+weight. Using one reference
 * per font (instead of the current string's own ink box) keeps the baseline from jumping while
 * the user types characters with or without descenders.
 */
export function capRatio(ctx: Ctx2D, layer: Pick<TextLayer, 'fontWeight' | 'fontFamily'>) {
  const key = `${layer.fontWeight}|${layer.fontFamily}`
  let ratio = capRatioCache.get(key)
  if (ratio === undefined) {
    ctx.save()
    ctx.font = fontString({ ...layer, fontSize: 100 })
    ctx.textBaseline = 'alphabetic'
    const ascent = ctx.measureText(CAP_REFERENCE).actualBoundingBoxAscent
    ctx.restore()
    ratio = ascent > 0 ? ascent / 100 : 0.72
    capRatioCache.set(key, ratio)
  }
  return ratio
}

/**
 * Draws one text layer in SOURCE pixel space; callers scale the context for previews. Text is
 * aligned horizontally inside the layer box and its cap height is centered vertically on the
 * box, so a replacement sits exactly where the OCR'd original was even if the string changes.
 */
export function drawTextLayer(ctx: Ctx2D, layer: TextLayer) {
  const lines = layer.text.split('\n')
  const lineHeight = layer.fontSize * LINE_HEIGHT
  const cx = layer.x + layer.width / 2
  const cy = layer.y + layer.height / 2
  const cap = capRatio(ctx, layer) * layer.fontSize

  ctx.save()
  ctx.translate(cx, cy)
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180)
  ctx.font = fontString(layer)
  ctx.fillStyle = layer.color
  ctx.textAlign = layer.textAlign
  ctx.textBaseline = 'alphabetic'

  const anchorX =
    layer.textAlign === 'center'
      ? 0
      : layer.textAlign === 'right' || layer.textAlign === 'end'
        ? layer.width / 2
        : -layer.width / 2
  const firstBaseline = -((lines.length - 1) * lineHeight) / 2 + cap / 2
  lines.forEach((line, i) => ctx.fillText(line, anchorX, firstBaseline + i * lineHeight))
  ctx.restore()
}

export function drawTextLayers(ctx: Ctx2D, layers: TextLayer[]) {
  for (const layer of layers) drawTextLayer(ctx, layer)
}

let measureCtx: OffscreenCanvasRenderingContext2D | null = null

/**
 * Axis-aligned extent of the rendered text (ignores rotation), in source pixels — used to size a
 * new layer's box and to hit-test layers that grew beyond their original OCR box.
 */
export function measureTextLayer(layer: TextLayer): Rect {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d')
  const lines = layer.text.split('\n')
  let textWidth = 0
  if (measureCtx) {
    measureCtx.font = fontString(layer)
    for (const line of lines) textWidth = Math.max(textWidth, measureCtx.measureText(line).width)
  } else {
    textWidth = layer.fontSize * 0.6 * Math.max(...lines.map((l) => l.length))
  }
  const textHeight = lines.length * layer.fontSize * LINE_HEIGHT

  const left =
    layer.textAlign === 'center'
      ? layer.x + (layer.width - textWidth) / 2
      : layer.textAlign === 'right' || layer.textAlign === 'end'
        ? layer.x + layer.width - textWidth
        : layer.x
  const top = layer.y + (layer.height - textHeight) / 2

  const x = Math.min(layer.x, left)
  const y = Math.min(layer.y, top)
  return {
    x,
    y,
    width: Math.max(layer.x + layer.width, left + textWidth) - x,
    height: Math.max(layer.y + layer.height, top + textHeight) - y,
  }
}
