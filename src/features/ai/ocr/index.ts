import type { AiPlugin } from '../types'

/**
 * Placeholder for a Tesseract.js OCR plugin, run inside its own Web Worker via
 * tesseract.js's built-in worker API. Not implemented in this MVP.
 */
export const ocrPlugin: AiPlugin<{ lang?: string }, string> = {
  id: 'ocr',
  name: '텍스트 추출(OCR)',
  description: 'Tesseract.js로 이미지 속 텍스트를 추출합니다. (준비 중)',
  isReady: false,
  run: async () => {
    throw new Error('OCR 기능은 아직 구현되지 않았습니다.')
  },
}
