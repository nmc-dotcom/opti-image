/**
 * Image preparation for OCR. Tesseract binarizes internally with one global threshold, which
 * fails on exactly the images people want to edit text in: banners, buttons and notices with
 * coloured/textured backgrounds, light-on-dark lettering and glyphs only ~12px tall. Each pass
 * below hands it an easier version of the same picture; the plugin reads all of them and merges
 * the results.
 *
 * - gray       luminance only. Surprisingly decisive: the same colour banner that returns garbage
 *              reads at ~95% confidence once colour is dropped.
 * - light-ink  pixels brighter than their LOCAL surroundings become black ink on white
 *              (light lettering, and dark lettering on a light button that sits on a dark ground).
 * - dark-ink   pixels darker than their local surroundings become black ink on white.
 *
 * The local passes use a Bradley-style adaptive threshold computed with an integral image, so a
 * button's text is judged against the button, not against the whole picture.
 */

export type OcrPass = 'gray' | 'light-ink' | 'dark-ink'

/** Glyphs smaller than this are hopeless for Tesseract; small images are enlarged to compensate. */
const SMALL_EDGE = 1000
const SMALL_TARGET_EDGE = 1200
const MAX_UPSCALE = 4
/**
 * Local passes turn texture (grass, fabric, noise) into hundreds of "ink" blobs, and Tesseract's
 * run time grows with that count (5-8 s on a 2400px photo vs 0.6 s for the plain grayscale pass).
 * They exist for banners, buttons and notices — small, flat graphics — while text in a big photo
 * is large enough for the grayscale pass, so their canvas is capped.
 */
const LOCAL_MAX_EDGE = 1280
const LOCAL_THRESHOLD = 0.12
const LOCAL_WINDOW = 0.12

/** Scale factor (relative to the input) at which `pass` should be rendered. */
export function scaleFor(width: number, height: number, pass: OcrPass): number {
  const longEdge = Math.max(width, height)
  const base = longEdge < SMALL_EDGE ? Math.min(MAX_UPSCALE, SMALL_TARGET_EDGE / longEdge) : 1
  if (pass === 'gray') return base
  return Math.min(base, LOCAL_MAX_EDGE / longEdge)
}

function luminance(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    data[i] = data[i + 1] = data[i + 2] = g
  }
}

function localThreshold(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  ink: 'light' | 'dark',
) {
  luminance(data)
  const stride = width + 1
  const integral = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += data[(y * width + x) * 4]
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row
    }
  }
  const radius = Math.max(8, Math.round(Math.min(width, height) * LOCAL_WINDOW))
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height, y + radius + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width, x + radius + 1)
      const sum =
        integral[y1 * stride + x1] -
        integral[y0 * stride + x1] -
        integral[y1 * stride + x0] +
        integral[y0 * stride + x0]
      const mean = sum / ((x1 - x0) * (y1 - y0))
      const v = data[(y * width + x) * 4]
      const isInk =
        ink === 'light' ? v > mean * (1 + LOCAL_THRESHOLD) : v < mean * (1 - LOCAL_THRESHOLD)
      const out = isInk ? 0 : 255
      const p = (y * width + x) * 4
      data[p] = data[p + 1] = data[p + 2] = out
    }
  }
}

/** Renders `source` for the given pass at `scale`. */
export function renderPass(source: OffscreenCanvas, pass: OcrPass, scale: number): OffscreenCanvas {
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D context unavailable for OCR preprocessing')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)

  const image = ctx.getImageData(0, 0, width, height)
  if (pass === 'gray') luminance(image.data)
  else localThreshold(image.data, width, height, pass === 'light-ink' ? 'light' : 'dark')
  ctx.putImageData(image, 0, 0)
  return canvas
}
