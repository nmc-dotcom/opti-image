import { useEffect, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Plus,
  ScanText,
  Trash2,
  Type,
} from 'lucide-react'
import { useImageStore } from '@/store/useImageStore'
import { useEditStore, getImageEditState } from '@/store/useEditStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  addTextLayer,
  commitTextLayers,
  deleteTextLayer,
  guessTextStyle,
  updateTextLayer,
  useTextEditing,
  type TextLayerStyle,
} from '@/hooks/useTextEditing'
import { FONT_OPTIONS } from '@/lib/textRendering'
import { cn } from '@/lib/utils'
import type { OcrGranularity, OcrLanguage } from '@/features/ai/ocr/types'
import type { OcrTextRegion, TextLayer } from '@/types/editing'
import { InpaintMethodPicker } from '../components/InpaintMethodPicker'
import { JobProgress } from '../components/JobProgress'

const LANGUAGES: { value: OcrLanguage; label: string }[] = [
  { value: 'kor+eng', label: '한국어 + 영어' },
  { value: 'eng', label: '영어' },
  { value: 'kor', label: '한국어' },
]

const ALIGNS: { value: CanvasTextAlign; icon: React.ReactNode; label: string }[] = [
  { value: 'left', icon: <AlignLeft />, label: '왼쪽' },
  { value: 'center', icon: <AlignCenter />, label: '가운데' },
  { value: 'right', icon: <AlignRight />, label: '오른쪽' },
]

const textareaClass =
  'flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function TextEditPanel() {
  const activeId = useImageStore((s) => s.activeId)
  const layers = useImageStore(
    (s) => s.images.find((i) => i.id === s.activeId)?.settings.textLayers,
  )
  const { ocrRegions, selectedRegionId, selectedLayerId } = useEditStore((s) =>
    getImageEditState(s.byImage, activeId),
  )
  const selectRegion = useEditStore((s) => s.selectRegion)
  const selectLayer = useEditStore((s) => s.selectLayer)
  const { job, busy, recognize } = useTextEditing()
  const [lang, setLang] = useState<OcrLanguage>('kor+eng')
  const [granularity, setGranularity] = useState<OcrGranularity>('line')

  if (!activeId || !layers) return null
  const selectedRegion = ocrRegions?.find((r) => r.id === selectedRegionId) ?? null
  const selectedLayer = layers.find((l) => l.id === selectedLayerId) ?? null

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-1.5">
          <Select value={lang} onValueChange={(v) => setLang(v as OcrLanguage)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value} className="text-xs">
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-1">
            {(['line', 'word'] as const).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={granularity === g ? 'default' : 'outline'}
                onClick={() => setGranularity(g)}
              >
                {g === 'line' ? '줄' : '단어'}
              </Button>
            ))}
          </div>
        </div>
        <Button
          className="w-full"
          variant="secondary"
          disabled={busy}
          onClick={() => recognize(activeId, lang, granularity)}
        >
          {busy ? <Spinner className="h-4 w-4" /> : <ScanText />} 텍스트 인식 (OCR)
        </Button>
        <p className="text-[11px] text-muted-foreground">
          처음 실행 시 OCR 엔진과 언어 데이터(약 8MB)를 내려받습니다. 이미지는 기기 밖으로
          전송되지 않습니다.
        </p>
      </div>

      {job && <JobProgress job={job} />}

      {ocrRegions && (
        <div className="space-y-1.5">
          <Label>인식된 텍스트 ({ocrRegions.length})</Label>
          {ocrRegions.length === 0 ? (
            <p className="text-xs text-muted-foreground">인식된 텍스트가 없습니다.</p>
          ) : (
            <ul className="scrollbar-thin max-h-36 space-y-1 overflow-y-auto pr-1">
              {ocrRegions.map((region) => (
                <li key={region.id}>
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs hover:bg-accent',
                      region.id === selectedRegionId && 'border-primary bg-primary/10',
                    )}
                    onClick={() => selectRegion(activeId, region.id)}
                  >
                    <span className="flex-1 truncate">{region.text}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {region.confidence}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selectedRegion && (
        <RegionEditor key={selectedRegion.id} imageId={activeId} region={selectedRegion} />
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>텍스트 레이어 ({layers.length})</Label>
          <Button size="sm" variant="outline" className="h-7" onClick={() => addTextLayer(activeId)}>
            <Plus /> 추가
          </Button>
        </div>
        {layers.length > 0 && (
          <ul className="space-y-1">
            {layers.map((layer) => (
              <li key={layer.id}>
                <button
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs hover:bg-accent',
                    layer.id === selectedLayerId && 'border-primary bg-primary/10',
                  )}
                  onClick={() => selectLayer(activeId, layer.id)}
                >
                  <Type className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{layer.text || '(빈 텍스트)'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          미리보기에서 텍스트를 드래그해 위치를 옮길 수 있습니다.
        </p>
      </div>

      {selectedLayer && <LayerEditor imageId={activeId} layer={selectedLayer} />}
    </div>
  )
}

/** Replace a recognized text region: new text + style, then erase original and render. */
function RegionEditor({ imageId, region }: { imageId: string; region: OcrTextRegion }) {
  const method = useEditStore((s) => s.method)
  const { busy, replace } = useTextEditing()
  const [text, setText] = useState(region.text)
  const [style, setStyle] = useState<TextLayerStyle>({
    fontFamily: FONT_OPTIONS[0].value,
    fontSize: Math.max(8, Math.round(region.bbox.height)),
    fontWeight: 'normal',
    color: '#000000',
    textAlign: 'left',
  })

  // Match size and color to the original text once, when the region is selected.
  useEffect(() => {
    let cancelled = false
    guessTextStyle(imageId, region, FONT_OPTIONS[0].value, 'normal')
      .then((guess) => {
        if (!cancelled) setStyle((s) => ({ ...s, fontSize: guess.fontSize, color: guess.color }))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [imageId, region])

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">기존 텍스트</Label>
        <p className="break-all text-xs">{region.text}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="replace-text">새 텍스트</Label>
        <textarea
          id="replace-text"
          className={textareaClass}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <StyleFields style={style} onChange={(patch) => setStyle((s) => ({ ...s, ...patch }))} />
      <InpaintMethodPicker />
      <Button
        className="w-full"
        disabled={busy}
        onClick={() => replace(imageId, region, text, style, method)}
      >
        {busy ? <Spinner className="h-4 w-4" /> : <Type />} 적용
      </Button>
      <p className="text-[11px] text-muted-foreground">
        기존 글자를 지우고 배경을 복원한 뒤 새 텍스트를 그립니다. 새 텍스트를 비우면 글자만
        지웁니다.
      </p>
    </div>
  )
}

/** Live-edits an existing text layer; each finished change is one undo step. */
function LayerEditor({ imageId, layer }: { imageId: string; layer: TextLayer }) {
  const update = (patch: Partial<TextLayer>) => updateTextLayer(imageId, layer.id, patch)
  const commit = () => commitTextLayers(imageId)

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <Label htmlFor="layer-text">텍스트</Label>
        <textarea
          id="layer-text"
          className={textareaClass}
          rows={2}
          value={layer.text}
          onChange={(e) => update({ text: e.target.value })}
          onBlur={commit}
        />
      </div>
      <StyleFields
        style={layer}
        onChange={(patch) => {
          update(patch)
          // Discrete controls (font, bold, align) commit immediately; numeric/color inputs
          // commit on blur via onCommit.
          if (!('fontSize' in patch) && !('color' in patch)) commit()
        }}
        onCommit={commit}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={Math.round(layer.x)} onChange={(x) => update({ x })} onCommit={commit} />
        <NumberField label="Y" value={Math.round(layer.y)} onChange={(y) => update({ y })} onCommit={commit} />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full text-destructive"
        onClick={() => deleteTextLayer(imageId, layer.id)}
      >
        <Trash2 /> 레이어 삭제
      </Button>
    </div>
  )
}

function StyleFields({
  style,
  onChange,
  onCommit,
}: {
  style: TextLayerStyle
  onChange: (patch: Partial<TextLayerStyle>) => void
  onCommit?: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">글꼴</Label>
        <Select value={style.fontFamily} onValueChange={(fontFamily) => onChange({ fontFamily })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_OPTIONS.map((f) => (
              <SelectItem key={f.label} value={f.value} className="text-xs">
                <span style={{ fontFamily: f.value }}>{f.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-1.5">
        <NumberField
          label="크기 (px)"
          value={style.fontSize}
          min={4}
          onChange={(fontSize) => onChange({ fontSize: Math.max(4, fontSize) })}
          onCommit={onCommit}
        />
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">색상</Label>
          <input
            type="color"
            aria-label="색상"
            className="h-8 w-10 cursor-pointer rounded-md border border-input bg-background p-0.5"
            value={style.color}
            onChange={(e) => onChange({ color: e.target.value })}
            onBlur={onCommit}
          />
        </div>
        <Button
          size="icon"
          variant={style.fontWeight === 'bold' ? 'default' : 'outline'}
          className="h-8 w-8"
          title="굵게"
          onClick={() => onChange({ fontWeight: style.fontWeight === 'bold' ? 'normal' : 'bold' })}
        >
          <Bold />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {ALIGNS.map((a) => (
          <Button
            key={a.value}
            size="sm"
            variant={style.textAlign === a.value ? 'default' : 'outline'}
            title={a.label}
            onClick={() => onChange({ textAlign: a.value })}
          >
            {a.icon}
          </Button>
        ))}
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  onChange: (value: number) => void
  onCommit?: () => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={min}
        value={value}
        className="h-8 text-xs"
        onChange={(e) => {
          const next = Number(e.target.value)
          if (!Number.isNaN(next)) onChange(next)
        }}
        onBlur={onCommit}
      />
    </div>
  )
}
