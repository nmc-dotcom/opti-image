import type { AiPlugin } from '../types'

/**
 * Placeholder for an ONNX Runtime Web (onnxruntime-web) background-removal plugin,
 * e.g. a U^2-Net / MODNet model run inside a dedicated Web Worker so the main thread
 * stays responsive. Not implemented in this MVP.
 */
export const backgroundRemovalPlugin: AiPlugin = {
  id: 'background-removal',
  name: '배경 제거',
  description: 'ONNX 모델을 사용해 브라우저에서 배경을 제거합니다. (준비 중)',
  isReady: false,
  run: async () => {
    throw new Error('배경 제거 기능은 아직 구현되지 않았습니다.')
  },
}
