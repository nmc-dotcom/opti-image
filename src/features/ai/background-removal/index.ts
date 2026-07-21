import type { AiPlugin } from '../types'

/**
 * ONNX Runtime Web (isnet_quint8) background-removal plugin. Model/wasm assets are fetched
 * from IMG.LY's CDN on first use and cached by the browser; only those generic assets cross
 * the network, never the user's image. Inference itself runs in a worker spawned internally
 * by @imgly/background-removal, so it never blocks the main thread.
 */
export const backgroundRemovalPlugin: AiPlugin = {
  id: 'background-removal',
  name: '배경 제거',
  description: 'ONNX 모델(ISNet)을 사용해 브라우저에서 배경을 투명하게 제거합니다.',
  isReady: true,
  run: async ({ bitmap, onProgress }) => {
    // Dynamically imported so the ~24MB onnxruntime-web WASM/JS graph is only ever
    // fetched by users who actually turn on background removal, not on initial page load.
    const { removeBackground } = await import('@imgly/background-removal')

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D context unavailable for background removal')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()

    const sourceBlob = await canvas.convertToBlob({ type: 'image/png' })

    return removeBackground(sourceBlob, {
      model: 'isnet_quint8',
      output: { format: 'image/png', quality: 1 },
      progress: (_key, current, total) => {
        if (total > 0) onProgress?.(Math.round((current / total) * 100))
      },
    })
  },
}
