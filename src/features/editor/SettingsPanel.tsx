import { Download, Redo2, Undo2 } from 'lucide-react'
import { useImageStore } from '@/store/useImageStore'
import { useUiStore, type EditorTool } from '@/store/useUiStore'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { CompressionStats } from './CompressionStats'
import { ResizePanel } from './panels/ResizePanel'
import { FormatPanel } from './panels/FormatPanel'
import { TransformPanel } from './panels/TransformPanel'
import { CropPanel } from './panels/CropPanel'
import { RenamePanel } from './panels/RenamePanel'
import { downloadSingleImage } from '@/lib/download'

const TOOL_TABS: { value: EditorTool; label: string }[] = [
  { value: 'resize', label: 'Resize' },
  { value: 'format', label: 'Format' },
  { value: 'transform', label: 'Rotate' },
  { value: 'crop', label: 'Crop' },
  { value: 'rename', label: 'Rename' },
]

export function SettingsPanel() {
  const activeId = useImageStore((s) => s.activeId)
  const item = useImageStore((s) => s.images.find((i) => i.id === activeId))
  const undo = useImageStore((s) => s.undo)
  const redo = useImageStore((s) => s.redo)
  const renameRule = useImageStore((s) => s.renameRule)
  const activeTool = useUiStore((s) => s.activeTool)
  const setActiveTool = useUiStore((s) => s.setActiveTool)

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        설정을 편집할 이미지를 선택하세요.
      </div>
    )
  }

  const canUndo = item.historyIndex > 0
  const canRedo = item.historyIndex < item.history.length - 1

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <CompressionStats />

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon"
          disabled={!canUndo}
          onClick={() => undo(item.id)}
        >
          <Undo2 />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={!canRedo}
          onClick={() => redo(item.id)}
        >
          <Redo2 />
        </Button>
        <Button
          className="ml-auto"
          size="sm"
          disabled={!item.result}
          onClick={() => item.result && downloadSingleImage(item, renameRule)}
        >
          <Download /> 다운로드
        </Button>
      </div>

      <Tabs value={activeTool} onValueChange={(v) => setActiveTool(v as EditorTool)}>
        <TabsList className="grid w-full grid-cols-5">
          {TOOL_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="resize">
          <ResizePanel />
        </TabsContent>
        <TabsContent value="format">
          <FormatPanel />
        </TabsContent>
        <TabsContent value="transform">
          <TransformPanel />
        </TabsContent>
        <TabsContent value="crop">
          <CropPanel />
        </TabsContent>
        <TabsContent value="rename">
          <RenamePanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
