import { useState } from 'react'
import { useImageStore } from '@/store/useImageStore'
import { useUiStore } from '@/store/useUiStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { formatBytes, compressionRatio } from '@/lib/format'
import { downloadZip, downloadSingleImage } from '@/lib/download'
import { toast } from '@/hooks/useToast'

export function BatchExportDialog() {
  const open = useUiStore((s) => s.batchExportOpen)
  const setOpen = useUiStore((s) => s.setBatchExportOpen)
  const images = useImageStore((s) => s.images)
  const selectedIds = useImageStore((s) => s.selectedIds)
  const processMany = useImageStore((s) => s.processMany)
  const renameRule = useImageStore((s) => s.renameRule)
  const [isExporting, setIsExporting] = useState(false)

  const targets =
    selectedIds.size > 0 ? images.filter((i) => selectedIds.has(i.id)) : images

  const totalOriginal = targets.reduce((sum, i) => sum + i.source.size, 0)
  const totalResult = targets.reduce(
    (sum, i) => sum + (i.result?.size ?? i.source.size),
    0,
  )
  const ratio = compressionRatio(totalOriginal, totalResult)

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const unprocessed = targets.filter((i) => !i.result).map((i) => i.id)
      if (unprocessed.length > 0) await processMany(unprocessed)

      const ready = useImageStore
        .getState()
        .images.filter((i) => targets.some((t) => t.id === i.id) && i.result)

      if (ready.length === 0) {
        toast({ variant: 'destructive', title: '다운로드할 이미지가 없습니다' })
        return
      }

      if (ready.length === 1) {
        downloadSingleImage(ready[0], renameRule)
      } else {
        await downloadZip(ready, renameRule)
      }

      toast({ title: `${ready.length}개 파일 다운로드 완료` })
      setOpen(false)
    } catch {
      toast({ variant: 'destructive', title: '내보내기 중 오류가 발생했습니다' })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>다운로드</DialogTitle>
          <DialogDescription>
            {targets.length > 1
              ? `${targets.length}개 이미지를 ZIP으로 내보냅니다.`
              : '선택한 이미지를 다운로드합니다.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 rounded-md border bg-muted/40 p-3 text-center text-xs">
          <div>
            <p className="text-muted-foreground">원본 총 용량</p>
            <p className="font-semibold">{formatBytes(totalOriginal)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">변환 후 총 용량</p>
            <p className="font-semibold">{formatBytes(totalResult)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">절감률</p>
            <p className="font-semibold">
              {ratio > 0 ? '-' : '+'}
              {Math.abs(ratio).toFixed(1)}%
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">파일명 규칙: {renameRule.pattern}</p>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button onClick={handleExport} disabled={isExporting || targets.length === 0}>
            {isExporting && <Spinner />} 내보내기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
