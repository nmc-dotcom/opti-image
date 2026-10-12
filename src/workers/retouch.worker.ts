import { featherMask, getMaskBounds, rasterizeMask, resizeMask } from '@/lib/mask'
import { inpaintTelea, holeThickness } from '@/lib/inpaint/telea'
import { inpaintTexture } from '@/lib/inpaint/texturefill'
import {
  THIN_HOLE_THRESHOLD,
  WORKING_MAX_EDGE,
  fillAtWorkingResolution,
  fitWithin,
  maskToHole,
} from '@/lib/inpaintingCrop'
import type { EditMask } from '@/types/editing'
import type { RetouchWorkerRequest, RetouchWorkerResponse } from '@/types/worker'

interface WorkerScope {
  onmessage: ((event: MessageEvent<RetouchWorkerRequest>) => void) | null
  postMessage: (message: RetouchWorkerResponse, transfer?: Transferable[]) => void
}

const ctx = self as unknown as WorkerScope

function post(message: RetouchWorkerResponse, transfer: Transferable[] = []) {
  ctx.postMessage(message, transfer)
}

type Algorithm = 'telea' | 'texture' | 'patchmatch'

/**
 * Chooses the classic algorithm from the hole's thickness: thin strokes (text, scratches)
 * diffuse cleanly with Telea; anything thicker also needs texture. By default that is the
 * frequency-separation fill (diffusion + borrowed grain). PatchMatch is an opt-in build option
 * (`VITE_ENABLE_PATCHMATCH=true`) and is compiled out otherwise.
 */
function chooseAlgorithm(mask: EditMask): Algorithm {
  const working = fitWithin(mask.width, mask.height, WORKING_MAX_EDGE.telea)
  const small = resizeMask(mask, working.width, working.height)
  const thin = holeThickness(maskToHole(small), small.width, small.height) <= THIN_HOLE_THRESHOLD
  if (thin) return 'telea'
  return import.meta.env.VITE_ENABLE_PATCHMATCH === 'true' ? 'patchmatch' : 'texture'
}

function readBitmap(bitmap: ImageBitmap): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const c2d = canvas.getContext('2d', { willReadFrequently: true })
  if (!c2d) throw new Error('2D context unavailable for reading region')
  c2d.drawImage(bitmap, 0, 0)
  bitmap.close()
  return c2d.getImageData(0, 0, canvas.width, canvas.height).data
}

/**
 * A seam score above this means the boundary is clearly less natural than the surrounding
 * texture, i.e. the fill borrowed from the wrong surroundings. Calibrated on test scenes: good
 * fills score ≤ 0.5, a sky-into-white-panel failure scores ~1.7.
 */
const SEAM_RETRY_THRESHOLD = 1

/**
 * PatchMatch with a quality check: the texture-friendly variant runs first; only if its seam is
 * unnatural is the context-preserving variant tried too, and the one with the more natural
 * seam wins. (Diffusion is deliberately not a candidate: it always scores a smooth seam even
 * when it wipes out texture.) Normal cases pay for a single run.
 */
async function fillPatchMatch(
  rgba: Uint8ClampedArray,
  hole: Uint8Array,
  width: number,
  height: number,
  onProgress: (fraction: number) => void,
): Promise<boolean> {
  const { inpaintPatchMatch, seamScore } = await import('@/lib/inpaint/patchmatch')
  const first = new Uint8ClampedArray(rgba)
  if (!inpaintPatchMatch(first, hole, width, height, onProgress, 'any')) return false
  let best = first
  const firstScore = seamScore(first, hole, width, height)

  if (firstScore > SEAM_RETRY_THRESHOLD) {
    const preserving = new Uint8ClampedArray(rgba)
    if (
      inpaintPatchMatch(preserving, hole, width, height, undefined, 'all') &&
      seamScore(preserving, hole, width, height) < firstScore
    ) {
      best = preserving
    }
  }

  rgba.set(best)
  return true
}

ctx.onmessage = async (event: MessageEvent<RetouchWorkerRequest>) => {
  const message = event.data
  const { requestId } = message

  try {
    switch (message.type) {
      case 'mask': {
        const { strokes, region, outWidth, outHeight, feather } = message
        const raw = rasterizeMask(strokes, region, outWidth, outHeight)
        const mask = featherMask(raw, feather * (outWidth / region.width))
        const bounds = getMaskBounds(mask)
        post({ type: 'mask', requestId, mask, bounds }, [mask.data.buffer])
        return
      }

      case 'fill': {
        const { bitmap, mask } = message
        const image = readBitmap(bitmap)
        let algorithm = chooseAlgorithm(mask)
        const fill = await fillAtWorkingResolution(
          image,
          mask,
          WORKING_MAX_EDGE[algorithm],
          async (rgba, hole, width, height) => {
            // Inline env check: lets the bundler drop PatchMatch entirely from default builds.
            if (import.meta.env.VITE_ENABLE_PATCHMATCH === 'true' && algorithm === 'patchmatch') {
              const ok = await fillPatchMatch(rgba, hole, width, height, (f) =>
                post({ type: 'progress', requestId, progress: Math.round(f * 100) }),
              )
              if (ok) return
              algorithm = 'texture'
            }
            if (algorithm === 'texture') {
              // No usable surrounding texture → inpaintTexture keeps the diffusion result.
              inpaintTexture(rgba, hole, width, height)
              return
            }
            inpaintTelea(rgba, hole, width, height)
          },
        )
        post({ type: 'fill', requestId, fill, algorithm }, [fill.buffer])
        return
      }

      case 'compose': {
        // Patch = fill pixels with alpha = feathered mask, cropped to the mask bounds; drawn
        // with source-over it reproduces fill·α + original·(1-α) exactly.
        const { fill, mask, bounds } = message
        const out = new Uint8ClampedArray(bounds.width * bounds.height * 4)
        for (let y = 0; y < bounds.height; y++) {
          const srcRow = (bounds.y + y) * mask.width + bounds.x
          for (let x = 0; x < bounds.width; x++) {
            const m = mask.data[srcRow + x]
            const s = (srcRow + x) * 4
            const d = (y * bounds.width + x) * 4
            out[d] = fill[s]
            out[d + 1] = fill[s + 1]
            out[d + 2] = fill[s + 2]
            out[d + 3] = (m * fill[s + 3]) / 255
          }
        }
        const canvas = new OffscreenCanvas(bounds.width, bounds.height)
        const c2d = canvas.getContext('2d')
        if (!c2d) throw new Error('2D context unavailable for patch encoding')
        c2d.putImageData(new ImageData(out, bounds.width, bounds.height), 0, 0)
        const blob = await canvas.convertToBlob({ type: 'image/png' })
        post({ type: 'compose', requestId, blob })
        return
      }
    }
  } catch (error) {
    post({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : 'Unknown retouch worker error',
    })
  }
}
