/**
 * Fast Marching Method inpainting (A. Telea, "An Image Inpainting Technique Based on the Fast
 * Marching Method", 2004) — the algorithm behind OpenCV's INPAINT_TELEA.
 *
 * The hole is filled from its boundary inwards in order of distance T (solved with the
 * eikonal equation). Each newly reached pixel takes a weighted average of already-known
 * pixels within `radius`, weighted by direction (along the T gradient), distance and level-set
 * proximity. Excellent for thin regions (scratches, text strokes, wires); large holes come out
 * smeared, which is why the caller switches to PatchMatch for thick selections.
 */

const KNOWN = 0
const BAND = 1
const INSIDE = 2

class MinHeap {
  private idx: Int32Array
  private key: Float32Array
  size = 0

  constructor(capacity: number) {
    this.idx = new Int32Array(capacity)
    this.key = new Float32Array(capacity)
  }

  push(i: number, k: number) {
    if (this.size === this.idx.length) {
      const idx = new Int32Array(this.idx.length * 2)
      idx.set(this.idx)
      const key = new Float32Array(this.key.length * 2)
      key.set(this.key)
      this.idx = idx
      this.key = key
    }
    let n = this.size++
    while (n > 0) {
      const parent = (n - 1) >> 1
      if (this.key[parent] <= k) break
      this.idx[n] = this.idx[parent]
      this.key[n] = this.key[parent]
      n = parent
    }
    this.idx[n] = i
    this.key[n] = k
  }

  pop(): number {
    const top = this.idx[0]
    const lastIdx = this.idx[--this.size]
    const lastKey = this.key[this.size]
    let n = 0
    for (;;) {
      let child = 2 * n + 1
      if (child >= this.size) break
      if (child + 1 < this.size && this.key[child + 1] < this.key[child]) child++
      if (this.key[child] >= lastKey) break
      this.idx[n] = this.idx[child]
      this.key[n] = this.key[child]
      n = child
    }
    this.idx[n] = lastIdx
    this.key[n] = lastKey
    return top
  }
}

/**
 * Fills `hole` pixels of an RGBA buffer in place.
 * @param rgba  width*height*4 pixels; hole pixels' input values are ignored.
 * @param hole  width*height, non-zero = unknown.
 */
export function inpaintTelea(
  rgba: Uint8ClampedArray,
  hole: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  radius = 5,
) {
  const n = width * height
  const flag = new Uint8Array(n)
  const T = new Float32Array(n)
  const heap = new MinHeap(1024)
  const INF = 1e6

  for (let i = 0; i < n; i++) {
    if (hole[i]) {
      flag[i] = INSIDE
      T[i] = INF
    }
  }

  // Seed the narrow band with known pixels touching the hole.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (flag[i] !== KNOWN) continue
      if (
        (x > 0 && flag[i - 1] === INSIDE) ||
        (x < width - 1 && flag[i + 1] === INSIDE) ||
        (y > 0 && flag[i - width] === INSIDE) ||
        (y < height - 1 && flag[i + width] === INSIDE)
      ) {
        flag[i] = BAND
        heap.push(i, 0)
      }
    }
  }

  const solve = (i1: number, i2: number): number => {
    const k1 = i1 >= 0 && flag[i1] !== INSIDE
    const k2 = i2 >= 0 && flag[i2] !== INSIDE
    if (k1 && k2) {
      const t1 = T[i1]
      const t2 = T[i2]
      const d = 2 - (t1 - t2) * (t1 - t2)
      if (d > 0) {
        const r = Math.sqrt(d)
        let s = (t1 + t2 - r) / 2
        if (s >= t1 && s >= t2) return s
        s += r
        if (s >= t1 && s >= t2) return s
      }
      return 1 + Math.min(t1, t2)
    }
    if (k1) return 1 + T[i1]
    if (k2) return 1 + T[i2]
    return INF
  }

  const r2 = radius * radius

  const inpaintPixel = (x: number, y: number) => {
    const i = y * width + x
    // Gradient of T at the pixel (central differences where neighbours are not inside).
    let gx = 0
    let gy = 0
    const l = x > 0 && flag[i - 1] !== INSIDE
    const r = x < width - 1 && flag[i + 1] !== INSIDE
    const u = y > 0 && flag[i - width] !== INSIDE
    const d = y < height - 1 && flag[i + width] !== INSIDE
    if (l && r) gx = (T[i + 1] - T[i - 1]) / 2
    else if (r) gx = T[i + 1] - T[i]
    else if (l) gx = T[i] - T[i - 1]
    if (u && d) gy = (T[i + width] - T[i - width]) / 2
    else if (d) gy = T[i + width] - T[i]
    else if (u) gy = T[i] - T[i - width]

    let sr = 0
    let sg = 0
    let sb = 0
    let sa = 0
    let sw = 0
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height - 1, y + radius)
    const x0 = Math.max(0, x - radius)
    const x1 = Math.min(width - 1, x + radius)
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const k = yy * width + xx
        if (flag[k] === INSIDE) continue
        const rx = x - xx
        const ry = y - yy
        const len2 = rx * rx + ry * ry
        if (len2 > r2 || len2 === 0) continue
        const len = Math.sqrt(len2)
        const dst = 1 / (len2 * len)
        const lev = 1 / (1 + Math.abs(T[k] - T[i]))
        let dir = rx * gx + ry * gy
        if (Math.abs(dir) <= 0.01) dir = 0.000001
        const w = Math.abs(dst * lev * dir)
        const p = k * 4
        sr += w * rgba[p]
        sg += w * rgba[p + 1]
        sb += w * rgba[p + 2]
        sa += w * rgba[p + 3]
        sw += w
      }
    }
    if (sw > 0) {
      const p = i * 4
      rgba[p] = sr / sw
      rgba[p + 1] = sg / sw
      rgba[p + 2] = sb / sw
      rgba[p + 3] = sa / sw
    }
  }

  while (heap.size > 0) {
    const i = heap.pop()
    flag[i] = KNOWN
    const x = i % width
    const y = (i - x) / width

    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ]
    for (const j of neighbors) {
      if (j < 0 || flag[j] !== INSIDE) continue
      const jx = j % width
      const jy = (j - jx) / width
      const left = jx > 0 ? j - 1 : -1
      const right = jx < width - 1 ? j + 1 : -1
      const up = jy > 0 ? j - width : -1
      const down = jy < height - 1 ? j + width : -1
      T[j] = Math.min(solve(up, left), solve(down, left), solve(up, right), solve(down, right))
      flag[j] = BAND
      inpaintPixel(jx, jy)
      heap.push(j, T[j])
    }
  }
}

/**
 * Distance (pixels, chamfer 3-4 approximation) from every hole pixel to the nearest known pixel;
 * 0 for known pixels, Infinity when the image has no known pixel at all.
 */
export function distanceToKnown(
  hole: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const INF = 1 << 28
  const d = new Int32Array(width * height)
  for (let i = 0; i < d.length; i++) d[i] = hole[i] ? INF : 0
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
      if (!d[i]) continue
      let v = d[i]
      if (x < width - 1) v = Math.min(v, d[i + 1] + 3)
      if (y < height - 1) {
        v = Math.min(v, d[i + width] + 3)
        if (x < width - 1) v = Math.min(v, d[i + width + 1] + 4)
        if (x > 0) v = Math.min(v, d[i + width - 1] + 4)
      }
      d[i] = v
      out[i] = v >= INF ? Infinity : v / 3
    }
  }
  return out
}

/** Largest distance from any hole pixel to known pixels (how "thick" the hole is). */
export function holeThickness(
  hole: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const d = distanceToKnown(hole, width, height)
  let max = 0
  for (let i = 0; i < d.length; i++) if (d[i] > max) max = d[i]
  return max
}
