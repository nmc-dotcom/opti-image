import type { EditMask } from '@/types/editing'

/**
 * Plugin contract for future browser-side AI features (background removal via ONNX
 * Runtime Web, OCR via Tesseract.js, etc). Each plugin runs entirely client-side and
 * plugs into the same editor pipeline as the built-in resize/format/crop tools.
 */
export interface AiPlugin<TOptions = Record<string, unknown>, TResult = Blob> {
  id: string
  name: string
  description: string
  /** Whether model assets are available; false renders the tool as "coming soon". */
  isReady: boolean
  run: (input: {
    bitmap: ImageBitmap
    options?: TOptions
    /** 0-100. Covers first-run model download plus inference. */
    onProgress?: (progress: number) => void
  }) => Promise<TResult>
}

/**
 * Extension of {@link AiPlugin} for models that operate on a selected area (inpainting).
 * Kept as a separate interface so every existing `AiPlugin` (and its callers) stays unchanged:
 * the only difference is the extra `mask`, same size as `bitmap`, 0 = keep, 255 = process.
 */
export interface MaskedAiPlugin<TOptions = Record<string, unknown>, TResult = Blob>
  extends Omit<AiPlugin<TOptions, TResult>, 'run'> {
  run: (input: {
    bitmap: ImageBitmap
    mask: EditMask
    options?: TOptions
    /** 0-100. Covers first-run model download plus inference. */
    onProgress?: (progress: number) => void
  }) => Promise<TResult>
}
