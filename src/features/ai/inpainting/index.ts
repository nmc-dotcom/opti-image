import type { MaskedAiPlugin } from '../types'
import { WORKING_MAX_EDGE } from '@/lib/inpaintingCrop'
import { MIGAN_MODEL, isModelCached } from './model'
import type {
  InpaintingOptions,
  InpaintingResult,
  InpaintingWorkerRequest,
  InpaintingWorkerResponse,
} from './types'

export { MIGAN_MODEL, isModelCached }

interface PendingJob {
  resolve: (result: InpaintingResult) => void
  reject: (error: Error) => void
  onProgress?: (progress: number) => void
}

let worker: Worker | null = null
const pending = new Map<string, PendingJob>()

/** Spawned on first use only: users who never pick AI never load ONNX Runtime or the model. */
function ensureWorker(): Worker {
  if (worker) return worker
  const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  created.onmessage = (event: MessageEvent<InpaintingWorkerResponse>) => {
    const response = event.data
    const job = pending.get(response.requestId)
    if (!job) return
    if (response.type === 'progress') {
      // Overall progress: download 0-60, session init 60-70, inference 70-100.
      const overall =
        response.stage === 'download'
          ? response.progress * 0.6
          : response.stage === 'init'
            ? 60 + response.progress * 0.1
            : 70 + response.progress * 0.3
      job.onProgress?.(Math.round(overall))
      return
    }
    pending.delete(response.requestId)
    if (response.type === 'error') job.reject(new Error(response.message))
    else job.resolve({ fill: response.fill, backend: response.backend })
  }
  created.onerror = (event) => {
    const error = new Error(event.message || 'AI 인페인팅 워커를 시작하지 못했습니다.')
    pending.forEach((job) => job.reject(error))
    pending.clear()
    worker = null
    created.terminate()
  }
  worker = created
  return created
}

/** Feature check without loading anything: WebAssembly is the minimum (WebGPU is optional). */
export function isAiInpaintingSupported(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
}

/**
 * Browser-side AI inpainting (MI-GAN via ONNX Runtime Web, WebGPU → WASM fallback).
 * Input: the region to repair + its mask (same size). Output: the region with masked pixels
 * filled. Everything runs in a local Web Worker; only the model file is downloaded.
 */
export const inpaintingPlugin: MaskedAiPlugin<InpaintingOptions, InpaintingResult> = {
  id: 'inpainting',
  name: 'AI 인페인팅',
  description: `${MIGAN_MODEL.name} 모델로 지운 영역의 배경을 브라우저에서 생성합니다.`,
  isReady: isAiInpaintingSupported(),
  run: ({ bitmap, mask, options, onProgress }) => {
    if (bitmap.width !== mask.width || bitmap.height !== mask.height) {
      return Promise.reject(new Error('이미지와 마스크 크기가 다릅니다.'))
    }
    const target = ensureWorker()
    const requestId = crypto.randomUUID()
    return new Promise<InpaintingResult>((resolve, reject) => {
      pending.set(requestId, { resolve, reject, onProgress })
      const message: InpaintingWorkerRequest = {
        type: 'inpaint',
        requestId,
        bitmap,
        mask,
        maxEdge: options?.maxEdge ?? WORKING_MAX_EDGE.ai,
      }
      target.postMessage(message, [bitmap])
    })
  },
}
