import type { OcrTextRegion } from '@/types/editing'

export type { OcrTextRegion }

/** `line` suits replacing whole phrases/dates; `word` allows editing a single token. */
export type OcrGranularity = 'line' | 'word'

export interface OcrOptions {
  granularity?: OcrGranularity
  /** Regions below this confidence (0-100) are dropped as noise. */
  minConfidence?: number
  /**
   * `auto` finds text lines first. `single-line` skips detection and reads the whole bitmap as one
   * line — for a user-dragged area that is known to contain exactly the text to read.
   */
  layout?: 'auto' | 'single-line'
}

/** Messages to/from the OCR worker. */
export interface OcrWorkerRequest {
  type: 'recognize'
  requestId: string
  bitmap: ImageBitmap
  options: Required<OcrOptions>
}

export type OcrWorkerResponse =
  | { type: 'progress'; requestId: string; stage: 'download' | 'init' | 'run'; progress: number }
  | { type: 'error'; requestId: string; message: string }
  | { type: 'result'; requestId: string; regions: OcrTextRegion[] }
