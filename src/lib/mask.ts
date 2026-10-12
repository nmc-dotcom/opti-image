import type { EditMask, MaskStroke, Rect } from '@/types/editing'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Maps source-pixel stroke coordinates onto a target canvas: target = (src - origin) * scale. */
export interface MaskTransform {
  scale: number
  originX: number
  originY: number
}

const SOFT_SPRITE_SIZE = 128
const softSprites = new Map<string, OffscreenCanvas>()

/**
 * A radial-gradient dab rendered once per color and then stamped with drawImage — far cheaper
 * than building a gradient per dab while the user drags a soft brush.
 */
function getSoftSprite(color: string): OffscreenCanvas {
  let sprite = softSprites.get(color)
  if (sprite) return sprite
  sprite = new OffscreenCanvas(SOFT_SPRITE_SIZE, SOFT_SPRITE_SIZE)
  const ctx = sprite.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable for brush sprite')
  const r = SOFT_SPRITE_SIZE / 2
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r)
  gradient.addColorStop(0, color)
  gradient.addColorStop(0.45, color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, SOFT_SPRITE_SIZE, SOFT_SPRITE_SIZE)
  softSprites.set(color, sprite)
  return sprite
}

function drawStroke(ctx: Ctx2D, stroke: MaskStroke, t: MaskTransform, color: string) {
  const px = (x: number) => (x - t.originX) * t.scale
  const py = (y: number) => (y - t.originY) * t.scale

  ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over'
  ctx.fillStyle = color
  ctx.strokeStyle = color

  switch (stroke.kind) {
    case 'rect':
      ctx.fillRect(px(stroke.x), py(stroke.y), stroke.width * t.scale, stroke.height * t.scale)
      return

    case 'lasso': {
      const pts = stroke.points
      if (pts.length < 6) return
      ctx.beginPath()
      ctx.moveTo(px(pts[0]), py(pts[1]))
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(px(pts[i]), py(pts[i + 1]))
      ctx.closePath()
      ctx.fill()
      return
    }

    case 'brush': {
      const pts = stroke.points
      if (pts.length < 2) return
      const size = stroke.size * t.scale

      if (stroke.edge === 'soft') {
        // Stamp dabs along the path. The sprite's solid core is 45% of its radius, so a soft
        // dab is drawn ~1.4x larger to keep the fully-selected core close to the brush size.
        const sprite = getSoftSprite(color)
        const dab = size * 1.4
        const spacing = Math.max(1, size * 0.2)
        const stamp = (x: number, y: number) =>
          ctx.drawImage(sprite, x - dab / 2, y - dab / 2, dab, dab)
        let prevX = px(pts[0])
        let prevY = py(pts[1])
        stamp(prevX, prevY)
        for (let i = 2; i < pts.length; i += 2) {
          const x = px(pts[i])
          const y = py(pts[i + 1])
          const dist = Math.hypot(x - prevX, y - prevY)
          const steps = Math.floor(dist / spacing)
          for (let s = 1; s <= steps; s++) {
            const f = (s * spacing) / dist
            stamp(prevX + (x - prevX) * f, prevY + (y - prevY) * f)
          }
          if (steps > 0) {
            const f = (steps * spacing) / dist
            prevX = prevX + (x - prevX) * f
            prevY = prevY + (y - prevY) * f
          }
        }
        return
      }

      if (pts.length === 2) {
        ctx.beginPath()
        ctx.arc(px(pts[0]), py(pts[1]), size / 2, 0, Math.PI * 2)
        ctx.fill()
        return
      }
      ctx.lineWidth = size
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(px(pts[0]), py(pts[1]))
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(px(pts[i]), py(pts[i + 1]))
      ctx.stroke()
    }
  }
}

/**
 * Rasterizes a stroke list onto any 2D context (on-screen overlay or worker OffscreenCanvas).
 * Using the same routine for both guarantees the region that gets removed is exactly the
 * region the user saw highlighted.
 */
export function drawMaskStrokes(
  ctx: Ctx2D,
  strokes: MaskStroke[],
  transform: MaskTransform,
  color = '#ffffff',
) {
  ctx.save()
  for (const stroke of strokes) drawStroke(ctx, stroke, transform, color)
  ctx.restore()
}

/** Bounding box (source pixels) of everything the strokes can select, or null when empty. */
export function getStrokesBounds(strokes: MaskStroke[]): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const include = (x: number, y: number, pad: number) => {
    minX = Math.min(minX, x - pad)
    minY = Math.min(minY, y - pad)
    maxX = Math.max(maxX, x + pad)
    maxY = Math.max(maxY, y + pad)
  }

  for (const stroke of strokes) {
    // Erase strokes can only shrink the selection, so they never grow the bounds.
    if (stroke.mode === 'erase') continue
    if (stroke.kind === 'rect') {
      include(stroke.x, stroke.y, 0)
      include(stroke.x + stroke.width, stroke.y + stroke.height, 0)
    } else {
      // Soft dabs are drawn 1.4x the nominal size (see drawStroke).
      const pad =
        stroke.kind === 'brush' ? (stroke.size * (stroke.edge === 'soft' ? 1.4 : 1)) / 2 : 0
      for (let i = 0; i < stroke.points.length; i += 2) {
        include(stroke.points[i], stroke.points[i + 1], pad)
      }
    }
  }

  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Integer rect grown by `pad` and clamped to the image; null if nothing is left. */
export function clampRect(rect: Rect, pad: number, imageWidth: number, imageHeight: number): Rect | null {
  const x0 = Math.max(0, Math.floor(rect.x - pad))
  const y0 = Math.max(0, Math.floor(rect.y - pad))
  const x1 = Math.min(imageWidth, Math.ceil(rect.x + rect.width + pad))
  const y1 = Math.min(imageHeight, Math.ceil(rect.y + rect.height + pad))
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * Rasterizes strokes into a mask covering `region` (source pixels), at `outWidth`×`outHeight`
 * (defaults to the region's full resolution).
 */
export function rasterizeMask(
  strokes: MaskStroke[],
  region: Rect,
  outWidth = region.width,
  outHeight = region.height,
): EditMask {
  const canvas = new OffscreenCanvas(outWidth, outHeight)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D context unavailable for mask rasterization')
  drawMaskStrokes(ctx, strokes, {
    scale: outWidth / region.width,
    originX: region.x,
    originY: region.y,
  })
  const rgba = ctx.getImageData(0, 0, outWidth, outHeight).data
  const data = new Uint8ClampedArray(outWidth * outHeight)
  for (let i = 0, j = 3; i < data.length; i++, j += 4) data[i] = rgba[j]
  return { width: outWidth, height: outHeight, data }
}

/**
 * Running-sum box blur, separable, O(width*height) regardless of radius. Operates in place via
 * one scratch buffer so even a large region costs only 2 bytes per pixel.
 */
function boxBlur(src: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius < 1) return
  const tmp = new Uint8ClampedArray(src.length)
  const size = radius * 2 + 1

  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let i = -radius; i <= radius; i++) sum += src[row + Math.min(width - 1, Math.max(0, i))]
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / size
      const add = Math.min(width - 1, x + radius + 1)
      const sub = Math.max(0, x - radius)
      sum += src[row + add] - src[row + sub]
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let i = -radius; i <= radius; i++) sum += tmp[Math.min(height - 1, Math.max(0, i)) * width + x]
    for (let y = 0; y < height; y++) {
      src[y * width + x] = sum / size
      const add = Math.min(height - 1, y + radius + 1)
      const sub = Math.max(0, y - radius)
      sum += tmp[add * width + x] - tmp[sub * width + x]
    }
  }
}

/** 1D binary dilation along one axis: selected if any selected pixel lies within `r`. */
function dilateLines(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  lines: number,
  length: number,
  stride: number,
  lineStride: number,
  r: number,
) {
  for (let l = 0; l < lines; l++) {
    const base = l * lineStride
    let last = -Infinity
    for (let i = 0; i < length; i++) {
      if (src[base + i * stride] > 0) last = i
      dst[base + i * stride] = i - last <= r ? 255 : 0
    }
    let next = Infinity
    for (let i = length - 1; i >= 0; i--) {
      if (src[base + i * stride] > 0) next = i
      if (next - i <= r) dst[base + i * stride] = 255
    }
  }
}

/** Exact square dilation by `r`, separable and O(width*height) regardless of radius. */
function dilate(src: Uint8ClampedArray, width: number, height: number, r: number) {
  const rows = new Uint8ClampedArray(src.length)
  dilateLines(src, rows, height, width, 1, width, r)
  const out = new Uint8ClampedArray(src.length)
  dilateLines(rows, out, width, height, width, 1, r)
  return out
}

/**
 * Feathers a mask OUTWARD by `radius` pixels: the selection is first grown by `radius`, then
 * softened, and finally the original selection is forced back to fully-selected. Feathering
 * inward instead would leave a faint ghost of the removed object's outline along the edge.
 */
export function featherMask(mask: EditMask, radius: number): EditMask {
  const r = Math.round(radius)
  if (r < 1) return mask
  const { width, height, data } = mask

  const grown = dilate(data, width, height, r)

  // Two box passes ≈ a triangle filter whose support stays within the dilation margin.
  const half = Math.max(1, Math.round(r / 2))
  boxBlur(grown, width, height, half)
  boxBlur(grown, width, height, half)

  for (let i = 0; i < grown.length; i++) if (data[i] > grown[i]) grown[i] = data[i]
  return { width, height, data: grown }
}

/** Bounding box of non-zero mask pixels (in mask-local coordinates), or null if empty. */
export function getMaskBounds(mask: EditMask): Rect | null {
  const { width, height, data } = mask
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (data[row + x] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Downscales a mask for working-resolution processing. */
export function resizeMask(mask: EditMask, width: number, height: number): EditMask {
  if (width === mask.width && height === mask.height) return mask
  const out = new Uint8ClampedArray(width * height)
  const sx = mask.width / width
  const sy = mask.height / height
  // Area-max sampling so thin selections (text strokes) never vanish when shrunk.
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.min(mask.height, Math.ceil((y + 1) * sy)))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.min(mask.width, Math.ceil((x + 1) * sx)))
      let m = 0
      for (let yy = y0; yy < y1; yy++) {
        const row = yy * mask.width
        for (let xx = x0; xx < x1; xx++) if (mask.data[row + xx] > m) m = mask.data[row + xx]
      }
      out[y * width + x] = m
    }
  }
  return { width, height, data: out }
}
