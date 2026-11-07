import { useState } from 'react'
import { useImageStore } from '@/store/useImageStore'
import { useUiStore } from '@/store/useUiStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { applyCropField, defaultCrop, ratioCrop, type CropField } from '@/lib/cropGeometry'
import { computeResizedDimensions } from '@/lib/imagePipeline'
import type { CropRect } from '@/types/image'

const PRESETS: { label: string; ratio: number | null }[] = [
  { label: '자유', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
]

const sameCrop = (a: CropRect | null, b: CropRect | null) =>
  a === b ||
  (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)

export function CropPanel() {
  const activeId = useImageStore((s) => s.activeId)
  const item = useImageStore((s) => s.images.find((i) => i.id === activeId))
  const updateSettings = useImageStore((s) => s.updateSettings)
  const commitHistory = useImageStore((s) => s.commitHistory)
  const ratio = useUiStore((s) => (activeId ? (s.cropRatios[activeId] ?? null) : null))
  const setRatioFor = useUiStore((s) => s.setCropRatio)

  if (!item) return null
  // A ratio lock belongs to the image it was chosen for.
  const setRatio = (value: number | null) => setRatioFor(item.id, value)
  const { crop, rotation, resize } = item.settings
  const { width: srcW, height: srcH } = item.source

  const setCrop = (next: CropRect | null) =>
    updateSettings(item.id, (s) => ({ ...s, crop: next }))

  /** One undo step per finished edit, and none when nothing changed (e.g. focus then blur). */
  const commitIfChanged = () => {
    const current = useImageStore.getState().images.find((i) => i.id === item.id)
    if (!current) return
    const last = current.history[current.historyIndex]
    if (!sameCrop(last?.crop ?? null, current.settings.crop)) commitHistory(item.id)
  }

  const applyPreset = (presetRatio: number | null) => {
    setRatio(presetRatio)
    if (presetRatio === null) {
      // "Free" unlocks the ratio and makes sure there is a box to edit.
      if (!crop) {
        setCrop(defaultCrop(srcW, srcH, null))
        commitIfChanged()
      }
      return
    }
    setCrop(ratioCrop(srcW, srcH, presetRatio))
    commitIfChanged()
  }

  const resetCrop = () => {
    setRatio(null)
    setCrop(null)
    commitIfChanged()
  }

  const setField = (field: CropField, value: number) => {
    const base = crop ?? defaultCrop(srcW, srcH, ratio)
    setCrop(applyCropField(base, field, value, srcW, srcH, ratio))
  }

  // What the export will really be: the crop is cut from the ORIGINAL pixels first, then
  // rotated and resized. Showing the end result avoids the "I resized it, why is it different" trap.
  const cropped = crop ?? { x: 0, y: 0, width: srcW, height: srcH }
  const swap = rotation === 90 || rotation === 270
  const output = computeResizedDimensions(
    swap ? cropped.height : cropped.width,
    swap ? cropped.width : cropped.height,
    resize,
  )
  const activePreset = PRESETS.find((p) =>
    p.ratio === null ? ratio === null : ratio !== null && Math.abs(p.ratio - ratio) < 1e-6,
  )

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        미리보기에서 드래그해 자를 영역을 지정하세요. 모서리·변을 끌어 크기를 바꾸고, 박스
        안쪽을 끌면 이동합니다. 아래 숫자로도 정확히 입력할 수 있습니다.
      </p>

      <div className="space-y-1.5">
        <Label>비율</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant={activePreset?.label === p.label ? 'default' : 'outline'}
              onClick={() => applyPreset(p.ratio)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {ratio === null
            ? '자유: 가로·세로를 따로 조절합니다.'
            : `${activePreset?.label ?? '비율'} 고정: 너비나 높이를 바꾸면 다른 쪽이 따라갑니다. 해제하려면 "자유"를 누르세요.`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <NumberField
          label="X"
          value={crop?.x ?? 0}
          disabled={!crop}
          onLive={(v) => setField('x', v)}
          onCommit={commitIfChanged}
        />
        <NumberField
          label="Y"
          value={crop?.y ?? 0}
          disabled={!crop}
          onLive={(v) => setField('y', v)}
          onCommit={commitIfChanged}
        />
        <NumberField
          label="너비"
          value={cropped.width}
          min={1}
          onLive={(v) => setField('width', v)}
          onCommit={commitIfChanged}
        />
        <NumberField
          label="높이"
          value={cropped.height}
          min={1}
          onLive={(v) => setField('height', v)}
          onCommit={commitIfChanged}
        />
      </div>
      {!crop && (
        <p className="text-[11px] text-muted-foreground">
          자르기 영역이 없습니다. 미리보기에서 드래그하거나 숫자를 입력해 시작하세요.
        </p>
      )}

      <div className="rounded-md border bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
        <p>
          원본 {srcW}×{srcH}
          {crop && (
            <>
              {' '}
              → 자른 영역 <b className="text-foreground">{crop.width}×{crop.height}</b>
            </>
          )}
        </p>
        {resize.mode !== 'none' || rotation !== 0 ? (
          <p>
            → 최종 출력 <b className="text-foreground">{output.width}×{output.height}</b>
          </p>
        ) : null}
        {resize.mode !== 'none' && (
          <p className="mt-1">
            자르기는 <b>원본 픽셀 기준</b>이며, 자른 뒤에 리사이즈가 적용됩니다.
          </p>
        )}
      </div>

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

/**
 * Number input that behaves like a text box while you type. The text being typed is kept
 * separately from the stored value, so you can empty the field and type a new number — the old
 * version rewrote the field to "1" the moment it was cleared, turning "800" into "1800". Valid
 * numbers apply live; the field snaps back to the (clamped) stored value on blur/Enter.
 */
function NumberField({
  label,
  value,
  min = 0,
  disabled,
  onLive,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  disabled?: boolean
  onLive: (value: number) => void
  onCommit: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        step={1}
        disabled={disabled}
        value={draft ?? String(value)}
        className="h-8 text-xs"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          const n = Number(raw)
          // An empty or half-typed field is not an edit; only real numbers are applied.
          if (raw.trim() !== '' && Number.isFinite(n) && n >= min) onLive(n)
        }}
        onBlur={() => {
          setDraft(null)
          onCommit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setDraft(null)
        }}
      />
    </div>
  )
}
