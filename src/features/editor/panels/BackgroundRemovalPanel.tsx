import { useImageStore } from '@/store/useImageStore'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function BackgroundRemovalPanel() {
  const activeId = useImageStore((s) => s.activeId)
  const item = useImageStore((s) => s.images.find((i) => i.id === activeId))
  const updateSettings = useImageStore((s) => s.updateSettings)
  const commitHistory = useImageStore((s) => s.commitHistory)
  const aiProgress = useImageStore((s) => s.aiProgress)

  if (!item) return null
  const { backgroundRemoval, format } = item.settings

  const toggle = (checked: boolean) => {
    updateSettings(item.id, (s) => ({
      ...s,
      backgroundRemoval: checked,
      // JPG has no alpha channel; auto-switch so the cutout isn't silently flattened.
      format: checked && s.format === 'jpeg' ? 'png' : s.format,
    }))
    commitHistory(item.id)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label>배경 제거</Label>
          <p className="text-xs text-muted-foreground">
            AI 모델(ISNet)로 피사체만 남기고 배경을 투명하게 만듭니다.
          </p>
        </div>
        <Switch checked={backgroundRemoval} onCheckedChange={toggle} />
      </div>

      {backgroundRemoval && format === 'jpeg' && (
        <p className="text-xs text-amber-500">
          JPG는 투명도를 지원하지 않습니다. Format 탭에서 PNG 또는 WEBP를 선택하세요.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        처음 실행 시 AI 모델(약 40MB)을 내려받으며, 이후에는 브라우저에 캐시되어 빠르게
        동작합니다. 이미지는 서버로 전송되지 않고 기기 내에서만 처리됩니다.
      </p>

      {aiProgress && (
        <div className="space-y-1 rounded-md border p-2">
          <p className="text-xs font-medium">
            {aiProgress.label} {aiProgress.percent}%
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${aiProgress.percent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
