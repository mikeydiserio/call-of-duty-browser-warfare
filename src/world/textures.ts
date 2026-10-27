/**
 * Procedural PBR textures for the Rust map: albedo + normal + ORM (R=ao, G=roughness, B=metalness).
 * Everything is generated from deterministic tileable noise (see noise.ts) into DataTextures,
 * once, and cached. All textures tile seamlessly.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three'
import { seeded } from '../core/math'
import { getBank } from './noise'

type C3 = [number, number, number]

export interface PBR {
  map: DataTexture
  normalMap: DataTexture
  orm: DataTexture
}

interface Px {
  r: number
  g: number
  b: number
  h: number
  rough: number
  metal: number
  a: number
}

const TAU = Math.PI * 2
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const sm = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const fract = (x: number) => x - Math.floor(x)

function setMix(p: Px, a: C3, b: C3, t: number) {
  p.r = a[0] + (b[0] - a[0]) * t
  p.g = a[1] + (b[1] - a[1]) * t
  p.b = a[2] + (b[2] - a[2]) * t
}
function tint(p: Px, c: C3, t: number) {
  p.r += (c[0] - p.r) * t
  p.g += (c[1] - p.g) * t
  p.b += (c[2] - p.b) * t
}
function shade(p: Px, k: number) {
  p.r *= k
  p.g *= k
  p.b *= k
}

function finishTex(t: DataTexture, srgb: boolean) {
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

function bake(w: number, h: number, nStr: number, fn: (u: number, v: number, p: Px) => void, alpha = false): PBR {
  const col = new Uint8Array(w * h * 4)
  const orm = new Uint8Array(w * h * 4)
  const hgt = new Float32Array(w * h)
  const p: Px = { r: 0, g: 0, b: 0, h: 0, rough: 0.9, metal: 0, a: 1 }
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      p.h = 0
      p.rough = 0.9
      p.metal = 0
      p.a = 1
      fn(u, v, p)
      const i = y * w + x
      hgt[i] = p.h
      const o = i * 4
      col[o] = p.r < 0 ? 0 : p.r > 255 ? 255 : p.r
      col[o + 1] = p.g < 0 ? 0 : p.g > 255 ? 255 : p.g
      col[o + 2] = p.b < 0 ? 0 : p.b > 255 ? 255 : p.b
      col[o + 3] = alpha ? (p.a > 0.5 ? 255 : 0) : 255
      orm[o] = 255
      orm[o + 1] = clamp01(p.rough) * 255
      orm[o + 2] = clamp01(p.metal) * 255
      orm[o + 3] = 255
    }
  }
  const nrm = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w
    const yp = ((y + 1) % h) * w
    const y0 = y * w
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w
      const xp = (x + 1) % w
      const dx = (hgt[y0 + xp]! - hgt[y0 + xm]!) * nStr
      const dy = (hgt[yp + x]! - hgt[ym + x]!) * nStr
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1)
      const o = (y0 + x) * 4
      nrm[o] = (-dx * inv * 0.5 + 0.5) * 255
      nrm[o + 1] = (-dy * inv * 0.5 + 0.5) * 255
      nrm[o + 2] = (inv * 0.5 + 0.5) * 255
      nrm[o + 3] = 255
    }
  }
  const mk = (d: Uint8Array, srgb: boolean) =>
    finishTex(new DataTexture(d, w, h, RGBAFormat, UnsignedByteType), srgb)
  return { map: mk(col, true), normalMap: mk(nrm, false), orm: mk(orm, false) }
}

// ───────────────────────────────────────────────────────────────────────────

const DUST: C3 = [196, 170, 130]

function sand(): PBR {
  const { A, B, W, C, CI } = getBank()
  const sandA: C3 = [210, 182, 136]
  const sandB: C3 = [176, 147, 104]
  return bake(1024, 1024, 3.2, (u, v, p) => {
    const a = A.s(u, v)
    const a2 = A.s(u * 3 + 0.17, v * 3 + 0.43)
    const b = B.s(u * 2, v * 2)
    const warp = (A.s(u * 2, v * 2) - 0.5) * 5
    const r1 = Math.sin(TAU * (22 * u + 7 * v) + warp)
    const r2 = Math.sin(TAU * (94 * u + 31 * v) + warp * 2)
    // wind ripples only in drifted patches; elsewhere packed, trampled sand
    const drift = sm(0.58, 0.82, a2)
    const ripple = r1 * 0.3 * drift + r2 * 0.05 * (0.4 + drift)
    const grain = W.at(u, v) - 0.5
    setMix(p, sandA, sandB, sm(0.25, 0.75, a * 0.7 + b * 0.3))
    const k = 1 + ripple * 0.05 + grain * 0.07 + (drift - 0.5) * 0.04
    shade(p, k)
    let h = ripple * 0.3 + grain * 0.1 + b * 0.35 + a * 0.25
    // pebbles
    const id = CI.at(u, v)
    if (id > 0.84) {
      const d = C.at(u, v)
      const rad = 0.05 + (id - 0.84) * 0.7
      if (d < rad) {
        const t = 1 - d / rad
        const dome = Math.sqrt(t)
        h += dome * 1.3
        const tone = id * 7 % 1
        if (tone < 0.5) tint(p, [150, 124, 96], 0.55)
        else tint(p, [196, 180, 156], 0.5)
        shade(p, 0.78 + dome * 0.3)
      }
    }
    p.h = h
    p.rough = 0.96
  })
}

function rock(): PBR {
  const { A, B, W, C } = getBank()
  const layers: C3[] = [
    [176, 144, 106],
    [150, 118, 88],
    [194, 162, 122],
    [126, 98, 74],
    [162, 130, 98],
    [140, 110, 82],
  ]
  return bake(512, 512, 3.5, (u, v, p) => {
    const warp = (A.s(u, v) - 0.5) * 1.4 + (B.s(u * 2, v) - 0.5) * 0.35
    const bv = v * 6 + warp
    const li = ((Math.floor(bv) % 6) + 6) % 6
    const f = fract(bv)
    const c = layers[li]!
    const n = B.s(u * 2, v * 3)
    setMix(p, c, layers[(li + 1) % 6]!, n * 0.5)
    shade(p, 0.82 + W.at(u, v) * 0.22 + (1 - f) * 0.12)
    // cracks
    const cr = Math.abs(A.s(u * 2 + 0.5, v * 2 + 0.2) - 0.5)
    let h = -f * 0.7 + B.s(u * 3, v * 3) * 0.5
    if (cr < 0.012) {
      shade(p, 0.45)
      h -= 0.8
    }
    // eroded pits
    if (C.at(u * 2, v * 2) < 0.08) {
      shade(p, 0.82)
      h -= 0.4
    }
    tint(p, DUST, 0.1)
    p.h = h
    p.rough = 0.93
  })
}

/** Heavily corroded riveted steel plate (tile 2 x 2 m, seams every 1 m). */
function rust(): PBR {
  const { A, B, W, C, CI } = getBank()
  const gunA: C3 = [52, 54, 58]
  const gunB: C3 = [84, 84, 84]
  const rustD: C3 = [92, 42, 20]
  const rustO: C3 = [178, 84, 34]
  const rustL: C3 = [206, 124, 58]
  return bake(1024, 1024, 4, (u, v, p) => {
    const a = A.s(u, v)
    const b = B.s(u * 3, v * 3)
    const st = A.s(u * 20 + 0.37, v * 2 + 0.11)
    let cov = a * 1.05 + (st - 0.5) * 0.85 + (b - 0.5) * 0.45 - 0.33
    // edges of plates corrode harder
    const sx = Math.abs(fract(u * 2 + 0.5) - 0.5) // 0 at seam
    const sy = Math.abs(fract(v * 2 + 0.5) - 0.5)
    const seamD = Math.min(sx, sy)
    cov += (1 - sm(0, 0.08, seamD)) * 0.35
    cov = sm(0.2, 0.62, cov)
    setMix(p, gunA, gunB, b)
    // brushed/pitted gunmetal
    shade(p, 0.9 + W.at(u * 2, v * 2) * 0.2)
    const rm = B.s(u * 6 + 0.2, v * 6 + 0.7)
    const rc: C3 = [0, 0, 0]
    const t1 = sm(0.2, 0.6, rm)
    rc[0] = mix(rustD[0], rustO[0], t1)
    rc[1] = mix(rustD[1], rustO[1], t1)
    rc[2] = mix(rustD[2], rustO[2], t1)
    const hi = sm(0.72, 0.9, B.s(u * 9, v * 9 + 0.3)) * cov
    rc[0] = mix(rc[0], rustL[0], hi)
    rc[1] = mix(rc[1], rustL[1], hi)
    rc[2] = mix(rc[2], rustL[2], hi)
    const base: C3 = [p.r, p.g, p.b]
    setMix(p, base, rc, cov)
    let h = cov * 0.6 + b * 0.25
    // pits
    const pd = C.at(u * 3, v * 3)
    if (pd < 0.12 && CI.at(u * 3, v * 3) > 0.5 && cov > 0.3) {
      shade(p, 0.55)
      h -= 0.8 * (1 - pd / 0.12)
    }
    // seams + rivets
    if (seamD < 0.0045) {
      shade(p, 0.45)
      h -= 1.2
    } else {
      // rivets along seams (both axes)
      const dxl = sx
      const dyl = sy
      let riv = 0
      if (Math.abs(dxl - 0.014) < 0.007) {
        const pv2 = fract(v * 32) - 0.5
        const dd = (dxl - 0.014) / 0.007
        riv = Math.max(riv, 1 - Math.sqrt(dd * dd + (pv2 * 4.4) ** 2))
      }
      if (Math.abs(dyl - 0.014) < 0.007) {
        const pu2 = fract(u * 32) - 0.5
        const dd = (dyl - 0.014) / 0.007
        riv = Math.max(riv, 1 - Math.sqrt(dd * dd + (pu2 * 4.4) ** 2))
      }
      if (riv > 0) {
        h += riv * 1.4
        shade(p, 1 + riv * 0.25)
      }
    }
    tint(p, DUST, 0.07)
    p.h = h
    p.rough = mix(0.5, 0.93, cov)
    p.metal = mix(0.65, 0.06, cov)
  })
}

interface PaintOpts {
  size?: number
  w?: number
  h?: number
  paint: C3
  paint2: C3
  under?: C3
  /** 0..1 portion of paint that has flaked. */
  wear: number
  rustAmt: number
  /** Vertical ridges across u. */
  ridges?: { n: number; amp: number; trap?: boolean }
  streak?: [number, number]
  /** Horizontal ring lines per tile (weld seams / barrel hoops). */
  rings?: number
  dust?: number
  nStr?: number
  offset?: number
  /** Non-periodic vertical wear (bottom rusts more) – only for textures mapped 1:1 on a wall. */
  gradient?: boolean
  gloss?: number
}

function painted(o: PaintOpts): PBR {
  const { A, B, W, C } = getBank()
  const rustD: C3 = [90, 44, 22]
  const rustO: C3 = [168, 82, 34]
  const under: C3 = o.under ?? [66, 62, 60]
  const w = o.w ?? o.size ?? 512
  const h = o.h ?? o.size ?? 512
  const sk = o.streak ?? [16, 2]
  const off = o.offset ?? 0
  return bake(
    w,
    h,
    o.nStr ?? 3.2,
    (u, v, p) => {
      const a = A.s(u + off, v + off * 0.7)
      const b = B.s(u * 3 + off, v * 3)
      const st = A.s(u * sk[0] + off, v * sk[1])
      let ridge = 0
      let ridgeEdge = 0
      if (o.ridges) {
        const t = fract(u * o.ridges.n)
        if (o.ridges.trap) {
          // trapezoid: flat crest, sloped flanks, flat trough
          const tri = Math.abs(t - 0.5) * 2 // 1 at seam(trough) .. 0 at centre(crest)
          ridge = 1 - sm(0.25, 0.75, tri)
          ridgeEdge = 1 - Math.abs(ridge - 0.5) * 2
        } else {
          ridge = Math.sin(t * TAU) * 0.5 + 0.5
          ridgeEdge = 1 - Math.abs(ridge - 0.5) * 2
        }
      }
      let grad = 0
      if (o.gradient) grad = (1 - v) * 0.25 + sm(0.92, 1, v) * 0.15
      // paint loss
      let loss = a * 0.55 + b * 0.3 + (st - 0.5) * 0.6 + ridgeEdge * 0.12 * (o.ridges ? 1 : 0)
      loss = loss + (o.wear - 0.5) * 1.1 + grad + (1 - ridge) * 0.06 * (o.ridges ? 1 : 0)
      const lossM = sm(0.45, 0.72, loss)
      // paint colour
      setMix(p, o.paint, o.paint2, sm(0.25, 0.75, B.s(u * 2 + 0.3, v * 2)))
      shade(p, 0.9 + W.at(u, v) * 0.14)
      // dirt in valleys / vertical grime
      if (o.ridges) shade(p, 0.82 + ridge * 0.2)
      shade(p, 1 - sm(0.55, 0.9, st) * 0.18)
      // under-paint: rust vs bare primer
      const rm = sm(0.3, 0.7, B.s(u * 5 + 0.1, v * 5 + 0.4) * 0.6 + a * 0.4 + (st - 0.5) * 0.3 + o.rustAmt - 0.5)
      const ur: C3 = [0, 0, 0]
      const t1 = sm(0.2, 0.7, B.s(u * 7, v * 7))
      ur[0] = mix(under[0], mix(rustD[0], rustO[0], t1), rm)
      ur[1] = mix(under[1], mix(rustD[1], rustO[1], t1), rm)
      ur[2] = mix(under[2], mix(rustD[2], rustO[2], t1), rm)
      const base: C3 = [p.r, p.g, p.b]
      setMix(p, base, ur, lossM)
      // pitting
      let ht = ridge * (o.ridges?.amp ?? 0) + lossM * 0.35 + b * 0.15
      if (C.at(u * 3, v * 3) < 0.09 && lossM > 0.5) {
        shade(p, 0.6)
        ht -= 0.5
      }
      if (o.rings) {
        const rv = Math.abs(fract(v * o.rings) - 0.5)
        if (rv < 0.012) {
          ht += 0.8
          shade(p, 1.12)
        } else if (rv > 0.485) {
          ht -= 0.8
          shade(p, 0.55)
        }
      }
      tint(p, DUST, o.dust ?? 0.1)
      p.h = ht
      p.rough = mix(0.55 - (o.gloss ?? 0), 0.92, lossM) * (1 - ridge * 0.08)
      p.metal = mix(0.35, 0.05, lossM)
    },
  )
}

function concrete(): PBR {
  const { A, B, W, C, CI } = getBank()
  return bake(512, 512, 3, (u, v, p) => {
    const a = A.s(u, v)
    const b = B.s(u * 2, v * 2)
    const st = A.s(u * 14, v * 2)
    setMix(p, [154, 150, 142], [118, 114, 106], a * 0.6 + b * 0.4)
    shade(p, 0.93 + (W.at(u, v) - 0.5) * 0.18)
    const stain = sm(0.55, 0.85, st * 0.7 + a * 0.5 - 0.12)
    tint(p, [82, 76, 68], stain * 0.28)
    const rs = sm(0.7, 0.86, A.s(u * 9 + 0.3, v * 1 + 0.1))
    tint(p, [138, 94, 58], rs * 0.28)
    let h = b * 0.3 + (W.at(u, v) - 0.5) * 0.25
    const cr = Math.abs(A.s(u * 2 + 0.5, v * 2 + 0.2) - 0.5)
    if (cr < 0.007) {
      shade(p, 0.45)
      h -= 1.2
    }
    if (C.at(u * 2, v * 2) < 0.07 && CI.at(u * 2, v * 2) > 0.7) {
      shade(p, 0.6)
      h -= 0.8
    }
    tint(p, DUST, 0.1 * (1 - a) + 0.04)
    p.h = h
    p.rough = 0.92
  })
}

function wood(): PBR {
  const { A, B, W, C, CI } = getBank()
  const ids = [0.12, 0.77, 0.4, 0.93, 0.28, 0.61]
  return bake(512, 512, 3.2, (u, v, p) => {
    const j = Math.floor(v * 6)
    const pv = v * 6 - j
    const id = ids[j]!
    const grain = A.s(u * 3 + id * 5, v * 48)
    const fine = B.s(u * 6 + id * 3, v * 120)
    setMix(p, [164, 144, 112], [118, 96, 70], grain * 0.7 + fine * 0.3)
    shade(p, 0.86 + id * 0.22)
    tint(p, [150, 144, 134], sm(0.4, 0.8, B.s(u * 2, v * 2)) * 0.5)
    let h = grain * 0.4 + fine * 0.25
    if (pv < 0.045 || pv > 0.955) {
      setMix(p, [48, 40, 32], [58, 48, 38], grain)
      h = -1
    }
    // knots
    if (C.at(u * 1, v * 1) < 0.07 && CI.at(u, v) > 0.8) {
      shade(p, 0.55)
      h -= 0.5
    }
    // splits
    if (Math.abs(A.s(u * 1 + id, v * 6 + 0.3) - 0.5) < 0.006) {
      shade(p, 0.4)
      h -= 0.8
    }
    shade(p, 0.95 + (W.at(u, v) - 0.5) * 0.1)
    tint(p, DUST, 0.12)
    p.h = h
    p.rough = 0.9
  })
}

function diamond(): PBR {
  const { A, B } = getBank()
  return bake(256, 256, 3, (u, v, p) => {
    const cu = fract(u * 4) - 0.5
    const cv = fract(v * 4) - 0.5
    const odd = (Math.floor(u * 4) + Math.floor(v * 4)) & 1
    const aa = (cu + cv) * 0.7071
    const bb = (cu - cv) * 0.7071
    const e = odd ? (aa / 0.4) ** 2 + (bb / 0.095) ** 2 : (bb / 0.4) ** 2 + (aa / 0.095) ** 2
    const lump = e < 1 ? 1 - e : 0
    setMix(p, [118, 116, 112], [92, 90, 88], B.s(u * 2, v * 2))
    const rs = sm(0.5, 0.78, A.s(u * 2, v * 2) * 0.7 + B.s(u * 3, v * 3) * 0.4 - 0.1)
    tint(p, [140, 78, 36], rs * 0.6)
    shade(p, 0.8 + lump * 0.3)
    tint(p, DUST, 0.12 * (1 - lump))
    p.h = lump * 1.1
    p.rough = mix(0.5, 0.88, rs)
    p.metal = mix(0.55, 0.1, rs)
  })
}

function grate(): PBR {
  const { A, B } = getBank()
  return bake(
    256,
    256,
    3,
    (u, v, p) => {
      const bu = fract(u * 8)
      const rv = fract(v * 4)
      const bar = bu < 0.24
      const rod = rv < 0.1
      const solid = bar || rod
      p.a = solid ? 1 : 0
      setMix(p, [66, 62, 58], [92, 78, 66], B.s(u * 4, v * 4))
      const rs = sm(0.45, 0.75, A.s(u * 2, v * 2) * 0.8 + B.s(u * 4, v * 4) * 0.3)
      tint(p, [128, 66, 30], rs * 0.55)
      p.h = bar ? 1 : rod ? 0.6 : 0
      p.rough = 0.72
      p.metal = 0.3
    },
    true,
  )
}

function sandbag(): PBR {
  const { A, B, W } = getBank()
  const tones: C3[] = [
    [160, 140, 102],
    [138, 126, 94],
    [172, 152, 114],
    [122, 114, 84],
    [150, 134, 100],
    [112, 104, 78],
  ]
  return bake(512, 512, 5, (u, v, p) => {
    const row = Math.floor(v * 4)
    const pu0 = u * 2 + (row & 1) * 0.5
    const bag = Math.floor(pu0)
    const pu = pu0 - bag
    const pv = v * 4 - row
    const dx = (pu - 0.5) * 2
    const dy = (pv - 0.5) * 2
    const e = Math.abs(dx) ** 2.6 + Math.abs(dy) ** 2.2
    const dome = e < 1 ? Math.sqrt(1 - e) : 0
    const idx = (((bag + row * 3) % 6) + 6) % 6
    const c = tones[idx]!
    setMix(p, c, tones[(idx + 2) % 6]!, B.s(u * 3, v * 3) * 0.6)
    const weave = (Math.sin(u * TAU * 64) * Math.sin(v * TAU * 64)) * 0.5 + 0.5
    shade(p, 0.78 + dome * 0.28 + weave * 0.07 + (W.at(u, v) - 0.5) * 0.08)
    // wrinkles + stitched ends
    const wr = B.s(u * 8 + bag * 0.13, v * 8)
    let h = dome * 1.0 + wr * 0.18 + weave * 0.05
    if (Math.abs(dx) > 0.86 && dome > 0) {
      h += Math.sin(dy * 28) * 0.08
      shade(p, 0.82)
    }
    if (e >= 1) {
      shade(p, 0.4)
      h = 0
    }
    tint(p, DUST, 0.22 + A.s(u * 2, v * 2) * 0.1)
    p.h = h
    p.rough = 0.98
  })
}

function chain(): PBR {
  const { B } = getBank()
  return bake(
    256,
    256,
    3,
    (u, v, p) => {
      const f1 = fract(4 * (u + v))
      const f2 = fract(4 * (u - v))
      const d1 = Math.min(f1, 1 - f1) / (4 * 1.4142)
      const d2 = Math.min(f2, 1 - f2) / (4 * 1.4142)
      const d = Math.min(d1, d2)
      const solid = d < 0.0042
      p.a = solid ? 1 : 0
      setMix(p, [150, 152, 150], [104, 96, 86], B.s(u * 4, v * 4))
      p.h = solid ? 1 - d / 0.0042 : 0
      p.rough = 0.55
      p.metal = 0.5
    },
    true,
  )
}

// ─── Decals (straight-alpha RGBA, sRGB) ─────────────────────────────────────

function decal(w: number, h: number, fn: (u: number, v: number, o: [number, number, number, number]) => void): DataTexture {
  const d = new Uint8Array(w * h * 4)
  const o: [number, number, number, number] = [0, 0, 0, 0]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      o[3] = 0
      fn((x + 0.5) / w, (y + 0.5) / h, o)
      const i = (y * w + x) * 4
      d[i] = o[0]
      d[i + 1] = o[1]
      d[i + 2] = o[2]
      d[i + 3] = clamp01(o[3]) * 255
    }
  }
  return finishTex(new DataTexture(d, w, h, RGBAFormat, UnsignedByteType), true)
}

function tireTracks(): DataTexture {
  const { A, B, W } = getBank()
  // u across (two parallel ruts), v along the track
  return decal(256, 256, (u, v, o) => {
    let a = 0
    for (const cx of [0.27, 0.73]) {
      const dx = Math.abs(u - cx)
      if (dx < 0.095) {
        const edge = 1 - sm(0.055, 0.095, dx)
        // chevron tread
        const tread = fract(v * 16 + (u < 0.5 ? (cx - u) : (u - cx)) * 3.2)
        const t = tread < 0.55 ? 1 : 0.55
        a = Math.max(a, edge * t)
      }
    }
    // broken up by noise so it reads as worn
    const n = A.s(u * 2, v * 4) * 0.6 + B.s(u * 3, v * 8) * 0.4
    a *= sm(0.15, 0.55, n + 0.2)
    const g = 0.75 + W.at(u, v) * 0.2
    o[0] = 112 * g
    o[1] = 86 * g
    o[2] = 58 * g
    o[3] = a * 0.62
  })
}

function oilStain(): DataTexture {
  const { A, B, D } = getBank()
  return decal(512, 512, (u, v, o) => {
    const dx = u - 0.5
    const dy = v - 0.5
    const r = Math.sqrt(dx * dx + dy * dy) * 2
    const n = A.s(u * 2, v * 2) * 0.55 + B.s(u * 3, v * 3) * 0.3 + D.s(u, v) * 0.15
    const edge = 1 - sm(0.28 + n * 0.45, 0.62 + n * 0.45, r + (n - 0.5) * 0.35)
    const core = sm(0.2, 0.7, B.s(u * 4, v * 4))
    o[0] = 22 + core * 14
    o[1] = 18 + core * 10
    o[2] = 14 + core * 8
    o[3] = edge * (0.55 + core * 0.35)
  })
}

function soilPatch(): DataTexture {
  const { A, B, W } = getBank()
  return decal(512, 512, (u, v, o) => {
    const dx = u - 0.5
    const dy = v - 0.5
    const r = Math.sqrt(dx * dx + dy * dy) * 2
    const n = A.s(u * 2, v * 2) * 0.6 + B.s(u * 3, v * 3) * 0.4
    const edge = 1 - sm(0.2 + n * 0.5, 0.95, r + (n - 0.5) * 0.3)
    const g = 0.8 + W.at(u, v) * 0.3
    o[0] = 118 * g
    o[1] = 94 * g
    o[2] = 66 * g
    o[3] = edge * 0.5
  })
}

// ─── Public catalogue ───────────────────────────────────────────────────────

export interface TextureSet {
  sand: PBR
  rock: PBR
  rust: PBR
  tin: PBR
  tinTan: PBR
  concrete: PBR
  wood: PBR
  diamond: PBR
  grate: PBR
  contBlue: PBR
  contRed: PBR
  contGreen: PBR
  pipeYellow: PBR
  pipeGrey: PBR
  barrelBlue: PBR
  barrelRed: PBR
  generator: PBR
  tank: PBR
  sandbag: PBR
  chain: PBR
  tracks: DataTexture
  oil: DataTexture
  soil: DataTexture
}

let cache: TextureSet | null = null

export function getTextures(): TextureSet {
  if (cache) return cache
  const t0 = performance.now()
  const rng = seeded(1234)
  void rng
  cache = {
    sand: sand(),
    rock: rock(),
    rust: rust(),
    tin: painted({
      w: 512,
      h: 1024,
      paint: [138, 142, 140],
      paint2: [112, 118, 118],
      under: [74, 70, 66],
      wear: 0.62,
      rustAmt: 0.62,
      ridges: { n: 8, amp: 0.55 },
      streak: [30, 3],
      nStr: 3.4,
      offset: 0.13,
    }),
    tinTan: painted({
      w: 512,
      h: 1024,
      paint: [176, 156, 120],
      paint2: [150, 134, 104],
      under: [72, 68, 62],
      wear: 0.55,
      rustAmt: 0.5,
      ridges: { n: 8, amp: 0.55 },
      streak: [26, 3],
      nStr: 3.4,
      offset: 0.41,
    }),
    concrete: concrete(),
    wood: wood(),
    diamond: diamond(),
    grate: grate(),
    contBlue: painted({
      w: 512,
      h: 512,
      paint: [44, 82, 128],
      paint2: [74, 108, 146],
      under: [70, 64, 60],
      wear: 0.5,
      rustAmt: 0.6,
      ridges: { n: 28, amp: 0.7, trap: true },
      streak: [24, 1],
      gradient: true,
      nStr: 3.4,
      offset: 0.27,
      dust: 0.14,
    }),
    contRed: painted({
      w: 512,
      h: 512,
      paint: [128, 40, 32],
      paint2: [158, 70, 52],
      under: [70, 62, 58],
      wear: 0.5,
      rustAmt: 0.62,
      ridges: { n: 28, amp: 0.7, trap: true },
      streak: [24, 1],
      gradient: true,
      nStr: 3.4,
      offset: 0.71,
      dust: 0.14,
    }),
    contGreen: painted({
      w: 512,
      h: 512,
      paint: [76, 86, 62],
      paint2: [106, 112, 84],
      under: [70, 64, 60],
      wear: 0.52,
      rustAmt: 0.6,
      ridges: { n: 28, amp: 0.7, trap: true },
      streak: [24, 1],
      gradient: true,
      nStr: 3.4,
      offset: 0.55,
      dust: 0.14,
    }),
    pipeYellow: painted({
      size: 512,
      paint: [200, 158, 40],
      paint2: [214, 176, 70],
      under: [78, 72, 66],
      wear: 0.62,
      rustAmt: 0.62,
      streak: [4, 18],
      rings: 4,
      nStr: 3,
      offset: 0.33,
    }),
    pipeGrey: painted({
      size: 512,
      paint: [116, 120, 118],
      paint2: [140, 142, 136],
      under: [66, 60, 56],
      wear: 0.6,
      rustAmt: 0.62,
      streak: [4, 18],
      rings: 4,
      nStr: 3,
      offset: 0.62,
    }),
    barrelBlue: painted({
      size: 512,
      paint: [34, 74, 132],
      paint2: [58, 98, 154],
      under: [70, 62, 56],
      wear: 0.5,
      rustAmt: 0.66,
      streak: [3, 14],
      rings: 3,
      nStr: 3,
      offset: 0.8,
      gloss: 0.1,
    }),
    barrelRed: painted({
      size: 512,
      paint: [138, 42, 30],
      paint2: [168, 70, 46],
      under: [70, 62, 56],
      wear: 0.5,
      rustAmt: 0.66,
      streak: [3, 14],
      rings: 3,
      nStr: 3,
      offset: 0.9,
      gloss: 0.1,
    }),
    generator: painted({
      size: 512,
      paint: [170, 138, 56],
      paint2: [190, 156, 78],
      under: [76, 68, 60],
      wear: 0.5,
      rustAmt: 0.6,
      streak: [8, 4],
      nStr: 3,
      offset: 0.19,
    }),
    tank: painted({
      size: 512,
      paint: [184, 172, 148],
      paint2: [160, 150, 128],
      under: [76, 66, 58],
      wear: 0.5,
      rustAmt: 0.55,
      streak: [3, 20],
      rings: 2,
      nStr: 3,
      offset: 0.47,
    }),
    sandbag: sandbag(),
    chain: chain(),
    tracks: tireTracks(),
    oil: oilStain(),
    soil: soilPatch(),
  }
  console.info(`[rust] textures generated in ${(performance.now() - t0).toFixed(0)} ms`)
  return cache
}

/** Dev aid: draw a texture's albedo into a canvas. */
export function debugSheet(tex: DataTexture, size = 256): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const w = tex.image.width
  const h = tex.image.height
  const id = g.createImageData(w, h)
  id.data.set(tex.image.data as Uint8Array)
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  tmp.getContext('2d')!.putImageData(id, 0, 0)
  g.save()
  g.translate(0, size)
  g.scale(1, -1)
  g.drawImage(tmp, 0, 0, size, size)
  g.restore()
  return c
}
