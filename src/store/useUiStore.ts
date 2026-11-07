import { create } from 'zustand'

export type EditorTool =
  | 'resize'
  | 'format'
  | 'transform'
  | 'crop'
  | 'ai'
  | 'edit'
  | 'rename'

interface UiState {
  activeTool: EditorTool
  setActiveTool: (tool: EditorTool) => void
  logPanelOpen: boolean
  toggleLogPanel: () => void
  batchExportOpen: boolean
  setBatchExportOpen: (open: boolean) => void
  /** Locked crop aspect ratio (width / height) per image id; absent/null = free crop. */
  cropRatios: Record<string, number | null>
  setCropRatio: (imageId: string, ratio: number | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeTool: 'resize',
  setActiveTool: (activeTool) => set({ activeTool }),
  logPanelOpen: false,
  toggleLogPanel: () => set((s) => ({ logPanelOpen: !s.logPanelOpen })),
  batchExportOpen: false,
  setBatchExportOpen: (batchExportOpen) => set({ batchExportOpen }),
  cropRatios: {},
  setCropRatio: (imageId, ratio) =>
    set((s) => ({ cropRatios: { ...s.cropRatios, [imageId]: ratio } })),
}))
