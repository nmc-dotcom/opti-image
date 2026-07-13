import { useEffect } from 'react'
import { useImageStore } from '@/store/useImageStore'

interface UseKeyboardShortcutsOptions {
  onSave: () => void
}

export function useKeyboardShortcuts({ onSave }: UseKeyboardShortcutsOptions) {
  const undo = useImageStore((s) => s.undo)
  const redo = useImageStore((s) => s.redo)
  const activeId = useImageStore((s) => s.activeId)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey
      if (!isMod) return

      const key = e.key.toLowerCase()

      if (key === 'z' && e.shiftKey) {
        e.preventDefault()
        if (activeId) redo(activeId)
        return
      }
      if (key === 'z') {
        e.preventDefault()
        if (activeId) undo(activeId)
        return
      }
      if (key === 'y') {
        e.preventDefault()
        if (activeId) redo(activeId)
        return
      }
      if (key === 's') {
        e.preventDefault()
        onSave()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, activeId, onSave])
}
