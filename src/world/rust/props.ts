/**
 * Reusable Rust props built on MapBuilder (merged static geometry) and an Instancer
 * (InstancedMesh per repeated prop). All functions take world or frame-local coordinates as
 * documented; frame-local ones work inside `b.frame(...)`.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  type Material,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  TorusGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  Vector2,
  Vector3,
  Euler,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Ladder, Surface } from '../../core/types'
import type { MapBuilder } from '../builder'
import type { MatKey } from '../materials'
import { fbm, groundY } from './terrain'

export type FpKind = 'building' | 'container' | 'tower' | 'tank' | 'low' | 'pad' | 'pipe' | 'derrick' | 'road'

export interface Footprint {
  x: number
  z: number
  w: number
  d: number
  ry: number
  kind: FpKind
  /** Optional CSS fill override (e.g. container colour). */
  fill?: string
}

export interface Ctx {
  b: MapBuilder
  inst: Instancer
  ladders: Ladder[]
  fp: Footprint[]
}

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler()
const _p = new Vector3()
const _s = new Vector3()
const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)

// ─── Instancer ─────────────────────────────────────────────────────────────

interface InstDef {
  geo: BufferGeometry
  mat: Material
  list: Matrix4[]
  shadow: boolean
}

export class Instancer {
  private defs = new Map<string, InstDef>()
  count = 0
  constructor(private b: MapBuilder) {}

  def(key: string, geo: BufferGeometry, mat: Material, shadow = true) {
    this.defs.set(key, { geo, mat, list: [], shadow })
  }
  has(key: string) {
    return this.defs.has(key)
  }

  /** Add an instance in world space. */
  add(key: string, x: number, y: number, z: number, ry = 0, scale: number | Vector3 = 1, rx = 0, rz = 0) {
    const d = this.defs.get(key)
    if (!d) throw new Error(`Instancer: unknown ${key}`)
    _e.set(rx, ry, rz, 'YXZ')
    _q.setFromEuler(_e)
    if (typeof scale === 'number') _s.set(scale, scale, scale)
    else _s.copy(scale)
    d.list.push(new Matrix4().compose(_p.set(x, y, z), _q, _s))
    this.count++
  }

  /** Same as add but also registers a collider geometry with the same transform. */
  addSolid(key: string, collider: BufferGeometry, surface: Surface, x: number, y: number, z: number, ry = 0, scale: number | Vector3 = 1, rx = 0, rz = 0) {
    this.add(key, x, y, z, ry, scale, rx, rz)
    const d = this.defs.get(key)!
    this.b.collision.addGeometry(collider, d.list[d.list.length - 1]!, surface)
    this.b.colTris += (collider.index ? collider.index.count : collider.getAttribute('position').count) / 3
  }

  finish(parent: Group) {
    let n = 0
    let tris = 0
    for (const [key, d] of this.defs) {
      if (!d.list.length) continue
      const im = new InstancedMesh(d.geo, d.mat, d.list.length)
      d.list.forEach((m, i) => im.setMatrixAt(i, m))
      im.instanceMatrix.needsUpdate = true
      im.castShadow = d.shadow
      im.receiveShadow = true
      im.name = `inst:${key}`
      im.computeBoundingSphere()
      parent.add(im)
      n++
      tris += ((d.geo.index ? d.geo.index.count : d.geo.getAttribute('position').count) / 3) * d.list.length
    }
    return { meshes: n, tris }
  }
}

// ─── shared prototype geometry ─────────────────────────────────────────────

function barrelGeometry() {
  const r = 0.29
  const h = 0.88
  const pts: Vector2[] = [new Vector2(0, 0), new Vector2(r - 0.02, 0), new Vector2(r, 0.015), new Vector2(r, 0.02)]
  const hoops = [0.02, 0.3, 0.58, 0.86]
  for (let i = 0; i < hoops.length; i++) {
    const y = hoops[i]!
    if (i > 0 && i < hoops.length - 1) {
      pts.push(new Vector2(r, y - 0.03), new Vector2(r + 0.012, y - 0.012), new Vector2(r + 0.012, y + 0.012), new Vector2(r, y + 0.03))
    }
  }
  pts.push(new Vector2(r, h - 0.02), new Vector2(r + 0.006, h - 0.01), new Vector2(r - 0.005, h), new Vector2(r - 0.03, h - 0.015), new Vector2(0, h - 0.012))
  const g = new LatheGeometry(pts, 20)
  return g
}

function rockGeometry(seed: number, detail = 2) {
  const g = new IcosahedronGeometry(1, detail)
  const p = g.getAttribute('position')
  const v = new Vector3()
  // random cutting planes give flat fractured faces; noise adds erosion
  const planes: [Vector3, number][] = []
  let s = seed * 9301 + 49297
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  for (let i = 0; i < 7; i++) {
    const n = new Vector3(rnd() - 0.5, (rnd() - 0.3) * 0.8, rnd() - 0.5).normalize()
    planes.push([n, 0.55 + rnd() * 0.3])
  }
  planes.push([new Vector3(0, 1, 0), 0.6 + rnd() * 0.2])
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = fbm(v.x * 1.7 + seed, v.y * 1.7 + v.z * 0.9 - seed, 4, seed)
    v.multiplyScalar(0.85 + n * 0.4)
    for (const [pn, d] of planes) {
      const k = v.dot(pn)
      if (k > d) v.addScaledVector(pn, -(k - d) * 0.92)
    }
    v.y *= 0.8
    p.setXYZ(i, v.x, v.y, v.z)
  }
  const ng = g.index ? g.toNonIndexed() : g
  ng.computeVertexNormals()
  const pp = ng.getAttribute('position')
  const nn = ng.getAttribute('normal')
  const uv = new Float32Array(pp.count * 2)
  for (let i = 0; i < pp.count; i++) {
    // per-face planar projection along the dominant normal axis
    const ax = Math.abs(nn.getX(i))
    const ay = Math.abs(nn.getY(i))
    const az = Math.abs(nn.getZ(i))
    let a: number
    let b: number
    if (ay >= ax && ay >= az) [a, b] = [pp.getX(i), pp.getZ(i)]
    else if (ax >= az) [a, b] = [pp.getZ(i), pp.getY(i)]
    else [a, b] = [pp.getX(i), pp.getY(i)]
    uv[i * 2] = a * 0.45
    uv[i * 2 + 1] = b * 0.45
  }
  ng.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  return ng
}

function sandbagGeometry() {
  const g = new BoxGeometry(0.62, 0.17, 0.36, 6, 2, 4)
  const p = g.getAttribute('position')
  const v = new Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const ex = Math.abs(v.x) / 0.31
    const ez = Math.abs(v.z) / 0.18
    const ey = v.y / 0.085
    // pillow: squash height at the edges, round the corners
    const edge = Math.max(ex, ez)
    v.y = ey * 0.085 * (1 - edge ** 4 * 0.55)
    v.x *= 1 - ez ** 4 * 0.12
    v.z *= 1 - ex ** 6 * 0.25 - Math.abs(ey) * 0.08
    // tied ends taper
    if (ex > 0.9) v.y *= 0.8
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  // the sandbag texture is an atlas of 2 x 4 bags; map every face onto one bag
  const uv = g.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.04 + uv.getX(i) * 0.42, 0.02 + uv.getY(i) * 0.21)
  return g
}

function shrubGeometry(seed: number) {
  const geos: BufferGeometry[] = []
  let s = seed
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2
    const tilt = 0.35 + rnd() * 0.9
    const len = 0.35 + rnd() * 0.45
    const c = new CylinderGeometry(0.004, 0.014, len, 3, 1, true)
    c.translate(0, len / 2, 0)
    const m = new Matrix4().makeRotationFromEuler(new Euler(tilt * Math.cos(a), 0, tilt * Math.sin(a)))
    c.applyMatrix4(m)
    geos.push(c)
    // twiggy forks
    const f = new CylinderGeometry(0.002, 0.007, len * 0.5, 3, 1, true)
    f.translate(0, len * 0.25, 0)
    const m2 = new Matrix4().makeRotationFromEuler(new Euler(tilt * Math.cos(a + 0.6) * 1.4, 0, tilt * Math.sin(a + 0.6) * 1.4))
    f.applyMatrix4(m2)
    f.translate(...new Vector3(0, len * 0.6, 0).applyMatrix4(m).toArray())
    geos.push(f)
  }
  const g = mergeGeometries(geos.map((x) => x.toNonIndexed()), false)!
  for (const x of geos) x.dispose()
  g.deleteAttribute('uv')
  return g
}

function tumbleweedGeometry(seed: number) {
  const geos: BufferGeometry[] = []
  let s = seed
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647 - 0.5
  }
  for (let i = 0; i < 16; i++) {
    const pts: Vector3[] = []
    const ax = new Vector3(rnd(), rnd(), rnd()).normalize()
    const start = new Vector3(rnd(), rnd(), rnd()).normalize()
    for (let k = 0; k < 7; k++) {
      const v = start.clone().applyAxisAngle(ax, (k / 6) * Math.PI * 1.3)
      v.multiplyScalar(0.32 + rnd() * 0.1)
      pts.push(v)
    }
    const t = new TubeGeometry(new CatmullRomCurve3(pts), 10, 0.006, 3, false)
    geos.push(t)
  }
  const g = mergeGeometries(geos, false)!
  for (const x of geos) x.dispose()
  g.deleteAttribute('uv')
  return g
}

export function registerPrototypes(c: Ctx) {
  const { inst, b } = c
  const M = b.mats
  const barrel = barrelGeometry()
  inst.def('barrelBlue', barrel, M.barrelBlue.mat)
  inst.def('barrelRed', barrel, M.barrelRed.mat)
  inst.def('barrelRust', barrel, M.rust.mat)
  inst.def('barrelGrey', barrel, M.pipeGrey.mat)
  for (let i = 0; i < 3; i++) inst.def(`rock${i}`, rockGeometry(i * 7 + 3, 2), M.rock.mat)
  inst.def('sandbag', sandbagGeometry(), M.sandbag.mat)
  const shrubMat = new MeshStandardMaterial({ color: 0x5a4b34, roughness: 1, metalness: 0 })
  inst.def('shrub0', shrubGeometry(11), shrubMat)
  inst.def('shrub1', shrubGeometry(29), new MeshStandardMaterial({ color: 0x6b6343, roughness: 1, metalness: 0 }))
  inst.def('tumble', tumbleweedGeometry(5), new MeshStandardMaterial({ color: 0x8a7350, roughness: 1, metalness: 0 }))
  const tire = new TorusGeometry(0.34, 0.12, 8, 20)
  tire.rotateX(Math.PI / 2)
  inst.def('tire', tire, M.rubber.mat)
  const block = new BoxGeometry(0.39, 0.19, 0.19)
  inst.def('cinder', block, M.concreteDark.mat)
  const brick = new DodecahedronGeometry(0.12, 0)
  inst.def('pebble', brick, M.rock.mat, false)
}

// colliders shared by instancing
const barrelCol = new CylinderGeometry(0.3, 0.3, 0.88, 8).translate(0, 0.44, 0)
const tireCol = new CylinderGeometry(0.46, 0.46, 0.24, 8)

// ─── small helpers ────────────────────────────────────────────────────────

/** World position of a local (lx, lz) offset from (x, z) rotated by ry. */
export function rot(x: number, z: number, ry: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(ry)
  const s = Math.sin(ry)
  return [x + lx * c + lz * s, z - lx * s + lz * c]
}

export function barrel(c: Ctx, x: number, z: number, kind: 'barrelBlue' | 'barrelRed' | 'barrelRust' | 'barrelGrey', o: { y?: number; ry?: number; tipped?: boolean } = {}) {
  const y = o.y ?? groundY(x, z) - 0.01
  const ry = o.ry ?? c.b.rand(0, Math.PI * 2)
  if (o.tipped) {
    c.inst.addSolid(kind, barrelCol, 'metal', x, y + 0.29, z, ry, 1, 0, Math.PI / 2)
  } else {
    c.inst.addSolid(kind, barrelCol, 'metal', x, y, z, ry, 1, c.b.rand(-0.02, 0.02), c.b.rand(-0.02, 0.02))
  }
}

/** A loose cluster of barrels around (x, z). */
export function barrelCluster(c: Ctx, x: number, z: number, n: number, kinds: ('barrelBlue' | 'barrelRed' | 'barrelRust' | 'barrelGrey')[], tipped = 0, y?: number) {
  const placed: [number, number][] = []
  let tries = 0
  while (placed.length < n && tries++ < 80) {
    const a = c.b.rand(0, Math.PI * 2)
    const r = placed.length === 0 ? 0 : c.b.rand(0.62, 0.62 + Math.sqrt(n) * 0.45)
    const px = x + Math.cos(a) * r
    const pz = z + Math.sin(a) * r
    if (placed.some(([qx, qz]) => Math.hypot(qx - px, qz - pz) < 0.62)) continue
    placed.push([px, pz])
    barrel(c, px, pz, c.b.pick(kinds), { y })
  }
  for (let i = 0; i < tipped; i++) {
    const a = c.b.rand(0, Math.PI * 2)
    const px = x + Math.cos(a) * (Math.sqrt(n) * 0.6 + 1.0)
    const pz = z + Math.sin(a) * (Math.sqrt(n) * 0.6 + 1.0)
    barrel(c, px, pz, c.b.pick(kinds), { tipped: true, y })
  }
}

export function tireStack(c: Ctx, x: number, z: number, n: number, y?: number) {
  const y0 = y ?? groundY(x, z)
  for (let i = 0; i < n; i++) {
    const tx = x + c.b.rand(-0.05, 0.05)
    const tz = z + c.b.rand(-0.05, 0.05)
    c.inst.addSolid('tire', tireCol, 'dirt', tx, y0 + 0.12 + i * 0.23, tz, c.b.rand(0, 6), 1, c.b.rand(-0.04, 0.04), c.b.rand(-0.04, 0.04))
  }
}

// ─── structural members ───────────────────────────────────────────────────

const ibeamCache = new Map<string, Shape>()
function iShape(w: number, h: number) {
  const key = `${w}|${h}`
  let s = ibeamCache.get(key)
  if (s) return s
  const tf = Math.max(0.012, h * 0.08)
  const tw = Math.max(0.008, w * 0.06)
  s = new Shape()
  s.moveTo(-w / 2, -h / 2)
  s.lineTo(w / 2, -h / 2)
  s.lineTo(w / 2, -h / 2 + tf)
  s.lineTo(tw / 2, -h / 2 + tf)
  s.lineTo(tw / 2, h / 2 - tf)
  s.lineTo(w / 2, h / 2 - tf)
  s.lineTo(w / 2, h / 2)
  s.lineTo(-w / 2, h / 2)
  s.lineTo(-w / 2, h / 2 - tf)
  s.lineTo(-tw / 2, h / 2 - tf)
  s.lineTo(-tw / 2, -h / 2 + tf)
  s.lineTo(-w / 2, -h / 2 + tf)
  s.closePath()
  ibeamCache.set(key, s)
  return s
}

function lShape(s: number) {
  const t = Math.max(0.008, s * 0.12)
  const sh = new Shape()
  sh.moveTo(-s / 2, -s / 2)
  sh.lineTo(s / 2, -s / 2)
  sh.lineTo(s / 2, -s / 2 + t)
  sh.lineTo(-s / 2 + t, -s / 2 + t)
  sh.lineTo(-s / 2 + t, s / 2)
  sh.lineTo(-s / 2, s / 2)
  sh.closePath()
  return sh
}

function orientAlong(a: Vector3, bb: Vector3, roll = 0) {
  const dir = new Vector3().subVectors(bb, a)
  const len = dir.length()
  dir.divideScalar(len)
  // Keep the profile "up" (local Y) as vertical as possible.
  let q: Quaternion
  if (Math.abs(dir.y) > 0.999) {
    q = new Quaternion().setFromUnitVectors(Z, dir)
  } else {
    const xAxis = new Vector3().crossVectors(Y, dir).normalize()
    const yAxis = new Vector3().crossVectors(dir, xAxis).normalize()
    q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, dir))
  }
  if (roll) q.multiply(new Quaternion().setFromAxisAngle(Z, roll))
  const mid = new Vector3().addVectors(a, bb).multiplyScalar(0.5)
  return { len, m: new Matrix4().compose(mid, q, new Vector3(1, 1, 1)) }
}

/** Steel I-beam between two frame-local points. w = flange width, h = depth. */
export function ibeam(b: MapBuilder, mat: MatKey, a: Vector3, bb: Vector3, w: number, h: number, o: { roll?: number; col?: Surface | false } = {}) {
  const { len, m } = orientAlong(a, bb, o.roll)
  if (len < 1e-3) return
  const g = new ExtrudeGeometry(iShape(w, h), { depth: len, bevelEnabled: false, curveSegments: 1 })
  g.translate(0, 0, -len / 2)
  const col = o.col === false ? undefined : new BoxGeometry(w, h, len)
  b.place(mat, g, m, { col: o.col, collider: col })
  g.dispose()
  col?.dispose()
}

/** L-angle (bracing) between two frame-local points. */
export function angle(b: MapBuilder, mat: MatKey, a: Vector3, bb: Vector3, s: number, o: { roll?: number; col?: Surface | false } = {}) {
  const { len, m } = orientAlong(a, bb, o.roll)
  if (len < 1e-3) return
  const g = new ExtrudeGeometry(lShape(s), { depth: len, bevelEnabled: false, curveSegments: 1 })
  g.translate(0, 0, -len / 2)
  const col = o.col === false ? undefined : new BoxGeometry(s, s, len)
  b.place(mat, g, m, { col: o.col ?? false, collider: col })
  g.dispose()
  col?.dispose()
}

/** Profile depth (0..1) at fraction t of one corrugation pitch. */
function profileAt(t: number, trap: boolean) {
  if (!trap) return Math.sin(t * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5
  if (t < 0.15 || t > 0.85) return 0
  if (t < 0.3) return (t - 0.15) / 0.15
  if (t > 0.7) return (0.85 - t) / 0.15
  return 1
}

/**
 * Corrugated sheet (real profiled geometry) w × h, centred at local (x,y,z), facing ±Z (rotate
 * with ry). Ridge pitch is tied to the material's texture tile so geometry and normal map agree:
 * sine = 8 waves per tile (tin), trap = 11 ribs per tile (containers).
 */
export function corrugated(
  b: MapBuilder,
  mat: MatKey,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  o: { ry?: number; rx?: number; rz?: number; col?: Surface | false; trap?: boolean; depth?: number } = {},
) {
  const def = b.mats[mat]
  const trap = o.trap ?? false
  const perTile = trap ? 11 : 8
  const pitch = def.tw / perTile
  const depth = o.depth ?? (trap ? 0.035 : 0.022)
  const samples = trap ? [0, 0.15, 0.3, 0.7, 0.85] : [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]
  const xs: number[] = []
  const n = Math.max(1, Math.round(w / pitch))
  const realPitch = w / n
  for (let i = 0; i < n; i++) for (const t of samples) xs.push((i + t) * realPitch)
  xs.push(w)
  const pos: number[] = []
  const uv: number[] = []
  const ov = b.rand(0, 1)
  const ou = Math.floor(b.rand(0, 4))
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]!
    const x1 = xs[i + 1]!
    const z0 = profileAt(fractOf(x0 / realPitch), trap) * depth - depth / 2
    const z1 = profileAt(i + 1 === xs.length - 1 ? 0 : fractOf(x1 / realPitch), trap) * depth - depth / 2
    const ax = x0 - w / 2
    const bx = x1 - w / 2
    // two triangles (non-indexed so ridges stay crisp for trapezoids)
    const quad: [number, number, number][] = [
      [ax, -h / 2, z0],
      [bx, -h / 2, z1],
      [bx, h / 2, z1],
      [ax, -h / 2, z0],
      [bx, h / 2, z1],
      [ax, h / 2, z0],
    ]
    for (const [px, py, pz] of quad) {
      pos.push(px, py, pz)
      uv.push((px + w / 2) / def.tw + ou, (py + h / 2) / def.th + ov)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  if (trap) g.computeVertexNormals()
  else {
    // smooth normals for sine sheets
    const idxG = mergeByPosition(g)
    idxG.computeVertexNormals()
    g.setAttribute('normal', idxG.toNonIndexed().getAttribute('normal'))
  }
  const col = o.col === false ? undefined : new BoxGeometry(w, h, Math.max(0.05, depth))
  b.geo(mat, g, x, y, z, { ry: o.ry, rx: o.rx, rz: o.rz, keepUV: true, col: o.col, collider: col })
  g.dispose()
  col?.dispose()
}

const fractOf = (v: number) => v - Math.floor(v + 1e-6)

function mergeByPosition(g: BufferGeometry) {
  const p = g.getAttribute('position')
  const map = new Map<string, number>()
  const verts: number[] = []
  const idx: number[] = []
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`
    let j = map.get(k)
    if (j === undefined) {
      j = verts.length / 3
      verts.push(p.getX(i), p.getY(i), p.getZ(i))
      map.set(k, j)
    }
    idx.push(j)
  }
  const out = new BufferGeometry()
  out.setAttribute('position', new Float32BufferAttribute(verts, 3))
  out.setIndex(idx)
  return out
}

// ─── ladders ──────────────────────────────────────────────────────────────

/**
 * Ladder against a face. `base` is the ladder plane point at the bottom (world), `n` points to the
 * climber. The player steps off onto whatever is behind the ladder at topY. Must be called with
 * an identity builder frame.
 */
export function ladder(c: Ctx, base: Vector3, topY: number, n: Vector3, width = 0.62, ext = 1.05, register = true, mat: MatKey = 'rustDark') {
  const b = c.b
  const t = new Vector3(-n.z, 0, n.x)
  const half = width / 2
  const y0 = base.y
  const y1 = topY + ext
  for (const sgn of [-1, 1]) {
    const px = base.x + t.x * half * sgn
    const pz = base.z + t.z * half * sgn
    b.box(mat, 0.06, y1 - y0, 0.07, px, (y0 + y1) / 2, pz, { ry: Math.atan2(n.x, n.z), col: false })
    // stand-off brackets back to the wall
    for (let yy = y0 + 1.2; yy < topY; yy += 2.4) {
      b.beam(mat, new Vector3(px, yy, pz), new Vector3(px - n.x * 0.2, yy, pz - n.z * 0.2), 0.04, 0.04, { col: false })
    }
    // grab handles curve over onto the deck
    b.beam(mat, new Vector3(px, y1, pz), new Vector3(px - n.x * 0.35, y1 - 0.25, pz - n.z * 0.35), 0.05, 0.05, { col: false })
  }
  for (let yy = y0 + 0.3; yy < topY - 0.05; yy += 0.3) {
    b.rod(mat, new Vector3(base.x - t.x * half, yy, base.z - t.z * half), new Vector3(base.x + t.x * half, yy, base.z + t.z * half), 0.016, 5, { col: false })
  }
  if (register) {
    c.ladders.push({
      bottom: new Vector3(base.x, y0, base.z),
      top: new Vector3(base.x, topY, base.z),
      normal: n.clone().setY(0).normalize(),
      width,
    })
  }
}

// ─── railings ─────────────────────────────────────────────────────────────

/** Railing along frame-local polyline at floor height y. */
export function railing(b: MapBuilder, pts: [number, number][], y: number, mat: MatKey = 'rust', o: { h?: number; col?: boolean } = {}) {
  const h = o.h ?? 1.05
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]!
    const [bx, bz] = pts[i + 1]!
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 0.05) continue
    const n = Math.max(1, Math.ceil(len / 1.6))
    for (let k = 0; k <= n; k++) {
      if (k === 0 && i > 0) continue
      const px = ax + ((bx - ax) * k) / n
      const pz = az + ((bz - az) * k) / n
      b.box(mat, 0.05, h, 0.05, px, y + h / 2, pz, { col: false })
    }
    b.rod(mat, new Vector3(ax, y + h, az), new Vector3(bx, y + h, bz), 0.024, 6, { col: false })
    b.rod(mat, new Vector3(ax, y + h * 0.52, az), new Vector3(bx, y + h * 0.52, bz), 0.016, 5, { col: false })
    const ry = Math.atan2(-(bz - az), bx - ax)
    b.box(mat, len, 0.1, 0.012, (ax + bx) / 2, y + 0.05, (az + bz) / 2, { ry, col: false })
    if (o.col !== false) b.colBox((ax + bx) / 2, y + h / 2 + 0.03, (az + bz) / 2, len, h + 0.06, 0.08, 'metal', { ry })
  }
}

// ─── containers ───────────────────────────────────────────────────────────

export const CONT = { L: 6.06, W: 2.44, H: 2.59 }

/**
 * ISO container. Local X is the long axis; doors at +X. `y` is the base height.
 * open: doors swung and a hollow interior you can walk into.
 */
export function container(c: Ctx, x: number, y: number, z: number, ry: number, mat: 'contBlue' | 'contRed' | 'contGreen', o: { open?: boolean; long?: boolean; fp?: boolean } = {}) {
  const b = c.b
  const L = o.long ? 12.19 : CONT.L
  const W = CONT.W
  const H = CONT.H
  const fill = mat === 'contBlue' ? '#4f6375' : mat === 'contRed' ? '#7a4e44' : '#5d6450'
  if (o.fp !== false) c.fp.push({ x, z, w: L, d: W, ry, kind: 'container', fill })
  b.frame(x, y, z, ry, () => {
    const t = 0.05
    // corrugated walls (real ribs), flat roof panel and floor
    const wc: Surface | false = o.open ? 'metal' : false
    corrugated(b, mat, L - 0.3, H - 0.26, 0, H / 2, W / 2 - 0.06, { trap: true, col: wc })
    corrugated(b, mat, L - 0.3, H - 0.26, 0, H / 2, -W / 2 + 0.06, { trap: true, col: wc, ry: Math.PI })
    corrugated(b, mat, W - 0.3, H - 0.26, -L / 2 + 0.06, H / 2, 0, { trap: true, col: wc, ry: -Math.PI / 2 })
    b.box(mat, L - 0.12, t, W - 0.12, 0, H - 0.05, 0, { col: o.open ? 'metal' : false })
    if (o.open) b.box('woodDark', L - 0.12, 0.08, W - 0.12, 0, 0.1, 0)
    else {
      b.box('black', L - 0.3, H - 0.3, W - 0.3, 0, H / 2, 0, { col: false })
      b.colBox(0, H / 2, 0, L, H, W, 'metal')
    }
    // frame: corner posts, rails
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.box(mat, 0.17, H, 0.17, sx * (L / 2 - 0.085), H / 2, sz * (W / 2 - 0.085), { col: false })
        for (const yy of [0.06, H - 0.06]) b.box('rustDark', 0.18, 0.12, 0.18, sx * (L / 2 - 0.085), yy, sz * (W / 2 - 0.085), { col: false })
      }
    }
    for (const sz of [-1, 1]) {
      b.box(mat, L - 0.3, 0.13, 0.1, 0, H - 0.07, sz * (W / 2 - 0.05), { col: false })
      b.box(mat, L - 0.3, 0.16, 0.1, 0, 0.08, sz * (W / 2 - 0.05), { col: false })
    }
    for (const sx of [-1, 1]) {
      b.box(mat, 0.1, 0.13, W - 0.3, sx * (L / 2 - 0.05), H - 0.07, 0, { col: false })
      b.box(mat, 0.1, 0.2, W - 0.3, sx * (L / 2 - 0.05), 0.1, 0, { col: false })
    }
    // doors at +X
    const dx = L / 2 - 0.02
    const doorW = (W - 0.3) / 2
    const doorH = H - 0.36
    const doors = o.open
      ? [
          { hz: W / 2 - 0.15, open: 1.9 },
          { hz: -W / 2 + 0.15, open: -0.25 },
        ]
      : [
          { hz: W / 2 - 0.15, open: 0 },
          { hz: -W / 2 + 0.15, open: 0 },
        ]
    for (const d of doors) {
      const sgn = d.hz > 0 ? -1 : 1
      b.frame(dx, 0, d.hz, d.open * -sgn, () => {
        const cz = (sgn * doorW) / 2
        b.box(mat, 0.04, doorH, doorW - 0.02, 0.02, H / 2, cz, { col: o.open ? 'metal' : false })
        // locking bars + cams
        for (const k of [0.28, 0.72]) {
          const bz = sgn * doorW * k
          b.rod('rustDark', new Vector3(0.07, 0.22, bz), new Vector3(0.07, H - 0.22, bz), 0.018, 6, { col: false })
          b.box('rustDark', 0.04, 0.05, 0.08, 0.06, 0.22, bz, { col: false })
          b.box('rustDark', 0.04, 0.05, 0.08, 0.06, H - 0.22, bz, { col: false })
          b.box('black', 0.05, 0.03, 0.22, 0.08, 1.2, bz + sgn * 0.08, { col: false })
        }
        // hinges
        for (const yy of [0.5, 1.3, 2.1]) b.box('rustDark', 0.06, 0.1, 0.06, 0.03, yy, 0, { col: false })
      })
    }
  })
}

// ─── concrete & barriers ──────────────────────────────────────────────────

let jerseyShape: Shape | null = null
export function jersey(c: Ctx, x: number, z: number, ry: number, len = 3.0) {
  if (!jerseyShape) {
    const s = new Shape()
    s.moveTo(-0.305, 0)
    s.lineTo(0.305, 0)
    s.lineTo(0.305, 0.075)
    s.lineTo(0.2, 0.33)
    s.lineTo(0.095, 0.79)
    s.lineTo(0.075, 0.81)
    s.lineTo(-0.075, 0.81)
    s.lineTo(-0.095, 0.79)
    s.lineTo(-0.2, 0.33)
    s.lineTo(-0.305, 0.075)
    s.closePath()
    jerseyShape = s
  }
  const g = new ExtrudeGeometry(jerseyShape, { depth: len, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 1, curveSegments: 1 })
  g.translate(0, 0, -len / 2)
  const y = groundY(x, z) - 0.03
  c.b.geo('concrete', g, x, y, z, { ry: ry + Math.PI / 2 })
  g.dispose()
  c.fp.push({ x, z, w: len, d: 0.6, ry, kind: 'low' })
}

/** Row of jersey barriers along a world-space line. */
export function jerseyRow(c: Ctx, ax: number, az: number, bx: number, bz: number) {
  const len = Math.hypot(bx - ax, bz - az)
  const n = Math.max(1, Math.round(len / 3.05))
  const ry = Math.atan2(-(bz - az), bx - ax)
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    jersey(c, ax + (bx - ax) * t + c.b.rand(-0.04, 0.04), az + (bz - az) * t + c.b.rand(-0.04, 0.04), ry + c.b.rand(-0.04, 0.04))
  }
}

/** Sandbag wall along local X centred at (x, z) world, rows high. */
export function sandbags(c: Ctx, x: number, z: number, ry: number, len: number, rows = 4, o: { curve?: number; fp?: boolean } = {}) {
  const per = Math.max(2, Math.round(len / 0.58))
  const y0 = groundY(x, z) - 0.03
  const curve = o.curve ?? 0
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 0.29 : 0
    const nRow = r % 2 ? per - 1 : per
    for (let i = 0; i < nRow; i++) {
      const lx = -len / 2 + 0.29 + off + i * (len - 0.58) / Math.max(1, per - 1)
      const bend = curve * (lx / (len / 2)) ** 2
      for (const dz of rows > 3 && r < 2 ? [-0.19, 0.19] : [0]) {
        const [wx, wz] = rot(x, z, ry, lx, dz + bend)
        c.inst.add('sandbag', wx, y0 + 0.08 + r * 0.155, wz, ry + c.b.rand(-0.09, 0.09) + Math.atan(curve * 2 * lx / ((len / 2) ** 2)), 1, c.b.rand(-0.03, 0.03), c.b.rand(-0.05, 0.05))
      }
    }
  }
  const h = rows * 0.155 + 0.06
  const thick = rows > 3 ? 0.75 : 0.4
  c.b.colBox(x, y0 + h / 2, z, len, h, thick, 'sand', { ry })
  if (curve !== 0) {
    // rough collider for the bent ends
    for (const sx of [-1, 1]) {
      const [wx, wz] = rot(x, z, ry, sx * len * 0.4, curve * 0.64)
      c.b.colBox(wx, y0 + h / 2, wz, len * 0.25, h, thick, 'sand', { ry })
    }
  }
  if (o.fp !== false) c.fp.push({ x, z, w: len, d: thick, ry, kind: 'low' })
}

// ─── wood ─────────────────────────────────────────────────────────────────

export function crate(c: Ctx, x: number, y: number, z: number, ry: number, s = 1.0, sy = s) {
  const b = c.b
  b.frame(x, y, z, ry, () => {
    b.box('wood', s - 0.04, sy - 0.04, s - 0.04, 0, sy / 2, 0, { col: false })
    const e = 0.07
    // frame edges
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.box('woodDark', e, sy, e, sx * (s / 2 - e / 2 + 0.01), sy / 2, sz * (s / 2 - e / 2 + 0.01), { col: false })
      for (const yy of [e / 2, sy - e / 2]) {
        b.box('woodDark', e, e, s, sx * (s / 2 - e / 2 + 0.01), yy, 0, { col: false })
        b.box('woodDark', s, e, e, 0, yy, sx * (s / 2 - e / 2 + 0.01), { col: false })
      }
    }
    // diagonal braces on two faces
    for (const sz of [-1, 1]) {
      b.beam('woodDark', new Vector3(-s / 2 + e, e, sz * (s / 2 + 0.005)), new Vector3(s / 2 - e, sy - e, sz * (s / 2 + 0.005)), 0.06, 0.02, { col: false })
    }
    b.colBox(0, sy / 2, 0, s, sy, s, 'wood')
  })
  c.fp.push({ x, z, w: s, d: s, ry, kind: 'low' })
}

export function pallet(c: Ctx, x: number, y: number, z: number, ry: number, col = true) {
  const b = c.b
  b.frame(x, y, z, ry, () => {
    for (let i = 0; i < 6; i++) b.box('wood', 0.1, 0.022, 1.2, -0.5 + i * 0.2, 0.133, 0, { col: false })
    for (const zz of [-0.55, 0, 0.55]) b.box('woodDark', 1.1, 0.1, 0.09, 0, 0.072, zz, { col: false })
    for (let i = 0; i < 3; i++) b.box('wood', 0.1, 0.022, 1.2, -0.5 + i * 0.5, 0.011, 0, { col: false })
    if (col) b.colBox(0, 0.072, 0, 1.1, 0.144, 1.2, 'wood')
  })
}

export function palletStack(c: Ctx, x: number, z: number, ry: number, n: number, y?: number) {
  const y0 = y ?? groundY(x, z)
  for (let i = 0; i < n; i++) pallet(c, x + c.b.rand(-0.04, 0.04), y0 + i * 0.145, z + c.b.rand(-0.04, 0.04), ry + c.b.rand(-0.06, 0.06), false)
  c.b.colBox(x, y0 + (n * 0.145) / 2, z, 1.15, n * 0.145, 1.25, 'wood', { ry })
  c.fp.push({ x, z, w: 1.1, d: 1.2, ry, kind: 'low' })
}

// ─── fences ───────────────────────────────────────────────────────────────

/** Chain-link fence along a world-space line, bays of ~3 m, optional barbed wire. */
export function fence(c: Ctx, ax: number, az: number, bx: number, bz: number, o: { h?: number; barbed?: boolean; gapAt?: [number, number] } = {}) {
  const b = c.b
  const h = o.h ?? 2.4
  const len = Math.hypot(bx - ax, bz - az)
  const n = Math.max(1, Math.round(len / 3))
  const ry = Math.atan2(-(bz - az), bx - ax)
  const nx = -(bz - az) / len
  const nz = (bx - ax) / len
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const px = ax + (bx - ax) * t
    const pz = az + (bz - az) * t
    const gy = groundY(px, pz)
    b.rod('pipeGrey', new Vector3(px, gy - 0.2, pz), new Vector3(px, gy + h + 0.05, pz), 0.038, 7, { col: false })
    if (o.barbed) {
      b.beam('rustDark', new Vector3(px, gy + h, pz), new Vector3(px + nx * 0.3, gy + h + 0.35, pz + nz * 0.3), 0.03, 0.03, { col: false })
    }
    if (i === n) break
    const t2 = (i + 1) / n
    const qx = ax + (bx - ax) * t2
    const qz = az + (bz - az) * t2
    const gy2 = groundY(qx, qz)
    const mx = (px + qx) / 2
    const mz = (pz + qz) / 2
    const bay = len / n
    if (o.gapAt && t >= o.gapAt[0] && t2 <= o.gapAt[1]) continue
    const my = (gy + gy2) / 2
    const fab = new PlaneGeometry(bay - 0.06, h - 0.1)
    b.geo('chain', fab, mx, my + h / 2 + 0.02, mz, { ry, col: false })
    fab.dispose()
    b.rod('pipeGrey', new Vector3(px, gy + h, pz), new Vector3(qx, gy2 + h, qz), 0.022, 6, { col: false })
    b.rod('pipeGrey', new Vector3(px, gy + 0.1, pz), new Vector3(qx, gy2 + 0.1, qz), 0.012, 5, { col: false })
    b.colBox(mx, my + h / 2, mz, bay, h + 0.2, 0.06, 'metal', { ry })
    if (o.barbed) {
      for (let k = 1; k <= 3; k++) {
        const off = k * 0.1
        b.wire(new Vector3(px + nx * off, gy + h + off * 1.1, pz + nz * off), new Vector3(qx + nx * off, gy2 + h + off * 1.1, qz + nz * off), 0.04, 0.006, 'rustDark')
      }
    }
  }
  c.fp.push({ x: (ax + bx) / 2, z: (az + bz) / 2, w: len, d: 0.1, ry, kind: 'road' })
}

// ─── poles & lights ───────────────────────────────────────────────────────

export function lightPole(c: Ctx, x: number, z: number, faceRy: number, h = 7.5) {
  const b = c.b
  const gy = groundY(x, z)
  b.cyl('concrete', 0.32, 0.38, 0.6, 'y', x, gy + 0.2, z, 10)
  b.cyl('pipeGrey', 0.07, 0.11, h, 'y', x, gy + 0.5 + h / 2, z, 10, { col: 'metal' })
  b.frame(x, gy + 0.5 + h, z, faceRy, () => {
    b.rod('pipeGrey', new Vector3(0, -0.1, 0), new Vector3(0, 0.12, -1.1), 0.04, 6, { col: false })
    b.box('black', 0.34, 0.14, 0.6, 0, 0.1, -1.25, { col: false, rx: -0.2 })
    b.box('lamp', 0.26, 0.02, 0.46, 0, 0.02, -1.24, { col: false, rx: -0.2 })
    // junction box + conduit
    b.box('pipeGrey', 0.22, 0.3, 0.14, 0, -h + 0.9, 0.12, { col: false })
  })
}

/** Wooden utility pole with crossarm; returns top attach points for wires. */
export function utilityPole(c: Ctx, x: number, z: number, ry: number, h = 8): Vector3[] {
  const b = c.b
  const gy = groundY(x, z)
  b.cyl('woodDark', 0.11, 0.14, h, 'y', x, gy + h / 2 - 0.3, z, 8, { col: 'wood' })
  const pts: Vector3[] = []
  b.frame(x, gy + h - 0.8, z, ry, () => {
    b.box('woodDark', 2.0, 0.12, 0.1, 0, 0, 0, { col: false })
    for (const lx of [-0.85, -0.3, 0.3, 0.85]) {
      b.cyl('black', 0.03, 0.04, 0.12, 'y', lx, 0.12, 0, 6, { col: false })
    }
  })
  for (const lx of [-0.85, -0.3, 0.3, 0.85]) {
    const [wx, wz] = rot(x, z, ry, lx, 0)
    pts.push(new Vector3(wx, gy + h - 0.8 + 0.18, wz))
  }
  return pts
}

// ─── pipes ────────────────────────────────────────────────────────────────

let saddleShapeCache = new Map<number, Shape>()
/** Concrete pipe saddle (block with a cradle) at world (x, z), pipe centre height cy, radius r. */
export function saddle(c: Ctx, x: number, z: number, ry: number, cy: number, r: number) {
  const gy = groundY(x, z) - 0.15
  const w = r * 2 + 0.3
  const top = cy - r * 0.55
  let s = saddleShapeCache.get(r)
  if (!s) {
    s = new Shape()
    s.moveTo(-w / 2, 0)
    s.lineTo(w / 2, 0)
    s.lineTo(w / 2, 1)
    s.lineTo(-w / 2, 1)
    s.closePath()
    saddleShapeCache.set(r, s)
  }
  const h = Math.max(0.2, top - gy)
  c.b.box('concrete', w, h, 0.5, x, gy + h / 2, z, { ry })
  // steel strap over the pipe
  c.b.frame(x, cy, z, ry, () => {
    const g = new TorusGeometry(r + 0.012, 0.012, 4, 16, Math.PI)
    c.b.geo('rustDark', g, 0, 0, 0, { col: false })
    g.dispose()
  })
}

/**
 * Pipe along world-space points (bends filleted), resting on saddles every `every` m.
 * walkTop: add a flat walkable strip collider along the top so capsules can walk on it.
 */
export function pipeline(c: Ctx, pts: Vector3[], r: number, mat: MatKey, o: { every?: number; walkTop?: boolean; saddles?: boolean; flanges?: boolean } = {}) {
  const b = c.b
  b.pipePath(mat, pts, r, Math.max(r * 2.5, 1.2), { radial: r > 0.4 ? 24 : 14 })
  // saddles & flanges along straight segments
  const every = o.every ?? 6
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const bb = pts[i + 1]!
    const len = a.distanceTo(bb)
    const ry = Math.atan2(-(bb.z - a.z), bb.x - a.x)
    const horiz = Math.hypot(bb.x - a.x, bb.z - a.z)
    const pitch = Math.atan2(bb.y - a.y, horiz)
    const n = Math.floor(len / every)
    for (let k = 1; k <= n; k++) {
      const t = (k - 0.5) / n
      const p = new Vector3().lerpVectors(a, bb, t)
      if (o.saddles !== false && p.y - r - groundY(p.x, p.z) < 2.2 && p.y - r - groundY(p.x, p.z) > -0.1) saddle(c, p.x, p.z, ry + Math.PI / 2, p.y, r)
    }
    if (o.flanges !== false && len > 3) {
      const fl = Math.max(1, Math.floor(len / 9))
      for (let k = 1; k <= fl; k++) {
        const p = new Vector3().lerpVectors(a, bb, k / (fl + 1))
        b.frame(p.x, p.y, p.z, ry, () => {
          b.cyl('rustDark', r + 0.045, r + 0.045, 0.08, 'x', 0, 0, 0, r > 0.4 ? 24 : 14, { col: false, rz: pitch })
        })
      }
    }
    if (o.walkTop) {
      // flat strip at the crown, slightly below so the visual sits on top
      const mid = new Vector3().lerpVectors(a, bb, 0.5)
      b.frame(mid.x, mid.y + r - 0.04, mid.z, ry, () => {
        b.colBox(0, 0, 0, len + 0.1, 0.08, r * 1.1, 'metal', { rz: pitch })
      })
    }
  }
}

/** Short vertical pipe stub / valve wheel assembly at world (x, z). */
export function valve(c: Ctx, x: number, z: number, ry: number, h = 1.1) {
  const b = c.b
  const gy = groundY(x, z)
  b.cyl('pipeYellow', 0.12, 0.12, h, 'y', x, gy + h / 2, z, 12, { col: 'metal' })
  b.cyl('rustDark', 0.17, 0.17, 0.06, 'y', x, gy + h * 0.55, z, 12, { col: false })
  b.frame(x, gy + h + 0.12, z, ry, () => {
    const g = new TorusGeometry(0.22, 0.02, 5, 18)
    b.geo('redwhite', g, 0, 0.0, 0, { col: false, rx: Math.PI / 2 })
    g.dispose()
    b.rod('rustDark', new Vector3(0, -0.14, 0), new Vector3(0, 0.02, 0), 0.025, 6, { col: false })
  })
}

// ─── scatter ─────────────────────────────────────────────────────────────

export function rock(c: Ctx, x: number, z: number, s: number, solid = s > 0.45) {
  const key = `rock${Math.floor(c.b.rand(0, 3))}`
  // seat on the lowest ground under the footprint so slopes don't leave it floating
  let lo = groundY(x, z)
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2
    lo = Math.min(lo, groundY(x + Math.cos(a) * s * 0.75, z + Math.sin(a) * s * 0.75))
  }
  const y = lo - s * 0.12
  const sc = new Vector3(s * c.b.rand(0.8, 1.3), s * c.b.rand(0.7, 1.1), s * c.b.rand(0.8, 1.3))
  const ry = c.b.rand(0, 6.28)
  if (solid) {
    const col = new DodecahedronGeometry(0.85, 0)
    col.scale(1, 0.72, 1)
    c.inst.addSolid(key, col, 'concrete', x, y, z, ry, sc)
    col.dispose()
  } else {
    c.inst.add(key, x, y, z, ry, sc)
  }
}

/** Fake "scrap" sheet lying on the ground. */
export function scrapSheet(c: Ctx, x: number, z: number, ry: number) {
  const gy = groundY(x, z)
  corrugated(c.b, c.b.pick(['tin', 'tinTan'] as MatKey[]), c.b.rand(0.8, 1.6), c.b.rand(1.2, 2.2), x, gy + 0.04, z, { ry, rx: -Math.PI / 2 + c.b.rand(-0.06, 0.06), col: false })
}

export const solidBox = (w: number, h: number, d: number) => new BoxGeometry(w, h, d)
