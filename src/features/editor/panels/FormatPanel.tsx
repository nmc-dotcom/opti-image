import { useImageStore } from '@/store/useImageStore'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import type { ImageFormat } from '@/types/image'

const FORMATS: { value: ImageFormat; label: string; hint: string }[] = [
  { value: 'png', label: 'PNG', hint: '무손실 · 투명도 지원' },
  { value: 'jpeg', label: 'JPG', hint: '손실 압축 · 용량 작음' },
  { value: 'webp', label: 'WEBP', hint: '차세대 포맷 · 고효율' },
]

export function FormatPanel() {
  const activeId = useImageStore((s) => s.activeId)
  const item = useImageStore((s) => s.images.find((i) => i.id === activeId))
  const updateSettings = useImageStore((s) => s.updateSettings)
  const commitHistory = useImageStore((s) => s.commitHistory)

  if (!item) return null
  const { format, quality } = item.settings
  const qualityApplicable = format !== 'png'

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>출력 포맷</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {FORMATS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={format === f.value ? 'default' : 'outline'}
              onClick={() => {
                updateSettings(item.id, (s) => ({ ...s, format: f.value }))
                commitHistory(item.id)
              }}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {FORMATS.find((f) => f.value === format)?.hint}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className={!qualityApplicable ? 'text-muted-foreground' : ''}>
            품질
          </Label>
          <span className="text-xs text-muted-foreground">{quality}</span>
        </div>
        <Slider
          min={1}
          max={100}
          step={1}
          disabled={!qualityApplicable}
          value={[quality]}
          onValueChange={([v]) => updateSettings(item.id, (s) => ({ ...s, quality: v }))}
          onValueCommit={() => commitHistory(item.id)}
        />
        {!qualityApplicable && (
          <p className="text-xs text-muted-foreground">
            PNG는 무손실 포맷이라 품질 설정이 적용되지 않습니다.
          </p>
        )}
      </div>
    </div>
  )
}
