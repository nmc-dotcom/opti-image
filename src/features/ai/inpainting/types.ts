import type { EditMask } from '@/types/editing'

export type InpaintingBackend = 'webgpu' | 'wasm'

export interface InpaintingOptions {
  /** Long-edge cap for the region handed to the model (the result is upscaled back). */
  maxEdge?: number
}

export interface InpaintingResult {
  /** RGBA region, same size as the input bitmap; pixels outside the mask are unchanged. */
  fill: Uint8ClampedArray
  backend: InpaintingBackend
}

/** Messages to/from the AI inpainting worker. */
export type InpaintingWorkerRequest = {
  type: 'inpaint'
  requestId: string
  bitmap: ImageBitmap
  mask: EditMask
  maxEdge: number
}

export type InpaintingWorkerResponse =
  | { type: 'progress'; requestId: string; stage: 'download' | 'init' | 'inference'; progress: number }
  | { type: 'error'; requestId: string; message: string }
  | { type: 'result'; requestId: string; fill: Uint8ClampedArray; backend: InpaintingBackend }
