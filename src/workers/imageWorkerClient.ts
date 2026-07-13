import type { EditSettings } from '@/types/image'
import type { WorkerResponse } from '@/types/worker'

interface PendingJob {
  resolve: (result: { blob: Blob; width: number; height: number }) => void
  reject: (error: Error) => void
  onProgress?: (progress: number) => void
}

/**
 * Manages a small pool of image-processing Web Workers and exposes a Promise-based API.
 * Jobs are round-robin dispatched to whichever worker is free; each worker processes one
 * job at a time so heavy encodes never block the main (UI) thread.
 */
class ImageWorkerPool {
  private workers: Worker[] = []
  private busy: boolean[] = []
  private pending = new Map<string, PendingJob>()
  private queue: Array<() => void> = []

  private ensurePool() {
    if (this.workers.length > 0) return
    const size = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 4))
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./image.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (event: MessageEvent<WorkerResponse>) =>
        this.handleMessage(i, event.data)
      this.workers.push(worker)
      this.busy.push(false)
    }
  }

  private handleMessage(workerIndex: number, response: WorkerResponse) {
    const job = this.pending.get(response.requestId)
    if (!job) return

    if (response.type === 'progress') {
      job.onProgress?.(response.progress)
      return
    }

    this.pending.delete(response.requestId)
    this.busy[workerIndex] = false

    if (response.type === 'success') {
      job.resolve({ blob: response.blob, width: response.width, height: response.height })
    } else {
      job.reject(new Error(response.message))
    }

    this.drainQueue()
  }

  private drainQueue() {
    const nextTask = this.queue.shift()
    nextTask?.()
  }

  private findFreeWorker(): number {
    return this.busy.findIndex((b) => !b)
  }

  async process(
    bitmap: ImageBitmap,
    settings: EditSettings,
    sourceType: string,
    onProgress?: (progress: number) => void,
  ): Promise<{ blob: Blob; width: number; height: number }> {
    this.ensurePool()

    return new Promise((resolve, reject) => {
      const dispatch = () => {
        const workerIndex = this.findFreeWorker()
        if (workerIndex === -1) {
          this.queue.push(dispatch)
          return
        }

        const requestId = crypto.randomUUID()
        this.busy[workerIndex] = true
        this.pending.set(requestId, { resolve, reject, onProgress })
        this.workers[workerIndex].postMessage(
          { type: 'process', requestId, bitmap, settings, sourceType },
          [bitmap],
        )
      }

      dispatch()
    })
  }

  terminate() {
    this.workers.forEach((worker) => worker.terminate())
    this.workers = []
    this.busy = []
    this.pending.clear()
    this.queue = []
  }
}

export const imageWorkerPool = new ImageWorkerPool()
