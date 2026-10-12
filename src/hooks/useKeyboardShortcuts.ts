import { useEffect } from 'react'
import { useImageStore } from '@/store/useImageStore'
import { useUiStore } from '@/store/useUiStore'
import { useEditStore } from '@/store/useEditStore'

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

      // Let text fields keep their native undo/redo (e.g. while typing replacement text).
      const target = e.target as HTMLElement | null
      const inTextField =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (inTextField && (key === 'z' || key === 'y')) return

      // In the Edit tool, an unapplied selection is undone stroke-by-stroke before falling
      // through to the image's settings history (like a paint program).
      const editingMask =
        useUiStore.getState().activeTool === 'edit' && useEditStore.getState().mode === 'remove'

      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        if (!activeId) return
        if (editingMask && useEditStore.getState().redoStroke(activeId)) return
        redo(activeId)
        return
      }
      if (key === 'z') {
        e.preventDefault()
        if (!activeId) return
        if (editingMask && useEditStore.getState().undoStroke(activeId)) return
        undo(activeId)
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
