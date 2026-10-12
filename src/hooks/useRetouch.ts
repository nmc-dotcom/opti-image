import { useCallback } from 'react'
import { useImageStore } from '@/store/useImageStore'
import { useEditStore } from '@/store/useEditStore'
import { getStrokesBounds } from '@/lib/mask'
import { computeInpaintRegion } from '@/lib/inpaintingCrop'
import { renderRetouchedRegion } from '@/lib/retouch'
import { retouchWorker } from '@/workers/retouchWorkerClient'
import type { InpaintMethod, MaskStroke, RetouchOp } from '@/types/editing'
import type { EditSettings } from '@/types/image'
import { toast } from '@/hooks/useToast'

export interface RemovalRequest {
  imageId: string
  strokes: MaskStroke[]
  method: InpaintMethod
  feather: number
  kind: RetouchOp['kind']
  /** Extra settings change committed in the SAME history entry (e.g. adding a text layer). */
  alsoUpdate?: (settings: EditSettings) => EditSettings
}

export interface RemovalOutcome {
  op: RetouchOp
  algorithm: string
  millis: number
}

/**
 * Removes the selected area: render the current retouched region (source + earlier patches)
 * with context padding → rasterize/feather the mask → fill it (classic algorithm or AI model,
 * both on-device) → encode just the masked pixels as a patch → record it in settings history.
 *
 * Pixels only ever travel main thread ⇄ local workers via postMessage; nothing is uploaded.
 */
export async function runRemoval(request: RemovalRequest): Promise<RemovalOutcome> {
  const { imageId, strokes, method, feather, kind, alsoUpdate } = request
  const edit = useEditStore.getState()
  const item = useImageStore.getState().images.find((i) => i.id === imageId)
  if (!item) throw new Error('이미지를 찾을 수 없습니다.')
  if (edit.job) throw new Error('이미 다른 편집 작업이 진행 중입니다.')

  const selection = getStrokesBounds(strokes)
  if (!selection) throw new Error('지울 영역을 먼저 선택하세요.')
  const region = computeInpaintRegion(selection, item.source.width, item.source.height, feather)
  if (!region) throw new Error('선택 영역이 이미지 밖에 있습니다.')

  const started = performance.now()
  const setJob = edit.setJob
  try {
    setJob({ label: '영역 준비 중', percent: null })
    const patches = item.settings.retouch
      .map((op) => edit.patches[op.id])
      .filter((p) => p !== undefined)
    const regionCanvas = await renderRetouchedRegion(
      item.source.file,
      patches,
      region.rect,
      region.outWidth,
      region.outHeight,
    )
    const { mask, bounds } = await retouchWorker.buildMask(
      strokes,
      region.rect,
      region.outWidth,
      region.outHeight,
      feather,
    )
    if (!bounds) throw new Error('선택 영역이 비어 있습니다.')

    let fill: Uint8ClampedArray
    let algorithm: string
    // The flag is checked inline (not via lib/features.ts): Vite only folds `import.meta.env`
    // literals within the module that reads them, and that is what lets the bundler drop the
    // inpainting module (and the model URL) from builds where AI inpainting is disabled.
    if (import.meta.env.VITE_ENABLE_AI_INPAINTING === 'true' && method === 'ai') {
      // Lazy: the plugin module (and through it the worker, ONNX Runtime and the model) is
      // only loaded the first time someone actually chooses AI inpainting.
      const { inpaintingPlugin } = await import('@/features/ai/inpainting')
      setJob({ label: 'AI 모델 준비 중', percent: 0 })
      const result = await inpaintingPlugin.run({
        bitmap: regionCanvas.transferToImageBitmap(),
        mask,
        onProgress: (percent) =>
          setJob({ label: percent < 60 ? 'AI 모델 다운로드 중' : percent < 70 ? 'AI 모델 초기화 중' : 'AI 인페인팅 중', percent }),
      })
      fill = result.fill
      algorithm = `ai/${result.backend}`
      useEditStore.getState().setAiBackend(result.backend)
    } else {
      setJob({ label: '배경 복원 중', percent: 0 })
      const result = await retouchWorker.fillClassic(
        regionCanvas.transferToImageBitmap(),
        mask,
        (percent) => setJob({ label: '배경 복원 중', percent }),
      )
      fill = result.fill
      algorithm = result.algorithm
    }

    setJob({ label: '결과 합성 중', percent: null })
    const blob = await retouchWorker.composePatch(fill, mask, bounds)

    // Region-local (possibly downscaled) bounds → source pixels.
    const sx = region.rect.width / region.outWidth
    const sy = region.rect.height / region.outHeight
    const op: RetouchOp = {
      id: crypto.randomUUID(),
      kind,
      method,
      bounds: {
        x: region.rect.x + bounds.x * sx,
        y: region.rect.y + bounds.y * sy,
        width: bounds.width * sx,
        height: bounds.height * sy,
      },
    }

    const images = useImageStore.getState()
    if (!images.images.some((i) => i.id === imageId)) throw new Error('이미지가 삭제되었습니다.')
    useEditStore.getState().addPatch({
      id: op.id,
      imageId,
      ...op.bounds,
      blob,
      url: URL.createObjectURL(blob),
    })
    images.updateSettings(imageId, (s) => {
      const next = { ...s, retouch: [...s.retouch, op] }
      return alsoUpdate ? alsoUpdate(next) : next
    })
    images.commitHistory(imageId)

    const millis = Math.round(performance.now() - started)
    images.log(
      'success',
      `${item.source.name}: ${kind === 'text-removal' ? '텍스트' : '영역'} 제거 완료 (${algorithm}, ${millis}ms)`,
    )
    return { op, algorithm, millis }
  } finally {
    setJob(null)
  }
}

/** React binding: current job + a `remove` that reports failures as a toast instead of throwing. */
export function useRetouch() {
  const job = useEditStore((s) => s.job)

  const remove = useCallback(async (request: RemovalRequest) => {
    try {
      return await runRemoval(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : '편집 중 오류가 발생했습니다.'
      useImageStore.getState().log('error', message)
      toast({ variant: 'destructive', title: '지우기 실패', description: message })
      return null
    }
  }, [])

  return { job, busy: job !== null, remove }
}
