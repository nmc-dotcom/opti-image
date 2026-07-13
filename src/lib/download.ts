import JSZip from 'jszip'
import type { ImageItem, RenameRule } from '@/types/image'
import { applyRenameRule } from '@/lib/fileNaming'

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadSingleImage(item: ImageItem, renameRule: RenameRule) {
  if (!item.result) return
  const filename = applyRenameRule(item.source.name, renameRule, 0, item.settings.format)
  triggerDownload(item.result.blob, filename)
}

export async function downloadZip(items: ImageItem[], renameRule: RenameRule) {
  const zip = new JSZip()

  items.forEach((item, index) => {
    if (!item.result) return
    const filename = applyRenameRule(
      item.source.name,
      renameRule,
      index,
      item.settings.format,
    )
    zip.file(filename, item.result.blob)
  })

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  triggerDownload(blob, `opti-image_${Date.now()}.zip`)
}
