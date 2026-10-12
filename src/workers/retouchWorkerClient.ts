import type { EditMask, MaskStroke, Rect } from '@/types/editing'
import type { RetouchWorkerRequest, RetouchWorkerResponse } from '@/types/worker'

type ResponseOf<T extends RetouchWorkerResponse['type']> = Extract<RetouchWorkerResponse, { type: T }>

interface PendingJob {
  resolve: (response: RetouchWorkerResponse) => void
  reject: (error: Error) => void
  onProgress?: (progress: number) => void
}

// Distributive Omit so each request variant keeps its own fields.
type RequestBody = RetouchWorkerRequest extends infer R
  ? R extends RetouchWorkerRequest
    ? Omit<R, 'requestId'>
    : never
  : never

/**
 * Promise wrapper around a single retouch worker. Created lazily on first use so users who
 * never open the Edit tool never spawn it. One worker is enough: removals are user-initiated
 * and sequential, and keeping the CPU-heavy fill off the image worker pool means ordinary
 * resize/encode jobs never queue behind it.
 */
class RetouchWorkerClient {
  private worker: Worker | null = null
  private pending = new Map<string, PendingJob>()

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./retouch.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<RetouchWorkerResponse>) => {
      const response = event.data
      const job = this.pending.get(response.requestId)
      if (!job) return
      if (response.type === 'progress') {
        job.onProgress?.(response.progress)
        return
      }
      this.pending.delete(response.requestId)
      if (response.type === 'error') job.reject(new Error(response.message))
      else job.resolve(response)
    }
    worker.onerror = (event) => {
      const error = new Error(event.message || '편집 워커에서 오류가 발생했습니다.')
      this.pending.forEach((job) => job.reject(error))
      this.pending.clear()
    }
    this.worker = worker
    return worker
  }

  private call<T extends RetouchWorkerResponse['type']>(
    body: RequestBody,
    transfer: Transferable[],
    onProgress?: (progress: number) => void,
  ): Promise<ResponseOf<T>> {
    const worker = this.ensureWorker()
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (response: RetouchWorkerResponse) => void,
        reject,
        onProgress,
      })
      worker.postMessage({ ...body, requestId } as RetouchWorkerRequest, transfer)
    })
  }

  /** Rasterizes + feathers the selection for `region` at `outWidth`×`outHeight`. */
  async buildMask(
    strokes: MaskStroke[],
    region: Rect,
    outWidth: number,
    outHeight: number,
    feather: number,
  ) {
    const response = await this.call<'mask'>(
      { type: 'mask', strokes, region, outWidth, outHeight, feather },
      [],
    )
    return { mask: response.mask, bounds: response.bounds }
  }

  /** Classic (no-AI) fill. Consumes `bitmap`; the mask is copied so the caller keeps it. */
  async fillClassic(bitmap: ImageBitmap, mask: EditMask, onProgress?: (p: number) => void) {
    const response = await this.call<'fill'>(
      { type: 'fill', bitmap, mask },
      [bitmap],
      onProgress,
    )
    return { fill: response.fill, algorithm: response.algorithm }
  }

  /** Encodes the masked part of `fill` as a PNG patch with feathered alpha. */
  async composePatch(fill: Uint8ClampedArray, mask: EditMask, bounds: Rect): Promise<Blob> {
    const response = await this.call<'compose'>(
      { type: 'compose', fill, mask, bounds },
      [fill.buffer],
    )
    return response.blob
  }
}

export const retouchWorker = new RetouchWorkerClient()
