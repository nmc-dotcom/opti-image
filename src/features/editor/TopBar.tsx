import { useRef } from 'react'
import { Images, Moon, Play, Sun, Trash2, Upload } from 'lucide-react'
import { useImageStore } from '@/store/useImageStore'
import { useUiStore } from '@/store/useUiStore'
import { useTheme } from '@/hooks/useTheme'
import { useFileDrop } from '@/hooks/useFileDrop'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/useToast'

export function TopBar() {
  const inputRef = useRef<HTMLInputElement>(null)
  const images = useImageStore((s) => s.images)
  const selectedIds = useImageStore((s) => s.selectedIds)
  const addFiles = useImageStore((s) => s.addFiles)
  const processMany = useImageStore((s) => s.processMany)
  const clearAll = useImageStore((s) => s.clearAll)
  const batchProgress = useImageStore((s) => s.batchProgress)
  const setBatchExportOpen = useUiStore((s) => s.setBatchExportOpen)
  const { theme, setTheme } = useTheme()

  const { onInputChange } = useFileDrop({
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

  const targetIds =
    selectedIds.size > 0 ? Array.from(selectedIds) : images.map((i) => i.id)

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 overflow-x-auto border-b px-2 sm:gap-2 sm:px-4">
      <div className="flex shrink-0 items-center gap-2 font-semibold">
        <Images className="h-5 w-5 text-primary" />
        <span className="hidden sm:inline">OptiImage</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml"
          className="hidden"
          onChange={onInputChange}
        />
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <Upload /> <span className="hidden sm:inline">파일 추가</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={images.length === 0 || batchProgress !== null}
          onClick={() => processMany(targetIds)}
        >
          <Play />
          <span className="hidden sm:inline">일괄 처리</span>
          {selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
        </Button>

        <Button
          size="sm"
          disabled={images.length === 0}
          onClick={() => setBatchExportOpen(true)}
        >
          다운로드
        </Button>

        <Button
          variant="ghost"
          size="icon"
          disabled={images.length === 0}
          onClick={clearAll}
          title="전체 삭제"
        >
          <Trash2 />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="테마 전환"
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  )
}
