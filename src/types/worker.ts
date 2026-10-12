import type { EditSettings } from './image'
import type { EditMask, MaskStroke, Rect } from './editing'

/** Request/response protocol for the image-processing Web Worker. */
export interface ProcessImageRequest {
  type: 'process'
  requestId: string
  bitmap: ImageBitmap
  settings: EditSettings
  sourceType: string
}

export type WorkerRequest = ProcessImageRequest

export interface ProcessImageSuccess {
  type: 'success'
  requestId: string
  blob: Blob
  width: number
  height: number
}

export interface ProcessImageProgress {
  type: 'progress'
  requestId: string
  progress: number
}

export interface ProcessImageError {
  type: 'error'
  requestId: string
  message: string
}

export type WorkerResponse =
  ProcessImageSuccess | ProcessImageProgress | ProcessImageError

/**
 * Request/response protocol for the retouch Web Worker (mask rasterization, classic in-browser
 * inpainting and patch encoding). Pixel buffers are transferred, never copied over the wire —
 * and never leave the device.
 */
export type RetouchWorkerRequest =
  | {
      type: 'mask'
      requestId: string
      strokes: MaskStroke[]
      /** Region in source pixels and the resolution to rasterize it at. */
      region: Rect
      outWidth: number
      outHeight: number
      /** Outward feather, in source pixels. */
      feather: number
    }
  | {
      type: 'fill'
      requestId: string
      /** The region at mask resolution. */
      bitmap: ImageBitmap
      mask: EditMask
    }
  | {
      type: 'compose'
      requestId: string
      fill: Uint8ClampedArray
      mask: EditMask
      /** Sub-rectangle of the mask to encode (mask-local pixels). */
      bounds: Rect
    }

export type RetouchWorkerResponse =
  | { type: 'progress'; requestId: string; progress: number }
  | { type: 'error'; requestId: string; message: string }
  | { type: 'mask'; requestId: string; mask: EditMask; bounds: Rect | null }
  | {
      type: 'fill'
      requestId: string
      fill: Uint8ClampedArray
      algorithm: 'telea' | 'texture' | 'patchmatch'
    }
  | { type: 'compose'; requestId: string; blob: Blob }
