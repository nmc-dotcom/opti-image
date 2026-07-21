import type { AiPlugin } from '../types'

/**
 * The isnet_quint8 model leaves a band of partially-transparent pixels (alpha ~40-200)
 * around the cutout edge — visible as a grey halo of the original background bleeding
 * through. Remapping alpha with a steep threshold band collapses that band down to a
 * crisp edge: anything below LOW is fully erased, anything above HIGH is fully kept, and
 * only the narrow band between is left graded (for a touch of anti-aliasing).
 */
const ALPHA_LOW = 90
const ALPHA_HIGH = 165

async function sharpenCutoutEdges(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable for edge sharpening')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  const range = ALPHA_HIGH - ALPHA_LOW
  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i]
    if (alpha <= ALPHA_LOW) data[i] = 0
    else if (alpha >= ALPHA_HIGH) data[i] = 255
    else data[i] = Math.round(((alpha - ALPHA_LOW) / range) * 255)
  }
  ctx.putImageData(imageData, 0, 0)

  return canvas.convertToBlob({ type: 'image/png' })
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Dynamic imports of a freshly content-hashed chunk can transiently 404 for a few seconds
 * right after a deploy while the CDN's edge nodes catch up. Retrying a failed dynamic
 * import re-issues the network fetch (browsers don't permanently cache a rejected module),
 * so a short backoff rides out that propagation window instead of failing outright.
 */
async function importBackgroundRemoval(retries = 2): Promise<typeof import('@imgly/background-removal')> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await import('@imgly/background-removal')
    } catch (error) {
      if (attempt >= retries) throw error
      await delay(1500 * (attempt + 1))
    }
  }
}

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
    let mod: typeof import('@imgly/background-removal')
    try {
      mod = await importBackgroundRemoval()
    } catch {
      // Either a stale tab across a redeploy (the page's own bundle references an old
      // content-hashed chunk the new deploy no longer serves) or something client-side
      // (ad blocker / privacy extension) blocking the request outright — retries above
      // already rule out a brief CDN propagation blip.
      throw new Error(
        '배경 제거 모듈을 불러오지 못했습니다. 페이지를 새로고침해서 다시 시도해보시고, 계속 실패하면 광고 차단 확장 프로그램을 꺼보세요.',
      )
    }
    const { removeBackground } = mod

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D context unavailable for background removal')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()

    const sourceBlob = await canvas.convertToBlob({ type: 'image/png' })

    const cutout = await removeBackground(sourceBlob, {
      model: 'isnet_quint8',
      output: { format: 'image/png', quality: 1 },
      progress: (_key, current, total) => {
        if (total > 0) onProgress?.(Math.round((current / total) * 100))
      },
    })

    return sharpenCutoutEdges(cutout)
  },
}
