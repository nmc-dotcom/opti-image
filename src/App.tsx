import { UploadCloud } from 'lucide-react'
import { useImageStore } from '@/store/useImageStore'
import { useTheme } from '@/hooks/useTheme'
import { useAutoProcess } from '@/hooks/useAutoProcess'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useFileDrop } from '@/hooks/useFileDrop'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toaster'
import { toast } from '@/hooks/useToast'
import { TopBar } from '@/features/editor/TopBar'
import { FileList } from '@/features/editor/FileList'
import { PreviewCanvas } from '@/features/editor/PreviewCanvas'
import { SettingsPanel } from '@/features/editor/SettingsPanel'
import { StatusBar } from '@/features/editor/StatusBar'
import { Dropzone } from '@/features/upload/Dropzone'
import { BatchExportDialog } from '@/features/batch/BatchExportDialog'
import { downloadSingleImage } from '@/lib/download'
import { cn } from '@/lib/utils'

function App() {
  useTheme()

  const images = useImageStore((s) => s.images)
  const activeId = useImageStore((s) => s.activeId)
  const activeItem = useImageStore((s) => s.images.find((i) => i.id === s.activeId))
  const addFiles = useImageStore((s) => s.addFiles)
  const processImage = useImageStore((s) => s.processImage)
  const renameRule = useImageStore((s) => s.renameRule)

  useAutoProcess(activeId)

  useKeyboardShortcuts({
    onSave: async () => {
      if (!activeItem) return
      if (!activeItem.result) await processImage(activeItem.id)
      const latest = useImageStore.getState().images.find((i) => i.id === activeItem.id)
      if (latest?.result) {
        downloadSingleImage(latest, renameRule)
        toast({ title: '다운로드 완료' })
      }
    },
  })

  const { isDragging, dropzoneProps } = useFileDrop({
    onFiles: (files) => {
      addFiles(files)
      toast({ title: `${files.length}개 파일 추가됨` })
    },
    onRejected: (reasons) => {
      toast({
        variant: 'destructive',
        title: '일부 파일을 추가할 수 없습니다',
        description: reasons[0],
      })
    },
  })

  return (
    <TooltipProvider>
      <div {...dropzoneProps} className="relative flex h-screen flex-col overflow-hidden">
        <TopBar />

        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          <aside className="flex max-h-48 w-full shrink-0 flex-col border-b lg:h-auto lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r">
            <FileList />
          </aside>

          <main className="min-h-0 flex-1">
            {images.length === 0 ? <Dropzone /> : <PreviewCanvas />}
          </main>

          <aside className="w-full shrink-0 overflow-y-auto border-t lg:h-auto lg:w-80 lg:border-l lg:border-t-0">
            <SettingsPanel />
          </aside>
        </div>

        <StatusBar />

        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-primary/10 backdrop-blur-sm">
            <UploadCloud className={cn('h-12 w-12 text-primary')} />
            <p className="text-lg font-medium text-primary">파일을 여기에 놓으세요</p>
          </div>
        )}
      </div>

      <BatchExportDialog />
      <Toaster />
    </TooltipProvider>
  )
}

export default App
