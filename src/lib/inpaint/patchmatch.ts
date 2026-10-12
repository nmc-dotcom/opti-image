import { distanceToKnown, holeThickness, inpaintTelea } from './telea'

/**
 * Exemplar-based hole filling: multi-scale PatchMatch (Barnes et al. 2009) with EM-style patch
 * voting (Wexler et al. 2007) — the family of methods behind "content-aware fill".
 *
 * Unlike diffusion (Telea), it copies real texture from the surroundings, so grass, sand,
 * walls, foliage etc. stay textured instead of smearing. Everything is pure TypedArray math so
 * it runs unchanged inside a Web Worker.
 */

const PATCH_RADIUS = 3
const PM_ITERATIONS = 4
const MIN_LEVEL_SIZE = 40
/**
 * Stop coarsening once the hole is only this thick (px). Going coarser makes the conservatively
 * downsampled hole swallow thin bands of real context (e.g. a white panel edge), and the wrong
 * colour picked there gets locked in by the EM iterations at every finer level.
 */
const MIN_HOLE_THICKNESS = PATCH_RADIUS * 2
/** Color similarity σ (0-255 scale) for voting weights. */
const VOTE_SIGMA = 28
/**
 * Boundary confidence base (Wexler et al.): a patch centered d pixels deep inside the hole votes
 * with weight γ^-d, so trustworthy colors next to the known boundary propagate inward instead of
 * the hole's own (initially guessed) interior reinforcing itself.
 */
const CONFIDENCE_GAMMA = 1.3

interface Level {
  width: number
  height: number
  /** RGB, 3 bytes per pixel. */
  rgb: Uint8ClampedArray
  /** 1 = hole. */
  hole: Uint8Array
}

function confidenceMap(level: Level): Float32Array {
  const dist = distanceToKnown(level.hole, level.width, level.height)
  const conf = new Float32Array(dist.length)
  for (let i = 0; i < dist.length; i++) {
    conf[i] = Number.isFinite(dist[i]) ? Math.pow(CONFIDENCE_GAMMA, -dist[i]) : 1e-6
  }
  return conf
}

/**
 * How a 2×2 block becomes a coarse hole pixel:
 * - `any`: if any child is a hole (conservative). Keeps coarse levels tidy, which is what lets
 *   textures such as grass come out textured — but it erodes thin bands of real context.
 * - `all`: only if every child is a hole. Preserves thin context bands (e.g. a panel edge
 *   between the hole and the sky) at the cost of smoother fills on busy textures.
 */
export type HoleDownsampleRule = 'any' | 'all'

function downsample(level: Level, rule: HoleDownsampleRule): Level {
  const width = Math.max(1, Math.floor(level.width / 2))
  const height = Math.max(1, Math.floor(level.height / 2))
  const rgb = new Uint8ClampedArray(width * height * 3)
  const hole = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let count = 0
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(level.width - 1, x * 2 + dx)
          const sy = Math.min(level.height - 1, y * 2 + dy)
          const si = sy * level.width + sx
          if (level.hole[si]) continue
          r += level.rgb[si * 3]
          g += level.rgb[si * 3 + 1]
          b += level.rgb[si * 3 + 2]
          count++
        }
      }
      const i = y * width + x
      // Colors always come from known children only, so no hole colors leak upward.
      hole[i] = (rule === 'any' ? count < 4 : count === 0) ? 1 : 0
      if (count > 0) {
        rgb[i * 3] = r / count
        rgb[i * 3 + 1] = g / count
        rgb[i * 3 + 2] = b / count
      }
    }
  }
  return { width, height, rgb, hole }
}

/** Patch-center validity: the whole patch lies inside the image and contains no hole pixels. */
function computeValidSources(level: Level): Int32Array {
  const { width, height, hole } = level
  const R = PATCH_RADIUS
  const valid: number[] = []
  // Prefix sums of hole pixels for O(1) patch tests.
  const sum = new Int32Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += hole[y * width + x]
      sum[(y + 1) * (width + 1) + x + 1] = sum[y * (width + 1) + x + 1] + row
    }
  }
  for (let y = R; y < height - R; y++) {
    for (let x = R; x < width - R; x++) {
      const x0 = x - R
      const y0 = y - R
      const x1 = x + R + 1
      const y1 = y + R + 1
      const count =
        sum[y1 * (width + 1) + x1] -
        sum[y0 * (width + 1) + x1] -
        sum[y1 * (width + 1) + x0] +
        sum[y0 * (width + 1) + x0]
      if (count === 0) valid.push(y * width + x)
    }
  }
  return Int32Array.from(valid)
}

/** Target patch centers: every pixel whose patch overlaps the hole. */
function computeTargets(level: Level): Int32Array {
  const { width, height, hole } = level
  const R = PATCH_RADIUS
  const mark = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!hole[y * width + x]) continue
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx
          if (xx >= 0 && xx < width) mark[yy * width + xx] = 1
        }
      }
    }
  }
  const out: number[] = []
  for (let i = 0; i < mark.length; i++) if (mark[i]) out.push(i)
  return Int32Array.from(out)
}

class Random {
  private s: number
  constructor(seed = 1234567) {
    this.s = seed
  }
  next() {
    // xorshift32
    let x = this.s
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.s = x >>> 0
    return this.s / 4294967296
  }
}

/** Sum of squared RGB differences between patches centered at t and s, with early exit. */
function patchDistance(level: Level, t: number, s: number, cutoff: number): number {
  const { width, height, rgb } = level
  const R = PATCH_RADIUS
  const tx = t % width
  const ty = (t - tx) / width
  const sx = s % width
  const sy = (s - sx) / width
  let dist = 0
  for (let dy = -R; dy <= R; dy++) {
    const tyy = ty + dy
    if (tyy < 0 || tyy >= height) continue
    const trow = tyy * width
    const srow = (sy + dy) * width
    for (let dx = -R; dx <= R; dx++) {
      const txx = tx + dx
      if (txx < 0 || txx >= width) continue
      const a = (trow + txx) * 3
      const b = (srow + sx + dx) * 3
      const dr = rgb[a] - rgb[b]
      const dg = rgb[a + 1] - rgb[b + 1]
      const db = rgb[a + 2] - rgb[b + 2]
      dist += dr * dr + dg * dg + db * db
    }
    if (dist >= cutoff) return dist
  }
  return dist
}

interface Nnf {
  /** Source patch center (pixel index) per target, parallel to `targets`. */
  match: Int32Array
  dist: Float64Array
}

function isValidSource(level: Level, validMask: Uint8Array, s: number) {
  return s >= 0 && s < level.width * level.height && validMask[s] === 1
}

function patchMatch(
  level: Level,
  targets: Int32Array,
  targetSlot: Int32Array,
  validMask: Uint8Array,
  nnf: Nnf,
  rng: Random,
) {
  const { width, height } = level
  const n = targets.length
  for (let i = 0; i < n; i++) nnf.dist[i] = patchDistance(level, targets[i], nnf.match[i], Infinity)

  const tryCandidate = (i: number, s: number) => {
    if (!isValidSource(level, validMask, s) || s === nnf.match[i]) return
    const d = patchDistance(level, targets[i], s, nnf.dist[i])
    if (d < nnf.dist[i]) {
      nnf.dist[i] = d
      nnf.match[i] = s
    }
  }

  const maxRadius = Math.max(width, height)
  for (let iter = 0; iter < PM_ITERATIONS; iter++) {
    const forward = iter % 2 === 0
    const step = forward ? 1 : -1
    for (let k = 0; k < n; k++) {
      const i = forward ? k : n - 1 - k
      const t = targets[i]
      const tx = t % width
      const ty = (t - tx) / width

      // Propagation: adopt the (shifted) match of the previous neighbour in scan order.
      const nx = tx - step
      if (nx >= 0 && nx < width) {
        const ni = targetSlot[t - step]
        if (ni >= 0) tryCandidate(i, nnf.match[ni] + step)
      }
      const ny = ty - step
      if (ny >= 0 && ny < height) {
        const ni = targetSlot[t - step * width]
        if (ni >= 0) tryCandidate(i, nnf.match[ni] + step * width)
      }

      // Random search around the current best with exponentially shrinking radius.
      const best = nnf.match[i]
      const bx = best % width
      const by = (best - bx) / width
      for (let r = maxRadius; r >= 1; r >>= 1) {
        const cx = Math.round(bx + (rng.next() * 2 - 1) * r)
        const cy = Math.round(by + (rng.next() * 2 - 1) * r)
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue
        tryCandidate(i, cy * width + cx)
      }
    }
  }
}

/** EM step: rebuild hole pixels as a similarity- and confidence-weighted patch vote. */
function vote(level: Level, targets: Int32Array, nnf: Nnf, confidence: Float32Array) {
  const { width, height, rgb, hole } = level
  const R = PATCH_RADIUS
  const patchArea = (2 * R + 1) * (2 * R + 1)
  const acc = new Float64Array(width * height * 4)
  const denom = 2 * VOTE_SIGMA * VOTE_SIGMA * 3

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    const s = nnf.match[i]
    const w = (Math.exp(-nnf.dist[i] / patchArea / denom) + 1e-8) * confidence[t]
    const tx = t % width
    const ty = (t - tx) / width
    const sx = s % width
    const sy = (s - sx) / width
    for (let dy = -R; dy <= R; dy++) {
      const yy = ty + dy
      if (yy < 0 || yy >= height) continue
      for (let dx = -R; dx <= R; dx++) {
        const xx = tx + dx
        if (xx < 0 || xx >= width) continue
        const p = yy * width + xx
        if (!hole[p]) continue
        const q = ((sy + dy) * width + sx + dx) * 3
        acc[p * 4] += w * rgb[q]
        acc[p * 4 + 1] += w * rgb[q + 1]
        acc[p * 4 + 2] += w * rgb[q + 2]
        acc[p * 4 + 3] += w
      }
    }
  }

  for (let p = 0; p < width * height; p++) {
    if (!hole[p] || acc[p * 4 + 3] === 0) continue
    const w = acc[p * 4 + 3]
    rgb[p * 3] = acc[p * 4] / w
    rgb[p * 3 + 1] = acc[p * 4 + 1] / w
    rgb[p * 3 + 2] = acc[p * 4 + 2] / w
  }
}

function randomValidSource(sources: Int32Array, rng: Random) {
  return sources[Math.floor(rng.next() * sources.length)]
}

/**
 * Fills `hole` pixels of an RGBA buffer in place. Returns false (leaving the buffer untouched)
 * when there is not enough intact surrounding texture to sample from; the caller falls back
 * to Telea in that case.
 */
export function inpaintPatchMatch(
  rgba: Uint8ClampedArray,
  hole: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  onProgress?: (fraction: number) => void,
  rule: HoleDownsampleRule = 'any',
): boolean {
  const rgb = new Uint8ClampedArray(width * height * 3)
  const holeBin = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = rgba[i * 4]
    rgb[i * 3 + 1] = rgba[i * 4 + 1]
    rgb[i * 3 + 2] = rgba[i * 4 + 2]
    holeBin[i] = hole[i] ? 1 : 0
  }

  const pyramid: Level[] = [{ width, height, rgb, hole: holeBin }]
  for (;;) {
    const top = pyramid[pyramid.length - 1]
    if (Math.min(top.width, top.height) / 2 < MIN_LEVEL_SIZE) break
    if (holeThickness(top.hole, top.width, top.height) / 2 < MIN_HOLE_THICKNESS) break
    pyramid.push(downsample(top, rule))
  }

  const rng = new Random()
  let prevNnf: { level: Level; targets: Int32Array; match: Int32Array } | null = null
  const totalLevels = pyramid.length

  for (let li = pyramid.length - 1; li >= 0; li--) {
    const level = pyramid[li]
    const sources = computeValidSources(level)
    if (sources.length === 0) {
      if (li === 0) return false
      // Hole swallows this whole (coarse) level; restart from a fresh fill one level finer.
      prevNnf = null
      continue
    }
    const validMask = new Uint8Array(level.width * level.height)
    for (const s of sources) validMask[s] = 1

    const targets = computeTargets(level)
    const confidence = confidenceMap(level)
    const targetSlot = new Int32Array(level.width * level.height).fill(-1)
    for (let i = 0; i < targets.length; i++) targetSlot[targets[i]] = i
    const nnf: Nnf = {
      match: new Int32Array(targets.length),
      dist: new Float64Array(targets.length),
    }

    if (prevNnf) {
      // Upsample the coarser NNF: a target maps to 2× its parent's match plus its sub-offset.
      const pw = prevNnf.level.width
      const prevSlot = new Int32Array(pw * prevNnf.level.height).fill(-1)
      for (let i = 0; i < prevNnf.targets.length; i++) prevSlot[prevNnf.targets[i]] = i
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i]
        const tx = t % level.width
        const ty = (t - tx) / level.width
        const px = Math.min(pw - 1, tx >> 1)
        const py = Math.min(prevNnf.level.height - 1, ty >> 1)
        const pi = prevSlot[py * pw + px]
        let candidate = -1
        if (pi >= 0) {
          const m = prevNnf.match[pi]
          const mx = m % pw
          const my = (m - mx) / pw
          const cx = mx * 2 + (tx & 1)
          const cy = my * 2 + (ty & 1)
          if (cx < level.width && cy < level.height) candidate = cy * level.width + cx
        }
        nnf.match[i] = isValidSource(level, validMask, candidate)
          ? candidate
          : randomValidSource(sources, rng)
      }
      // Initialize this level's hole by voting with the upsampled field.
      vote(level, targets, nnf, confidence)
    } else {
      // Coarsest level: start from a diffusion fill so the first distances are meaningful.
      const coarse = new Uint8ClampedArray(level.width * level.height * 4)
      for (let i = 0; i < level.width * level.height; i++) {
        coarse[i * 4] = level.rgb[i * 3]
        coarse[i * 4 + 1] = level.rgb[i * 3 + 1]
        coarse[i * 4 + 2] = level.rgb[i * 3 + 2]
        coarse[i * 4 + 3] = 255
      }
      inpaintTelea(coarse, level.hole, level.width, level.height, 5)
      for (let i = 0; i < level.width * level.height; i++) {
        if (!level.hole[i]) continue
        level.rgb[i * 3] = coarse[i * 4]
        level.rgb[i * 3 + 1] = coarse[i * 4 + 1]
        level.rgb[i * 3 + 2] = coarse[i * 4 + 2]
      }
      for (let i = 0; i < targets.length; i++) nnf.match[i] = randomValidSource(sources, rng)
    }

    // More EM iterations where it's cheap (coarse), fewer at full resolution.
    const emIterations = li === 0 ? 2 : li === 1 ? 3 : 5
    for (let em = 0; em < emIterations; em++) {
      patchMatch(level, targets, targetSlot, validMask, nnf, rng)
      vote(level, targets, nnf, confidence)
    }

    prevNnf = { level, targets, match: nnf.match }
    onProgress?.((totalLevels - li) / totalLevels)
  }

  for (let i = 0; i < width * height; i++) {
    if (!holeBin[i]) continue
    rgba[i * 4] = rgb[i * 3]
    rgba[i * 4 + 1] = rgb[i * 3 + 1]
    rgba[i * 4 + 2] = rgb[i * 3 + 2]
    rgba[i * 4 + 3] = 255
  }
  return true
}

/**
 * Seam quality of a fill: mean color difference across the hole boundary (filled pixel vs. its
 * known 4-neighbour), divided by the natural difference between neighbouring known pixels just
 * outside the hole. ≈1 means the boundary is as smooth as the surrounding texture itself; a fill
 * that pulled in the wrong surroundings (sky inside a white panel) scores far higher.
 */
export function seamScore(
  rgba: Uint8ClampedArray,
  hole: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const diff = (a: number, b: number) =>
    (Math.abs(rgba[a * 4] - rgba[b * 4]) +
      Math.abs(rgba[a * 4 + 1] - rgba[b * 4 + 1]) +
      Math.abs(rgba[a * 4 + 2] - rgba[b * 4 + 2])) /
    3
  let seam = 0
  let seamCount = 0
  let natural = 0
  let naturalCount = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ]
      if (hole[i]) {
        for (const j of neighbors) {
          if (j >= 0 && !hole[j]) {
            seam += diff(i, j)
            seamCount++
          }
        }
        continue
      }
      // Known pixel touching the hole: measure the texture's own local variation along the ring.
      if (!neighbors.some((j) => j >= 0 && hole[j])) continue
      for (const j of neighbors) {
        if (j >= 0 && !hole[j]) {
          natural += diff(i, j)
          naturalCount++
        }
      }
    }
  }
  if (seamCount === 0) return 0
  return seam / seamCount / (natural / Math.max(1, naturalCount) + 2)
}
