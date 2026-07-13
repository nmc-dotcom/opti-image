import type { EditSettings, ResizeSettings } from '@/types/image'

const MIME_BY_FORMAT: Record<EditSettings['format'], string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export function formatToMime(format: EditSettings['format']): string {
  return MIME_BY_FORMAT[format]
}

/** Computes final output dimensions for a given source size + resize settings. */
export function computeResizedDimensions(
  sourceWidth: number,
  sourceHeight: number,
  resize: ResizeSettings,
): { width: number; height: number } {
  const ratio = sourceWidth / sourceHeight

  switch (resize.mode) {
    case 'exact': {
      let width = resize.width || sourceWidth
      let height = resize.height || sourceHeight
      if (resize.keepAspectRatio) {
        if (resize.width && !resize.height) height = Math.round(width / ratio)
        else if (resize.height && !resize.width) width = Math.round(height * ratio)
        else height = Math.round(width / ratio)
      }
      return {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      }
    }
    case 'longEdge': {
      const target = resize.longEdge || Math.max(sourceWidth, sourceHeight)
      if (sourceWidth >= sourceHeight) {
        return { width: target, height: Math.max(1, Math.round(target / ratio)) }
      }
      return { width: Math.max(1, Math.round(target * ratio)), height: target }
    }
    case 'percentage': {
      const pct = (resize.percentage || 100) / 100
      return {
        width: Math.max(1, Math.round(sourceWidth * pct)),
        height: Math.max(1, Math.round(sourceHeight * pct)),
      }
    }
    case 'none':
    default:
      return { width: sourceWidth, height: sourceHeight }
  }
}

/**
 * Runs the full edit pipeline (crop -> rotate -> flip -> resize) on a bitmap using an
 * OffscreenCanvas, and returns the resulting canvas ready for encoding.
 */
export function renderEditedCanvas(
  bitmap: ImageBitmap,
  settings: EditSettings,
): OffscreenCanvas {
  const crop = settings.crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height }

  const cropCanvas = new OffscreenCanvas(crop.width, crop.height)
  const cropCtx = cropCanvas.getContext('2d')
  if (!cropCtx) throw new Error('2D context unavailable for crop stage')
  cropCtx.drawImage(
    bitmap,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  )

  const swapDimensions = settings.rotation === 90 || settings.rotation === 270
  const rotatedWidth = swapDimensions ? cropCanvas.height : cropCanvas.width
  const rotatedHeight = swapDimensions ? cropCanvas.width : cropCanvas.height

  const rotateCanvas = new OffscreenCanvas(rotatedWidth, rotatedHeight)
  const rotateCtx = rotateCanvas.getContext('2d')
  if (!rotateCtx) throw new Error('2D context unavailable for rotate stage')
  rotateCtx.translate(rotatedWidth / 2, rotatedHeight / 2)
  rotateCtx.rotate((settings.rotation * Math.PI) / 180)
  rotateCtx.drawImage(cropCanvas, -cropCanvas.width / 2, -cropCanvas.height / 2)

  const flipCanvas = new OffscreenCanvas(rotatedWidth, rotatedHeight)
  const flipCtx = flipCanvas.getContext('2d')
  if (!flipCtx) throw new Error('2D context unavailable for flip stage')
  const flipX = settings.flip === 'horizontal' || settings.flip === 'both' ? -1 : 1
  const flipY = settings.flip === 'vertical' || settings.flip === 'both' ? -1 : 1
  flipCtx.translate(flipX === -1 ? rotatedWidth : 0, flipY === -1 ? rotatedHeight : 0)
  flipCtx.scale(flipX, flipY)
  flipCtx.drawImage(rotateCanvas, 0, 0)

  const { width: outWidth, height: outHeight } = computeResizedDimensions(
    rotatedWidth,
    rotatedHeight,
    settings.resize,
  )

  if (outWidth === rotatedWidth && outHeight === rotatedHeight) {
    return flipCanvas
  }

  const resizeCanvas = new OffscreenCanvas(outWidth, outHeight)
  const resizeCtx = resizeCanvas.getContext('2d')
  if (!resizeCtx) throw new Error('2D context unavailable for resize stage')
  resizeCtx.imageSmoothingEnabled = true
  resizeCtx.imageSmoothingQuality = 'high'
  resizeCtx.drawImage(flipCanvas, 0, 0, outWidth, outHeight)

  return resizeCanvas
}
