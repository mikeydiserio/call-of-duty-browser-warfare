/**
 * MapBuilder: a tiny scene-assembly kit. Everything is placed through a transform "frame" stack,
 * collected per material (and per spatial chunk, for frustum culling), merged, and — when requested —
 * registered with the collision world using the same transform.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Curve,
  CurvePath,
  CylinderGeometry,
  Euler,
  Group,
  LineCurve3,
  Matrix4,
  Mesh,
  QuadraticBezierCurve3,
  Quaternion,
  TubeGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { seeded } from '../core/math'
import type { Surface } from '../core/types'
import type { CollisionWorld } from './collision'
import type { MatKey, Mats } from './materials'

export interface PlaceOpts {
  rx?: number
  ry?: number
  rz?: number
  /** Collision: undefined = material default, false = none, Surface = override. */
  col?: Surface | false
  /** UV offset in tiles. */
  uv?: [number, number]
  /** Skip box-projected UVs (geometry supplies its own). */
  keepUV?: boolean
  /** Collide with this simplified geometry instead (same local frame). */
  collider?: BufferGeometry
}

const Y = new Vector3(0, 1, 0)
const _v = new Vector3()
const _q = new Quaternion()
const _e = new Euler()
const _m = new Matrix4()
const _s = new Vector3(1, 1, 1)

/** Box-project UVs from local positions/normals (metres → tiles). */
export function projectBoxUV(g: BufferGeometry, su: number, sv: number, ou = 0, ov = 0) {
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const ax = Math.abs(nor.getX(i))
    const ay = Math.abs(nor.getY(i))
    const az = Math.abs(nor.getZ(i))
    let u: number
    let v: number
    if (ax >= ay && ax >= az) {
      u = z * su
      v = y * sv
    } else if (az >= ay) {
      u = x * su
      v = y * sv
    } else {
      u = x * su
      v = z * su
    }
    uv[i * 2] = u + ou
    uv[i * 2 + 1] = v + ov
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2))
}

export function scaleUV(g: BufferGeometry, su: number, sv: number, ou = 0, ov = 0, swap = false) {
  const uv = g.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) {
    const a = uv.getX(i)
    const b = uv.getY(i)
    if (swap) uv.setXY(i, b * su + ou, a * sv + ov)
    else uv.setXY(i, a * su + ou, b * sv + ov)
  }
  uv.needsUpdate = true
}

export class MapBuilder {
  private frameM = new Matrix4()
  private stack: Matrix4[] = []
  private groups = new Map<string, { mat: MatKey; geos: BufferGeometry[] }>()
  readonly rng = seeded(4242)
  visTris = 0
  colTris = 0

  constructor(
    readonly mats: Mats,
    readonly collision: CollisionWorld,
  ) {}

  rand(lo = 0, hi = 1) {
    return lo + this.rng() * (hi - lo)
  }
  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.rng() * a.length)] as T
  }

  // ─── frames ──────────────────────────────────────────────────────────────

  /** Run fn with a local frame at (x,y,z) rotated ry (about Y) — plus optional rx/rz. */
  frame(x: number, y: number, z: number, ry: number, fn: () => void, rx = 0, rz = 0) {
    this.stack.push(this.frameM.clone())
    _e.set(rx, ry, rz, 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_v.set(x, y, z), _q, _s)
    this.frameM.multiply(_m)
    fn()
    this.frameM.copy(this.stack.pop()!)
  }

  // ─── core placement ──────────────────────────────────────────────────────

  private local(x: number, y: number, z: number, o?: PlaceOpts) {
    _e.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0, 'YXZ')
    _q.setFromEuler(_e)
    return new Matrix4().compose(new Vector3(x, y, z), _q.clone(), new Vector3(1, 1, 1))
  }

  /** Place a prepared geometry (consumed? no — cloned) with a local matrix. */
  place(mat: MatKey, g: BufferGeometry, local: Matrix4, o?: PlaceOpts) {
    const def = this.mats[mat]
    if (!o?.keepUV) {
      const ou = o?.uv ? o.uv[0] : this.rng()
      const ov = o?.uv ? o.uv[1] : this.rng()
      projectBoxUV(g, 1 / def.tw, 1 / def.th, ou, ov)
    }
    const full = this.frameM.clone().multiply(local)
    // visual
    const vg = g.clone()
    for (const name of Object.keys(vg.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') vg.deleteAttribute(name)
    }
    if (!vg.index) {
      const n = vg.getAttribute('position').count
      const idx = new Uint32Array(n)
      for (let i = 0; i < n; i++) idx[i] = i
      vg.setIndex(new BufferAttribute(idx, 1))
    }
    vg.applyMatrix4(full)
    vg.computeBoundingBox()
    const c = vg.boundingBox!.getCenter(_v)
    const key = `${mat}|${c.x >= 0 ? 1 : 0}${c.z >= 0 ? 1 : 0}`
    let grp = this.groups.get(key)
    if (!grp) {
      grp = { mat, geos: [] }
      this.groups.set(key, grp)
    }
    grp.geos.push(vg)
    this.visTris += (vg.index ? vg.index.count : vg.getAttribute('position').count) / 3
    // collision
    const surface = o?.col === undefined ? def.surface : o.col
    if (surface !== false && o?.col !== false) {
      if (o?.collider) {
        this.collision.addGeometry(o.collider, full, surface)
        this.colTris += (o.collider.index ? o.collider.index.count : o.collider.getAttribute('position').count) / 3
      } else {
        this.collision.addGeometry(g, full, surface)
        this.colTris += (g.index ? g.index.count : g.getAttribute('position').count) / 3
      }
    }
  }

  // ─── primitives (all in the current frame) ───────────────────────────────

  box(mat: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, o?: PlaceOpts) {
    const g = new BoxGeometry(w, h, d)
    this.place(mat, g, this.local(x, y, z, o), o)
    g.dispose()
  }

  /** Box from corner to corner. */
  bbox(mat: MatKey, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o?: PlaceOpts) {
    this.box(mat, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, o)
  }

  /** Box whose long axis (Y of the geometry) runs from a to b. */
  beam(mat: MatKey, a: Vector3, b: Vector3, w: number, d: number, o?: PlaceOpts & { roll?: number }) {
    const dir = new Vector3().subVectors(b, a)
    const len = dir.length()
    if (len < 1e-4) return
    dir.divideScalar(len)
    const q = new Quaternion().setFromUnitVectors(Y, dir)
    if (o?.roll) q.multiply(new Quaternion().setFromAxisAngle(Y, o.roll))
    const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5)
    const g = new BoxGeometry(w, len, d)
    this.place(mat, g, new Matrix4().compose(mid, q, new Vector3(1, 1, 1)), o)
    g.dispose()
  }

  /** Round pipe/rod between two points. */
  rod(mat: MatKey, a: Vector3, b: Vector3, r: number, seg = 8, o?: PlaceOpts) {
    const dir = new Vector3().subVectors(b, a)
    const len = dir.length()
    if (len < 1e-4) return
    dir.divideScalar(len)
    const q = new Quaternion().setFromUnitVectors(Y, dir)
    const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5)
    const g = new CylinderGeometry(r, r, len, seg, 1, false)
    const def = this.mats[mat]
    scaleUV(g, (Math.PI * 2 * r) / def.tw, len / def.th, this.rng(), this.rng())
    this.place(mat, g, new Matrix4().compose(mid, q, new Vector3(1, 1, 1)), { ...o, keepUV: true })
    g.dispose()
  }

  /** Cylinder (or cone) centred at (x,y,z) with its axis along 'x' | 'y' | 'z'. */
  cyl(
    mat: MatKey,
    rTop: number,
    rBot: number,
    len: number,
    axis: 'x' | 'y' | 'z',
    x: number,
    y: number,
    z: number,
    seg = 12,
    o?: PlaceOpts & { open?: boolean },
  ) {
    const g = new CylinderGeometry(rTop, rBot, len, seg, 1, o?.open ?? false)
    const def = this.mats[mat]
    const r = Math.max(rTop, rBot)
    scaleUV(g, (Math.PI * 2 * r) / def.tw, len / def.th, this.rng(), this.rng())
    const base = this.local(x, y, z, o)
    if (axis === 'x') base.multiply(new Matrix4().makeRotationZ(Math.PI / 2))
    else if (axis === 'z') base.multiply(new Matrix4().makeRotationX(Math.PI / 2))
    this.place(mat, g, base, { ...o, keepUV: true })
    g.dispose()
  }

  /** Any geometry, with box-projected UVs unless keepUV. */
  geo(mat: MatKey, g: BufferGeometry, x: number, y: number, z: number, o?: PlaceOpts) {
    this.place(mat, g, this.local(x, y, z, o), o)
  }

  /** Smooth tube along a path of points with filleted corners (bendR). */
  pipePath(mat: MatKey, pts: Vector3[], r: number, bendR: number, o?: PlaceOpts & { radial?: number }) {
    const path = new CurvePath<Vector3>()
    let prev = pts[0]!.clone()
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!
      const din = new Vector3().subVectors(p, pts[i - 1]!)
      const dout = new Vector3().subVectors(pts[i + 1]!, p)
      const lin = din.length()
      const lout = dout.length()
      din.normalize()
      dout.normalize()
      const ang = din.angleTo(dout)
      const t = Math.min(bendR * Math.tan(ang / 2), lin * 0.5, lout * 0.5)
      const a = p.clone().addScaledVector(din, -t)
      const b = p.clone().addScaledVector(dout, t)
      if (prev.distanceTo(a) > 1e-4) path.add(new LineCurve3(prev, a))
      path.add(new QuadraticBezierCurve3(a, p.clone(), b))
      prev = b
    }
    path.add(new LineCurve3(prev, pts[pts.length - 1]!.clone()))
    const len = path.getLength()
    const segs = Math.max(8, Math.ceil(len * 3))
    const g = new TubeGeometry(path as unknown as Curve<Vector3>, segs, r, o?.radial ?? 14, false)
    const def = this.mats[mat]
    scaleUV(g, len / def.th, (Math.PI * 2 * r) / def.tw, this.rng(), this.rng(), false)
    // tube uv: x along, y around → texture wants u around, v along
    const uv = g.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) {
      const a = uv.getX(i)
      const b = uv.getY(i)
      uv.setXY(i, b, a)
    }
    // collision: coarse tube
    const cg = new TubeGeometry(path as unknown as Curve<Vector3>, Math.max(4, Math.ceil(len * 0.8)), r, 8, false)
    this.place(mat, g, new Matrix4(), { ...o, keepUV: true, collider: cg })
    g.dispose()
    cg.dispose()
  }

  curve(points: Vector3[], tension = 0.5) {
    return new CatmullRomCurve3(points, false, 'catmullrom', tension)
  }

  /** Thin wire/cable along a catenary-ish curve. */
  wire(a: Vector3, b: Vector3, sag: number, r = 0.012, mat: MatKey = 'black') {
    const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5)
    mid.y -= sag
    const c = new CatmullRomCurve3([a, new Vector3().lerpVectors(a, mid, 0.5).setY((a.y + mid.y) / 2 - sag * 0.1), mid, new Vector3().lerpVectors(mid, b, 0.5).setY((mid.y + b.y) / 2 - sag * 0.1), b])
    const len = a.distanceTo(b)
    const g = new TubeGeometry(c, Math.max(6, Math.ceil(len)), r, 5, false)
    this.place(mat, g, new Matrix4(), { keepUV: true, col: false })
    g.dispose()
  }

  // ─── invisible colliders ─────────────────────────────────────────────────

  colBox(x: number, y: number, z: number, w: number, h: number, d: number, surface: Surface, o?: PlaceOpts) {
    const g = new BoxGeometry(w, h, d)
    const full = this.frameM.clone().multiply(this.local(x, y, z, o))
    this.collision.addGeometry(g, full, surface)
    this.colTris += 12
    g.dispose()
  }
  colBBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, surface: Surface, o?: PlaceOpts) {
    this.colBox((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, surface, o)
  }
  colGeo(g: BufferGeometry, x: number, y: number, z: number, surface: Surface, o?: PlaceOpts) {
    const full = this.frameM.clone().multiply(this.local(x, y, z, o))
    this.collision.addGeometry(g, full, surface)
    this.colTris += (g.index ? g.index.count : g.getAttribute('position').count) / 3
  }

  // ─── output ──────────────────────────────────────────────────────────────

  finish(parent: Group): { meshes: number } {
    let n = 0
    for (const [key, grp] of this.groups) {
      const merged = mergeGeometries(grp.geos, false)
      for (const g of grp.geos) g.dispose()
      if (!merged) continue
      merged.computeBoundingSphere()
      merged.computeBoundingBox()
      const def = this.mats[grp.mat]
      const mesh = new Mesh(merged, def.mat)
      mesh.name = key
      mesh.castShadow = grp.mat !== 'lamp'
      mesh.receiveShadow = true
      parent.add(mesh)
      n++
    }
    this.groups.clear()
    return { meshes: n }
  }
}
