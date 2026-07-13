import { create } from 'zustand'
import { DEFAULT_EDIT_SETTINGS, MAX_HISTORY_LENGTH } from '@/lib/constants'
import { createSourceImage } from '@/lib/loadImage'
import { imageWorkerPool } from '@/workers/imageWorkerClient'
import type {
  EditSettings,
  ImageItem,
  LogEntry,
  ProcessStatus,
  RenameRule,
} from '@/types/image'

interface ImageState {
  images: ImageItem[]
  activeId: string | null
  selectedIds: Set<string>
  logs: LogEntry[]
  batchProgress: { current: number; total: number } | null

  addFiles: (files: File[]) => Promise<void>
  removeImage: (id: string) => void
  clearAll: () => void

  setActive: (id: string | null) => void
  toggleSelected: (id: string) => void
  selectAll: () => void
  clearSelection: () => void

  updateSettings: (id: string, updater: (settings: EditSettings) => EditSettings) => void
  commitHistory: (id: string) => void
  undo: (id: string) => void
  redo: (id: string) => void

  processImage: (id: string) => Promise<void>
  processMany: (ids: string[]) => Promise<void>

  renameRule: RenameRule
  setRenameRule: (rule: RenameRule) => void

  log: (level: LogEntry['level'], message: string) => void
}

function createLogEntry(level: LogEntry['level'], message: string): LogEntry {
  return { id: crypto.randomUUID(), timestamp: Date.now(), level, message }
}

function setStatus(images: ImageItem[], id: string, status: ProcessStatus): ImageItem[] {
  return images.map((item) => (item.id === id ? { ...item, status } : item))
}

export const useImageStore = create<ImageState>((set, get) => ({
  images: [],
  activeId: null,
  selectedIds: new Set(),
  logs: [],
  batchProgress: null,

  addFiles: async (files) => {
    const created = await Promise.all(
      files.map(async (file) => {
        const id = crypto.randomUUID()
        const source = await createSourceImage(file, id)
        const item: ImageItem = {
          id,
          source,
          settings: { ...DEFAULT_EDIT_SETTINGS },
          status: 'idle',
          result: null,
          resultSettings: null,
          error: null,
          history: [{ ...DEFAULT_EDIT_SETTINGS }],
          historyIndex: 0,
        }
        return item
      }),
    )

    set((state) => ({
      images: [...state.images, ...created],
      activeId: state.activeId ?? created[0]?.id ?? null,
      logs: [
        ...state.logs,
        createLogEntry('info', `${created.length}개 파일을 추가했습니다.`),
      ],
    }))
  },

  removeImage: (id) => {
    set((state) => {
      const target = state.images.find((item) => item.id === id)
      if (target) {
        URL.revokeObjectURL(target.source.originalUrl)
        if (target.result) URL.revokeObjectURL(target.result.url)
      }
      const images = state.images.filter((item) => item.id !== id)
      const selectedIds = new Set(state.selectedIds)
      selectedIds.delete(id)
      return {
        images,
        selectedIds,
        activeId: state.activeId === id ? (images[0]?.id ?? null) : state.activeId,
      }
    })
  },

  clearAll: () => {
    const { images } = get()
    images.forEach((item) => {
      URL.revokeObjectURL(item.source.originalUrl)
      if (item.result) URL.revokeObjectURL(item.result.url)
    })
    set({ images: [], activeId: null, selectedIds: new Set(), batchProgress: null })
  },

  setActive: (id) => set({ activeId: id }),

  toggleSelected: (id) => {
    set((state) => {
      const selectedIds = new Set(state.selectedIds)
      if (selectedIds.has(id)) selectedIds.delete(id)
      else selectedIds.add(id)
      return { selectedIds }
    })
  },

  selectAll: () =>
    set((state) => ({ selectedIds: new Set(state.images.map((i) => i.id)) })),
  clearSelection: () => set({ selectedIds: new Set() }),

  updateSettings: (id, updater) => {
    set((state) => ({
      images: state.images.map((item) =>
        item.id === id ? { ...item, settings: updater(item.settings) } : item,
      ),
    }))
  },

  commitHistory: (id) => {
    set((state) => ({
      images: state.images.map((item) => {
        if (item.id !== id) return item
        const truncated = item.history.slice(0, item.historyIndex + 1)
        const nextHistory = [...truncated, { ...item.settings }].slice(
          -MAX_HISTORY_LENGTH,
        )
        return { ...item, history: nextHistory, historyIndex: nextHistory.length - 1 }
      }),
    }))
  },

  undo: (id) => {
    set((state) => ({
      images: state.images.map((item) => {
        if (item.id !== id || item.historyIndex <= 0) return item
        const historyIndex = item.historyIndex - 1
        return { ...item, historyIndex, settings: { ...item.history[historyIndex] } }
      }),
    }))
  },

  redo: (id) => {
    set((state) => ({
      images: state.images.map((item) => {
        if (item.id !== id || item.historyIndex >= item.history.length - 1) return item
        const historyIndex = item.historyIndex + 1
        return { ...item, historyIndex, settings: { ...item.history[historyIndex] } }
      }),
    }))
  },

  processImage: async (id) => {
    const item = get().images.find((i) => i.id === id)
    if (!item) return

    const requestedSettings = item.settings
    set((state) => ({ images: setStatus(state.images, id, 'processing') }))

    try {
      const bitmap = await createImageBitmap(item.source.file)
      const { blob, width, height } = await imageWorkerPool.process(
        bitmap,
        requestedSettings,
        item.source.type,
      )
      const url = URL.createObjectURL(blob)

      set((state) => ({
        images: state.images.map((i) => {
          if (i.id !== id) return i
          if (i.result) URL.revokeObjectURL(i.result.url)
          return {
            ...i,
            status: 'done',
            error: null,
            result: {
              blob,
              url,
              width,
              height,
              size: blob.size,
              format: requestedSettings.format,
            },
            resultSettings: requestedSettings,
          }
        }),
        logs: [
          ...state.logs,
          createLogEntry('success', `${item.source.name} 처리 완료 (${width}x${height})`),
        ],
      }))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.'
      set((state) => ({
        images: state.images.map((i) =>
          i.id === id ? { ...i, status: 'error', error: message } : i,
        ),
        logs: [...state.logs, createLogEntry('error', `${item.source.name}: ${message}`)],
      }))
    }
  },

  processMany: async (ids) => {
    set({ batchProgress: { current: 0, total: ids.length } })
    let current = 0

    await Promise.all(
      ids.map(async (id) => {
        await get().processImage(id)
        current += 1
        set({ batchProgress: { current, total: ids.length } })
      }),
    )

    set((state) => ({
      batchProgress: null,
      logs: [...state.logs, createLogEntry('info', `일괄 처리 완료 (${ids.length}개)`)],
    }))
  },

  renameRule: { pattern: 'image_{number}', startIndex: 1 },
  setRenameRule: (renameRule) => set({ renameRule }),

  log: (level, message) => {
    set((state) => ({ logs: [...state.logs, createLogEntry(level, message)] }))
  },
}))
