/**
 * MI-GAN inpainting model (Picsart AI Research, ICCV 2023), "pipeline v2" ONNX export.
 *
 * Verified before adoption (see README "AI 인페인팅 모델"):
 * - inputs  `image` uint8 [1,3,H,W], `mask` uint8 [1,1,H,W] with 255 = keep, 0 = fill
 * - output  `result` uint8 [1,3,H,W]; any H×W (the pipeline crops/resizes to 512 internally)
 * - 28 MB, MIT license, served by Hugging Face with `Access-Control-Allow-Origin: *`
 *
 * The URL is pinned to a repository commit and the file is checked against its SHA-256, so a
 * changed or tampered upstream file is rejected instead of being executed.
 */
export const MIGAN_MODEL = {
  id: 'migan-pipeline-v2',
  name: 'MI-GAN (pipeline v2)',
  url: 'https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx',
  sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
  bytes: 28_079_181,
  license: 'MIT',
  source: 'https://huggingface.co/andraniksargsyan/migan',
} as const

const CACHE_NAME = 'optiimage-models-v1'

function hasCacheApi() {
  return typeof caches !== 'undefined'
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** True when the model is already in the browser's Cache Storage (no download needed). */
export async function isModelCached(): Promise<boolean> {
  if (!hasCacheApi()) return false
  try {
    const cache = await caches.open(CACHE_NAME)
    return (await cache.match(MIGAN_MODEL.url)) !== undefined
  } catch {
    return false
  }
}

/**
 * Returns the model bytes, downloading them once (plain GET, no credentials, no referrer) and
 * caching them in Cache Storage. This is the ONLY network request the AI inpainting feature
 * makes; the user's image never leaves the device.
 */
export async function loadModel(onProgress?: (percent: number) => void): Promise<ArrayBuffer> {
  if (hasCacheApi()) {
    try {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(MIGAN_MODEL.url)
      if (cached) {
        const buffer = await cached.arrayBuffer()
        if ((await sha256Hex(buffer)) === MIGAN_MODEL.sha256) {
          onProgress?.(100)
          return buffer
        }
        await cache.delete(MIGAN_MODEL.url)
      }
    } catch {
      // Cache Storage can be unavailable (private mode, quota); fall through to the network.
    }
  }

  const response = await fetch(MIGAN_MODEL.url, {
    method: 'GET',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
  if (!response.ok || !response.body) {
    throw new Error(`AI 모델을 내려받지 못했습니다. (HTTP ${response.status})`)
  }

  const total = Number(response.headers.get('content-length')) || MIGAN_MODEL.bytes
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress?.(Math.min(99, Math.round((received / total) * 100)))
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }

  if ((await sha256Hex(bytes.buffer)) !== MIGAN_MODEL.sha256) {
    throw new Error('AI 모델 파일 검증(SHA-256)에 실패했습니다. 잠시 후 다시 시도하세요.')
  }

  if (hasCacheApi()) {
    try {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(
        MIGAN_MODEL.url,
        new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }),
      )
    } catch {
      // Not fatal: the next session just downloads again.
    }
  }
  onProgress?.(100)
  return bytes.buffer
}
