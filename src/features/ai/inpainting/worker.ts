import { fillAtWorkingResolution } from '@/lib/inpaintingCrop'
import { inpaintTelea } from '@/lib/inpaint/telea'
import { loadModel } from './model'
import { createInpaintSession, type InpaintSession } from './runtime'
import type { InpaintingWorkerRequest, InpaintingWorkerResponse } from './types'

interface WorkerScope {
  onmessage: ((event: MessageEvent<InpaintingWorkerRequest>) => void) | null
  postMessage: (message: InpaintingWorkerResponse, transfer?: Transferable[]) => void
}

const ctx = self as unknown as WorkerScope

function post(message: InpaintingWorkerResponse, transfer: Transferable[] = []) {
  ctx.postMessage(message, transfer)
}

let sessionPromise: Promise<InpaintSession> | null = null

function getSession(requestId: string) {
  sessionPromise ??= (async () => {
    const model = await loadModel((progress) =>
      post({ type: 'progress', requestId, stage: 'download', progress }),
    )
    post({ type: 'progress', requestId, stage: 'init', progress: 0 })
    return createInpaintSession(model)
  })().catch((error) => {
    sessionPromise = null
    throw error
  })
  return sessionPromise
}

function readBitmap(bitmap: ImageBitmap): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const c2d = canvas.getContext('2d', { willReadFrequently: true })
  if (!c2d) throw new Error('2D context unavailable for reading region')
  c2d.drawImage(bitmap, 0, 0)
  bitmap.close()
  return c2d.getImageData(0, 0, canvas.width, canvas.height).data
}

/**
 * Dedicated AI inpainting worker: model download/caching, ONNX Runtime session and inference
 * all happen here, so the multi-second first run never blocks the UI. Input and output pixels
 * only cross the main-thread ⇄ worker boundary via postMessage.
 */
ctx.onmessage = async (event: MessageEvent<InpaintingWorkerRequest>) => {
  const message = event.data
  if (message.type !== 'inpaint') return
  const { requestId, bitmap, mask, maxEdge } = message

  try {
    const session = await getSession(requestId)
    post({ type: 'progress', requestId, stage: 'inference', progress: 0 })
    const image = readBitmap(bitmap)
    const fill = await fillAtWorkingResolution(image, mask, maxEdge, async (rgba, hole, w, h) => {
      // The MI-GAN pipeline resamples the image smoothly and blends its output back with a
      // blurred mask, so whatever sits under the mask bleeds into the result near the edges
      // (a faint "ghost" of the removed object). Pre-filling the hole with a quick diffusion of
      // the surroundings makes that bleed background-coloured instead.
      inpaintTelea(rgba, hole, w, h)
      const rgb = await session.run(rgba, hole, w, h)
      const plane = w * h
      for (let i = 0; i < plane; i++) {
        if (!hole[i]) continue
        rgba[i * 4] = rgb[i]
        rgba[i * 4 + 1] = rgb[plane + i]
        rgba[i * 4 + 2] = rgb[2 * plane + i]
        rgba[i * 4 + 3] = 255
      }
    })
    post({ type: 'progress', requestId, stage: 'inference', progress: 100 })
    post({ type: 'result', requestId, fill, backend: session.backend }, [fill.buffer])
  } catch (error) {
    post({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : 'AI 인페인팅 중 오류가 발생했습니다.',
    })
  }
}
