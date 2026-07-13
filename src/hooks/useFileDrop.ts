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
    e.preventDefault()
    dragCounter.current += 1
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragging(false)
    }
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
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
