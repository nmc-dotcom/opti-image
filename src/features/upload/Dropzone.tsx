import { useRef } from 'react'
import { UploadCloud } from 'lucide-react'
import { useImageStore } from '@/store/useImageStore'
import { useFileDrop } from '@/hooks/useFileDrop'
import { toast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'

export function Dropzone() {
  const inputRef = useRef<HTMLInputElement>(null)
  const addFiles = useImageStore((s) => s.addFiles)

  const { isDragging, dropzoneProps, onInputChange } = useFileDrop({
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
    <div
      {...dropzoneProps}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'flex h-full flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed m-4 transition-colors',
        isDragging ? 'border-primary bg-accent' : 'border-border hover:bg-accent/40',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml"
        className="hidden"
        onChange={onInputChange}
      />
      <UploadCloud className="h-10 w-10 text-muted-foreground" />
      <div className="text-center">
        <p className="text-sm font-medium">이미지를 드래그하거나 클릭하여 추가하세요</p>
        <p className="text-xs text-muted-foreground">
          PNG, JPG, WEBP, GIF, BMP, SVG · 모든 처리는 브라우저에서 이루어집니다
        </p>
      </div>
    </div>
  )
}
