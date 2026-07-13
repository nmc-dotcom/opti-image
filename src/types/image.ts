/** Supported output image formats for the 1st MVP. AVIF/BMP/ICO land in phase 2. */
export type ImageFormat = 'png' | 'jpeg' | 'webp'

export type ResizeMode = 'exact' | 'longEdge' | 'percentage' | 'none'

export interface ResizeSettings {
  mode: ResizeMode
  width: number
  height: number
  longEdge: number
  percentage: number
  keepAspectRatio: boolean
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export type FlipAxis = 'none' | 'horizontal' | 'vertical' | 'both'

export interface RenameRule {
  pattern: string
  startIndex: number
}

/** The full set of edit operations applied to a source image, in a fixed pipeline order. */
export interface EditSettings {
  resize: ResizeSettings
  format: ImageFormat
  quality: number
  rotation: 0 | 90 | 180 | 270
  flip: FlipAxis
  crop: CropRect | null
}

export type ProcessStatus = 'idle' | 'queued' | 'processing' | 'done' | 'error'

export interface SourceImage {
  id: string
  file: File
  name: string
  originalUrl: string
  width: number
  height: number
  size: number
  type: string
  createdAt: number
}

export interface ProcessedResult {
  blob: Blob
  url: string
  width: number
  height: number
  size: number
  format: ImageFormat
}

export interface ImageItem {
  id: string
  source: SourceImage
  settings: EditSettings
  status: ProcessStatus
  result: ProcessedResult | null
  /** Settings snapshot that produced `result`; used to detect a stale result while a re-process is pending. */
  resultSettings: EditSettings | null
  error: string | null
  /** Undo/redo history of settings for this item. */
  history: EditSettings[]
  historyIndex: number
}

export interface LogEntry {
  id: string
  timestamp: number
  level: 'info' | 'success' | 'error'
  message: string
}
