import { formatToMime, renderEditedCanvas } from '@/lib/imagePipeline'
import type { WorkerRequest, WorkerResponse } from '@/types/worker'

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse) => void
}

const ctx = self as unknown as WorkerScope

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type !== 'process') return

  const { requestId, bitmap, settings } = message

  try {
    post({ type: 'progress', requestId, progress: 20 })

    const canvas = renderEditedCanvas(bitmap, settings)
    bitmap.close()

    post({ type: 'progress', requestId, progress: 70 })

    const mime = formatToMime(settings.format)
    const quality = settings.format === 'png' ? undefined : settings.quality / 100
    const blob = await canvas.convertToBlob({ type: mime, quality })

    console.debug(
      `[OptiImage worker] format=${settings.format} qualityInput=${settings.quality} qualityArg=${quality} -> ${canvas.width}x${canvas.height}, ${blob.size} bytes`,
    )

    post({ type: 'progress', requestId, progress: 100 })
    post({ type: 'success', requestId, blob, width: canvas.width, height: canvas.height })
  } catch (error) {
    post({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : 'Unknown worker error',
    })
  }
}

function post(response: WorkerResponse) {
  ctx.postMessage(response)
}
