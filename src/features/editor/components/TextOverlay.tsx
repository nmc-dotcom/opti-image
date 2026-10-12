import { useEffect, useRef } from 'react'
import { useEditStore, getImageEditState } from '@/store/useEditStore'
import { drawTextLayers, measureTextLayer } from '@/lib/textRendering'
import { commitTextLayers, updateTextLayer } from '@/hooks/useTextEditing'
import { cn } from '@/lib/utils'
import type { ContentRect } from '@/lib/imageCoordinates'
import type { ImageItem } from '@/types/image'

interface TextOverlayProps {
  item: ImageItem
  contentBox: ContentRect
  /** Text mode: show OCR boxes and make layers selectable/draggable. */
  interactive: boolean
}

/**
 * Renders the image's text layers onto a canvas scaled to the preview, using the very same
 * drawTextLayer routine the export worker uses, so what you see is what gets exported.
 */
export function TextOverlay({ item, contentBox, interactive }: TextOverlayProps) {
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
    </>
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
