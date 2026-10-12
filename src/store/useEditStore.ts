import { create } from 'zustand'
import type {
  BrushEdge,
  InpaintMethod,
  MaskMode,
  MaskStroke,
  MaskTool,
  OcrTextRegion,
  RetouchPatch,
} from '@/types/editing'

export type EditMode = 'remove' | 'text'

/** Per-image working state that is NOT part of the image's settings history. */
interface ImageEditState {
  /** The in-progress selection (not yet applied). */
  strokes: MaskStroke[]
  /** Strokes popped by "Undo mask", restorable until a new stroke is drawn. */
  redoStrokes: MaskStroke[]
  ocrRegions: OcrTextRegion[] | null
  selectedRegionId: string | null
  selectedLayerId: string | null
}

const EMPTY_IMAGE_STATE: ImageEditState = {
  strokes: [],
  redoStrokes: [],
  ocrRegions: null,
  selectedRegionId: null,
  selectedLayerId: null,
}

export interface EditJob {
  label: string
  /** 0-100, or null for an indeterminate step. */
  percent: number | null
}

interface EditState {
  mode: EditMode
  maskTool: MaskTool
  maskMode: MaskMode
  /** Brush diameter in on-screen CSS pixels (converted to source pixels per stroke). */
  brushSize: number
  brushEdge: BrushEdge
  /** Outward feather in source pixels, applied when a removal is executed. */
  feather: number
  method: InpaintMethod

  byImage: Record<string, ImageEditState>
  /** Inpainted pixels, keyed by RetouchOp id. Referenced (not copied) by settings history. */
  patches: Record<string, RetouchPatch>
  job: EditJob | null
  /** Execution backend reported by the last AI inpainting run. */
  aiBackend: 'webgpu' | 'wasm' | null

  setMode: (mode: EditMode) => void
  setMaskTool: (tool: MaskTool) => void
  setMaskMode: (mode: MaskMode) => void
  setBrushSize: (size: number) => void
  setBrushEdge: (edge: BrushEdge) => void
  setFeather: (feather: number) => void
  setMethod: (method: InpaintMethod) => void

  addStroke: (imageId: string, stroke: MaskStroke) => void
  undoStroke: (imageId: string) => boolean
  redoStroke: (imageId: string) => boolean
  clearStrokes: (imageId: string) => void

  setOcrRegions: (imageId: string, regions: OcrTextRegion[] | null) => void
  removeOcrRegion: (imageId: string, regionId: string) => void
  selectRegion: (imageId: string, regionId: string | null) => void
  selectLayer: (imageId: string, layerId: string | null) => void

  addPatch: (patch: RetouchPatch) => void
  /** Frees every patch of `imageId` whose id is not in `keepIds`. */
  prunePatches: (imageId: string, keepIds: Set<string>) => void
  /** Drops all edit state (and patch object URLs) for an image that was removed. */
  forgetImage: (imageId: string) => void
  forgetAll: () => void

  setJob: (job: EditJob | null) => void
  setAiBackend: (backend: 'webgpu' | 'wasm') => void
}

export function getImageEditState(
  byImage: Record<string, ImageEditState>,
  imageId: string | null | undefined,
): ImageEditState {
  return (imageId && byImage[imageId]) || EMPTY_IMAGE_STATE
}

export const useEditStore = create<EditState>((set, get) => {
  const patchImage = (imageId: string, patch: (s: ImageEditState) => Partial<ImageEditState>) =>
    set((state) => {
      const current = getImageEditState(state.byImage, imageId)
      return { byImage: { ...state.byImage, [imageId]: { ...current, ...patch(current) } } }
    })

  return {
    mode: 'remove',
    maskTool: 'brush',
    maskMode: 'add',
    brushSize: 40,
    brushEdge: 'hard',
    feather: 4,
    method: 'classic',

    byImage: {},
    patches: {},
    job: null,
    aiBackend: null,

    setMode: (mode) => set({ mode }),
    setMaskTool: (maskTool) => set({ maskTool }),
    setMaskMode: (maskMode) => set({ maskMode }),
    setBrushSize: (brushSize) => set({ brushSize }),
    setBrushEdge: (brushEdge) => set({ brushEdge }),
    setFeather: (feather) => set({ feather }),
    setMethod: (method) => set({ method }),

    addStroke: (imageId, stroke) =>
      patchImage(imageId, (s) => ({ strokes: [...s.strokes, stroke], redoStrokes: [] })),

    undoStroke: (imageId) => {
      const current = getImageEditState(get().byImage, imageId)
      if (current.strokes.length === 0) return false
      const last = current.strokes[current.strokes.length - 1]
      patchImage(imageId, (s) => ({
        strokes: s.strokes.slice(0, -1),
        redoStrokes: [...s.redoStrokes, last],
      }))
      return true
    },

    redoStroke: (imageId) => {
      const current = getImageEditState(get().byImage, imageId)
      if (current.redoStrokes.length === 0) return false
      const next = current.redoStrokes[current.redoStrokes.length - 1]
      patchImage(imageId, (s) => ({
        strokes: [...s.strokes, next],
        redoStrokes: s.redoStrokes.slice(0, -1),
      }))
      return true
    },

    clearStrokes: (imageId) => patchImage(imageId, () => ({ strokes: [], redoStrokes: [] })),

    setOcrRegions: (imageId, ocrRegions) =>
      patchImage(imageId, () => ({ ocrRegions, selectedRegionId: null })),

    removeOcrRegion: (imageId, regionId) =>
      patchImage(imageId, (s) => ({
        ocrRegions: s.ocrRegions?.filter((r) => r.id !== regionId) ?? null,
        selectedRegionId: s.selectedRegionId === regionId ? null : s.selectedRegionId,
      })),

    selectRegion: (imageId, selectedRegionId) =>
      patchImage(imageId, (s) => ({
        selectedRegionId,
        selectedLayerId: selectedRegionId ? null : s.selectedLayerId,
      })),

    selectLayer: (imageId, selectedLayerId) =>
      patchImage(imageId, (s) => ({
        selectedLayerId,
        selectedRegionId: selectedLayerId ? null : s.selectedRegionId,
      })),

    addPatch: (patch) => set((state) => ({ patches: { ...state.patches, [patch.id]: patch } })),

    prunePatches: (imageId, keepIds) => {
      const { patches } = get()
      let changed = false
      const next: Record<string, RetouchPatch> = {}
      for (const [id, patch] of Object.entries(patches)) {
        if (patch.imageId === imageId && !keepIds.has(id)) {
          URL.revokeObjectURL(patch.url)
          changed = true
        } else {
          next[id] = patch
        }
      }
      if (changed) set({ patches: next })
    },

    forgetImage: (imageId) => {
      get().prunePatches(imageId, new Set())
      set((state) => {
        const byImage = { ...state.byImage }
        delete byImage[imageId]
        return { byImage }
      })
    },

    forgetAll: () => {
      Object.values(get().patches).forEach((p) => URL.revokeObjectURL(p.url))
      set({ patches: {}, byImage: {} })
    },

    setJob: (job) => set({ job }),
    setAiBackend: (aiBackend) => set({ aiBackend }),
  }
})
