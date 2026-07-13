import { useImageStore } from '@/store/useImageStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import type { ResizeMode } from '@/types/image'
import { cn } from '@/lib/utils'

const MODES: { value: ResizeMode; label: string }[] = [
  { value: 'none', label: '원본 유지' },
  { value: 'exact', label: '사용자 지정' },
  { value: 'longEdge', label: '긴 변 기준' },
  { value: 'percentage', label: '비율(%)' },
]

export function ResizePanel() {
  const activeId = useImageStore((s) => s.activeId)
  const item = useImageStore((s) => s.images.find((i) => i.id === activeId))
  const updateSettings = useImageStore((s) => s.updateSettings)
  const commitHistory = useImageStore((s) => s.commitHistory)

  if (!item) return null
  const { resize } = item.settings

  const setResize = (patch: Partial<typeof resize>) => {
    updateSettings(item.id, (s) => ({ ...s, resize: { ...s.resize, ...patch } }))
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1.5">
        {MODES.map((m) => (
          <Button
            key={m.value}
            size="sm"
            variant={resize.mode === m.value ? 'default' : 'outline'}
            className={cn('justify-center')}
            onClick={() => {
              setResize({ mode: m.value })
              commitHistory(item.id)
            }}
          >
            {m.label}
          </Button>
        ))}
      </div>

      {resize.mode === 'exact' && (
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="resize-width">너비 (px)</Label>
              <Input
                id="resize-width"
                type="number"
                min={1}
                value={resize.width || ''}
                placeholder={String(item.source.width)}
                onChange={(e) => setResize({ width: Number(e.target.value) })}
                onBlur={() => commitHistory(item.id)}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="resize-height">높이 (px)</Label>
              <Input
                id="resize-height"
                type="number"
                min={1}
                value={resize.height || ''}
                placeholder={String(item.source.height)}
                onChange={(e) => setResize({ height: Number(e.target.value) })}
                onBlur={() => commitHistory(item.id)}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label
              htmlFor="keep-ratio"
              className="text-xs font-normal text-muted-foreground"
            >
              비율 유지
            </Label>
            <Switch
              id="keep-ratio"
              checked={resize.keepAspectRatio}
              onCheckedChange={(checked) => {
                setResize({ keepAspectRatio: checked })
                commitHistory(item.id)
              }}
            />
          </div>
        </div>
      )}

      {resize.mode === 'longEdge' && (
        <div className="space-y-1">
          <Label htmlFor="resize-long-edge">긴 변 길이 (px)</Label>
          <Input
            id="resize-long-edge"
            type="number"
            min={1}
            value={resize.longEdge || ''}
            placeholder={String(Math.max(item.source.width, item.source.height))}
            onChange={(e) => setResize({ longEdge: Number(e.target.value) })}
            onBlur={() => commitHistory(item.id)}
          />
        </div>
      )}

      {resize.mode === 'percentage' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>비율</Label>
            <span className="text-xs text-muted-foreground">{resize.percentage}%</span>
          </div>
          <Slider
            min={10}
            max={200}
            step={5}
            value={[resize.percentage]}
            onValueChange={([v]) => setResize({ percentage: v })}
            onValueCommit={() => commitHistory(item.id)}
          />
        </div>
      )}
    </div>
  )
}
