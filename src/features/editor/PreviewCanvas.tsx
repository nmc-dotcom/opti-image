import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { useImageStore } from '@/store/useImageStore'
import { useUiStore } from '@/store/useUiStore'
import { Spinner } from '@/components/ui/spinner'
import { getContentRect, useCropOverlay } from '@/hooks/useCropOverlay'
import { cn } from '@/lib/utils'

export function PreviewCanvas() {
  const activeId = useImageStore((s) => s.activeId)
  const item = useImageStore((s) => s.images.find((i) => i.id === activeId))
  const updateSettings = useImageStore((s) => s.updateSettings)
  const commitHistory = useImageStore((s) => s.commitHistory)
  const activeTool = useUiStore((s) => s.activeTool)

  const [sliderPos, setSliderPos] = useState(50)
  const [contentBox, setContentBox] = useState({
    offsetX: 0,
    offsetY: 0,
    width: 0,
    height: 0,
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const draggingSlider = useRef(false)

  // Track the actual displayed image content box so a committed/preset crop can be drawn over
  // exactly the right pixels (mirrors the mapping used to read a drag back to natural pixels).
  const measureContent = useCallback(() => {
    const el = imgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const next = getContentRect(el, rect.width, rect.height)
    // Only update when the box actually changes; returning the previous reference otherwise
    // avoids an infinite render loop (this runs in a layout effect on every commit).
    setContentBox((prev) =>
      prev.offsetX === next.offsetX &&
      prev.offsetY === next.offsetY &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next,
    )
  }, [])

  useLayoutEffect(() => {
    measureContent()
  })

  useEffect(() => {
    const ro = new ResizeObserver(measureContent)
    if (imgRef.current) ro.observe(imgRef.current)
    if (containerRef.current) ro.observe(containerRef.current)
    window.addEventListener('resize', measureContent)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measureContent)
    }
  }, [measureContent])

  const onSliderPointerDown = useCallback((e: React.PointerEvent) => {
    draggingSlider.current = true
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [])

  const onContainerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingSlider.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    setSliderPos(Math.min(100, Math.max(0, pct)))
  }, [])

  const onSliderPointerUp = useCallback(() => {
    draggingSlider.current = false
  }, [])

  const cropOverlay = useCropOverlay(
    imgRef,
    (rect) => {
      if (!item) return
      updateSettings(item.id, (s) => ({ ...s, crop: rect }))
    },
    () => {
      if (item) commitHistory(item.id)
    },
  )

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        왼쪽에서 이미지를 선택하세요.
      </div>
    )
  }

  const isCropping = activeTool === 'crop'

  // While cropping, the box always matches the source so pointer math maps 1:1 to
  // the original image; otherwise it matches the processed result so the after
  // image is never squeezed into a mismatched (pre-rotate/crop) aspect ratio.
  const boxWidth = isCropping || !item.result ? item.source.width : item.result.width
  const boxHeight = isCropping || !item.result ? item.source.height : item.result.height

  // Map the committed crop (natural pixels) back onto the displayed content box, so a crop set
  // via a ratio preset or a previous drag stays visible while editing.
  const crop = item.settings.crop
  const committedCropBox =
    isCropping && crop && !cropOverlay.draftRect && contentBox.width > 0
      ? {
          left: contentBox.offsetX + (crop.x / item.source.width) * contentBox.width,
          top: contentBox.offsetY + (crop.y / item.source.height) * contentBox.height,
          width: (crop.width / item.source.width) * contentBox.width,
          height: (crop.height / item.source.height) * contentBox.height,
        }
      : null

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="truncate font-medium">{item.source.name}</span>
        <span className="text-xs text-muted-foreground">
          {item.source.width}×{item.source.height}
          {item.result && ` → ${item.result.width}×${item.result.height}`}
        </span>
      </div>

      <div
        ref={containerRef}
        className="checkerboard relative flex flex-1 items-center justify-center overflow-hidden rounded-lg border"
        onPointerMove={onContainerPointerMove}
        onPointerUp={onSliderPointerUp}
      >
        <div
          className="relative h-full max-h-[60vh] max-w-full"
          style={{ aspectRatio: `${boxWidth} / ${boxHeight}` }}
        >
          <img
            ref={imgRef}
            src={item.source.originalUrl}
            alt={item.source.name}
            className="absolute inset-0 block h-full w-full select-none object-contain"
            draggable={false}
            onLoad={measureContent}
          />

          {item.result && !isCropping && (
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            >
              <img
                src={item.result.url}
                alt="after"
                className="block h-full w-full select-none object-contain"
                draggable={false}
              />
            </div>
          )}

          {item.result && !isCropping && (
            <>
              <div
                className="absolute inset-y-0 w-0.5 cursor-ew-resize bg-primary"
                style={{ left: `${sliderPos}%` }}
              >
                <div
                  className="absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md"
                  onPointerDown={onSliderPointerDown}
                >
                  <GripVertical className="h-4 w-4" />
                </div>
              </div>
              <span className="absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium">
                BEFORE
              </span>
              <span className="absolute right-2 top-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium">
                AFTER
              </span>
            </>
          )}

          {isCropping && (
            <div
              className="absolute inset-0 cursor-crosshair"
              onPointerDown={cropOverlay.onPointerDown}
              onPointerMove={cropOverlay.onPointerMove}
              onPointerUp={cropOverlay.onPointerUp}
            >
              {cropOverlay.draftRect && (
                <div
                  className="absolute border-2 border-primary bg-primary/10"
                  style={{
                    left: cropOverlay.draftRect.x,
                    top: cropOverlay.draftRect.y,
                    width: cropOverlay.draftRect.w,
                    height: cropOverlay.draftRect.h,
                  }}
                />
              )}
              {committedCropBox && (
                <div
                  className="pointer-events-none absolute border-2 border-primary bg-primary/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                  style={{
                    left: committedCropBox.left,
                    top: committedCropBox.top,
                    width: committedCropBox.width,
                    height: committedCropBox.height,
                  }}
                />
              )}
            </div>
          )}

          {item.status === 'processing' && (
            <div
              className={cn(
                'absolute inset-0 flex items-center justify-center bg-background/40',
                isCropping && 'hidden',
              )}
            >
              <Spinner className="h-6 w-6" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
