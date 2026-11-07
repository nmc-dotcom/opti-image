import type { CropRect } from '@/types/image'

/** Pure geometry for the crop tool: numeric field edits and on-canvas box dragging. */

export type CropField = 'x' | 'y' | 'width' | 'height'

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Applies one numeric field edit to a crop, in source pixels.
 *
 * - A size is honoured up to the full image: if the box would run past the right/bottom edge it
 *   is pushed back inside instead of the typed size being silently cut down to "what is left".
 * - With a locked aspect `ratio` (width / height) the other dimension follows; if that would not
 *   fit in the image, both shrink together so the ratio is kept.
 * - x / y move the box and can never push it outside the image.
 */
export function applyCropField(
  crop: CropRect,
  field: CropField,
  rawValue: number,
  srcW: number,
  srcH: number,
  ratio: number | null,
): CropRect {
  const value = Math.round(rawValue)
  let { x, y, width, height } = crop

  if (field === 'x') {
    x = clamp(value, 0, srcW - width)
  } else if (field === 'y') {
    y = clamp(value, 0, srcH - height)
  } else if (field === 'width') {
    width = clamp(value, 1, srcW)
    if (ratio) {
      height = Math.max(1, Math.round(width / ratio))
      if (height > srcH) {
        height = srcH
        width = Math.max(1, Math.round(height * ratio))
      }
    }
  } else {
    height = clamp(value, 1, srcH)
    if (ratio) {
      width = Math.max(1, Math.round(height * ratio))
      if (width > srcW) {
        width = srcW
        height = Math.max(1, Math.round(width / ratio))
      }
    }
  }

  x = clamp(x, 0, srcW - width)
  y = clamp(y, 0, srcH - height)
  return { x, y, width, height }
}

/** A default, clearly visible crop box (centred, 80% of the image) for when none exists yet. */
export function defaultCrop(srcW: number, srcH: number, ratio: number | null): CropRect {
  let width = Math.round(srcW * 0.8)
  let height = Math.round(srcH * 0.8)
  if (ratio) {
    if (width / height > ratio) width = Math.round(height * ratio)
    else height = Math.round(width / ratio)
  }
  return {
    x: Math.round((srcW - width) / 2),
    y: Math.round((srcH - height) / 2),
    width,
    height,
  }
}

/** Largest box of `ratio` that fits the image, centred. */
export function ratioCrop(srcW: number, srcH: number, ratio: number): CropRect {
  let width = srcW
  let height = Math.round(width / ratio)
  if (height > srcH) {
    height = srcH
    width = Math.round(height * ratio)
  }
  return {
    x: Math.round((srcW - width) / 2),
    y: Math.round((srcH - height) / 2),
    width,
    height,
  }
}

// ---- on-canvas dragging (element-local CSS pixels) ---------------------------------------------

export interface LocalBox {
  x: number
  y: number
  w: number
  h: number
}

/** The visible image area inside the element, in the same local pixels. */
export interface LocalBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLE_CURSOR: Record<CropHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

/** Which handle (if any) is under `p`; corners win over edges. `tolerance` is in local px. */
export function hitHandle(
  box: LocalBox,
  p: { x: number; y: number },
  tolerance: number,
): CropHandle | null {
  // A tiny box must still leave room to grab its inside.
  const t = Math.max(3, Math.min(tolerance, Math.min(box.w, box.h) / 3))
  const nearL = Math.abs(p.x - box.x) <= t
  const nearR = Math.abs(p.x - (box.x + box.w)) <= t
  const nearT = Math.abs(p.y - box.y) <= t
  const nearB = Math.abs(p.y - (box.y + box.h)) <= t
  const inX = p.x >= box.x - t && p.x <= box.x + box.w + t
  const inY = p.y >= box.y - t && p.y <= box.y + box.h + t

  if (nearT && nearL) return 'nw'
  if (nearT && nearR) return 'ne'
  if (nearB && nearL) return 'sw'
  if (nearB && nearR) return 'se'
  if (nearT && inX) return 'n'
  if (nearB && inX) return 's'
  if (nearL && inY) return 'w'
  if (nearR && inY) return 'e'
  return null
}

/**
 * Box spanned from a fixed corner (ax, ay) towards the pointer, growing in direction (dirX, dirY),
 * kept inside `bounds` and — if `ratio` is given — at that aspect ratio.
 */
function boxFromCorner(
  ax: number,
  ay: number,
  dirX: 1 | -1,
  dirY: 1 | -1,
  px: number,
  py: number,
  bounds: LocalBounds,
  ratio: number | null,
  min: number,
): LocalBox {
  const maxW = dirX > 0 ? bounds.right - ax : ax - bounds.left
  const maxH = dirY > 0 ? bounds.bottom - ay : ay - bounds.top
  let w = clamp(dirX * (px - ax), 0, maxW)
  let h = clamp(dirY * (py - ay), 0, maxH)

  if (ratio) {
    // Follow whichever dimension the pointer has pulled further, then fit back inside bounds.
    if (w / ratio >= h) h = w / ratio
    else w = h * ratio
    const scale = Math.min(1, maxW / Math.max(w, 1e-6), maxH / Math.max(h, 1e-6))
    w *= scale
    h *= scale
  }
  if (min > 0) {
    if (w < min) {
      w = min
      if (ratio) h = w / ratio
    }
    if (h < min) {
      h = min
      if (ratio) w = h * ratio
    }
  }
  return { x: dirX > 0 ? ax : ax - w, y: dirY > 0 ? ay : ay - h, w, h }
}

/** A box drawn by dragging from `start` to `pointer` (both already clamped to the image). */
export function drawBox(
  start: { x: number; y: number },
  pointer: { x: number; y: number },
  bounds: LocalBounds,
  ratio: number | null,
): LocalBox {
  const dirX = pointer.x >= start.x ? 1 : -1
  const dirY = pointer.y >= start.y ? 1 : -1
  return boxFromCorner(start.x, start.y, dirX, dirY, pointer.x, pointer.y, bounds, ratio, 0)
}

/** `origin` resized by dragging `handle` to `pointer`. Opposite edge/corner stays fixed. */
export function resizeBox(
  origin: LocalBox,
  handle: CropHandle,
  pointer: { x: number; y: number },
  bounds: LocalBounds,
  ratio: number | null,
  min: number,
): LocalBox {
  const left = origin.x
  const right = origin.x + origin.w
  const top = origin.y
  const bottom = origin.y + origin.h
  const hasW = handle.includes('w')
  const hasE = handle.includes('e')
  const hasN = handle.includes('n')
  const hasS = handle.includes('s')
  const isCorner = (hasW || hasE) && (hasN || hasS)

  if (isCorner) {
    const ax = hasW ? right : left
    const ay = hasN ? bottom : top
    return boxFromCorner(ax, ay, hasW ? -1 : 1, hasN ? -1 : 1, pointer.x, pointer.y, bounds, ratio, min)
  }

  if (!ratio) {
    let l = left
    let r = right
    let t = top
    let b = bottom
    if (hasW) l = clamp(pointer.x, bounds.left, right - min)
    if (hasE) r = clamp(pointer.x, left + min, bounds.right)
    if (hasN) t = clamp(pointer.y, bounds.top, bottom - min)
    if (hasS) b = clamp(pointer.y, top + min, bounds.bottom)
    return { x: l, y: t, w: r - l, h: b - t }
  }

  // Edge handle with a locked ratio: the dragged dimension drives, the other is re-centred.
  if (hasW || hasE) {
    const ax = hasW ? right : left
    const cy = top + origin.h / 2
    const halfRoom = Math.min(cy - bounds.top, bounds.bottom - cy)
    const maxW = Math.min(hasE ? bounds.right - ax : ax - bounds.left, halfRoom * 2 * ratio)
    const w = clamp(hasE ? pointer.x - ax : ax - pointer.x, min, maxW)
    const h = w / ratio
    return { x: hasE ? ax : ax - w, y: cy - h / 2, w, h }
  }
  const ay = hasN ? bottom : top
  const cx = left + origin.w / 2
  const halfRoom = Math.min(cx - bounds.left, bounds.right - cx)
  const maxH = Math.min(hasS ? bounds.bottom - ay : ay - bounds.top, (halfRoom * 2) / ratio)
  const h = clamp(hasS ? pointer.y - ay : ay - pointer.y, min, maxH)
  const w = h * ratio
  return { x: cx - w / 2, y: hasS ? ay : ay - h, w, h }
}

/** Offset between the pointer and the edges it grabbed, so a drag does not jump on first move. */
export function grabOffset(box: LocalBox, handle: CropHandle, p: { x: number; y: number }) {
  return {
    x: handle.includes('w') ? p.x - box.x : handle.includes('e') ? p.x - (box.x + box.w) : 0,
    y: handle.includes('n') ? p.y - box.y : handle.includes('s') ? p.y - (box.y + box.h) : 0,
  }
}
