import { clampRect, resizeMask } from './mask'
import type { EditMask, Rect } from '@/types/editing'

/**
 * Upper bound on the pixel count of a region we rasterize/fill at once (≈ 4000×4000). A huge
 * selection on an 8K photo is processed at reduced resolution instead of allocating several
 * 190MB RGBA buffers; the patch is drawn back scaled, and pixels outside the mask are never
 * touched, so the rest of the image keeps its full original resolution.
 */
export const MAX_REGION_PIXELS = 16_000_000

/** Working long-edge limits per algorithm (the fill is upscaled back to region resolution). */
export const WORKING_MAX_EDGE = {
  telea: 2048,
  /** Borrowed texture is grain-scale, so it is kept at (up to) the region's own resolution. */
  texture: 4096,
  patchmatch: 1024,
  ai: 2048,
} as const

/** Holes thinner than this (working px, distance to nearest known pixel) use Telea. */
export const THIN_HOLE_THRESHOLD = 6

export interface InpaintRegion {
  /** Region in source pixels (selection + surrounding context). */
  rect: Rect
  /** Processing resolution for the region (≤ MAX_REGION_PIXELS). */
  outWidth: number
  outHeight: number
}

/**
 * Selection bounds → processing region. Context padding grows with the selection so fillers
 * (and the AI model) see enough of the surrounding scene to continue it plausibly, while
 * never feeding the whole image to them.
 */
export function computeInpaintRegion(
  selection: Rect,
  imageWidth: number,
  imageHeight: number,
  feather: number,
): InpaintRegion | null {
  const pad = Math.min(1536, Math.max(48, Math.round(Math.max(selection.width, selection.height) * 0.6)))
  const rect = clampRect(selection, pad + feather, imageWidth, imageHeight)
  if (!rect) return null
  const scale = Math.min(1, Math.sqrt(MAX_REGION_PIXELS / (rect.width * rect.height)))
  return {
    rect,
    outWidth: Math.max(1, Math.round(rect.width * scale)),
    outHeight: Math.max(1, Math.round(rect.height * scale)),
  }
}

export function fitWithin(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

/** High-quality RGBA resample via the browser's image scaler (works inside workers). */
export async function resizeRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
): Promise<Uint8ClampedArray> {
  if (width === outWidth && height === outHeight) return new Uint8ClampedArray(data)
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(data), width, height), {
    resizeWidth: outWidth,
    resizeHeight: outHeight,
    resizeQuality: 'high',
  })
  const canvas = new OffscreenCanvas(outWidth, outHeight)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D context unavailable for resampling')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, outWidth, outHeight).data
}

export function maskToHole(mask: EditMask): Uint8Array {
  const hole = new Uint8Array(mask.data.length)
  for (let i = 0; i < hole.length; i++) hole[i] = mask.data[i] > 0 ? 1 : 0
  return hole
}

/**
 * Runs `fill` at most at `maxEdge` resolution and merges the result back: outside the mask the
 * original region pixels are kept verbatim, inside it the (upscaled) fill is used.
 */
export async function fillAtWorkingResolution(
  image: Uint8ClampedArray,
  mask: EditMask,
  maxEdge: number,
  fill: (rgba: Uint8ClampedArray, hole: Uint8Array, width: number, height: number) => Promise<void> | void,
): Promise<Uint8ClampedArray> {
  const { width, height } = mask
  const working = fitWithin(width, height, maxEdge)

  if (working.scale === 1) {
    const rgba = new Uint8ClampedArray(image)
    await fill(rgba, maskToHole(mask), width, height)
    return rgba
  }

  const small = await resizeRgba(image, width, height, working.width, working.height)
  const smallMask = resizeMask(mask, working.width, working.height)
  await fill(small, maskToHole(smallMask), working.width, working.height)
  const up = await resizeRgba(small, working.width, working.height, width, height)

  const out = new Uint8ClampedArray(image)
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i] === 0) continue
    const p = i * 4
    out[p] = up[p]
    out[p + 1] = up[p + 1]
    out[p + 2] = up[p + 2]
    out[p + 3] = up[p + 3]
  }
  return out
}
