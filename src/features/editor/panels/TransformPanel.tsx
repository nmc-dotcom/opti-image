import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from 'lucide-react'
import { useImageStore } from '@/store/useImageStore'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { FlipAxis } from '@/types/image'

const ROTATION_STEPS = [0, 90, 180, 270] as const

export function TransformPanel() {
  const activeId = useImageStore((s) => s.activeId)
  const item = useImageStore((s) => s.images.find((i) => i.id === activeId))
  const updateSettings = useImageStore((s) => s.updateSettings)
  const commitHistory = useImageStore((s) => s.commitHistory)

  if (!item) return null
  const { rotation, flip } = item.settings

  const rotate = (delta: number) => {
    const currentIndex = ROTATION_STEPS.indexOf(rotation)
    const next = ROTATION_STEPS[(currentIndex + delta + 4) % 4]
    updateSettings(item.id, (s) => ({ ...s, rotation: next }))
    commitHistory(item.id)
  }

  const toggleFlip = (axis: 'horizontal' | 'vertical') => {
    const next = computeFlip(flip, axis)
    updateSettings(item.id, (s) => ({ ...s, flip: next }))
    commitHistory(item.id)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>회전</Label>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => rotate(-1)}
          >
            <RotateCcw /> -90°
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => rotate(1)}
          >
            <RotateCw /> +90°
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">현재 회전값: {rotation}°</p>
      </div>

      <div className="space-y-1.5">
        <Label>대칭 이동</Label>
        <div className="flex gap-1.5">
          <Button
            variant={flip === 'horizontal' || flip === 'both' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => toggleFlip('horizontal')}
          >
            <FlipHorizontal2 /> 좌우
          </Button>
          <Button
            variant={flip === 'vertical' || flip === 'both' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => toggleFlip('vertical')}
          >
            <FlipVertical2 /> 상하
          </Button>
        </div>
      </div>
    </div>
  )
}

function computeFlip(current: FlipAxis, axis: 'horizontal' | 'vertical'): FlipAxis {
  const hasHorizontal = current === 'horizontal' || current === 'both'
  const hasVertical = current === 'vertical' || current === 'both'
  const nextHorizontal = axis === 'horizontal' ? !hasHorizontal : hasHorizontal
  const nextVertical = axis === 'vertical' ? !hasVertical : hasVertical

  if (nextHorizontal && nextVertical) return 'both'
  if (nextHorizontal) return 'horizontal'
  if (nextVertical) return 'vertical'
  return 'none'
}
