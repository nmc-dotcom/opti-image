import { useCallback, useRef, useState } from 'react'
import type { CropRect } from '@/types/image'

interface Point {
  x: number
  y: number
}

/**
 * Drives an interactive crop rectangle drawn on top of a rendered <img>.
 * Coordinates are tracked in rendered (CSS pixel) space and converted to natural
 * image-pixel space via `naturalWidth/renderedWidth` scale on commit.
 */
export function useCropOverlay(
  imageRef: React.RefObject<HTMLImageElement | null>,
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

  const toLocalPoint = useCallback(
    (e: React.PointerEvent): Point => {
      const el = imageRef.current
      if (!el) return { x: 0, y: 0 }
      const rect = el.getBoundingClientRect()
      return {
        x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
        y: Math.min(Math.max(e.clientY - rect.top, 0), rect.height),
      }
    },
    [imageRef],
  )

  const commitRectToSettings = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      const el = imageRef.current
      if (!el || rect.w < 4 || rect.h < 4) return
      const scaleX = el.naturalWidth / el.clientWidth
      const scaleY = el.naturalHeight / el.clientHeight
      onChange({
        x: Math.round(rect.x * scaleX),
        y: Math.round(rect.y * scaleY),
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
      start.current = point
      setDraftRect({ x: point.x, y: point.y, w: 0, h: 0 })
    },
    [toLocalPoint],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return
      const point = toLocalPoint(e)
      const x = Math.min(start.current.x, point.x)
      const y = Math.min(start.current.y, point.y)
      const w = Math.abs(point.x - start.current.x)
      const h = Math.abs(point.y - start.current.y)
      setDraftRect({ x, y, w, h })
    },
    [toLocalPoint],
  )

  const onPointerUp = useCallback(() => {
    if (draftRect) {
      commitRectToSettings(draftRect)
      onCommit()
    }
    start.current = null
  }, [draftRect, commitRectToSettings, onCommit])

  return { draftRect, onPointerDown, onPointerMove, onPointerUp }
}
