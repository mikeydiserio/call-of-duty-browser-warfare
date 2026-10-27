/**
 * Procedural canvas textures for the viewmodel: parkerized gunmetal, polymer,
 * worn wood, desert multicam, fabric weave, skin, muzzle flashes, smoke...
 * Everything is generated once at load; nothing here runs per frame.
 */
import { CanvasTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import { seeded } from '../core/math'

// ─── Tileable value noise ───────────────────────────────────────────────────

class Noise {
  private g = new Float32Array(256 * 256)
  constructor(seed: number) {
    const r = seeded(seed)
    for (let i = 0; i < this.g.length; i++) this.g[i] = r()
  }
  /** Value noise with integer period `p` (so textures tile seamlessly). */
  at(x: number, y: number, p: number): number {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = x - xi
    const fy = y - yi
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const x0 = ((xi % p) + p) % p
    const y0 = ((yi % p) + p) % p
    const x1 = (x0 + 1) % p
    const y1 = (y0 + 1) % p
    const g = this.g
    const a = g[(y0 & 255) * 256 + (x0 & 255)]!
    const b = g[(y0 & 255) * 256 + (x1 & 255)]!
    const c = g[(y1 & 255) * 256 + (x0 & 255)]!
    const d = g[(y1 & 255) * 256 + (x1 & 255)]!
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }
  /** fBm in [0,1]. u,v in [0,1) tile coords; f = base cycles across the tile. */
  fbm(u: number, v: number, f: number, oct = 4, gain = 0.5): number {
    let amp = 1
    let sum = 0
    let norm = 0
    let freq = f
    for (let o = 0; o < oct; o++) {
      sum += this.at(u * freq, v * freq, freq) * amp
      norm += amp
      amp *= gain
      freq *= 2
    }
    return sum / norm
  }
}

const N1 = new Noise(1337)
const N2 = new Noise(4242)
const N3 = new Noise(99)

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  return [c, ctx, ctx.createImageData(size, size)]
}

function toTexture(c: HTMLCanvasElement, srgb: boolean): Texture {
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  t.anisotropy = 8
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  return t
}

function heightToNormal(h: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const [c, ctx, img] = makeCanvas(size)
  const d = img.data
  const m = size - 1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1) & m)]!
      const r = h[y * size + ((x + 1) & m)]!
      const u = h[((y - 1) & m) * size + x]!
      const dn = h[((y + 1) & m) * size + x]!
      let nx = (l - r) * strength
      let ny = (u - dn) * strength
      const nz = 1
      const inv = 1 / Math.hypot(nx, ny, nz)
      nx *= inv
      ny *= inv
      const i = (y * size + x) * 4
      d[i] = (nx * 0.5 + 0.5) * 255
      d[i + 1] = (ny * 0.5 + 0.5) * 255
      d[i + 2] = nz * inv * 0.5 * 255 + 127.5
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

function grayCanvas(v: Float32Array, size: number): HTMLCanvasElement {
  const [c, ctx, img] = makeCanvas(size)
  const d = img.data
  for (let i = 0; i < v.length; i++) {
    const g = Math.max(0, Math.min(255, v[i]! * 255))
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g
    d[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

export interface PBRSet {
  map: Texture
  rough: Texture
  normal: Texture
}

const hex = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const

// ─── Parkerized gunmetal with edge wear ────────────────────────────────────

export function makeGunmetal(tintBase = 0x2a2c2e, wearColor = 0x8d8f91, size = 512): PBRSet {
  const [cc, cctx, cimg] = makeCanvas(size)
  const rough = new Float32Array(size * size)
  const height = new Float32Array(size * size)
  const base = hex(tintBase)
  const wear = hex(wearColor)
  const rnd = seeded(7)
  const cd = cimg.data
  // Scratch field: draw random thin lines into a wear buffer.
  const scratch = new Float32Array(size * size)
  for (let i = 0; i < 140; i++) {
    let x = rnd() * size
    let y = rnd() * size
    const ang = rnd() * Math.PI
    const len = 6 + rnd() * 60
    const a = 0.15 + rnd() * 0.45
    const dx = Math.cos(ang)
    const dy = Math.sin(ang)
    for (let s = 0; s < len; s++) {
      const ix = ((Math.floor(x) % size) + size) % size
      const iy = ((Math.floor(y) % size) + size) % size
      scratch[iy * size + ix] = Math.max(scratch[iy * size + ix]!, a)
      x += dx
      y += dy
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const i = y * size + x
      const big = N1.fbm(u, v, 3, 4)
      const fine = N2.fbm(u, v, 64, 2)
      const speck = N3.at(u * 200, v * 200, 200) > 0.93 ? 1 : 0
      // Blotchy wear zones, concentrated where big noise is high.
      const wz = Math.max(0, (big - 0.55) * 3)
      const w = Math.min(1, wz * (0.35 + scratch[i]! * 0.8) + scratch[i]! * 0.3 + speck * 0.12)
      const shade = 0.82 + fine * 0.3 + (big - 0.5) * 0.35
      for (let k = 0; k < 3; k++) {
        const b = base[k]! * shade
        cd[i * 4 + k] = b + (wear[k]! - b) * w
      }
      cd[i * 4 + 3] = 255
      rough[i] = 0.62 + (fine - 0.5) * 0.25 - w * 0.4 + (big - 0.5) * 0.15
      height[i] = fine * 0.5 + (1 - scratch[i]!) * 0.35 + speck * 0.1
    }
  }
  cctx.putImageData(cimg, 0, 0)
  return {
    map: toTexture(cc, true),
    rough: toTexture(grayCanvas(rough, size), false),
    normal: toTexture(heightToNormal(height, size, 2.4), false),
  }
}

// ─── Polymer (stippled) ─────────────────────────────────────────────────────

export function makePolymer(size = 512): PBRSet {
  const [cc, cctx, cimg] = makeCanvas(size)
  const rough = new Float32Array(size * size)
  const height = new Float32Array(size * size)
  const cd = cimg.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const i = y * size + x
      const big = N1.fbm(u, v, 4, 3)
      const stip = N2.at(u * 180, v * 180, 180)
      const stip2 = N3.at(u * 90 + 0.5, v * 90 + 0.5, 90)
      const sh = 0.78 + big * 0.35 + (stip - 0.5) * 0.14
      const g = 255 * sh
      cd[i * 4] = g
      cd[i * 4 + 1] = g
      cd[i * 4 + 2] = g
      cd[i * 4 + 3] = 255
      rough[i] = 0.55 + stip * 0.28 + (big - 0.5) * 0.2
      height[i] = stip * 0.6 + stip2 * 0.4
    }
  }
  cctx.putImageData(cimg, 0, 0)
  return {
    map: toTexture(cc, true),
    rough: toTexture(grayCanvas(rough, size), false),
    normal: toTexture(heightToNormal(height, size, 1.6), false),
  }
}

// ─── Wood ───────────────────────────────────────────────────────────────────

export function makeWood(size = 512): PBRSet {
  const [cc, cctx, cimg] = makeCanvas(size)
  const rough = new Float32Array(size * size)
  const height = new Float32Array(size * size)
  const cd = cimg.data
  const dark = hex(0x4a2412)
  const mid = hex(0x8a4a22)
  const light = hex(0xb06a34)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const i = y * size + x
      // Grain runs along V (stretched noise in V).
      const warp = N1.fbm(u, v, 2, 3) * 0.7
      const g1 = N2.at((u + warp) * 14, v * 1.5, 14)
      const g2 = N3.at((u + warp * 0.5) * 60, v * 3, 60)
      const rings = 0.5 + 0.5 * Math.sin((u + warp) * 90 + g1 * 6)
      const t = Math.min(1, Math.max(0, rings * 0.55 + g1 * 0.35 + g2 * 0.12))
      const kA = t < 0.5 ? t * 2 : (t - 0.5) * 2
      const c0 = t < 0.5 ? dark : mid
      const c1 = t < 0.5 ? mid : light
      for (let k = 0; k < 3; k++) cd[i * 4 + k] = c0[k]! + (c1[k]! - c0[k]!) * kA
      // Dirt and wear
      const dirt = N1.fbm(u + 0.3, v + 0.7, 5, 3)
      const dk = 0.78 + dirt * 0.3
      cd[i * 4] *= dk
      cd[i * 4 + 1] *= dk
      cd[i * 4 + 2] *= dk
      cd[i * 4 + 3] = 255
      rough[i] = 0.55 + g2 * 0.25
      height[i] = g2 * 0.5 + rings * 0.3
    }
  }
  cctx.putImageData(cimg, 0, 0)
  return {
    map: toTexture(cc, true),
    rough: toTexture(grayCanvas(rough, size), false),
    normal: toTexture(heightToNormal(height, size, 1.4), false),
  }
}

// ─── Desert multicam (sleeves) ─────────────────────────────────────────────

export function makeCamo(size = 512): PBRSet {
  const [cc, cctx, cimg] = makeCanvas(size)
  const height = new Float32Array(size * size)
  const cd = cimg.data
  const tan = hex(0xbfa77d)
  const light = hex(0xd6c49e)
  const olive = hex(0x8b8458)
  const brown = hex(0x6c5236)
  const dark = hex(0x4a4630)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const i = y * size + x
      const a = N1.fbm(u, v, 3, 4)
      const b = N2.fbm(u + 0.37, v + 0.11, 4, 4)
      const c = N3.fbm(u + 0.71, v + 0.53, 5, 3)
      let col = tan
      if (a > 0.58) col = olive
      if (b > 0.62) col = brown
      if (c > 0.66 && a < 0.5) col = light
      if (a > 0.66 && b > 0.5) col = dark
      // Weave
      const wv = (Math.sin(x * 2.4) * Math.sin(y * 2.4) + 1) * 0.5
      const sh = 0.88 + wv * 0.12 + (N2.at(u * 128, v * 128, 128) - 0.5) * 0.12
      cd[i * 4] = col[0] * sh
      cd[i * 4 + 1] = col[1] * sh
      cd[i * 4 + 2] = col[2] * sh
      cd[i * 4 + 3] = 255
      height[i] = wv * 0.6 + N2.at(u * 128, v * 128, 128) * 0.4
    }
  }
  cctx.putImageData(cimg, 0, 0)
  const rough = new Float32Array(size * size).fill(0.92)
  return {
    map: toTexture(cc, true),
    rough: toTexture(grayCanvas(rough, size), false),
    normal: toTexture(heightToNormal(height, size, 1.1), false),
  }
}

// ─── Glove fabric / leather ─────────────────────────────────────────────────

export function makeGlove(size = 256): PBRSet {
  const [cc, cctx, cimg] = makeCanvas(size)
  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const cd = cimg.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const i = y * size + x
      const wv = (Math.sin(x * 1.57) * Math.sin(y * 1.57) + 1) * 0.5
      const n = N1.fbm(u, v, 6, 3)
      const sh = 0.62 + n * 0.45 + wv * 0.08
      const g = 255 * sh
      cd[i * 4] = g
      cd[i * 4 + 1] = g
      cd[i * 4 + 2] = g
      cd[i * 4 + 3] = 255
      height[i] = wv * 0.25 + n * 0.5
      rough[i] = 0.72 + n * 0.2
    }
  }
  cctx.putImageData(cimg, 0, 0)
  return {
    map: toTexture(cc, true),
    rough: toTexture(grayCanvas(rough, size), false),
    normal: toTexture(heightToNormal(height, size, 1.5), false),
  }
}

export function makeSkin(size = 128): PBRSet {
  const [cc, cctx, cimg] = makeCanvas(size)
  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const cd = cimg.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const i = y * size + x
      const n = N2.fbm(u, v, 8, 3)
      const pores = N3.at(u * 64, v * 64, 64)
      const sh = 0.86 + n * 0.28
      cd[i * 4] = 214 * sh
      cd[i * 4 + 1] = 160 * sh
      cd[i * 4 + 2] = 128 * sh
      cd[i * 4 + 3] = 255
      height[i] = pores * 0.5 + n * 0.5
      rough[i] = 0.62
    }
  }
  cctx.putImageData(cimg, 0, 0)
  return {
    map: toTexture(cc, true),
    rough: toTexture(grayCanvas(rough, size), false),
    normal: toTexture(heightToNormal(height, size, 0.8), false),
  }
}

/** Painted grenade body: olive drab, worn, with the segment grid baked into the albedo. */
export function makeGrenadeBody(size = 256): PBRSet {
  const [cc, cctx, cimg] = makeCanvas(size)
  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const cd = cimg.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const i = y * size + x
      const n = N1.fbm(u, v, 5, 4)
      const grid = Math.max(Math.abs(((u * 8) % 1) - 0.5), Math.abs(((v * 6) % 1) - 0.5))
      const groove = grid > 0.46 ? 1 : 0
      const wear = Math.max(0, (N2.fbm(u, v, 7, 3) - 0.62) * 4)
      const sh = 0.8 + n * 0.35 - groove * 0.5
      const col = [70, 78, 52]
      const metal = [120, 118, 112]
      for (let k = 0; k < 3; k++) cd[i * 4 + k] = (col[k]! + (metal[k]! - col[k]!) * Math.min(1, wear)) * sh
      cd[i * 4 + 3] = 255
      height[i] = 1 - groove * 0.8 + n * 0.1
      rough[i] = 0.55 + wear * 0.2 + n * 0.1
    }
  }
  cctx.putImageData(cimg, 0, 0)
  return {
    map: toTexture(cc, true),
    rough: toTexture(grayCanvas(rough, size), false),
    normal: toTexture(heightToNormal(height, size, 2.0), false),
  }
}

export function makeWatchFace(): Texture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.fillStyle = '#0d0f10'
  g.fillRect(0, 0, s, s)
  g.strokeStyle = '#9bd0a0'
  g.lineWidth = 3
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    g.beginPath()
    g.moveTo(s / 2 + Math.sin(a) * 44, s / 2 - Math.cos(a) * 44)
    g.lineTo(s / 2 + Math.sin(a) * (i % 3 === 0 ? 34 : 38), s / 2 - Math.cos(a) * (i % 3 === 0 ? 34 : 38))
    g.stroke()
  }
  g.lineWidth = 4
  g.strokeStyle = '#e8f4ea'
  g.beginPath()
  g.moveTo(s / 2, s / 2)
  g.lineTo(s / 2 + 18, s / 2 - 26)
  g.stroke()
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(s / 2, s / 2)
  g.lineTo(s / 2 - 30, s / 2 + 8)
  g.stroke()
  g.fillStyle = '#c33'
  g.fillRect(s / 2 - 1, s / 2 - 40, 2, 40)
  return toTexture(c, true)
}

// ─── Muzzle flash & smoke sprites ───────────────────────────────────────────

export function makeFlashTextures(): Texture[] {
  const out: Texture[] = []
  const rnd = seeded(2024)
  for (let variant = 0; variant < 3; variant++) {
    const s = 256
    const c = document.createElement('canvas')
    c.width = c.height = s
    const g = c.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, s, s)
    g.globalCompositeOperation = 'lighter'
    const cx = s / 2
    const cy = s / 2
    // Soft core
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, s * 0.28)
    core.addColorStop(0, 'rgba(255,255,235,1)')
    core.addColorStop(0.35, 'rgba(255,214,120,0.85)')
    core.addColorStop(1, 'rgba(255,120,20,0)')
    g.fillStyle = core
    g.fillRect(0, 0, s, s)
    // Star spikes
    const spikes = 5 + variant * 2
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + rnd() * 0.5
      const len = s * (0.3 + rnd() * 0.18)
      const w = 5 + rnd() * 9
      g.save()
      g.translate(cx, cy)
      g.rotate(a)
      const grd = g.createLinearGradient(0, 0, len, 0)
      grd.addColorStop(0, 'rgba(255,240,200,0.95)')
      grd.addColorStop(0.5, 'rgba(255,170,60,0.6)')
      grd.addColorStop(1, 'rgba(255,90,10,0)')
      g.fillStyle = grd
      g.beginPath()
      g.moveTo(0, -w)
      g.lineTo(len, 0)
      g.lineTo(0, w)
      g.closePath()
      g.fill()
      g.restore()
    }
    // Forward-biased cone (muzzle jet along +x)
    g.save()
    g.translate(cx, cy)
    const jet = g.createLinearGradient(0, 0, s * 0.48, 0)
    jet.addColorStop(0, 'rgba(255,245,210,0.9)')
    jet.addColorStop(1, 'rgba(255,120,20,0)')
    g.fillStyle = jet
    g.beginPath()
    g.moveTo(0, -18)
    g.quadraticCurveTo(s * 0.3, -10, s * 0.48, 0)
    g.quadraticCurveTo(s * 0.3, 10, 0, 18)
    g.closePath()
    g.fill()
    g.restore()
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    out.push(t)
  }
  return out
}

export function makeSmokeTexture(): Texture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const img = g.createImageData(s, s)
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = x / s
      const v = y / s
      const dx = u - 0.5
      const dy = v - 0.5
      const r = Math.sqrt(dx * dx + dy * dy) * 2
      const n = N1.fbm(u, v, 4, 4)
      const a = Math.max(0, 1 - r) ** 1.6 * (0.5 + n * 0.9)
      const i = (y * s + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.min(255, a * 255)
    }
  }
  g.putImageData(img, 0, 0)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** Dark "glass" with faint coating colours, used for scope / sight lenses. */
export function makeLensTexture(): Texture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(s * 0.35, s * 0.3, 4, s / 2, s / 2, s * 0.6)
  grd.addColorStop(0, '#6c7f96')
  grd.addColorStop(0.35, '#20303f')
  grd.addColorStop(0.7, '#0a1118')
  grd.addColorStop(1, '#162a1e')
  g.fillStyle = grd
  g.fillRect(0, 0, s, s)
  return toTexture(c, true)
}
