import { useCallback, useRef, useState } from 'react'
import type { CropRect } from '@/types/image'
import { getContentRect } from '@/lib/imageCoordinates'
import {
  HANDLE_CURSOR,
  drawBox,
  grabOffset,
  hitHandle,
  resizeBox,
  type CropHandle,
  type LocalBounds,
  type LocalBox,
} from '@/lib/cropGeometry'

// Shared with the edit (mask/text) overlay; re-exported so existing imports keep working.
export { getContentRect }

interface Point {
  x: number
  y: number
}

type DragMode =
  | { kind: 'draw' }
  | { kind: 'move'; origin: LocalBox }
  | { kind: 'resize'; origin: LocalBox; handle: CropHandle; grab: Point }

/** How close (CSS px) to an edge/corner the pointer must be to grab it. */
const HANDLE_HIT = 10
/** Smallest box (CSS px) a resize may shrink to. */
const MIN_BOX = 8

/**
 * Drives an interactive crop rectangle drawn on top of a rendered <img>. Pointer positions are
 * tracked in element-local CSS pixels, clamped to the visible image content box, and converted
 * to natural image-pixel coordinates (accounting for object-contain letterboxing) on commit.
 *
 * Interactions on the committed box:
 * - drag a corner or an edge → resize it (the opposite side stays put),
 * - drag inside → move it, keeping its size,
 * - drag anywhere outside → draw a new box.
 * With a locked aspect `ratio` every one of these keeps that ratio.
 */
export function useCropOverlay(
  imageRef: React.RefObject<HTMLImageElement | null>,
  crop: CropRect | null,
  ratio: number | null,
  onChange: (rect: CropRect) => void,
  onCommit: () => void,
) {
  const [draftRect, setDraftRect] = useState<LocalBox | null>(null)
  const [cursor, setCursor] = useState('crosshair')
  const start = useRef<Point | null>(null)
  const drag = useRef<DragMode>({ kind: 'draw' })

  const getBounds = useCallback((): LocalBounds | null => {
    const el = imageRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const content = getContentRect(el, rect.width, rect.height)
    return {
      left: content.offsetX,
      top: content.offsetY,
      right: content.offsetX + content.width,
      bottom: content.offsetY + content.height,
    }
  }, [imageRef])

  const toLocalPoint = useCallback(
    (e: React.PointerEvent): Point => {
      const el = imageRef.current
      const bounds = getBounds()
      if (!el || !bounds) return { x: 0, y: 0 }
      const rect = el.getBoundingClientRect()
      // Clamp to the visible image content so the box can't be drawn over the letterbox padding.
      return {
        x: Math.min(Math.max(e.clientX - rect.left, bounds.left), bounds.right),
        y: Math.min(Math.max(e.clientY - rect.top, bounds.top), bounds.bottom),
      }
    },
    [imageRef, getBounds],
  )

  // Maps the currently committed crop (natural pixels) onto the displayed content box, so a
  // pointerdown can be tested against where the existing box actually is on screen.
  const getLocalCropBox = useCallback((): LocalBox | null => {
    const el = imageRef.current
    if (!el || !crop || !el.naturalWidth || !el.naturalHeight) return null
    const bounds = getBounds()
    if (!bounds) return null
    const scaleX = (bounds.right - bounds.left) / el.naturalWidth
    const scaleY = (bounds.bottom - bounds.top) / el.naturalHeight
    return {
      x: bounds.left + crop.x * scaleX,
      y: bounds.top + crop.y * scaleY,
      w: crop.width * scaleX,
      h: crop.height * scaleY,
    }
  }, [imageRef, crop, getBounds])

  /** Writes a local-pixel box into settings. Returns true if the crop actually changed. */
  const commitRectToSettings = useCallback(
    (rect: LocalBox): boolean => {
      const el = imageRef.current
      const bounds = getBounds()
      if (!el || !bounds || rect.w < 4 || rect.h < 4) return false
      const scaleX = el.naturalWidth / (bounds.right - bounds.left)
      const scaleY = el.naturalHeight / (bounds.bottom - bounds.top)
      const x = Math.min(Math.max(Math.round((rect.x - bounds.left) * scaleX), 0), el.naturalWidth - 1)
      const y = Math.min(Math.max(Math.round((rect.y - bounds.top) * scaleY), 0), el.naturalHeight - 1)
      const next: CropRect = {
        x,
        y,
        width: Math.max(1, Math.min(Math.round(rect.w * scaleX), el.naturalWidth - x)),
        height: Math.max(1, Math.min(Math.round(rect.h * scaleY), el.naturalHeight - y)),
      }
      if (
        crop &&
        crop.x === next.x &&
        crop.y === next.y &&
        crop.width === next.width &&
        crop.height === next.height
      ) {
        return false
      }
      onChange(next)
      return true
    },
    [imageRef, getBounds, crop, onChange],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      ;(e.target as Element).setPointerCapture(e.pointerId)
      const point = toLocalPoint(e)
      const box = getLocalCropBox()
      start.current = point

      if (box) {
        const handle = hitHandle(box, point, HANDLE_HIT)
        if (handle) {
          drag.current = { kind: 'resize', origin: box, handle, grab: grabOffset(box, handle, point) }
          setDraftRect(box)
          return
        }
        if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
          drag.current = { kind: 'move', origin: box }
          setDraftRect(box)
          return
        }
      }

      drag.current = { kind: 'draw' }
      setDraftRect({ x: point.x, y: point.y, w: 0, h: 0 })
    },
    [toLocalPoint, getLocalCropBox],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const point = toLocalPoint(e)
      const bounds = getBounds()
      if (!bounds) return

      // Not dragging: only keep the cursor in sync with what a press here would do.
      if (!start.current) {
        const box = getLocalCropBox()
        let next = 'crosshair'
        if (box) {
          const handle = hitHandle(box, point, HANDLE_HIT)
          if (handle) next = HANDLE_CURSOR[handle]
          else if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
            next = 'move'
          }
        }
        setCursor((prev) => (prev === next ? prev : next))
        return
      }

      const mode = drag.current
      if (mode.kind === 'move') {
        const { origin } = mode
        const dx = point.x - start.current.x
        const dy = point.y - start.current.y
        setDraftRect({
          x: Math.min(Math.max(origin.x + dx, bounds.left), Math.max(bounds.left, bounds.right - origin.w)),
          y: Math.min(Math.max(origin.y + dy, bounds.top), Math.max(bounds.top, bounds.bottom - origin.h)),
          w: origin.w,
          h: origin.h,
        })
        return
      }

      if (mode.kind === 'resize') {
        const pointer = { x: point.x - mode.grab.x, y: point.y - mode.grab.y }
        setDraftRect(resizeBox(mode.origin, mode.handle, pointer, bounds, ratio, MIN_BOX))
        return
      }

      setDraftRect(drawBox(start.current, point, bounds, ratio))
    },
    [toLocalPoint, getBounds, getLocalCropBox, ratio],
  )

  const onPointerUp = useCallback(() => {
    // Only a drag that really changed the crop is worth an undo step (a plain click is not).
    if (draftRect && commitRectToSettings(draftRect)) onCommit()
    start.current = null
    drag.current = { kind: 'draw' }
    // Clear the live draft; the resting crop box is rendered from settings.crop so that
    // preset-applied crops and manual drags share a single source of truth.
    setDraftRect(null)
  }, [draftRect, commitRectToSettings, onCommit])

  return { draftRect, cursor, onPointerDown, onPointerMove, onPointerUp }
}
