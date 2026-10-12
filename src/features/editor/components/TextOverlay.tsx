import { useEffect, useRef, useState } from 'react'
import { useEditStore, getImageEditState } from '@/store/useEditStore'
import { drawTextLayers, measureTextLayer } from '@/lib/textRendering'
import { commitTextLayers, updateTextLayer, useTextEditing } from '@/hooks/useTextEditing'
import { cn } from '@/lib/utils'
import { clientToImagePoint, type ContentRect } from '@/lib/imageCoordinates'
import type { ImageItem } from '@/types/image'

interface TextOverlayProps {
  item: ImageItem
  imgRef: React.RefObject<HTMLImageElement | null>
  contentBox: ContentRect
  /** Text mode: show OCR boxes and make layers selectable/draggable. */
  interactive: boolean
}

/**
 * Renders the image's text layers onto a canvas scaled to the preview, using the very same
 * drawTextLayer routine the export worker uses, so what you see is what gets exported.
 */
export function TextOverlay({ item, imgRef, contentBox, interactive }: TextOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layers = item.settings.textLayers
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const width = Math.max(1, Math.round(contentBox.width * dpr))
  const height = Math.max(1, Math.round(contentBox.height * dpr))

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const scale = canvas.width / item.source.width
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    drawTextLayers(ctx, layers)
  }, [layers, width, height, item.source.width])

  return (
    <>
      {layers.length > 0 && (
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      )}
      {interactive && <TextHandles item={item} scale={contentBox.width / item.source.width} />}
      {interactive && <AreaSelector item={item} imgRef={imgRef} />}
    </>
  )
}

/**
 * "Pick the text to edit" mode: drag a rectangle over the text and only that area is recognized.
 * A rubber band is drawn while dragging; Escape cancels. One drag per activation, so afterwards
 * the recognized box can be clicked/edited without starting another selection by accident.
 */
function AreaSelector({
  item,
  imgRef,
}: {
  item: ImageItem
  imgRef: React.RefObject<HTMLImageElement | null>
}) {
  const active = useEditStore((s) => s.ocrAreaMode)
  const setActive = useEditStore((s) => s.setOcrAreaMode)
  const lang = useEditStore((s) => s.ocrLang)
  const busy = useEditStore((s) => s.job !== null)
  const { recognizeArea } = useTextEditing()
  const start = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      start.current = null
      setBand(null)
      setActive(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, setActive])

  if (!active) return null

  const local = (e: React.PointerEvent) => {
    const bounds = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(Math.max(e.clientX - bounds.left, 0), bounds.width),
      y: Math.min(Math.max(e.clientY - bounds.top, 0), bounds.height),
    }
  }

  return (
    <div
      className="absolute inset-0 touch-none cursor-crosshair bg-black/5"
      onPointerDown={(e) => {
        if (busy || e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = local(e)
        start.current = { ...p, cx: e.clientX, cy: e.clientY }
        setBand({ x: p.x, y: p.y, w: 0, h: 0 })
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s) return
        const p = local(e)
        setBand({
          x: Math.min(s.x, p.x),
          y: Math.min(s.y, p.y),
          w: Math.abs(p.x - s.x),
          h: Math.abs(p.y - s.y),
        })
      }}
      onPointerUp={(e) => {
        const s = start.current
        start.current = null
        setBand(null)
        const img = imgRef.current
        if (!s || !img) return
        // Corners → original source pixels (handles the letterboxed preview).
        const a = clientToImagePoint(img, s.cx, s.cy)
        const b = clientToImagePoint(img, e.clientX, e.clientY)
        const area = {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
        }
        setActive(false)
        if (area.width >= 6 && area.height >= 6) void recognizeArea(item.id, area, lang)
      }}
      onPointerCancel={() => {
        start.current = null
        setBand(null)
      }}
    >
      {band && (
        <div
          className="pointer-events-none absolute border-2 border-primary bg-primary/15"
          style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
        />
      )}
    </div>
  )
}

function TextHandles({ item, scale }: { item: ImageItem; scale: number }) {
  const { ocrRegions, selectedRegionId, selectedLayerId } = useEditStore((s) =>
    getImageEditState(s.byImage, item.id),
  )
  const selectRegion = useEditStore((s) => s.selectRegion)
  const selectLayer = useEditStore((s) => s.selectLayer)
  const drag = useRef<{
    layerId: string
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)

  const toCss = (r: { x: number; y: number; width: number; height: number }) => ({
    left: r.x * scale,
    top: r.y * scale,
    width: r.width * scale,
    height: r.height * scale,
  })

  return (
    <div
      className="absolute inset-0"
      onPointerDown={(e) => {
        // Clicking empty space clears the selection.
        if (e.target === e.currentTarget) {
          selectRegion(item.id, null)
          selectLayer(item.id, null)
        }
      }}
    >
      {ocrRegions?.map((region) => (
        <button
          key={region.id}
          title={region.text}
          className={cn(
            'absolute rounded-sm border-2 border-dashed border-amber-400 bg-amber-300/15 hover:bg-amber-300/30',
            region.id === selectedRegionId && 'border-solid border-primary bg-primary/20',
          )}
          style={toCss(region.bbox)}
          onClick={() => selectRegion(item.id, region.id)}
        />
      ))}

      {item.settings.textLayers.map((layer) => (
        <div
          key={layer.id}
          className={cn(
            'absolute cursor-move touch-none rounded-sm border border-dashed border-sky-400/70',
            layer.id === selectedLayerId && 'border-2 border-solid border-primary',
          )}
          style={toCss(measureTextLayer(layer))}
          onPointerDown={(e) => {
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            selectLayer(item.id, layer.id)
            drag.current = {
              layerId: layer.id,
              startX: e.clientX,
              startY: e.clientY,
              originX: layer.x,
              originY: layer.y,
              moved: false,
            }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d || d.layerId !== layer.id) return
            const dx = (e.clientX - d.startX) / scale
            const dy = (e.clientY - d.startY) / scale
            if (!d.moved && Math.hypot(dx, dy) * scale < 2) return
            d.moved = true
            updateTextLayer(item.id, layer.id, {
              x: Math.round(d.originX + dx),
              y: Math.round(d.originY + dy),
            })
          }}
          onPointerUp={() => {
            const d = drag.current
            drag.current = null
            if (d?.moved) commitTextLayers(item.id)
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
        />
      ))}
    </div>
  )
}
