import type * as Ort from 'onnxruntime-web'
import type { InpaintingBackend } from './types'

type OrtModule = typeof Ort

let ortPromise: Promise<OrtModule> | null = null

/**
 * The WebGPU build of ONNX Runtime Web also contains the WASM (CPU) execution provider, so one
 * dynamically imported bundle covers both. Its .wasm binary is emitted by Vite as a same-origin
 * asset (no CDN involved), and it is only ever fetched once AI inpainting is actually used.
 */
async function loadOrt(): Promise<OrtModule> {
  ortPromise ??= import('onnxruntime-web/webgpu')
    .then((mod) => {
      const ort = ((mod as unknown as { default?: OrtModule }).default ?? mod) as OrtModule
      // We already run inside a dedicated worker; multi-threading needs cross-origin isolation.
      ort.env.wasm.proxy = false
      ort.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.min(4, navigator.hardwareConcurrency || 1)
        : 1
      return ort
    })
    .catch((error) => {
      ortPromise = null
      throw error
    })
  return ortPromise
}

/** WebGPU is never assumed: the API must exist AND hand out an adapter. */
export async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

export interface InpaintSession {
  backend: InpaintingBackend
  run: (rgba: Uint8ClampedArray, hole: Uint8Array, width: number, height: number) => Promise<Uint8Array>
}

function createRunner(ort: OrtModule, session: Ort.InferenceSession) {
  return async (rgba: Uint8ClampedArray, hole: Uint8Array, width: number, height: number) => {
    const plane = width * height
    const image = new Uint8Array(plane * 3)
    const mask = new Uint8Array(plane)
    for (let i = 0; i < plane; i++) {
      image[i] = rgba[i * 4]
      image[plane + i] = rgba[i * 4 + 1]
      image[2 * plane + i] = rgba[i * 4 + 2]
      // MI-GAN convention: 255 = keep, 0 = fill.
      mask[i] = hole[i] ? 0 : 255
    }
    const outputs = await session.run({
      image: new ort.Tensor('uint8', image, [1, 3, height, width]),
      mask: new ort.Tensor('uint8', mask, [1, 1, height, width]),
    })
    const result = outputs.result
    const data = result.data as Uint8Array
    result.dispose?.()
    return data
  }
}

/**
 * Creates an inference session, preferring WebGPU and falling back to WASM (CPU). A WebGPU
 * session that fails to create OR to run a first inference (driver/op support differs by
 * device) is discarded and the WASM provider is used instead, so the feature degrades
 * gracefully rather than failing.
 */
export async function createInpaintSession(model: ArrayBuffer): Promise<InpaintSession> {
  const ort = await loadOrt()

  if (await hasWebGpu()) {
    try {
      const session = await ort.InferenceSession.create(new Uint8Array(model), {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
        // Errors only: hides the benign "some nodes were not assigned to the preferred EP"
        // notice (ORT deliberately keeps shape ops on CPU).
        logSeverityLevel: 3,
      })
      const run = createRunner(ort, session)
      // Smoke test on a tiny input so an EP that loads but cannot execute is caught here.
      const probeHole = new Uint8Array(64 * 64)
      probeHole.fill(1, 64 * 24, 64 * 40)
      await run(new Uint8ClampedArray(64 * 64 * 4).fill(128), probeHole, 64, 64)
      return { backend: 'webgpu', run }
    } catch (error) {
      console.warn('[OptiImage] WebGPU inpainting unavailable, falling back to WASM:', error)
    }
  }

  if (typeof WebAssembly === 'undefined') {
    throw new Error('이 브라우저는 WebGPU와 WebAssembly를 모두 지원하지 않아 AI 인페인팅을 사용할 수 없습니다.')
  }
  const session = await ort.InferenceSession.create(new Uint8Array(model), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  })
  return { backend: 'wasm', run: createRunner(ort, session) }
}
