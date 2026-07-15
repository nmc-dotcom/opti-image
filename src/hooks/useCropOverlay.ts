import { useCallback, useRef, useState } from 'react'
import type { CropRect } from '@/types/image'

interface Point {
  x: number
  y: number
}

interface ContentRect {
  offsetX: number
  offsetY: number
  width: number
  height: number
}

/**
 * Computes the actual displayed image content box inside the <img> element. Because the image
 * is rendered with `object-contain`, its content can be letterboxed (centered with padding)
 * when the element's box aspect ratio differs from the image's. Crop coordinates must be mapped
 * against this content box, not the element box, or the crop lands on the wrong region.
 */
export function getContentRect(
  el: HTMLImageElement,
  elWidth: number,
  elHeight: number,
): ContentRect {
  const { naturalWidth: nw, naturalHeight: nh } = el
  if (!nw || !nh) return { offsetX: 0, offsetY: 0, width: elWidth, height: elHeight }

  const elRatio = elWidth / elHeight
  const imgRatio = nw / nh

  let width: number
  let height: number
  if (elRatio > imgRatio) {
    // Element is wider than the image → padding on left/right.
    height = elHeight
    width = elHeight * imgRatio
  } else {
    // Element is taller than the image → padding on top/bottom.
    width = elWidth
    height = elWidth / imgRatio
  }
  return { offsetX: (elWidth - width) / 2, offsetY: (elHeight - height) / 2, width, height }
}

/**
 * Drives an interactive crop rectangle drawn on top of a rendered <img>. Pointer positions are
 * tracked in element-local CSS pixels, clamped to the visible image content box, and converted
 * to natural image-pixel coordinates (accounting for object-contain letterboxing) on commit.
 *
 * Two interactions are supported: starting a drag outside the current committed crop draws a
 * new rectangle from scratch (resize-by-redraw); starting a drag inside it translates the
 * existing box, keeping its width/height fixed.
 */
export function useCropOverlay(
  imageRef: React.RefObject<HTMLImageElement | null>,
  crop: CropRect | null,
  onChange: (rect: CropRect) => void,
  onCommit: () => void,
) {
  const [draftRect, setDraftRect] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const start = useRef<Point | null>(null)
  const mode = useRef<'draw' | 'move'>('draw')
  const moveOrigin = useRef<{ boxX: number; boxY: number; w: number; h: number } | null>(null)

  const toLocalPoint = useCallback(
    (e: React.PointerEvent): Point => {
      const el = imageRef.current
      if (!el) return { x: 0, y: 0 }
      const rect = el.getBoundingClientRect()
      const content = getContentRect(el, rect.width, rect.height)
      // Clamp to the visible image content so the box can't be drawn over the letterbox padding.
      return {
        x: Math.min(Math.max(e.clientX - rect.left, content.offsetX), content.offsetX + content.width),
        y: Math.min(Math.max(e.clientY - rect.top, content.offsetY), content.offsetY + content.height),
      }
    },
    [imageRef],
  )

  // Maps the currently committed crop (natural pixels) onto the displayed content box, so a
  // pointerdown can be tested against where the existing box actually is on screen.
  const getLocalCropBox = useCallback(() => {
    const el = imageRef.current
    if (!el || !crop || !el.naturalWidth || !el.naturalHeight) return null
    const bounds = el.getBoundingClientRect()
    const content = getContentRect(el, bounds.width, bounds.height)
    const scaleX = content.width / el.naturalWidth
    const scaleY = content.height / el.naturalHeight
    return {
      x: content.offsetX + crop.x * scaleX,
      y: content.offsetY + crop.y * scaleY,
      w: crop.width * scaleX,
      h: crop.height * scaleY,
    }
  }, [imageRef, crop])

  const commitRectToSettings = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      const el = imageRef.current
      if (!el || rect.w < 4 || rect.h < 4) return
      const bounds = el.getBoundingClientRect()
      const content = getContentRect(el, bounds.width, bounds.height)
      const scaleX = el.naturalWidth / content.width
      const scaleY = el.naturalHeight / content.height
      onChange({
        x: Math.round((rect.x - content.offsetX) * scaleX),
        y: Math.round((rect.y - content.offsetY) * scaleY),
        width: Math.round(rect.w * scaleX),
        height: Math.round(rect.h * scaleY),
      })
    },
    [imageRef, onChange],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      ;(e.target as Element).setPointerCapture(e.pointerId)
      const point = toLocalPoint(e)
      const box = getLocalCropBox()

      if (box && point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
        mode.current = 'move'
        start.current = point
        moveOrigin.current = { boxX: box.x, boxY: box.y, w: box.w, h: box.h }
        setDraftRect(box)
        return
      }

      mode.current = 'draw'
      start.current = point
      moveOrigin.current = null
      setDraftRect({ x: point.x, y: point.y, w: 0, h: 0 })
    },
    [toLocalPoint, getLocalCropBox],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return
      const point = toLocalPoint(e)

      if (mode.current === 'move' && moveOrigin.current) {
        const el = imageRef.current
        if (!el) return
        const bounds = el.getBoundingClientRect()
        const content = getContentRect(el, bounds.width, bounds.height)
        const { boxX, boxY, w, h } = moveOrigin.current
        const dx = point.x - start.current.x
        const dy = point.y - start.current.y
        const minX = content.offsetX
        const minY = content.offsetY
        const maxX = Math.max(minX, content.offsetX + content.width - w)
        const maxY = Math.max(minY, content.offsetY + content.height - h)
        setDraftRect({
          x: Math.min(Math.max(boxX + dx, minX), maxX),
          y: Math.min(Math.max(boxY + dy, minY), maxY),
          w,
          h,
        })
        return
      }

      const x = Math.min(start.current.x, point.x)
      const y = Math.min(start.current.y, point.y)
      const w = Math.abs(point.x - start.current.x)
      const h = Math.abs(point.y - start.current.y)
      setDraftRect({ x, y, w, h })
    },
    [toLocalPoint, imageRef],
  )

  const onPointerUp = useCallback(() => {
    if (draftRect) {
      commitRectToSettings(draftRect)
      onCommit()
    }
    start.current = null
    moveOrigin.current = null
    mode.current = 'draw'
    // Clear the live draft; the resting crop box is rendered from settings.crop so that
    // preset-applied crops and manual drags share a single source of truth.
    setDraftRect(null)
  }, [draftRect, commitRectToSettings, onCommit])

  return { draftRect, onPointerDown, onPointerMove, onPointerUp }
}
