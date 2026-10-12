import { Brush, Eraser, Lasso, Redo2, Square, Trash2, Undo2, Wand2 } from 'lucide-react'
import { useImageStore } from '@/store/useImageStore'
import { useEditStore, getImageEditState } from '@/store/useEditStore'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { useRetouch } from '@/hooks/useRetouch'
import { toast } from '@/hooks/useToast'
import { InpaintMethodPicker } from '../components/InpaintMethodPicker'
import { JobProgress } from '../components/JobProgress'
import type { MaskTool } from '@/types/editing'

const TOOLS: { value: MaskTool; label: string; icon: React.ReactNode }[] = [
  { value: 'brush', label: '브러시', icon: <Brush /> },
  { value: 'rect', label: '사각형', icon: <Square /> },
  { value: 'lasso', label: '자유 선택', icon: <Lasso /> },
]

export function ObjectRemovalPanel() {
  const activeId = useImageStore((s) => s.activeId)
  const maskTool = useEditStore((s) => s.maskTool)
  const maskMode = useEditStore((s) => s.maskMode)
  const brushSize = useEditStore((s) => s.brushSize)
  const brushEdge = useEditStore((s) => s.brushEdge)
  const feather = useEditStore((s) => s.feather)
  const setMaskTool = useEditStore((s) => s.setMaskTool)
  const setMaskMode = useEditStore((s) => s.setMaskMode)
  const setBrushSize = useEditStore((s) => s.setBrushSize)
  const setBrushEdge = useEditStore((s) => s.setBrushEdge)
  const setFeather = useEditStore((s) => s.setFeather)
  const undoStroke = useEditStore((s) => s.undoStroke)
  const redoStroke = useEditStore((s) => s.redoStroke)
  const clearStrokes = useEditStore((s) => s.clearStrokes)
  const method = useEditStore((s) => s.method)
  const { strokes, redoStrokes } = useEditStore((s) => getImageEditState(s.byImage, activeId))
  const { job, busy, remove } = useRetouch()

  if (!activeId) return null

  const apply = async () => {
    const outcome = await remove({
      imageId: activeId,
      strokes,
      method,
      feather,
      kind: 'object-removal',
    })
    if (outcome) {
      clearStrokes(activeId)
      toast({ title: '선택 영역을 지웠습니다', description: `${outcome.millis}ms · ${outcome.algorithm}` })
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        미리보기에서 지울 영역을 칠하거나 지정하세요. Alt 키를 누른 채 칠하면 선택이
        복원됩니다.
      </p>

      <div className="space-y-1.5">
        <Label>선택 도구</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {TOOLS.map((tool) => (
            <Button
              key={tool.value}
              size="sm"
              variant={maskTool === tool.value ? 'default' : 'outline'}
              onClick={() => setMaskTool(tool.value)}
            >
              {tool.icon} {tool.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          variant={maskMode === 'add' ? 'default' : 'outline'}
          onClick={() => setMaskMode('add')}
        >
          <Brush /> 선택 칠하기
        </Button>
        <Button
          size="sm"
          variant={maskMode === 'erase' ? 'default' : 'outline'}
          onClick={() => setMaskMode('erase')}
        >
          <Eraser /> 선택 복원
        </Button>
      </div>

      {maskTool === 'brush' && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>브러시 크기</Label>
              <span className="text-xs text-muted-foreground">{brushSize}px</span>
            </div>
            <Slider
              min={4}
              max={200}
              step={1}
              value={[brushSize]}
              onValueChange={([v]) => setBrushSize(v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>가장자리</Label>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                variant={brushEdge === 'hard' ? 'default' : 'outline'}
                onClick={() => setBrushEdge('hard')}
              >
                하드
              </Button>
              <Button
                size="sm"
                variant={brushEdge === 'soft' ? 'default' : 'outline'}
                onClick={() => setBrushEdge('soft')}
              >
                소프트
              </Button>
            </div>
          </div>
        </>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>경계 페더</Label>
          <span className="text-xs text-muted-foreground">{feather}px</span>
        </div>
        <Slider
          min={0}
          max={40}
          step={1}
          value={[feather]}
          onValueChange={([v]) => setFeather(v)}
        />
        <p className="text-[11px] text-muted-foreground">
          원본 픽셀 기준으로 선택 영역 바깥쪽을 부드럽게 섞습니다.
        </p>
      </div>

      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={strokes.length === 0}
          onClick={() => undoStroke(activeId)}
          title="선택 되돌리기"
        >
          <Undo2 /> 선택 취소
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={redoStrokes.length === 0}
          onClick={() => redoStroke(activeId)}
          title="선택 다시 실행"
        >
          <Redo2 />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={strokes.length === 0}
          onClick={() => clearStrokes(activeId)}
        >
          <Trash2 /> 전체 해제
        </Button>
      </div>

      <InpaintMethodPicker />

      <Button className="w-full" disabled={strokes.length === 0 || busy} onClick={apply}>
        {busy ? <Spinner className="h-4 w-4" /> : <Wand2 />} 선택 영역 지우기
      </Button>

      {job && <JobProgress job={job} />}
    </div>
  )
}
