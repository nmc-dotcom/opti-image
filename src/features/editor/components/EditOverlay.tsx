import { useCallback, useEffect, useRef } from 'react'
import { useEditStore, getImageEditState } from '@/store/useEditStore'
import { drawMaskStrokes } from '@/lib/mask'
import { clientToImagePoint, getImageScale, type ContentRect } from '@/lib/imageCoordinates'
import type { MaskStroke } from '@/types/editing'
import type { ImageItem } from '@/types/image'
import { TextOverlay } from './TextOverlay'

const MASK_COLOR = 'rgb(239, 68, 68)'

interface EditOverlayProps {
  item: ImageItem
  imgRef: React.RefObject<HTMLImageElement | null>
  contentBox: ContentRect
}

/**
 * Edit-mode layers stacked over the source <img>, all positioned on the letterboxed content
 * box: applied retouch patches (so the user sees the current retouched image), text layers,
 * the semi-transparent selection mask and the pointer surface that edits it.
 */
export function EditOverlay({ item, imgRef, contentBox }: EditOverlayProps) {
  const mode = useEditStore((s) => s.mode)
  const patches = useEditStore((s) => s.patches)
  const scale = contentBox.width / item.source.width

  const boxStyle = {
    left: contentBox.offsetX,
    top: contentBox.offsetY,
    width: contentBox.width,
    height: contentBox.height,
  }

  return (
    <div className="absolute overflow-hidden" style={boxStyle}>
      {item.settings.retouch.map((op) => {
        const patch = patches[op.id]
        if (!patch) return null
        return (
          <img
            key={op.id}
            src={patch.url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{
              left: patch.x * scale,
              top: patch.y * scale,
              width: patch.width * scale,
              height: patch.height * scale,
            }}
          />
        )
      })}

      <TextOverlay item={item} contentBox={contentBox} interactive={mode === 'text'} />

      {mode === 'remove' && <MaskLayer item={item} imgRef={imgRef} contentBox={contentBox} />}
    </div>
  )
}

function MaskLayer({ item, imgRef, contentBox }: EditOverlayProps) {
  const strokes = useEditStore((s) => getImageEditState(s.byImage, item.id).strokes)
  const maskTool = useEditStore((s) => s.maskTool)
  const maskMode = useEditStore((s) => s.maskMode)
  const brushSize = useEditStore((s) => s.brushSize)
  const brushEdge = useEditStore((s) => s.brushEdge)
  const addStroke = useEditStore((s) => s.addStroke)
  const busy = useEditStore((s) => s.job !== null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const liveStroke = useRef<MaskStroke | null>(null)
  const rectStart = useRef<{ x: number; y: number } | null>(null)
  const frame = useRef<number | null>(null)

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const canvasWidth = Math.max(1, Math.round(contentBox.width * dpr))
  const canvasHeight = Math.max(1, Math.round(contentBox.height * dpr))

  const redraw = useCallback(() => {
    frame.current = null
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const transform = { scale: canvas.width / item.source.width, originX: 0, originY: 0 }
    const all = liveStroke.current ? [...strokes, liveStroke.current] : strokes
    drawMaskStrokes(ctx, all, transform, MASK_COLOR)

    // Marching outline for a rect/lasso being dragged, so erase-mode drags are visible too.
    const live = liveStroke.current
    if (live && live.kind !== 'brush') {
      ctx.save()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5 * dpr
      ctx.setLineDash([6 * dpr, 4 * dpr])
      ctx.beginPath()
      if (live.kind === 'rect') {
        ctx.rect(
          live.x * transform.scale,
          live.y * transform.scale,
          live.width * transform.scale,
          live.height * transform.scale,
        )
      } else {
        for (let i = 0; i < live.points.length; i += 2) {
          const x = live.points[i] * transform.scale
          const y = live.points[i + 1] * transform.scale
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
      }
      ctx.stroke()
      ctx.restore()
    }
  }, [strokes, item.source.width, dpr])

  const scheduleRedraw = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(redraw)
  }, [redraw])

  useEffect(() => {
    redraw()
  }, [redraw, canvasWidth, canvasHeight])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  const moveCursor = (e: React.PointerEvent) => {
    const cursor = cursorRef.current
    if (!cursor) return
    const bounds = e.currentTarget.getBoundingClientRect()
    cursor.style.transform = `translate(${e.clientX - bounds.left}px, ${e.clientY - bounds.top}px)`
    cursor.style.opacity = '1'
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const img = imgRef.current
    if (!img || busy || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = clientToImagePoint(img, e.clientX, e.clientY)
    // Alt temporarily flips to the opposite mode (quick restore while painting).
    const strokeMode = e.altKey ? (maskMode === 'add' ? 'erase' : 'add') : maskMode

    if (maskTool === 'brush') {
      liveStroke.current = {
        kind: 'brush',
        mode: strokeMode,
        size: brushSize * getImageScale(img),
        edge: brushEdge,
        points: [p.x, p.y],
      }
    } else if (maskTool === 'rect') {
      rectStart.current = p
      liveStroke.current = { kind: 'rect', mode: strokeMode, x: p.x, y: p.y, width: 0, height: 0 }
    } else {
      liveStroke.current = { kind: 'lasso', mode: strokeMode, points: [p.x, p.y] }
    }
    scheduleRedraw()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (maskTool === 'brush') moveCursor(e)
    const live = liveStroke.current
    const img = imgRef.current
    if (!live || !img) return
    const p = clientToImagePoint(img, e.clientX, e.clientY)

    if (live.kind === 'rect' && rectStart.current) {
      const s = rectStart.current
      live.x = Math.min(s.x, p.x)
      live.y = Math.min(s.y, p.y)
      live.width = Math.abs(p.x - s.x)
      live.height = Math.abs(p.y - s.y)
    } else if (live.kind !== 'rect') {
      // Thin out points: skip moves shorter than a fraction of the brush (or ~2 screen px).
      const minStep =
        live.kind === 'brush' ? Math.max(1, live.size * 0.08) : 2 * getImageScale(img)
      const n = live.points.length
      if (Math.hypot(p.x - live.points[n - 2], p.y - live.points[n - 1]) < minStep) return
      live.points.push(p.x, p.y)
    }
    scheduleRedraw()
  }

  const onPointerUp = () => {
    const live = liveStroke.current
    liveStroke.current = null
    rectStart.current = null
    if (!live) return
    const img = imgRef.current
    const minSize = img ? 3 * getImageScale(img) : 3
    const valid =
      live.kind === 'brush' ||
      (live.kind === 'rect' && live.width >= minSize && live.height >= minSize) ||
      (live.kind === 'lasso' && live.points.length >= 6)
    if (valid) addStroke(item.id, live)
    else scheduleRedraw()
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-50"
      />
      <div
        className="absolute inset-0 touch-none"
        style={{ cursor: maskTool === 'brush' ? 'none' : 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (cursorRef.current) cursorRef.current.style.opacity = '0'
        }}
      >
        {maskTool === 'brush' && (
          <div
            ref={cursorRef}
            className="pointer-events-none absolute left-0 top-0 opacity-0"
            style={{ willChange: 'transform' }}
          >
            <div
              className="rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
              style={{
                width: brushSize,
                height: brushSize,
                marginLeft: -brushSize / 2,
                marginTop: -brushSize / 2,
                borderStyle: maskMode === 'erase' ? 'dashed' : 'solid',
              }}
            />
          </div>
        )}
      </div>
    </>
  )
}
