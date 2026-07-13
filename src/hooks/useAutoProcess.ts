import { useEffect, useRef } from 'react'
import { useImageStore } from '@/store/useImageStore'

const DEBOUNCE_MS = 250

/** Re-runs the worker pipeline for the active image whenever its settings change. */
export function useAutoProcess(id: string | null) {
  const settings = useImageStore((s) => s.images.find((i) => i.id === id)?.settings)
  const processImage = useImageStore((s) => s.processImage)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!id || !settings) return

    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      processImage(id)
    }, DEBOUNCE_MS)

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, JSON.stringify(settings)])
}
