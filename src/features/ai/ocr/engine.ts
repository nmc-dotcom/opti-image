import type Tesseract from 'tesseract.js'

type TesseractModule = typeof import('tesseract.js')

let modulePromise: Promise<TesseractModule> | null = null
const workers = new Map<string, Promise<Tesseract.Worker>>()
let progressListener: ((progress: number) => void) | null = null

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Same short retry as background removal, to ride out post-deploy chunk 404s. */
async function importTesseract(retries = 2): Promise<TesseractModule> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await import('tesseract.js')
    } catch (error) {
      if (attempt >= retries) throw error
      await delay(1500 * (attempt + 1))
    }
  }
}

export function setOcrProgressListener(listener: ((progress: number) => void) | null) {
  progressListener = listener
}

/**
 * Lazily creates (and then reuses) a Tesseract.js worker per language set and page
 * segmentation mode. Tesseract.js runs recognition inside its own dedicated Web Worker, so the
 * UI thread never blocks; the image reaches that worker through postMessage only. The worker
 * script, WASM core and `*.traineddata` language files are fetched with plain GETs from jsDelivr
 * on first use and the language data is cached in IndexedDB — no image data is ever part of a
 * network request.
 */
export async function getOcrWorker(
  lang: string,
  pageSegMode: Tesseract.PSM,
): Promise<Tesseract.Worker> {
  const key = `${lang}|${pageSegMode}`
  const existing = workers.get(key)
  if (existing) return existing

  modulePromise ??= importTesseract().catch((error) => {
    modulePromise = null
    throw error
  })

  const created = (async () => {
    const { createWorker, OEM } = await modulePromise!
    const worker = await createWorker(lang, OEM.LSTM_ONLY, {
      logger: (message) => {
        // Model download/initialisation is reported as the first half, recognition as the rest.
        const loading =
          message.status.startsWith('loading') || message.status.startsWith('initializ')
        const progress = loading ? message.progress * 50 : 50 + message.progress * 50
        progressListener?.(Math.round(progress))
      },
    })
    await worker.setParameters({
      tessedit_pageseg_mode: pageSegMode,
      // Screenshots/photos carry no DPI. Without this Tesseract estimates it from the glyphs it
      // finds, and the estimate (hence the recognition) changes when other text is edited out.
      user_defined_dpi: '300',
    })
    return worker
  })().catch((error) => {
    workers.delete(key)
    throw error
  })

  workers.set(key, created)
  return created
}

export async function terminateOcrWorkers() {
  const all = [...workers.values()]
  workers.clear()
  await Promise.all(all.map((w) => w.then((worker) => worker.terminate()).catch(() => undefined)))
}

/** PSM values without importing tesseract.js eagerly (they are plain strings in its enum). */
export const PSM = {
  SINGLE_LINE: '7',
  SPARSE_TEXT: '11',
} as unknown as Record<'SINGLE_LINE' | 'SPARSE_TEXT', Tesseract.PSM>
