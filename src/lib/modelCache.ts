/**
 * Download-once model files: fetched with a plain GET, verified against a pinned SHA-256, and kept
 * in the browser's Cache Storage so later sessions never touch the network for them.
 *
 * This is the ONLY kind of request the on-device AI features make — the user's image never
 * appears in a URL, header or body. Works inside Web Workers (Cache Storage and crypto.subtle are
 * both available there on secure origins).
 */

export interface ModelAsset {
  /** Pinned (commit-addressed) URL. */
  url: string
  /** Lower-case hex SHA-256 of the file. A mismatch rejects the file instead of running it. */
  sha256: string
  /** Expected size, used for progress when the server sends no Content-Length. */
  bytes: number
}

const CACHE_NAME = 'optiimage-models-v1'

const hasCacheApi = () => typeof caches !== 'undefined'

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** True when the asset is already in Cache Storage (no download needed). */
export async function isModelCached(asset: ModelAsset): Promise<boolean> {
  if (!hasCacheApi()) return false
  try {
    const cache = await caches.open(CACHE_NAME)
    return (await cache.match(asset.url)) !== undefined
  } catch {
    return false
  }
}

/** Returns the file's bytes (from cache when possible), reporting 0-100 while it downloads. */
export async function loadCachedModel(
  asset: ModelAsset,
  onProgress?: (percent: number) => void,
): Promise<ArrayBuffer> {
  if (hasCacheApi()) {
    try {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(asset.url)
      if (cached) {
        const buffer = await cached.arrayBuffer()
        if ((await sha256Hex(buffer)) === asset.sha256) {
          onProgress?.(100)
          return buffer
        }
        await cache.delete(asset.url)
      }
    } catch {
      // Cache Storage can be unavailable (private mode, quota); fall through to the network.
    }
  }

  let response: Response
  try {
    response = await fetch(asset.url, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    // Offline, DNS failure, blocked by an extension or a firewall: the browser's own message
    // ("Failed to fetch") says nothing useful to the user.
    throw new Error(`모델 파일을 내려받지 못했습니다. (${new URL(asset.url).host}에 연결할 수 없음)`)
  }
  if (!response.ok || !response.body) {
    throw new Error(`모델 파일을 내려받지 못했습니다. (HTTP ${response.status})`)
  }

  const total = Number(response.headers.get('content-length')) || asset.bytes
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

  if ((await sha256Hex(bytes.buffer)) !== asset.sha256) {
    throw new Error('모델 파일 검증(SHA-256)에 실패했습니다. 잠시 후 다시 시도하세요.')
  }

  if (hasCacheApi()) {
    try {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(
        asset.url,
        new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }),
      )
    } catch {
      // Not fatal: the next session just downloads again.
    }
  }
  onProgress?.(100)
  return bytes.buffer
}
