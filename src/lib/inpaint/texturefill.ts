/**
 * Frequency-separation fill for thick selections.
 *
 * A diffusion-style fill reproduces the smooth part of the surroundings but leaves a hole looking
 * like a flat smear on textured backgrounds. This splits the problem the way retouchers do
 * ("frequency separation"):
 *
 *   low frequency  (colour, gradients, shading)   →  row/column linear interpolation across the
 *                                                   hole (span-weighted), "pull-push" fallback
 *   high frequency (grain, grass, foliage, noise) →  residual borrowed from the surrounding area
 *
 * The residual of every known pixel is its difference from a local mean (computed ignoring the
 * hole). Each hole pixel then receives the residual of a displaced known pixel, with the
 * displacement held constant over small cells so the grain keeps its local structure. Sources are
 * only accepted when they are NOT on a strong edge (a panel border, the horizon) and when their
 * local colour matches the colour being filled, so structure and unrelated textures (grass specks
 * in the sky) are never cloned into the hole.
 *
 * Only textbook operations are used (linear interpolation, pyramid interpolation — Gortler et
 * al. 1996 "pull-push" —, box blur, clone-stamp style sampling). It is deliberately NOT an exemplar/patch-search method
 * such as PatchMatch.
 */

const CELL = 12
/** Local-mean radius (px): features smaller than this count as "texture". */
const BASE_RADIUS = 3
/** Wider mean used for the interpolation endpoints, so one boundary speck cannot streak a row. */
const ENDPOINT_RADIUS = 9
/** Sources whose local mean changes faster than this (levels per 2px) are edges, not texture. */
const EDGE_GRADIENT = 12
/** A source's local colour must be within this mean-abs distance of the colour being filled. */
const COLOR_TOLERANCE = 24
/** Candidate displacements tried per cell. */
const CANDIDATES = 6

function hash(x: number, y: number, k: number): number {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Normalized box mean of `src` over known pixels only (hole pixels carry zero weight). */
function maskedBoxMean(
  src: Float32Array,
  known: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const sum = new Float32Array(width * height)
  const cnt = new Float32Array(width * height)
  const tmpS = new Float32Array(width * height)
  const tmpC = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    const row = y * width
    let s = 0
    let c = 0
    for (let x = 0; x <= Math.min(radius, width - 1); x++) {
      if (known[row + x]) {
        s += src[row + x]
        c++
      }
    }
    for (let x = 0; x < width; x++) {
      tmpS[row + x] = s
      tmpC[row + x] = c
      const add = x + radius + 1
      const sub = x - radius
      if (add < width && known[row + add]) {
        s += src[row + add]
        c++
      }
      if (sub >= 0 && known[row + sub]) {
        s -= src[row + sub]
        c--
      }
    }
  }
  for (let x = 0; x < width; x++) {
    let s = 0
    let c = 0
    for (let y = 0; y <= Math.min(radius, height - 1); y++) {
      s += tmpS[y * width + x]
      c += tmpC[y * width + x]
    }
    for (let y = 0; y < height; y++) {
      sum[y * width + x] = s
      cnt[y * width + x] = c
      const add = y + radius + 1
      const sub = y - radius
      if (add < height) {
        s += tmpS[add * width + x]
        c += tmpC[add * width + x]
      }
      if (sub >= 0) {
        s -= tmpS[sub * width + x]
        c -= tmpC[sub * width + x]
      }
    }
  }
  const out = new Float32Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = cnt[i] > 0.5 ? sum[i] / cnt[i] : src[i]
  return out
}

interface PyramidLevel {
  width: number
  height: number
  /** Colour, 3 floats per pixel. */
  color: Float32Array
  /** 0..1 confidence (1 = known). */
  weight: Float32Array
}

/**
 * Smooth fill of the hole by multi-resolution interpolation: known pixels are averaged upward
 * ("pull"), then coarse estimates are interpolated back down into the unknown pixels ("push").
 * Unlike directional diffusion it never produces streaks, however large or oddly shaped the hole.
 * Returns false when there is no known pixel at all.
 */
function pullPushFill(
  rgba: Uint8ClampedArray,
  known: Uint8Array,
  width: number,
  height: number,
): boolean {
  const base: PyramidLevel = {
    width,
    height,
    color: new Float32Array(width * height * 3),
    weight: new Float32Array(width * height),
  }
  let any = false
  for (let i = 0; i < width * height; i++) {
    if (!known[i]) continue
    any = true
    base.weight[i] = 1
    base.color[i * 3] = rgba[i * 4]
    base.color[i * 3 + 1] = rgba[i * 4 + 1]
    base.color[i * 3 + 2] = rgba[i * 4 + 2]
  }
  if (!any) return false

  const levels: PyramidLevel[] = [base]
  while (levels[levels.length - 1].width > 1 || levels[levels.length - 1].height > 1) {
    const fine = levels[levels.length - 1]
    const w = Math.max(1, Math.ceil(fine.width / 2))
    const h = Math.max(1, Math.ceil(fine.height / 2))
    const coarse: PyramidLevel = {
      width: w,
      height: h,
      color: new Float32Array(w * h * 3),
      weight: new Float32Array(w * h),
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sw = 0
        let r = 0
        let g = 0
        let b = 0
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const fx = x * 2 + dx
            const fy = y * 2 + dy
            if (fx >= fine.width || fy >= fine.height) continue
            const fi = fy * fine.width + fx
            const fw = fine.weight[fi]
            sw += fw
            r += fw * fine.color[fi * 3]
            g += fw * fine.color[fi * 3 + 1]
            b += fw * fine.color[fi * 3 + 2]
          }
        }
        const ci = y * w + x
        if (sw > 0) {
          coarse.color[ci * 3] = r / sw
          coarse.color[ci * 3 + 1] = g / sw
          coarse.color[ci * 3 + 2] = b / sw
        }
        coarse.weight[ci] = Math.min(1, sw)
      }
    }
    levels.push(coarse)
  }

  // Push: from the coarsest level down, blend each level with the bilinearly upsampled coarser one.
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l]
    const coarse = levels[l + 1]
    for (let y = 0; y < fine.height; y++) {
      const cy = Math.min(coarse.height - 1, Math.max(0, (y + 0.5) / 2 - 0.5))
      const y0 = Math.floor(cy)
      const y1 = Math.min(coarse.height - 1, y0 + 1)
      const fy = cy - y0
      for (let x = 0; x < fine.width; x++) {
        const fi = y * fine.width + x
        const w = fine.weight[fi]
        if (w >= 1) continue
        const cx = Math.min(coarse.width - 1, Math.max(0, (x + 0.5) / 2 - 0.5))
        const x0 = Math.floor(cx)
        const x1 = Math.min(coarse.width - 1, x0 + 1)
        const fx = cx - x0
        for (let ch = 0; ch < 3; ch++) {
          const c00 = coarse.color[(y0 * coarse.width + x0) * 3 + ch]
          const c10 = coarse.color[(y0 * coarse.width + x1) * 3 + ch]
          const c01 = coarse.color[(y1 * coarse.width + x0) * 3 + ch]
          const c11 = coarse.color[(y1 * coarse.width + x1) * 3 + ch]
          const up = (c00 * (1 - fx) + c10 * fx) * (1 - fy) + (c01 * (1 - fx) + c11 * fx) * fy
          fine.color[fi * 3 + ch] = fine.color[fi * 3 + ch] * w + up * (1 - w)
        }
        fine.weight[fi] = 1
      }
    }
  }

  for (let i = 0; i < width * height; i++) {
    if (known[i]) continue
    rgba[i * 4] = base.color[i * 3]
    rgba[i * 4 + 1] = base.color[i * 3 + 1]
    rgba[i * 4 + 2] = base.color[i * 3 + 2]
    rgba[i * 4 + 3] = 255
  }
  return true
}

/**
 * Smooth base fill by linear interpolation along rows and columns. Every hole pixel is
 * interpolated between the nearest known pixels on its row (left/right) and on its column
 * (up/down); the two estimates are blended by 1/span³, so the direction in which the hole is
 * NARROWER wins. A tall thin hole is therefore filled mostly row-wise, which carries a horizon or
 * any horizontal edge straight across it at the correct height — something an isotropic
 * interpolation cannot do (it smears the edge into a haze). Endpoints use the hole-excluding
 * local mean rather than the raw pixel, so one speck on the boundary cannot streak a whole row.
 * Pixels with no known neighbour on their row or column are left as filled by `pullPushFill`.
 */
function directionalBase(
  rgba: Uint8ClampedArray,
  known: Uint8Array,
  means: Float32Array[],
  width: number,
  height: number,
) {
  const n = width * height
  const left = new Int32Array(n).fill(-1)
  const right = new Int32Array(n).fill(-1)
  const up = new Int32Array(n).fill(-1)
  const down = new Int32Array(n).fill(-1)
  for (let y = 0; y < height; y++) {
    let last = -1
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (known[i]) last = x
      left[i] = last
    }
    last = -1
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      if (known[i]) last = x
      right[i] = last
    }
  }
  for (let x = 0; x < width; x++) {
    let last = -1
    for (let y = 0; y < height; y++) {
      const i = y * width + x
      if (known[i]) last = y
      up[i] = last
    }
    last = -1
    for (let y = height - 1; y >= 0; y--) {
      const i = y * width + x
      if (known[i]) last = y
      down[i] = last
    }
  }

  const SINGLE_SIDE_PENALTY = 3
  const est = [0, 0, 0]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (known[i]) continue
      est[0] = est[1] = est[2] = 0
      let weightSum = 0

      // Estimate along one axis: (a, b) are the known coordinates before/after, `pos` the pixel's.
      const axis = (a: number, b: number, pos: number, index: (c: number) => number) => {
        let span: number
        let t: number
        let ia: number
        let ib: number
        if (a >= 0 && b >= 0) {
          span = b - a
          t = (pos - a) / span
          ia = index(a)
          ib = index(b)
        } else if (a >= 0) {
          span = (pos - a) * SINGLE_SIDE_PENALTY + 32
          t = 0
          ia = ib = index(a)
        } else if (b >= 0) {
          span = (b - pos) * SINGLE_SIDE_PENALTY + 32
          t = 0
          ia = ib = index(b)
        } else {
          return
        }
        const w = 1 / (span * span * span)
        for (let ch = 0; ch < 3; ch++) est[ch] += w * (means[ch][ia] * (1 - t) + means[ch][ib] * t)
        weightSum += w
      }
      axis(left[i], right[i], x, (c) => y * width + c)
      axis(up[i], down[i], y, (c) => c * width + x)

      if (weightSum > 0) {
        for (let ch = 0; ch < 3; ch++) rgba[i * 4 + ch] = est[ch] / weightSum
        rgba[i * 4 + 3] = 255
      }
    }
  }
}

/** Distance (px) from every KNOWN pixel to the nearest hole pixel (chamfer 3-4 approximation). */
function distanceToHole(known: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1 << 28
  const d = new Int32Array(width * height)
  for (let i = 0; i < d.length; i++) d[i] = known[i] ? INF : 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!d[i]) continue
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 3)
      if (y > 0) {
        v = Math.min(v, d[i - width] + 3)
        if (x > 0) v = Math.min(v, d[i - width - 1] + 4)
        if (x < width - 1) v = Math.min(v, d[i - width + 1] + 4)
      }
      d[i] = v
    }
  }
  const out = new Float32Array(width * height)
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      let v = d[i]
      if (v) {
        if (x < width - 1) v = Math.min(v, d[i + 1] + 3)
        if (y < height - 1) {
          v = Math.min(v, d[i + width] + 3)
          if (x < width - 1) v = Math.min(v, d[i + width + 1] + 4)
          if (x > 0) v = Math.min(v, d[i + width - 1] + 4)
        }
        d[i] = v
      }
      out[i] = d[i] >= INF ? Infinity : d[i] / 3
    }
  }
  return out
}

/**
 * Fills `hole` pixels of an RGBA buffer in place (smooth base + borrowed texture).
 * Returns false only if the image has no known pixel (nothing is changed then).
 */
export function inpaintTexture(
  rgba: Uint8ClampedArray,
  hole: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  const n = width * height
  const known = new Uint8Array(n)
  let holeCount = 0
  for (let i = 0; i < n; i++) {
    known[i] = hole[i] ? 0 : 1
    if (hole[i]) holeCount++
  }
  if (holeCount === 0) return true

  // 1. Local mean + residual of the KNOWN pixels (before the base fill overwrites anything).
  const means: Float32Array[] = []
  const wideMeans: Float32Array[] = []
  const residual = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  const edgeness = new Float32Array(n)
  for (let ch = 0; ch < 3; ch++) {
    const channel = new Float32Array(n)
    for (let i = 0; i < n; i++) channel[i] = rgba[i * 4 + ch]
    const mean = maskedBoxMean(channel, known, width, height, BASE_RADIUS)
    means.push(mean)
    wideMeans.push(maskedBoxMean(channel, known, width, height, ENDPOINT_RADIUS))
    for (let i = 0; i < n; i++) residual[ch][i] = known[i] ? channel[i] - mean[i] : 0
    // Gradient of the local mean: large on real edges, tiny on grain/speckle texture.
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        const g = Math.abs(mean[i + 1] - mean[i - 1]) + Math.abs(mean[i + width] - mean[i - width])
        if (g > edgeness[i]) edgeness[i] = g
      }
    }
  }
  // Pixels usable as texture sources: known, and not on/next to a strong edge.
  const usable = new Uint8Array(n)
  for (let i = 0; i < n; i++) usable[i] = known[i] && edgeness[i] <= EDGE_GRADIENT ? 1 : 0

  // 2. Low frequency: smooth fill (pull-push everywhere, then span-weighted row/column
  //    interpolation wherever the hole has known pixels on its row or column).
  if (!pullPushFill(rgba, known, width, height)) return false
  directionalBase(rgba, known, wideMeans, width, height)

  // 3. Search radius from the hole size, and the texture amplitude of the surroundings.
  const distToHole = distanceToHole(known, width, height)
  const searchRadius = Math.min(256, Math.max(24, Math.round(Math.sqrt(holeCount) + 16)))

  // High percentile, not the median: speckled textures such as grass are mostly flat with sparse
  // strong specks.
  const samples: number[] = []
  const stride = Math.max(1, Math.floor(n / 40000))
  for (let i = 0; i < n; i += stride) {
    if (usable[i] && distToHole[i] <= searchRadius) {
      samples.push(
        Math.max(Math.abs(residual[0][i]), Math.abs(residual[1][i]), Math.abs(residual[2][i])),
      )
    }
  }
  if (samples.length < 16) return true
  samples.sort((a, b) => a - b)
  const limit = samples[Math.floor(samples.length * 0.995)]
  // Surroundings are flat/smooth (sky, wall): the smooth fill is already the right answer.
  if (limit < 4) return true

  // 4. High frequency: per-cell displacement candidates → first source with matching colour.
  const cellsX = Math.ceil(width / CELL)
  const cellsY = Math.ceil(height / CELL)
  const offsets = new Int32Array(cellsX * cellsY * CANDIDATES * 2)
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const cell = (cy * cellsX + cx) * CANDIDATES * 2
      for (let k = 0; k < CANDIDATES; k++) {
        const angle = hash(cx, cy, k * 2) * Math.PI * 2
        const radius = (0.3 + 0.7 * hash(cx, cy, k * 2 + 1)) * searchRadius
        offsets[cell + k * 2] = Math.round(Math.cos(angle) * radius)
        offsets[cell + k * 2 + 1] = Math.round(Math.sin(angle) * radius)
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!hole[i]) continue
      const cell = (Math.floor(y / CELL) * cellsX + Math.floor(x / CELL)) * CANDIDATES * 2
      const r = rgba[i * 4]
      const g = rgba[i * 4 + 1]
      const b = rgba[i * 4 + 2]

      for (let k = 0; k < CANDIDATES; k++) {
        const sx = x + offsets[cell + k * 2]
        const sy = y + offsets[cell + k * 2 + 1]
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue
        const si = sy * width + sx
        if (!usable[si]) continue
        const colorDistance =
          (Math.abs(means[0][si] - r) + Math.abs(means[1][si] - g) + Math.abs(means[2][si] - b)) / 3
        if (colorDistance > COLOR_TOLERANCE) continue
        for (let ch = 0; ch < 3; ch++) {
          const v = rgba[i * 4 + ch] + Math.max(-limit, Math.min(limit, residual[ch][si]))
          rgba[i * 4 + ch] = Math.max(0, Math.min(255, v))
        }
        break
      }
    }
  }
  return true
}
