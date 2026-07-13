import { create } from 'zustand'

export type EditorTool = 'resize' | 'format' | 'transform' | 'crop' | 'rename'

interface UiState {
  activeTool: EditorTool
  setActiveTool: (tool: EditorTool) => void
  logPanelOpen: boolean
  toggleLogPanel: () => void
  batchExportOpen: boolean
  setBatchExportOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeTool: 'resize',
  setActiveTool: (activeTool) => set({ activeTool }),
  logPanelOpen: false,
  toggleLogPanel: () => set((s) => ({ logPanelOpen: !s.logPanelOpen })),
  batchExportOpen: false,
  setBatchExportOpen: (batchExportOpen) => set({ batchExportOpen }),
}))
