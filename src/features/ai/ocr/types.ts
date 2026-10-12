import type { OcrTextRegion } from '@/types/editing'

export type { OcrTextRegion }

/** Tesseract language string. `kor+eng` recognizes mixed Korean/English/digits. */
export type OcrLanguage = 'kor+eng' | 'eng' | 'kor'

/** `line` suits replacing whole phrases/dates; `word` allows editing a single token. */
export type OcrGranularity = 'line' | 'word'

export interface OcrOptions {
  lang?: OcrLanguage
  granularity?: OcrGranularity
  /** Regions below this confidence (0-100) are dropped as noise. */
  minConfidence?: number
}
