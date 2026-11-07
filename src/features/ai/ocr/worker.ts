import type * as Ort from 'onnxruntime-web'
import { loadCachedModel } from '@/lib/modelCache'
import { OCR_MODELS } from './models'
import {
  detectPasses,
  isPlausibleText,
  overlapRatio,
  parseDictionary,
  recognizeLine,
  splitWords,
  type DetectionPasses,
  type RecognizedLine,
} from './pipeline'
import type { OcrTextRegion, OcrWorkerRequest, OcrWorkerResponse } from './types'
import type { Rect } from '@/types/editing'

interface WorkerScope {
  onmessage: ((event: MessageEvent<OcrWorkerRequest>) => void) | null
  postMessage: (message: OcrWorkerResponse) => void
}

const ctx = self as unknown as WorkerScope
const post = (message: OcrWorkerResponse) => ctx.postMessage(message)

type OrtModule = typeof Ort

interface Engine {
  ort: OrtModule
  det: Ort.InferenceSession
  rec: Ort.InferenceSession
  dictionary: string[]
}

let enginePromise: Promise<Engine> | null = null

/**
 * Loads ONNX Runtime Web and the three model files once, in this worker. Progress covers the
 * download (0-70, weighted by file size), session creation (70-100 of the "init" stage).
 */
function getEngine(requestId: string): Promise<Engine> {
  enginePromise ??= (async () => {
    const mod = await import('onnxruntime-web')
    const ort = ((mod as unknown as { default?: OrtModule }).default ?? mod) as OrtModule
    // Dedicated worker already; threads need cross-origin isolation, which the host may not set.
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1

    const assets = [OCR_MODELS.det, OCR_MODELS.rec, OCR_MODELS.dict]
    const total = assets.reduce((s, a) => s + a.bytes, 0)
    const done = [0, 0, 0]
    const report = () => {
      const bytes = assets.reduce((s, a, i) => s + (a.bytes * done[i]) / 100, 0)
      post({ type: 'progress', requestId, stage: 'download', progress: Math.round((bytes / total) * 100) })
    }
    const [detBytes, recBytes, ymlBytes] = await Promise.all(
      assets.map((asset, i) =>
        loadCachedModel(asset, (percent) => {
          done[i] = percent
          report()
        }),
      ),
    )

    post({ type: 'progress', requestId, stage: 'init', progress: 0 })
    const options: Ort.InferenceSession.SessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      // Errors only: the exported graphs trigger harmless "unused initializer" notices.
      logSeverityLevel: 3,
    }
    const det = await ort.InferenceSession.create(new Uint8Array(detBytes), options)
    post({ type: 'progress', requestId, stage: 'init', progress: 50 })
    const rec = await ort.InferenceSession.create(new Uint8Array(recBytes), options)
    const dictionary = parseDictionary(new TextDecoder('utf-8').decode(ymlBytes))
    return { ort, det, rec, dictionary }
  })().catch((error) => {
    enginePromise = null
    throw error
  })
  return enginePromise
}

function toRegion(line: RecognizedLine, box: Rect, offsetX = 0, offsetWidth?: number): OcrTextRegion {
  return {
    id: crypto.randomUUID(),
    text: line.text,
    confidence: line.confidence,
    bbox: { x: box.x + offsetX, y: box.y, width: offsetWidth ?? box.width, height: box.height },
  }
}

ctx.onmessage = async (event: MessageEvent<OcrWorkerRequest>) => {
  const { requestId, bitmap, options } = event.data
  try {
    const engine = await getEngine(requestId)

    const source = new OffscreenCanvas(bitmap.width, bitmap.height)
    const sctx = source.getContext('2d')
    if (!sctx) throw new Error('2D context unavailable for OCR')
    sctx.drawImage(bitmap, 0, 0)
    bitmap.close()

    post({ type: 'progress', requestId, stage: 'run', progress: 0 })
    const passes: DetectionPasses =
      options.layout === 'single-line'
        ? { base: [{ x: 0, y: 0, width: source.width, height: source.height }], fine: [] }
        : await detectPasses(engine.ort, engine.det, source)

    const regions: OcrTextRegion[] = []
    /** Line boxes that produced readable text; later (finer) boxes must not duplicate them. */
    const accepted: Rect[] = []
    const total = passes.base.length + passes.fine.length
    let done = 0

    const readBox = async (box: Rect) => {
      const line = await recognizeLine(engine.ort, engine.rec, engine.dictionary, source, box)
      done++
      post({ type: 'progress', requestId, stage: 'run', progress: Math.round((done / total) * 100) })

      const parts = options.granularity === 'word' ? splitWords(line) : [line]
      let produced = false
      for (const part of parts) {
        if (part.confidence < options.minConfidence || !isPlausibleText(part.text, part.confidence)) continue
        produced = true
        if (options.granularity === 'word') {
          // A word's box comes from the CTC time steps of its characters.
          const x0 = Math.max(0, Math.min(...part.chars.map((c) => c.x0)))
          const x1 = Math.min(box.width, Math.max(...part.chars.map((c) => c.x1)))
          regions.push(toRegion(part, box, x0, Math.max(1, x1 - x0)))
        } else {
          regions.push(toRegion(part, box))
        }
      }
      if (produced) accepted.push(box)
    }

    for (const box of passes.base) await readBox(box)
    for (const box of passes.fine) {
      if (accepted.some((a) => overlapRatio(a, box) >= 0.5)) {
        done++
        continue
      }
      await readBox(box)
    }
    regions.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
    post({ type: 'result', requestId, regions })
  } catch (error) {
    post({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : 'OCR 중 오류가 발생했습니다.',
    })
  }
}
