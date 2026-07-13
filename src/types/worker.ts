import type { EditSettings } from './image'

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
