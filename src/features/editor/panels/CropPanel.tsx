import { useImageStore } from '@/store/useImageStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const PRESETS: { label: string; ratio: number | null }[] = [
  { label: '자유', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
]

export function CropPanel() {
  const activeId = useImageStore((s) => s.activeId)
  const item = useImageStore((s) => s.images.find((i) => i.id === activeId))
  const updateSettings = useImageStore((s) => s.updateSettings)
  const commitHistory = useImageStore((s) => s.commitHistory)

  if (!item) return null
  const { crop } = item.settings
  const { width: srcW, height: srcH } = item.source

  const applyPreset = (ratio: number | null) => {
    if (ratio === null) return
    const width = Math.min(srcW, Math.round(srcH * ratio))
    const height = Math.round(width / ratio)
    const x = Math.round((srcW - width) / 2)
    const y = Math.round((srcH - height) / 2)
    updateSettings(item.id, (s) => ({ ...s, crop: { x, y, width, height } }))
    commitHistory(item.id)
  }

  const resetCrop = () => {
    updateSettings(item.id, (s) => ({ ...s, crop: null }))
    commitHistory(item.id)
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        미리보기 이미지 위에서 드래그하여 자를 영역을 지정하세요.
      </p>

      <div className="space-y-1.5">
        <Label>비율 프리셋</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant="outline"
              onClick={() => applyPreset(p.ratio)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {crop && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label="X" value={crop.x} />
          <Field label="Y" value={crop.y} />
          <Field label="너비" value={crop.width} />
          <Field label="높이" value={crop.height} />
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={resetCrop}
        disabled={!crop}
      >
        자르기 초기화
      </Button>
    </div>
  )
}

function Field({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input value={value} readOnly className="h-8 text-xs" />
    </div>
  )
}
