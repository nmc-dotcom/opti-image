import { CheckCircle2, ImageIcon, Loader2, X, XCircle } from 'lucide-react'
import { useImageStore } from '@/store/useImageStore'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

export function FileList() {
  const images = useImageStore((s) => s.images)
  const activeId = useImageStore((s) => s.activeId)
  const selectedIds = useImageStore((s) => s.selectedIds)
  const setActive = useImageStore((s) => s.setActive)
  const toggleSelected = useImageStore((s) => s.toggleSelected)
  const removeImage = useImageStore((s) => s.removeImage)
  const selectAll = useImageStore((s) => s.selectAll)
  const clearSelection = useImageStore((s) => s.clearSelection)

  if (images.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <ImageIcon className="h-8 w-8 opacity-40" />
        아직 추가된 이미지가 없습니다.
      </div>
    )
  }

  const allSelected = selectedIds.size === images.length

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
        <span>
          {images.length}개 파일 · {selectedIds.size}개 선택
        </span>
        <button
          className="font-medium text-primary hover:underline"
          onClick={() => (allSelected ? clearSelection() : selectAll())}
        >
          {allSelected ? '선택 해제' : '전체 선택'}
        </button>
      </div>

      <div className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {images.map((item) => (
          <div
            key={item.id}
            className={cn(
              'group flex cursor-pointer items-center gap-2 rounded-md border p-2 transition-colors hover:bg-accent',
              activeId === item.id && 'border-primary bg-accent',
            )}
            onClick={() => setActive(item.id)}
          >
            <Checkbox
              checked={selectedIds.has(item.id)}
              onCheckedChange={() => toggleSelected(item.id)}
              onClick={(e) => e.stopPropagation()}
              aria-label={`${item.source.name} 선택`}
            />

            <img
              src={item.source.originalUrl}
              alt={item.source.name}
              className="h-10 w-10 shrink-0 rounded object-cover"
            />

            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{item.source.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {item.source.width}×{item.source.height} · {formatBytes(item.source.size)}
              </p>
            </div>

            <StatusIcon status={item.status} />

            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                removeImage(item.id)
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'processing')
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
  if (status === 'done') return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
  if (status === 'error') return <XCircle className="h-4 w-4 shrink-0 text-destructive" />
  return null
}
