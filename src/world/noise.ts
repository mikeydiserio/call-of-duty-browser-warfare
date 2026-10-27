/**
 * Tileable noise "bank". We pre-bake a handful of periodic noise fields once and sample them
 * (bilinear, wrapped) with integer frequency multipliers, which keeps every generated texture
 * seamlessly tileable while making the per-pixel texture shaders cheap.
 */
import { seeded } from '../core/math'

const N = 512

export class Grid {
  readonly data: Float32Array
  constructor(readonly n = N) {
    this.data = new Float32Array(n * n)
  }
  /** Bilinear, wrapped. u/v in "tile" units (period 1). */
  s(u: number, v: number): number {
    const n = this.n
    const fu = (u - Math.floor(u)) * n
    const fv = (v - Math.floor(v)) * n
    const x0 = fu | 0
    const y0 = fv | 0
    const tx = fu - x0
    const ty = fv - y0
    const x1 = (x0 + 1) & (n - 1)
    const y1 = (y0 + 1) & (n - 1)
    const d = this.data
    const a = d[y0 * n + x0]!
    const b = d[y0 * n + x1]!
    const c = d[y1 * n + x0]!
    const e = d[y1 * n + x1]!
    return a + (b - a) * tx + (c - a + (a - b - c + e) * tx) * ty
  }
  /** Nearest texel. */
  at(u: number, v: number): number {
    const n = this.n
    const x = ((u - Math.floor(u)) * n) | 0
    const y = ((v - Math.floor(v)) * n) | 0
    return this.data[y * n + x]!
  }
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/** Periodic fractal value noise normalised to 0..1. */
export function makeFbm(seed: number, baseFreq: number, octaves: number, gain = 0.5, n = N): Grid {
  const g = new Grid(n)
  const rng = seeded(seed)
  let amp = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const f = baseFreq * 2 ** o
    const lat = new Float32Array(f * f)
    for (let i = 0; i < lat.length; i++) lat[i] = rng()
    for (let y = 0; y < n; y++) {
      const fy = (y / n) * f
      const y0 = Math.floor(fy)
      const ty = fade(fy - y0)
      const y1 = (y0 + 1) % f
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * f
        const x0 = Math.floor(fx)
        const tx = fade(fx - x0)
        const x1 = (x0 + 1) % f
        const a = lat[y0 * f + x0]!
        const b = lat[y0 * f + x1]!
        const c = lat[y1 * f + x0]!
        const d = lat[y1 * f + x1]!
        g.data[y * n + x] += amp * (a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty)
      }
    }
    total += amp
    amp *= gain
  }
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i]! / total
    g.data[i] = v
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const k = 1 / (hi - lo)
  for (let i = 0; i < g.data.length; i++) g.data[i] = (g.data[i]! - lo) * k
  return g
}

export function makeWhite(seed: number, n = N): Grid {
  const g = new Grid(n)
  const rng = seeded(seed)
  for (let i = 0; i < g.data.length; i++) g.data[i] = rng()
  return g
}

/** Periodic Worley F1 distance (0 at feature point, ~1 at cell border) plus a per-cell random id. */
export function makeWorley(seed: number, cells: number, n = N): { f1: Grid; id: Grid } {
  const rng = seeded(seed)
  const px = new Float32Array(cells * cells)
  const py = new Float32Array(cells * cells)
  const pid = new Float32Array(cells * cells)
  for (let i = 0; i < cells * cells; i++) {
    px[i] = rng()
    py[i] = rng()
    pid[i] = rng()
  }
  const f1 = new Grid(n)
  const id = new Grid(n)
  for (let y = 0; y < n; y++) {
    const fy = (y / n) * cells
    const cy = Math.floor(fy)
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells
      const cx = Math.floor(fx)
      let best = 9
      let bid = 0
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const wx = (((cx + i) % cells) + cells) % cells
          const wy = (((cy + j) % cells) + cells) % cells
          const k = wy * cells + wx
          const dx = cx + i + px[k]! - fx
          const dy = cy + j + py[k]! - fy
          const d = dx * dx + dy * dy
          if (d < best) {
            best = d
            bid = pid[k]!
          }
        }
      }
      f1.data[y * n + x] = Math.min(1, Math.sqrt(best))
      id.data[y * n + x] = bid
    }
  }
  return { f1, id }
}

export interface NoiseBank {
  /** Low-frequency fbm (features ~1/4 tile). */
  A: Grid
  /** Mid/high-frequency fbm. */
  B: Grid
  /** White noise. */
  W: Grid
  /** Worley distance, 28 cells. */
  C: Grid
  /** Worley cell id. */
  CI: Grid
  /** Worley distance, 9 cells (big blobs). */
  D: Grid
}

let bank: NoiseBank | null = null
export function getBank(): NoiseBank {
  if (bank) return bank
  const wl = makeWorley(77, 28)
  const wl2 = makeWorley(91, 9)
  bank = {
    A: makeFbm(11, 4, 5),
    B: makeFbm(23, 8, 4, 0.55),
    W: makeWhite(5),
    C: wl.f1,
    CI: wl.id,
    D: wl2.f1,
  }
  return bank
}
