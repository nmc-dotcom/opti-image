import { useCallback, useRef, useState } from 'react'
import { ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '@/lib/constants'

interface UseFileDropOptions {
  onFiles: (files: File[]) => void
  onRejected?: (reasons: string[]) => void
}

function filterFiles(fileList: FileList | File[]): {
  accepted: File[]
  rejected: string[]
} {
  const accepted: File[] = []
  const rejected: string[] = []

  for (const file of Array.from(fileList)) {
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      rejected.push(`${file.name}: 지원하지 않는 형식입니다.`)
      continue
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      rejected.push(`${file.name}: 파일 크기가 너무 큽니다 (최대 100MB).`)
      continue
    }
    accepted.push(file)
  }

  return { accepted, rejected }
}

/**
 * True only for drags that carry files from outside the page. Dragging inside the app (selected
 * text, a thumbnail, a crop drag that the browser turned into a native drag) carries other types
 * and must not trigger the drop overlay.
 */
function carriesFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

export function useFileDrop({ onFiles, onRejected }: UseFileDropOptions) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const { accepted, rejected } = filterFiles(fileList)
      if (accepted.length > 0) onFiles(accepted)
      if (rejected.length > 0) onRejected?.(rejected)
    },
    [onFiles, onRejected],
  )

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    dragCounter.current += 1
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragging(false)
    }
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!carriesFiles(e)) return
    e.preventDefault()
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      // Stop bubbling so a drop is handled exactly once. The empty-state Dropzone is nested
      // inside App's full-window dropzone; without this a single drop fires both handlers and
      // the file is added twice.
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragging(false)
      if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) handleFiles(e.target.files)
      e.target.value = ''
    },
    [handleFiles],
  )

  return {
    isDragging,
    dropzoneProps: { onDragEnter, onDragLeave, onDragOver, onDrop },
    onInputChange,
  }
}
