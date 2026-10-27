import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Team } from '../core/types'
import { COLS, createSoldierAtlas, MARGIN, TILE } from './camo'

export const BONE_ORDER = [
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'uarmL', 'farmL', 'handL', 'uarmR', 'farmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const
export type BoneName = (typeof BONE_ORDER)[number]

const BI = {} as Record<BoneName, number>
BONE_ORDER.forEach((n, i) => {
  BI[n] = i
})

/** World-space rest positions (feet at y = 0, facing -Z, +X is the soldier's right). */
export const REST: Record<BoneName, [number, number, number]> = {
  pelvis: [0, 0.955, 0],
  spine: [0, 1.075, 0],
  chest: [0, 1.215, 0],
  neck: [0, 1.475, 0],
  head: [0, 1.555, 0],
  uarmL: [-0.205, 1.415, 0],
  farmL: [-0.205, 1.125, 0],
  handL: [-0.205, 0.855, 0],
  uarmR: [0.205, 1.415, 0],
  farmR: [0.205, 1.125, 0],
  handR: [0.205, 0.855, 0],
  thighL: [-0.1, 0.935, 0],
  shinL: [-0.1, 0.495, 0],
  footL: [-0.1, 0.08, 0],
  thighR: [0.1, 0.935, 0],
  shinR: [0.1, 0.495, 0],
  footR: [0.1, 0.08, 0],
}
const PARENT: Record<BoneName, BoneName | null> = {
  pelvis: null, spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  uarmL: 'chest', farmL: 'uarmL', handL: 'farmL', uarmR: 'chest', farmR: 'uarmR', handR: 'farmR',
  thighL: 'pelvis', shinL: 'thighL', footL: 'shinL', thighR: 'pelvis', shinR: 'thighR', footR: 'shinR',
}

export const DIM = {
  upperArm: 0.29,
  foreArm: 0.27,
  thigh: 0.44,
  shin: 0.415,
  ankleHeight: 0.08,
} as const

export interface SoldierRig {
  root: Group
  mesh: SkinnedMesh
  bones: Record<BoneName, Bone>
  boneList: Bone[]
  /** Weapon mount under the chest bone; the animator moves it. */
  mount: Object3D
  knife: Object3D
  skin: Color
  headgear: string
  dispose(): void
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

interface Geo {
  pos: Float32Array
  nor: Float32Array
  idx: ArrayLike<number>
  /** Optional authored UVs (0..1 within the tile); otherwise box-projected. */
  uv?: Float32Array
}

function fromThree(g: BufferGeometry, keepUV = false): Geo {
  const uv = keepUV ? g.getAttribute('uv') : null
  return {
    pos: Float32Array.from(g.getAttribute('position').array as ArrayLike<number>),
    nor: Float32Array.from(g.getAttribute('normal').array as ArrayLike<number>),
    idx: g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: g.getAttribute('position').count }, (_, i) => i),
    uv: uv ? Float32Array.from(uv.array as ArrayLike<number>) : undefined,
  }
}

let templates: { sphere: Geo; box: Geo; cyl: Geo; dome: Geo } | null = null
function getTemplates() {
  if (!templates) {
    templates = {
      sphere: fromThree(new SphereGeometry(1, 14, 10)),
      box: fromThree(new RoundedBoxGeometry(1, 1, 1, 2, 0.16)),
      cyl: fromThree(new CylinderGeometry(1, 1, 1, 14, 1)),
      dome: fromThree(new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
    }
  }
  return templates
}

// ─── Sculpted head ──────────────────────────────────────────────────────────

const HEAD_C = [0, 1.665, 0.002] as const
const HEAD_S = [0.086, 0.11, 0.102] as const
const gauss = (x: number, mu: number, sigma: number) => Math.exp(-((x - mu) * (x - mu)) / (2 * sigma * sigma))

/**
 * Head built from a sphere with its UV seam at the back (face at u = 0.5),
 * sculpted with a brow ridge, eye sockets, cheekbones, a tapered jaw and chin.
 * kind 'face' is the skin; 'balaclava' / 'wrap' are cloth shells with an eye
 * slit cut out (the wrap also gets folds and a covered nose).
 */
function headGeo(kind: 'face' | 'balaclava' | 'wrap'): Geo {
  const g = kind === 'face' ? new SphereGeometry(1, 32, 24, Math.PI / 2) : new SphereGeometry(1, 48, 40, Math.PI / 2)
  const pos = g.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i)
    let x = ux, y = uy, z = uz
    const front = Math.max(0, -uz)
    // Jaw taper and chin.
    if (uy < -0.1) {
      const t = (-uy - 0.1) / 0.9
      x *= 1 - 0.32 * t * t
      z *= uz < 0 ? 1 + 0.05 * t : 1 - 0.3 * t
    }
    // Rounder cranium at the back.
    if (uz > 0 && uy > -0.3) z *= 1.06
    // Brow ridge, eye sockets, cheekbones, nose bridge.
    z -= front ** 3 * gauss(uy, 0.27, 0.08) * 0.07
    for (const ex of [-0.38, 0.38]) z += front * 0.075 * Math.exp(-((ux - ex) ** 2 + (uy - 0.1) ** 2) / 0.018)
    x *= 1 + 0.06 * gauss(uy, -0.05, 0.14) * front
    // Slightly flattened face plane.
    if (z < -0.86) z = -0.86 - (-z - 0.86) * 0.55
    if (kind !== 'face') {
      // Cloth sits proud of the skin and smooths over the sockets; the nose shows through.
      const k = kind === 'balaclava' ? 1.075 : 1.13
      x *= k
      y *= k * (kind === 'wrap' ? 1.02 : 1)
      z *= k
      z -= front ** 4 * gauss(uy, -0.12, 0.18) * gauss(ux, 0, 0.12) * 0.27
      if (kind === 'wrap') {
        // Wrapped folds.
        const phi = Math.atan2(ux, -uz)
        const f = 1 + 0.045 * Math.sin(phi * 9 + uy * 7) + 0.025 * Math.sin(phi * 4 - uy * 13)
        x *= f
        z *= f
        if (uy > 0.5) y *= 1 + 0.06 * (uy - 0.5) // bunched top
      }
    }
    pos.setXYZ(i, x * HEAD_S[0] + HEAD_C[0], y * HEAD_S[1] + HEAD_C[1], z * HEAD_S[2] + HEAD_C[2])
  }
  g.computeVertexNormals()
  const geo = fromThree(g, true)
  g.dispose()
  if (kind !== 'face') {
    // Cut the eye slit (UV band around the eyes).
    const uv = geo.uv!
    const half = kind === 'balaclava' ? 0.105 : 0.13
    const [v0, v1] = kind === 'balaclava' ? [0.475, 0.6] : [0.475, 0.625]
    const idx: number[] = []
    const src = geo.idx
    // Remove whole grid quads (both triangles share rows/columns) for clean, straight slit edges.
    for (let t = 0; t < src.length; t += 3) {
      let inside = true
      for (let k = 0; k < 3 && inside; k++) {
        const u = uv[src[t + k]! * 2]!
        const v = uv[src[t + k]! * 2 + 1]!
        if (Math.abs(u - 0.5) > half + 1e-4 || v < v0 - 1e-4 || v > v1 + 1e-4) inside = false
      }
      if (!inside) idx.push(src[t]!, src[t + 1]!, src[t + 2]!)
    }
    geo.idx = idx
  }
  return geo
}

let headCache: Record<'face' | 'balaclava' | 'wrap', Geo> | null = null
function heads() {
  if (!headCache) headCache = { face: headGeo('face'), balaclava: headGeo('balaclava'), wrap: headGeo('wrap') }
  return headCache
}

interface Section {
  y: number
  rx: number
  rz: number
  cx?: number
  cz?: number
}

function loftGeo(sections: Section[], radial = 12): Geo {
  const rings = sections.length
  const pos = new Float32Array(rings * radial * 3)
  for (let i = 0; i < rings; i++) {
    const s = sections[i]!
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const o = (i * radial + j) * 3
      pos[o] = (s.cx ?? 0) + Math.sin(a) * s.rx
      pos[o + 1] = s.y
      pos[o + 2] = (s.cz ?? 0) + Math.cos(a) * s.rz
    }
  }
  const idx: number[] = []
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j
      const b = i * radial + ((j + 1) % radial)
      const c = (i + 1) * radial + j
      const d = (i + 1) * radial + ((j + 1) % radial)
      idx.push(a, c, b, b, c, d)
    }
  }
  // Cap both ends with a centre fan (closed solid).
  const centreBottom = rings * radial
  const centreTop = centreBottom + 1
  const pos2 = new Float32Array(pos.length + 6)
  pos2.set(pos)
  const sb = sections[0]!
  const st = sections[rings - 1]!
  pos2.set([sb.cx ?? 0, sb.y, sb.cz ?? 0, st.cx ?? 0, st.y, st.cz ?? 0], pos.length)
  for (let j = 0; j < radial; j++) {
    const j2 = (j + 1) % radial
    idx.push(centreBottom, j2, j)
    idx.push(centreTop, (rings - 1) * radial + j, (rings - 1) * radial + j2)
  }
  // Orientation check: outward normal of the first side quad should point away from the axis.
  const ia = idx[0]!
  const ib = idx[1]!
  const ic = idx[2]!
  const ax = pos2[ia * 3]!, ay = pos2[ia * 3 + 1]!, az = pos2[ia * 3 + 2]!
  const e1x = pos2[ib * 3]! - ax, e1y = pos2[ib * 3 + 1]! - ay, e1z = pos2[ib * 3 + 2]! - az
  const e2x = pos2[ic * 3]! - ax, e2y = pos2[ic * 3 + 1]! - ay, e2z = pos2[ic * 3 + 2]! - az
  const nx = e1y * e2z - e1z * e2y
  const nz = e1x * e2y - e1y * e2x
  const outx = ax - (sections[0]!.cx ?? 0)
  const outz = az - (sections[0]!.cz ?? 0)
  if (nx * outx + nz * outz < 0) {
    for (let k = 0; k < idx.length; k += 3) {
      const t = idx[k + 1]!
      idx[k + 1] = idx[k + 2]!
      idx[k + 2] = t
    }
  }
  // Smooth normals.
  const nor = new Float32Array(pos2.length)
  for (let k = 0; k < idx.length; k += 3) {
    const i0 = idx[k]!, i1 = idx[k + 1]!, i2 = idx[k + 2]!
    const px = pos2[i0 * 3]!, py = pos2[i0 * 3 + 1]!, pz = pos2[i0 * 3 + 2]!
    const ux = pos2[i1 * 3]! - px, uy = pos2[i1 * 3 + 1]! - py, uz = pos2[i1 * 3 + 2]! - pz
    const vx = pos2[i2 * 3]! - px, vy = pos2[i2 * 3 + 1]! - py, vz = pos2[i2 * 3 + 2]! - pz
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    for (const i of [i0, i1, i2]) {
      nor[i * 3] += fx
      nor[i * 3 + 1] += fy
      nor[i * 3 + 2] += fz
    }
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i]!, nor[i + 1]!, nor[i + 2]!) || 1
    nor[i] /= l
    nor[i + 1] /= l
    nor[i + 2] /= l
  }
  return { pos: pos2, nor, idx }
}

// ─── Skin weights ───────────────────────────────────────────────────────────

const W = { b0: 0, w0: 1, b1: 0, w1: 0 }
type Weight = number | ((y: number) => void)
const sstep = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}
/** Blend `hi` (bone above the joint) and `lo` (bone below) around height yj. */
const joint = (hi: BoneName, lo: BoneName, yj: number, hw: number): Weight => (y) => {
  const t = sstep((y - (yj - hw)) / (2 * hw))
  W.b0 = BI[hi]
  W.w0 = t
  W.b1 = BI[lo]
  W.w1 = 1 - t
}
const torsoChain: Weight = (y) => {
  if (y <= 0.955) {
    W.b0 = BI.pelvis
    W.w0 = 1
    W.w1 = 0
  } else if (y < 1.075) {
    const t = sstep((y - 0.955) / 0.12)
    W.b0 = BI.spine
    W.w0 = t
    W.b1 = BI.pelvis
    W.w1 = 1 - t
  } else if (y < 1.215) {
    const t = sstep((y - 1.075) / 0.14)
    W.b0 = BI.chest
    W.w0 = t
    W.b1 = BI.spine
    W.w1 = 1 - t
  } else {
    W.b0 = BI.chest
    W.w0 = 1
    W.w1 = 0
  }
}

/** Thigh: pelvis above the hip crease, thigh in the middle, shin below the knee. */
const hipKnee = (thigh: BoneName, shin: BoneName): Weight => (y) => {
  if (y > 0.88) {
    const t = sstep((y - 0.88) / 0.1)
    W.b0 = BI.pelvis
    W.w0 = t
    W.b1 = BI[thigh]
    W.w1 = 1 - t
  } else if (y < 0.55) {
    const t = sstep((y - 0.44) / 0.11)
    W.b0 = BI[thigh]
    W.w0 = t
    W.b1 = BI[shin]
    W.w1 = 1 - t
  } else {
    W.b0 = BI[thigh]
    W.w0 = 1
    W.w1 = 0
  }
}
const rigid = (b: BoneName): Weight => BI[b]

// ─── Mesh builder ───────────────────────────────────────────────────────────

const _m = new Matrix4()
const _nm = new Matrix3()
const _q = new Quaternion()
const _e = new Euler()
const _p = new Vector3()
const _s = new Vector3()
const SAND = new Color(0.52, 0.4, 0.26)

class Builder {
  pos: number[] = []
  nor: number[] = []
  uv: number[] = []
  col: number[] = []
  skinIdx: number[] = []
  skinW: number[] = []
  index: number[] = []
  private vcount = 0

  add(g: Geo, m: Matrix4, tile: number, color: Color, weight: Weight, uvScale = 1.8, dust = true) {
    _nm.getNormalMatrix(m)
    const n = g.pos.length / 3
    const px = new Float32Array(n * 3)
    const nx = new Float32Array(n * 3)
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < n; i++) {
      _p.set(g.pos[i * 3]!, g.pos[i * 3 + 1]!, g.pos[i * 3 + 2]!).applyMatrix4(m)
      px[i * 3] = _p.x
      px[i * 3 + 1] = _p.y
      px[i * 3 + 2] = _p.z
      minX = Math.min(minX, _p.x); maxX = Math.max(maxX, _p.x)
      minY = Math.min(minY, _p.y); maxY = Math.max(maxY, _p.y)
      minZ = Math.min(minZ, _p.z); maxZ = Math.max(maxZ, _p.z)
      _p.set(g.nor[i * 3]!, g.nor[i * 3 + 1]!, g.nor[i * 3 + 2]!).applyMatrix3(_nm).normalize()
      nx[i * 3] = _p.x
      nx[i * 3 + 1] = _p.y
      nx[i * 3 + 2] = _p.z
    }
    const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.02)
    const s = Math.min(uvScale, 0.98 / ext)
    const tc = tileOrigin(tile)
    for (let i = 0; i < n; i++) {
      const x = px[i * 3]!, y = px[i * 3 + 1]!, z = px[i * 3 + 2]!
      const nxv = nx[i * 3]!, nyv = nx[i * 3 + 1]!, nzv = nx[i * 3 + 2]!
      this.pos.push(x, y, z)
      this.nor.push(nxv, nyv, nzv)
      const ax = Math.abs(nxv), ay = Math.abs(nyv), az = Math.abs(nzv)
      let u: number, v: number
      if (g.uv) {
        u = g.uv[i * 2]!
        v = g.uv[i * 2 + 1]!
      } else if (az >= ax && az >= ay) {
        u = (x - minX) * s
        v = (y - minY) * s
      } else if (ax >= ay) {
        u = (z - minZ) * s
        v = (y - minY) * s
      } else {
        u = (x - minX) * s
        v = (z - minZ) * s
      }
      this.uv.push(tc[0] + Math.min(1, Math.max(0, u)) * tc[2], tc[1] + Math.min(1, Math.max(0, v)) * tc[3])
      // Baked AO-ish shading + dust near the ground.
      const ao = 0.76 + 0.24 * (nyv * 0.5 + 0.5)
      let r = color.r * ao, gg = color.g * ao, b = color.b * ao
      if (dust) {
        const f = Math.max(0, Math.min(1, (0.75 - y) / 0.75)) * 0.5
        r = r * (1 - f * 0.4) + SAND.r * f * 0.3
        gg = gg * (1 - f * 0.4) + SAND.g * f * 0.3
        b = b * (1 - f * 0.4) + SAND.b * f * 0.3
      }
      this.col.push(r, gg, b)
      if (typeof weight === 'number') {
        this.skinIdx.push(weight, 0, 0, 0)
        this.skinW.push(1, 0, 0, 0)
      } else {
        weight(y)
        this.skinIdx.push(W.b0, W.b1, 0, 0)
        this.skinW.push(W.w0, W.w1, 0, 0)
      }
    }
    for (let i = 0; i < g.idx.length; i++) this.index.push(g.idx[i]! + this.vcount)
    this.vcount += n
  }

  build(): BufferGeometry {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3))
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3))
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2))
    geo.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3))
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(this.skinIdx, 4))
    geo.setAttribute('skinWeight', new BufferAttribute(new Float32Array(this.skinW), 4))
    geo.setIndex(this.index)
    geo.computeBoundingSphere()
    geo.computeBoundingBox()
    return geo
  }
}

/** [uOrigin, vOrigin, uSize, vSize] of the usable area of an atlas tile. */
function tileOrigin(tile: number): [number, number, number, number] {
  const col = tile % COLS
  const row = Math.floor(tile / COLS)
  const size = 1 - 2 * MARGIN
  return [(col + MARGIN) / COLS, 1 - (row + MARGIN + size) / COLS, size / COLS, size / COLS]
}

// ─── Part shorthands ────────────────────────────────────────────────────────

function mat(pos: [number, number, number], scale: [number, number, number], rot?: [number, number, number]): Matrix4 {
  _p.set(pos[0], pos[1], pos[2])
  _s.set(scale[0], scale[1], scale[2])
  if (rot) _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]))
  else _q.identity()
  return _m.compose(_p, _q, _s)
}


const _m2 = new Matrix4()
/** Rotation about a pivot point (for lofts authored in world space). */
function matAbout(pivot: [number, number, number], rot: [number, number, number]): Matrix4 {
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]))
  _m.makeTranslation(pivot[0], pivot[1], pivot[2])
  _m2.makeRotationFromQuaternion(_q)
  _m.multiply(_m2)
  _m2.makeTranslation(-pivot[0], -pivot[1], -pivot[2])
  return _m.multiply(_m2)
}

const C = (hex: number) => new Color(hex)
const CS = (r: number, g: number, b: number) => new Color().setRGB(r, g, b)

type V3 = [number, number, number]

// ─── Soldier assembly ───────────────────────────────────────────────────────

let sharedMaterial: MeshStandardMaterial | null = null
function getMaterial() {
  if (!sharedMaterial) {
    const atlas = createSoldierAtlas()
    sharedMaterial = new MeshStandardMaterial({
      map: atlas.map,
      roughnessMap: atlas.orm,
      metalnessMap: atlas.orm,
      roughness: 1,
      metalness: 1,
      vertexColors: true,
      envMapIntensity: 0.6,
    })
  }
  return sharedMaterial
}

const SKIN_TONES = [
  CS(1.0, 0.86, 0.76),
  CS(0.9, 0.7, 0.56),
  CS(0.78, 0.56, 0.42),
  CS(0.62, 0.42, 0.3),
  CS(0.42, 0.28, 0.2),
]

const tint = (c: number, v: number) => C(c).multiplyScalar(v)

export function buildSoldier(team: Team, rnd: () => number): SoldierRig {
  const T = getTemplates()
  const b = new Builder()
  const pick = <A>(arr: readonly A[]): A => arr[Math.floor(rnd() * arr.length)]!
  const chance = (p: number) => rnd() < p
  const vary = (c: Color, a = 0.08) => c.clone().multiplyScalar(1 - a + rnd() * a * 2)

  const skin = pick(team === 'tf141' ? SKIN_TONES.slice(0, 4) : SKIN_TONES).clone()
  const hair = pick([C(0x15110d), C(0x2a1d12), C(0x3c2a18), C(0x1a1a1a), C(0x57402a)])
  const eyeColor = pick([CS(0.16, 0.1, 0.06), CS(0.12, 0.08, 0.05), CS(0.2, 0.26, 0.3), CS(0.22, 0.2, 0.12)])

  // Outfit selection.
  let topTile: number = TILE.MULTICAM
  let topColor = CS(1, 1, 1)
  let pantsTile: number = TILE.MULTICAM
  let pantsColor = CS(1, 1, 1)
  let gearTile: number = TILE.COYOTE
  let gearColor = CS(1, 1, 1)
  let bareForearm = false
  let headgear = 'bare'
  let sleeveless = false

  if (team === 'tf141') {
    const o = rnd()
    if (o < 0.6) {
      topTile = pantsTile = TILE.MULTICAM
    } else if (o < 0.78) {
      topTile = TILE.MULTICAM
      pantsTile = TILE.KHAKI
    } else {
      topTile = pantsTile = TILE.KHAKI
      topColor = CS(0.95, 0.95, 0.88)
    }
    gearTile = pick([TILE.COYOTE, TILE.COYOTE, TILE.RANGER, TILE.BLACK_NYLON])
    bareForearm = chance(0.3)
  } else {
    // Militia: mixed civilian/surplus clothing, mid-value colours so it reads in shade.
    const o = rnd()
    if (o < 0.2) {
      topTile = TILE.OLIVE
      pantsTile = pick([TILE.DENIM, TILE.KHAKI])
    } else if (o < 0.35) {
      topTile = TILE.GREY
      pantsTile = pick([TILE.DENIM, TILE.DARK])
    } else if (o < 0.5) {
      topTile = TILE.TAN_SHIRT
      pantsTile = pick([TILE.DARK, TILE.OLIVE_PLAIN])
    } else if (o < 0.62) {
      topTile = TILE.DENIM
      pantsTile = TILE.KHAKI
    } else if (o < 0.74) {
      topTile = TILE.URBAN
      pantsTile = pick([TILE.DARK, TILE.DENIM])
    } else if (o < 0.88) {
      topTile = TILE.WHITE
      topColor = pick([CS(0.75, 0.68, 0.54), CS(0.62, 0.64, 0.66), CS(0.78, 0.38, 0.32), CS(0.48, 0.55, 0.5)])
      pantsTile = pick([TILE.DENIM, TILE.KHAKI])
      sleeveless = chance(0.35)
    } else {
      topTile = TILE.OLIVE_PLAIN
      pantsTile = TILE.KHAKI
    }
    gearTile = pick([TILE.RANGER, TILE.BLACK_NYLON, TILE.COYOTE, TILE.LEATHER])
    bareForearm = chance(0.35) || topTile === TILE.WHITE
  }
  topColor = vary(topColor, 0.06)
  pantsColor = vary(pantsColor, 0.06)
  gearColor = vary(gearColor, 0.1)
  const skinW = joint('farmR', 'handR', 0.9, 0.02) // placeholder (replaced per side below)
  void skinW

  const SK = (c: Color = skin) => c

  // ── Weights & bones used per side
  const side = (s: 1 | -1) => {
    const S = s === 1 ? 'R' : 'L'
    return {
      uarm: `uarm${S}` as BoneName,
      farm: `farm${S}` as BoneName,
      hand: `hand${S}` as BoneName,
      thigh: `thigh${S}` as BoneName,
      shin: `shin${S}` as BoneName,
      foot: `foot${S}` as BoneName,
    }
  }

  // ── Pelvis / pants
  b.add(loftGeo([
    { y: 0.76, rx: 0.15, rz: 0.1 },
    { y: 0.86, rx: 0.175, rz: 0.115 },
    { y: 0.97, rx: 0.172, rz: 0.113 },
    { y: 1.03, rx: 0.165, rz: 0.108 },
  ], 14), mat([0, 0, 0], [1, 1, 1]), pantsTile, pantsColor, rigid('pelvis'))
  // Belt.
  b.add(loftGeo([
    { y: 0.985, rx: 0.176, rz: 0.118 },
    { y: 1.03, rx: 0.176, rz: 0.118 },
  ], 14), mat([0, 0, 0], [1, 1, 1]), team === 'tf141' ? gearTile : TILE.LEATHER, team === 'tf141' ? gearColor : CS(0.7, 0.62, 0.55), rigid('pelvis'))
  b.add(T.box, mat([0, 1.007, -0.119], [0.05, 0.04, 0.012]), TILE.METAL, CS(0.8, 0.78, 0.7), rigid('pelvis'))

  // ── Torso (shirt) — lofted with a smooth chest/waist profile.
  const torsoSections: Section[] = [
    { y: 0.93, rx: 0.1747, rz: 0.121 },
    { y: 1.02, rx: 0.1685, rz: 0.1165 },
    { y: 1.11, rx: 0.1581, rz: 0.112 },
    { y: 1.2, rx: 0.1789, rz: 0.121 },
    { y: 1.3, rx: 0.1997, rz: 0.1299 },
    { y: 1.39, rx: 0.208, rz: 0.1277 },
    { y: 1.45, rx: 0.1768, rz: 0.112 },
    { y: 1.485, rx: 0.078, rz: 0.0784 },
  ]
  b.add(loftGeo(torsoSections, 16), mat([0, 0, 0], [1, 1, 1]), topTile, topColor, torsoChain)
  // Collar.
  b.add(loftGeo([
    { y: 1.455, rx: 0.082, rz: 0.076 },
    { y: 1.515, rx: 0.075, rz: 0.072 },
  ], 12), mat([0, 0, 0], [1, 1, 1]), topTile, topColor, rigid('chest'))

  // ── Neck
  b.add(loftGeo([
    { y: 1.46, rx: 0.066, rz: 0.066 },
    { y: 1.53, rx: 0.06, rz: 0.062 },
    { y: 1.59, rx: 0.058, rz: 0.06, cz: 0.006 },
    { y: 1.63, rx: 0.05, rz: 0.05, cz: 0.012 },
  ], 10), mat([0, 0, 0], [1, 1, 1]), TILE.SKIN, SK(), joint('head', 'chest', 1.52, 0.045), 1.8, false)

  // ── Head
  const headW = rigid('head')
  const H = heads()
  const fr = rnd()
  const faceTile = team === 'tf141' ? (fr < 0.42 ? TILE.FACE_CLEAN : fr < 0.88 ? TILE.FACE_STUBBLE : TILE.FACE_BEARD) : fr < 0.15 ? TILE.FACE_CLEAN : fr < 0.55 ? TILE.FACE_STUBBLE : TILE.FACE_BEARD
  b.add(H.face, mat([0, 0, 0], [1, 1, 1]), faceTile, SK(), headW, 1, false)
  // Nose: bridge, tip and wings.
  b.add(T.sphere, mat([0, 1.656, -0.09], [0.0085, 0.025, 0.011], [-0.3, 0, 0]), TILE.SKIN, SK(), headW, 3, false)
  b.add(T.sphere, mat([0, 1.637, -0.095], [0.0085, 0.0085, 0.0095]), TILE.SKIN, SK(), headW, 3, false)
  for (const sx of [-1, 1]) {
    b.add(T.sphere, mat([sx * 0.0095, 1.632, -0.091], [0.0065, 0.006, 0.007]), TILE.SKIN, SK().clone().multiplyScalar(0.93), headW, 3, false)
    // Ears.
    b.add(T.sphere, mat([sx * 0.087, 1.662, 0.004], [0.011, 0.029, 0.019], [0, sx * 0.25, 0]), TILE.SKIN, SK().clone().multiplyScalar(0.95), headW, 3, false)
    // Eyes: sclera + iris.
    b.add(T.sphere, mat([sx * 0.033, 1.676, -0.083], [0.0105, 0.006, 0.008]), TILE.WHITE, CS(0.66, 0.6, 0.54), headW, 3, false)
    b.add(T.sphere, mat([sx * 0.033, 1.6758, -0.0899], [0.0052, 0.0052, 0.0022]), TILE.BLACK_NYLON, eyeColor, headW, 3, false)
  }

  // ── Headgear
  const helmetTile = pick([TILE.MULTICAM, TILE.MULTICAM, TILE.COYOTE, TILE.RANGER])
  if (team === 'tf141') {
    const r = rnd()
    if (r < 0.58) {
      headgear = 'helmet'
      const hc = helmetTile === TILE.MULTICAM ? CS(1, 1, 1) : vary(CS(0.95, 0.95, 0.9), 0.06)
      b.add(T.dome, mat([0, 1.702, 0.012], [0.121, 0.11, 0.142], [0.14, 0, 0]), helmetTile, hc, headW, 2.5, false)
      // Rim + ear flaps.
      b.add(loftGeo([
        { y: 1.682, rx: 0.123, rz: 0.142, cz: 0.014 },
        { y: 1.702, rx: 0.121, rz: 0.14, cz: 0.012 },
      ], 16), matAbout([0, 1.679, 0], [0.14, 0, 0]), TILE.BLACK_NYLON, CS(0.5, 0.5, 0.5), headW, 2.5, false)
      b.add(T.box, mat([0.108, 1.669, 0.03], [0.022, 0.07, 0.1]), helmetTile, hc, headW, 2.5, false)
      b.add(T.box, mat([-0.108, 1.669, 0.03], [0.022, 0.07, 0.1]), helmetTile, hc, headW, 2.5, false)
      // NVG shroud + flip-up device.
      b.add(T.box, mat([0, 1.756, -0.118], [0.05, 0.034, 0.03]), TILE.METAL, CS(0.5, 0.5, 0.5), headW, 2.5, false)
      if (chance(0.55)) {
        b.add(T.box, mat([0, 1.776, -0.134], [0.1, 0.05, 0.06]), TILE.METAL, CS(0.32, 0.32, 0.33), headW, 2.5, false)
        b.add(T.cyl, mat([0.026, 1.776, -0.168], [0.017, 0.02, 0.017], [Math.PI / 2, 0, 0]), TILE.METAL, CS(0.06, 0.07, 0.08), headW, 2.5, false)
        b.add(T.cyl, mat([-0.026, 1.776, -0.168], [0.017, 0.02, 0.017], [Math.PI / 2, 0, 0]), TILE.METAL, CS(0.06, 0.07, 0.08), headW, 2.5, false)
      }
      // Goggles strap + lenses on the brow.
      if (chance(0.6)) {
        b.add(loftGeo([
          { y: 1.711, rx: 0.126, rz: 0.146, cz: 0.014 },
          { y: 1.736, rx: 0.124, rz: 0.144, cz: 0.012 },
        ], 16), matAbout([0, 1.701, 0], [0.14, 0, 0]), TILE.BLACK_NYLON, CS(0.6, 0.6, 0.6), headW, 2.5, false)
        b.add(T.box, mat([0, 1.724, -0.138], [0.15, 0.052, 0.045]), TILE.BLACK_NYLON, CS(0.5, 0.5, 0.5), headW, 2.5, false)
        b.add(T.box, mat([0.036, 1.724, -0.163], [0.056, 0.036, 0.012]), TILE.METAL, CS(0.18, 0.3, 0.34), headW, 2.5, false)
        b.add(T.box, mat([-0.036, 1.724, -0.163], [0.056, 0.036, 0.012]), TILE.METAL, CS(0.18, 0.3, 0.34), headW, 2.5, false)
      }
      // Helmet cover scrim band.
      b.add(T.box, mat([0, 1.784, 0.02], [0.2, 0.012, 0.012]), TILE.BLACK_NYLON, CS(0.5, 0.5, 0.5), headW, 2.5, false)
    } else if (r < 0.72) {
      headgear = 'boonie'
      b.add(T.dome, mat([0, 1.715, 0.003], [0.104, 0.075, 0.115]), TILE.MULTICAM, CS(1, 1, 1), headW, 2.5, false)
      b.add(loftGeo([
        { y: 1.712, rx: 0.2, rz: 0.21 },
        { y: 1.722, rx: 0.1, rz: 0.11 },
      ], 16), mat([0, 0, 0], [1, 1, 1]), TILE.MULTICAM, CS(0.95, 0.95, 0.95), headW, 2.5, false)
    } else if (r < 0.86) {
      headgear = 'cap'
      const cc = pick([CS(0.12, 0.12, 0.12), CS(0.55, 0.46, 0.32), CS(0.3, 0.33, 0.22)])
      b.add(T.dome, mat([0, 1.7, 0.01], [0.098, 0.088, 0.112], [0.05, 0, 0]), TILE.BLACK_NYLON, cc, headW, 2.5, false)
      b.add(T.box, mat([0, 1.7, -0.12], [0.1, 0.012, 0.08], [0.18, 0, 0]), TILE.BLACK_NYLON, cc, headW, 2.5, false)
    } else {
      headgear = 'bare'
      b.add(T.dome, mat([0, 1.712, 0.01], [0.089, 0.067, 0.104], [0.12, 0, 0]), TILE.KNIT, hair.clone().multiplyScalar(1.6), headW, 2.5, false)
    }
    // Ballistic glasses / shades.
    if (headgear !== 'helmet' || chance(0.4)) {
      if (chance(0.55)) {
        b.add(T.box, mat([0, 1.676, -0.097], [0.134, 0.028, 0.02]), TILE.METAL, CS(0.05, 0.05, 0.06), headW, 2.5, false)
      }
    }
    // Headset.
    if (chance(0.45)) {
      b.add(T.cyl, mat([0.098, 1.665, 0.006], [0.036, 0.016, 0.036], [0, 0, Math.PI / 2]), TILE.BLACK_NYLON, CS(0.5, 0.5, 0.5), headW, 2.5, false)
      b.add(T.cyl, mat([-0.098, 1.665, 0.006], [0.036, 0.016, 0.036], [0, 0, Math.PI / 2]), TILE.BLACK_NYLON, CS(0.5, 0.5, 0.5), headW, 2.5, false)
      b.add(T.box, mat([0, 1.775, 0.006], [0.2, 0.012, 0.012]), TILE.BLACK_NYLON, CS(0.5, 0.5, 0.5), headW, 2.5, false)
      b.add(T.box, mat([-0.07, 1.62, -0.09], [0.1, 0.008, 0.008], [0, -0.5, 0]), TILE.BLACK_NYLON, CS(0.5, 0.5, 0.5), headW, 2.5, false)
    }
    // Neck gaiter / shemagh scarf (desert).
    if (chance(0.3)) {
      b.add(loftGeo([
        { y: 1.5, rx: 0.088, rz: 0.09 },
        { y: 1.57, rx: 0.082, rz: 0.086 },
        { y: 1.6, rx: 0.078, rz: 0.08, cz: -0.004 },
      ], 12), mat([0, 0, 0], [1, 1, 1]), TILE.TAN_SHIRT, CS(0.95, 0.92, 0.82), joint('head', 'chest', 1.52, 0.045), 2.5, false)
    }
  } else {
    const r = rnd()
    if (r < 0.34) {
      headgear = 'shemagh'
      const red = chance(0.5)
      const stile = red ? TILE.SHEMAGH_RED : TILE.SHEMAGH
      const sc = vary(pick([CS(1, 1, 1), CS(1, 0.95, 0.82), CS(0.9, 0.92, 0.95)]), 0.06)
      // Wrapped head + face cloth with an eye slit, folds sculpted in.
      b.add(H.wrap, mat([0, 0, 0], [1, 1, 1]), red ? TILE.SHEMAGH_WRAP_RED : TILE.SHEMAGH_WRAP, sc, headW, 1, false)
      b.add(loftGeo([
        { y: 1.505, rx: 0.1, rz: 0.1 },
        { y: 1.575, rx: 0.095, rz: 0.098 },
        { y: 1.62, rx: 0.088, rz: 0.1, cz: -0.004 },
      ], 12), mat([0, 0, 0], [1, 1, 1]), stile, sc, joint('head', 'chest', 1.52, 0.045), 2.5, false)
      b.add(T.box, mat([0, 1.43, 0.115], [0.17, 0.2, 0.025], [-0.12, 0, 0]), stile, sc, rigid('chest'), 2.5, false) // tail
      b.add(T.box, mat([0.09, 1.52, -0.09], [0.08, 0.1, 0.03], [0, 0.3, 0.2]), stile, sc, joint('head', 'chest', 1.52, 0.05), 2.5, false)
    } else if (r < 0.52) {
      headgear = 'balaclava'
      // Knit balaclava: ribbed shell with a cut eye slit; charcoal, olive or tan.
      const bcol = pick([CS(1, 1, 1), CS(1, 1, 1), CS(1.25, 1.35, 1.0), CS(1.9, 1.62, 1.18)])
      b.add(H.balaclava, mat([0, 0, 0], [1, 1, 1]), TILE.BALACLAVA, bcol, headW, 1, false)
      b.add(loftGeo([
        { y: 1.49, rx: 0.074, rz: 0.074 },
        { y: 1.58, rx: 0.07, rz: 0.072 },
      ], 12), mat([0, 0, 0], [1, 1, 1]), TILE.BALACLAVA, bcol, joint('head', 'chest', 1.52, 0.045), 2.5, false)
    } else if (r < 0.66) {
      headgear = 'beanie'
      const bc = pick([CS(0.12, 0.12, 0.12), CS(0.2, 0.24, 0.16), CS(0.42, 0.36, 0.28)])
      b.add(T.dome, mat([0, 1.69, 0.006], [0.098, 0.1, 0.112], [0.12, 0, 0]), TILE.KNIT, bc, headW, 2.5, false)
    } else if (r < 0.74) {
      headgear = 'helmet'
      b.add(T.dome, mat([0, 1.695, 0.01], [0.114, 0.1, 0.13], [0.1, 0, 0]), TILE.RANGER, CS(0.9, 0.9, 0.9), headW, 2.5, false)
      b.add(loftGeo([
        { y: 1.668, rx: 0.115, rz: 0.131, cz: 0.012 },
        { y: 1.695, rx: 0.114, rz: 0.13, cz: 0.01 },
      ], 16), matAbout([0, 1.665, 0], [0.1, 0, 0]), TILE.RANGER, CS(0.8, 0.8, 0.8), headW, 2.5, false)
    } else {
      headgear = 'bare'
      b.add(T.dome, mat([0, 1.712, 0.01], [0.089, 0.067, 0.104], [0.12, 0, 0]), TILE.KNIT, hair.clone().multiplyScalar(1.6), headW, 2.5, false)
    }

    if (headgear !== 'balaclava' && chance(0.4)) {
      b.add(T.box, mat([0, 1.676, -0.097], [0.134, 0.028, 0.02]), TILE.METAL, CS(0.05, 0.05, 0.06), headW, 2.5, false)
    }
  }

  // ── Gear: plate carrier (TF) / chest rig (OpFor), pouches, pack
  if (team === 'tf141') {
    const gw = rigid('chest')
    b.add(T.box, mat([0, 1.29, -0.116], [0.31, 0.35, 0.065]), gearTile, gearColor, gw, 2)
    b.add(T.box, mat([0, 1.29, 0.116], [0.31, 0.35, 0.065]), gearTile, gearColor, gw, 2)
    b.add(T.box, mat([0.12, 1.45, -0.01], [0.065, 0.04, 0.24], [0.05, 0, 0]), gearTile, gearColor, gw, 2)
    b.add(T.box, mat([-0.12, 1.45, -0.01], [0.065, 0.04, 0.24], [0.05, 0, 0]), gearTile, gearColor, gw, 2)
    b.add(loftGeo([
      { y: 1.1, rx: 0.188, rz: 0.12 },
      { y: 1.21, rx: 0.2, rz: 0.126 },
    ], 16), mat([0, 0, 0], [1, 1, 1]), gearTile, gearColor, torsoChain, 2)
    for (let i = -1; i <= 1; i++) {
      b.add(T.box, mat([i * 0.098, 1.15, -0.155], [0.085, 0.115, 0.06]), gearTile, vary(gearColor, 0.12), gw, 1.6)
      b.add(T.box, mat([i * 0.098, 1.2, -0.172], [0.08, 0.03, 0.03]), gearTile, vary(gearColor, 0.15), gw, 1.6)
    }
    b.add(T.box, mat([-0.12, 1.37, -0.15], [0.075, 0.13, 0.05]), gearTile, vary(gearColor, 0.12), gw, 1.6) // radio pouch
    b.add(T.box, mat([0.12, 1.38, -0.148], [0.07, 0.1, 0.045]), gearTile, vary(gearColor, 0.12), gw, 1.6) // admin
    b.add(T.cyl, mat([0.1, 1.04, 0.0], [0.04, 0.05, 0.04]), TILE.COYOTE, CS(0.8, 0.8, 0.8), rigid('pelvis'), 1.6) // canteen
    b.add(T.box, mat([-0.19, 0.99, 0.0], [0.07, 0.11, 0.1]), gearTile, vary(gearColor, 0.12), rigid('pelvis'), 1.6)
    if (chance(0.38)) {
      b.add(T.box, mat([0, 1.3, 0.21], [0.29, 0.34, 0.15]), gearTile, vary(gearColor, 0.1), gw, 1.6)
      b.add(T.box, mat([0, 1.3, 0.285], [0.24, 0.22, 0.05]), gearTile, vary(gearColor, 0.15), gw, 1.6)
      b.add(T.cyl, mat([0, 1.51, 0.2], [0.065, 0.15, 0.065], [0, 0, Math.PI / 2]), TILE.KHAKI, CS(0.85, 0.85, 0.8), gw, 1.6)
    }
    if (chance(0.4)) {
      // Dump pouch / drop-leg holster.
      b.add(T.box, mat([0.19, 0.78, -0.02], [0.055, 0.17, 0.09]), TILE.BLACK_NYLON, CS(0.7, 0.7, 0.7), rigid('thighR'), 1.6)
    }
  } else {
    const gw = rigid('chest')
    const rigTile = gearTile
    b.add(T.box, mat([0, 1.27, -0.118], [0.28, 0.22, 0.05]), rigTile, gearColor, gw, 2)
    b.add(T.box, mat([0.12, 1.43, -0.01], [0.05, 0.03, 0.22], [0.05, 0, 0]), rigTile, gearColor, gw, 2)
    b.add(T.box, mat([-0.12, 1.43, -0.01], [0.05, 0.03, 0.22], [0.05, 0, 0]), rigTile, gearColor, gw, 2)
    const magCol = pick([CS(0.25, 0.2, 0.15), CS(0.12, 0.12, 0.12), CS(0.28, 0.3, 0.2)])
    for (const x of [-0.105, -0.035, 0.035, 0.105]) {
      b.add(T.box, mat([x, 1.245, -0.153], [0.058, 0.13, 0.04]), TILE.LEATHER, magCol, gw, 1.6)
      b.add(T.box, mat([x, 1.31, -0.157], [0.05, 0.03, 0.03]), TILE.METAL, CS(0.5, 0.5, 0.5), gw, 1.6)
    }
    if (chance(0.4)) {
      b.add(T.box, mat([0.02, 1.3, -0.108], [0.07, 0.62, 0.025], [0, 0, 0.62]), TILE.LEATHER, CS(0.8, 0.7, 0.5), gw, 1.6) // bandolier
    }
    if (chance(0.3)) b.add(T.box, mat([0, 1.3, 0.17], [0.26, 0.3, 0.11]), TILE.RANGER, vary(CS(1, 1, 1), 0.1), gw, 1.6) // small pack
    b.add(T.box, mat([-0.18, 0.99, 0.0], [0.06, 0.1, 0.1]), TILE.LEATHER, CS(0.7, 0.7, 0.7), rigid('pelvis'), 1.6)
  }

  // ── Arms & legs per side
  for (const s of [1, -1] as const) {
    const n = side(s)
    const sx = s * 0.205
    const elbow = joint(n.uarm, n.farm, 1.125, 0.055)
    const wrist = joint(n.farm, n.hand, 0.86, 0.025)
    const upperTile = sleeveless ? TILE.SKIN : topTile
    const upperColor = sleeveless ? SK() : topColor
    // Shoulder cap + upper arm.
    b.add(T.sphere, mat([sx, 1.41, 0], [0.08, 0.082, 0.08]), upperTile, upperColor, rigid(n.uarm), 1.8)
    b.add(loftGeo([
      { y: 1.42, rx: 0.0739, rz: 0.0739, cx: sx },
      { y: 1.3, rx: 0.0694, rz: 0.0694, cx: sx },
      { y: 1.2, rx: 0.0627, rz: 0.0638, cx: sx },
      { y: 1.125, rx: 0.0582, rz: 0.0594, cx: sx },
      { y: 1.07, rx: 0.056, rz: 0.056, cx: sx },
    ], 10), mat([0, 0, 0], [1, 1, 1]), upperTile, upperColor, elbow, 1.8)
    // Forearm: sleeve to the roll line, skin below if rolled.
    const rollY = bareForearm ? 1.0 : 0.88
    b.add(loftGeo([
      { y: 1.125, rx: 0.056, rz: 0.0582, cx: sx },
      { y: rollY, rx: 0.0504, rz: 0.0515, cx: sx },
    ], 10), mat([0, 0, 0], [1, 1, 1]), topTile, topColor, elbow, 1.8)
    b.add(loftGeo([
      { y: rollY + 0.01, rx: 0.0538, rz: 0.0549, cx: sx },
      { y: 0.9, rx: 0.0448, rz: 0.0448, cx: sx },
      { y: 0.85, rx: 0.0403, rz: 0.0403, cx: sx },
    ], 10), mat([0, 0, 0], [1, 1, 1]), bareForearm ? TILE.SKIN : topTile, bareForearm ? SK() : topColor, wrist, 1.8, !bareForearm)
    if (team === 'tf141' && chance(0.3)) {
      b.add(T.box, mat([sx, 1.125, -0.01], [0.085, 0.09, 0.09]), TILE.COYOTE, CS(0.85, 0.85, 0.85), rigid(n.farm), 1.6) // elbow pad
    }
    // Hand / glove.
    const gloved = team === 'tf141' ? chance(0.75) : chance(0.3)
    const gTile = gloved ? (team === 'tf141' ? pick([TILE.COYOTE, TILE.BLACK_NYLON]) : TILE.BLACK_NYLON) : TILE.SKIN
    const gCol = gloved ? CS(0.9, 0.9, 0.9) : SK()
    b.add(T.box, mat([sx, 0.815, -0.004], [0.084, 0.09, 0.046]), gTile, gCol, rigid(n.hand), 2, false)
    b.add(T.box, mat([sx, 0.755, -0.016], [0.08, 0.05, 0.042], [0.5, 0, 0]), gTile, gCol, rigid(n.hand), 2, false)
    b.add(T.box, mat([sx - s * 0.04, 0.8, -0.03], [0.026, 0.06, 0.03], [0.2, 0, s * 0.3]), gTile, gCol, rigid(n.hand), 2, false)

    // Leg.
    const lx = s * 0.1
    const knee = joint(n.thigh, n.shin, 0.495, 0.055)
    b.add(loftGeo([
      { y: 1.0, rx: 0.122, rz: 0.1175, cx: lx },
      { y: 0.88, rx: 0.1141, rz: 0.1119, cx: lx },
      { y: 0.7, rx: 0.0994, rz: 0.0994, cx: lx },
      { y: 0.55, rx: 0.0836, rz: 0.0847, cx: lx },
      { y: 0.495, rx: 0.0791, rz: 0.0802, cx: lx },
    ], 10), mat([0, 0, 0], [1, 1, 1]), pantsTile, pantsColor, hipKnee(n.thigh, n.shin), 1.8)
    b.add(loftGeo([
      { y: 0.495, rx: 0.0791, rz: 0.0802, cx: lx },
      { y: 0.4, rx: 0.0723, rz: 0.0746, cx: lx },
      { y: 0.26, rx: 0.0633, rz: 0.0655, cx: lx },
      { y: 0.18, rx: 0.0701, rz: 0.0701, cx: lx },
    ], 10), mat([0, 0, 0], [1, 1, 1]), pantsTile, pantsColor, knee, 1.8)
    // Boots / sneakers.
    const sneaker = team === 'opfor' && chance(0.35)
    const bootTile = sneaker ? TILE.WHITE : TILE.LEATHER
    const bootCol = sneaker ? pick([CS(0.8, 0.8, 0.78), CS(0.15, 0.15, 0.16), CS(0.5, 0.2, 0.15)]) : team === 'tf141' ? CS(1.5, 1.15, 0.85) : CS(1, 0.95, 0.9)
    b.add(loftGeo([
      { y: 0.2, rx: 0.0657, rz: 0.0657, cx: lx },
      { y: 0.14, rx: 0.0657, rz: 0.07, cx: lx },
      { y: 0.07, rx: 0.0657, rz: 0.0742, cx: lx, cz: -0.012 },
    ], 10), mat([0, 0, 0], [1, 1, 1]), bootTile, bootCol, rigid(n.shin), 1.8)
    b.add(T.box, mat([lx, 0.05, -0.06], [0.1, 0.082, 0.285]), bootTile, bootCol, rigid(n.foot), 1.8)
    b.add(T.sphere, mat([lx, 0.044, -0.185], [0.05, 0.04, 0.05]), bootTile, bootCol, rigid(n.foot), 1.8)
    b.add(T.box, mat([lx, 0.011, -0.065], [0.106, 0.024, 0.3]), TILE.LEATHER, CS(0.28, 0.26, 0.24), rigid(n.foot), 1.8)
    b.add(T.box, mat([lx, 0.08, 0.042], [0.095, 0.1, 0.07]), bootTile, bootCol, rigid(n.foot), 1.8)
    // Knee pad, thigh pocket.
    if (team === 'tf141' || chance(0.25)) {
      b.add(T.box, mat([lx, 0.5, -0.073], [0.105, 0.125, 0.05]), team === 'tf141' ? gearTile : TILE.BLACK_NYLON, team === 'tf141' ? gearColor : CS(0.8, 0.8, 0.8), knee, 1.6)
    }
    b.add(T.box, mat([s * 0.208, 0.78, 0.0], [0.05, 0.16, 0.12]), pantsTile, vary(pantsColor, 0.05), rigid(n.thigh), 1.6)
  }

  // ── Build skeleton & mesh
  const geo = b.build()
  const bones = {} as Record<BoneName, Bone>
  const boneList: Bone[] = []
  for (const name of BONE_ORDER) {
    const bone = new Bone()
    bone.name = name
    bones[name] = bone
    boneList.push(bone)
  }
  for (const name of BONE_ORDER) {
    const p = PARENT[name]
    const r = REST[name]
    if (p) {
      const pr = REST[p]
      bones[name].position.set(r[0] - pr[0], r[1] - pr[1], r[2] - pr[2])
      bones[p].add(bones[name])
    } else bones[name].position.set(r[0], r[1], r[2])
  }

  const root = new Group()
  const mesh = new SkinnedMesh(geo, getMaterial())
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  root.add(mesh)
  mesh.add(bones.pelvis)
  root.updateMatrixWorld(true)
  mesh.bind(new Skeleton(boneList))

  const mount = new Object3D()
  mount.name = 'weaponMount'
  bones.chest.add(mount)

  const knife = new Group()
  const blade = new Mesh(new RoundedBoxGeometry(0.02, 0.012, 0.17, 1, 0.003), new MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.3 }))
  blade.position.set(0, 0, -0.12)
  const handle = new Mesh(new RoundedBoxGeometry(0.026, 0.026, 0.1, 1, 0.01), new MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 }))
  knife.add(blade, handle)
  knife.visible = false
  bones.handR.add(knife)
  knife.position.set(0, -0.06, -0.02)
  knife.traverse((o) => {
    o.castShadow = true
  })

  return {
    root,
    mesh,
    bones,
    boneList,
    mount,
    knife,
    skin,
    headgear,
    dispose() {
      geo.dispose()
      mesh.skeleton.dispose()
    },
  }
}
