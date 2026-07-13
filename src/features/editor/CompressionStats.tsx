import { useImageStore } from '@/store/useImageStore'
import { compressionRatio, formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

export function CompressionStats() {
  const activeId = useImageStore((s) => s.activeId)
  const item = useImageStore((s) => s.images.find((i) => i.id === activeId))

  if (!item) return null

  const original = item.source.size
  const result = item.result?.size ?? null
  const ratio = result !== null ? compressionRatio(original, result) : null

  return (
    <div className="grid grid-cols-3 gap-2 rounded-md border bg-muted/40 p-3 text-center text-xs">
      <div>
        <p className="text-muted-foreground">원본</p>
        <p className="font-semibold">{formatBytes(original)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">변환 후</p>
        <p className="font-semibold">{result !== null ? formatBytes(result) : '—'}</p>
      </div>
      <div>
        <p className="text-muted-foreground">절감률</p>
        <p
          className={cn(
            'font-semibold',
            ratio !== null && ratio > 0 && 'text-success',
            ratio !== null && ratio < 0 && 'text-destructive',
          )}
        >
          {ratio !== null
            ? `${ratio > 0 ? '-' : '+'}${Math.abs(ratio).toFixed(1)}%`
            : '—'}
        </p>
      </div>
    </div>
  )
}
