import type { Rect, RetouchPatch } from '@/types/editing'

function get2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable for retouch compositing')
  return ctx
}

/**
 * Draws retouch patches (PNG with feathered alpha, in source coordinates) over a full-size
 * source bitmap. Plain `source-over` gives exactly fill·α + original·(1-α), so a patch blends
 * seamlessly into its surroundings. Consumes `bitmap` and returns a new one.
 */
export async function composeRetouchPatches(
  bitmap: ImageBitmap,
  patches: RetouchPatch[],
): Promise<ImageBitmap> {
  if (patches.length === 0) return bitmap
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = get2d(canvas)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  for (const patch of patches) {
    const patchBitmap = await createImageBitmap(patch.blob)
    // Explicit size: patches of very large selections are stored at reduced resolution.
    ctx.drawImage(patchBitmap, patch.x, patch.y, patch.width, patch.height)
    patchBitmap.close()
  }
  return canvas.transferToImageBitmap()
}

/**
 * Renders the current retouched image (source + patches) for just `region`, optionally scaled
 * to `outWidth`×`outHeight`. Only the region-sized canvas is kept; the full decode is released
 * immediately, so preparing an inpainting crop of an 8K photo never holds two full copies.
 */
export async function renderRetouchedRegion(
  file: Blob,
  patches: RetouchPatch[],
  region: Rect,
  outWidth = region.width,
  outHeight = region.height,
): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(outWidth, outHeight)
  const ctx = get2d(canvas)
  ctx.imageSmoothingQuality = 'high'
  const sx = outWidth / region.width
  const sy = outHeight / region.height

  // Decode the whole file and crop with drawImage (rather than createImageBitmap's crop
  // rectangle) so EXIF orientation is applied exactly as in the main pipeline.
  const source = await createImageBitmap(file)
  ctx.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, outWidth, outHeight)
  source.close()

  for (const patch of patches) {
    const overlaps =
      patch.x < region.x + region.width &&
      patch.x + patch.width > region.x &&
      patch.y < region.y + region.height &&
      patch.y + patch.height > region.y
    if (!overlaps) continue
    const patchBitmap = await createImageBitmap(patch.blob)
    ctx.drawImage(
      patchBitmap,
      (patch.x - region.x) * sx,
      (patch.y - region.y) * sy,
      patch.width * sx,
      patch.height * sy,
    )
    patchBitmap.close()
  }
  return canvas
}
