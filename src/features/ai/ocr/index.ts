import type { AiPlugin } from '../types'
import { OCR_MODEL_INFO, OCR_MODELS } from './models'
import { isModelCached } from '@/lib/modelCache'
import type {
  OcrOptions,
  OcrTextRegion,
  OcrWorkerRequest,
  OcrWorkerResponse,
} from './types'

export { OCR_MODEL_INFO }

/** Default floor for a recognized line (0-100). Garbage from texture reads far below this. */
const DEFAULT_MIN_CONFIDENCE = 60

interface PendingJob {
  resolve: (regions: OcrTextRegion[]) => void
  reject: (error: Error) => void
  onProgress?: (progress: number) => void
}

let worker: Worker | null = null
const pending = new Map<string, PendingJob>()

/** Spawned on first use only: users who never run OCR load neither ONNX Runtime nor the models. */
function ensureWorker(): Worker {
  if (worker) return worker
  const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  created.onmessage = (event: MessageEvent<OcrWorkerResponse>) => {
    const response = event.data
    const job = pending.get(response.requestId)
    if (!job) return
    if (response.type === 'progress') {
      // Overall: model download 0-70, session init 70-80, recognition 80-100.
      const overall =
        response.stage === 'download'
          ? response.progress * 0.7
          : response.stage === 'init'
            ? 70 + response.progress * 0.1
            : 80 + response.progress * 0.2
      job.onProgress?.(Math.round(overall))
      return
    }
    pending.delete(response.requestId)
    if (response.type === 'error') job.reject(new Error(response.message))
    else job.resolve(response.regions)
  }
  created.onerror = (event) => {
    const error = new Error(event.message || 'OCR 워커를 시작하지 못했습니다.')
    pending.forEach((job) => job.reject(error))
    pending.clear()
    worker = null
    created.terminate()
  }
  worker = created
  return created
}

/** Whether the OCR models are already stored in this browser (no download needed). */
export async function isOcrModelCached(): Promise<boolean> {
  const results = await Promise.all(
    [OCR_MODELS.det, OCR_MODELS.rec, OCR_MODELS.dict].map((a) => isModelCached(a)),
  )
  return results.every(Boolean)
}

/**
 * On-device OCR with PaddleOCR PP-OCRv5 mobile (ONNX Runtime Web, WASM). Returns text lines — or
 * words — with bounding boxes in the input bitmap's pixel coordinates. Everything runs in a local
 * Web Worker; the only network requests are the one-time GETs of the pinned model files.
 */
export const ocrPlugin: AiPlugin<OcrOptions, OcrTextRegion[]> = {
  id: 'ocr',
  name: '텍스트 인식(OCR)',
  description: `${OCR_MODEL_INFO.name} 모델로 이미지 속 한국어/영어 텍스트와 위치를 브라우저에서 인식합니다.`,
  isReady: typeof WebAssembly !== 'undefined' && typeof OffscreenCanvas !== 'undefined',
  run: ({ bitmap, options, onProgress }) => {
    let target: Worker
    try {
      target = ensureWorker()
    } catch {
      bitmap.close()
      return Promise.reject(
        new Error('OCR을 시작하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 보세요.'),
      )
    }
    const requestId = crypto.randomUUID()
    return new Promise<OcrTextRegion[]>((resolve, reject) => {
      pending.set(requestId, {
        resolve,
        reject: (error) =>
          reject(
            error.message.includes('모델')
              ? new Error(`${error.message} 네트워크 연결을 확인하거나 광고 차단 확장 프로그램을 꺼보세요.`)
              : error,
          ),
        onProgress,
      })
      const message: OcrWorkerRequest = {
        type: 'recognize',
        requestId,
        bitmap,
        options: {
          granularity: options?.granularity ?? 'line',
          minConfidence: options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
          layout: options?.layout ?? 'auto',
        },
      }
      target.postMessage(message, [bitmap])
    })
  },
}
