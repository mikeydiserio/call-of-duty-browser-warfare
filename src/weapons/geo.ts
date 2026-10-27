/**
 * Geometry helpers for hand-modelling weapons from side profiles.
 * Weapon-local frame: +X right, +Y up, barrel points down -Z. Profiles are
 * authored in (f, y): f = metres FORWARD along the barrel (so z = -f).
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Quaternion,
  TorusGeometry,
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  Object3D,
  Path,
  Shape,
  Vector2,
  Vector3,
  type Material,
} from 'three'
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import type { MatKey } from './materials'

/** Point with optional corner radius override. */
export type P = [f: number, y: number, r?: number]

function roundedPath<T extends Path>(path: T, pts: P[], r: number): T {
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!
    const cur = pts[i]!
    const next = pts[(i + 1) % n]!
    const rr = cur[2] ?? r
    const d1x = prev[0] - cur[0]
    const d1y = prev[1] - cur[1]
    const d2x = next[0] - cur[0]
    const d2y = next[1] - cur[1]
    const l1 = Math.hypot(d1x, d1y)
    const l2 = Math.hypot(d2x, d2y)
    const a = Math.min(rr, l1 * 0.5)
    const b = Math.min(rr, l2 * 0.5)
    const ax = cur[0] + (d1x / l1) * a
    const ay = cur[1] + (d1y / l1) * a
    const bx = cur[0] + (d2x / l2) * b
    const by = cur[1] + (d2y / l2) * b
    if (i === 0) path.moveTo(ax, ay)
    else path.lineTo(ax, ay)
    if (a > 1e-6 && b > 1e-6) path.quadraticCurveTo(cur[0], cur[1], bx, by)
    else path.lineTo(cur[0], cur[1])
  }
  path.closePath()
  return path
}

export interface ProfOpts {
  /** X centre offset. */
  x?: number
  bevel?: number
  /** Default corner radius. */
  r?: number
  crease?: number
  holes?: P[][]
}

/** Extrude a side profile to a given width (X). */
export function prof(pts: P[], width: number, o: ProfOpts = {}): BufferGeometry {
  const bevel = Math.min(o.bevel ?? 0.0012, width * 0.35)
  const shape = roundedPath(new Shape(), pts, o.r ?? 0.004)
  if (o.holes) for (const h of o.holes) shape.holes.push(roundedPath(new Path(), h, o.r ?? 0.004))
  const depth = Math.max(0.0005, width - bevel * 2)
  const geo = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
    curveSegments: 5,
  })
  geo.translate(0, 0, -depth / 2)
  geo.rotateY(Math.PI / 2)
  if (o.x) geo.translate(o.x, 0, 0)
  geo.deleteAttribute('uv')
  return finish(geo, o.crease ?? 0.75)
}

/** Rounded box: f0..f1 forward, y0..y1 up, centred on x with width w. */
export function rbox(f0: number, f1: number, y0: number, y1: number, w: number, x = 0, r = 0.004, bevel = 0.0012): BufferGeometry {
  return prof(
    [
      [f0, y0],
      [f1, y0],
      [f1, y1],
      [f0, y1],
    ],
    w,
    { x, r, bevel },
  )
}

/** Cheap axis-aligned box (no bevel) for small detail. */
export function box(f0: number, f1: number, y0: number, y1: number, x0: number, x1: number): BufferGeometry {
  const g = new BoxGeometry(x1 - x0, y1 - y0, f1 - f0)
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, -(f0 + f1) / 2)
  return flat(g)
}

/** Revolve a profile of [radius, f] pairs around the axis at (x, y) running along the barrel. */
export function lathe(profile: [number, number][], x = 0, y = 0, seg = 24, crease = 0.6): BufferGeometry {
  const pts = profile.map(([r, f]) => new Vector2(r, f))
  const g = new LatheGeometry(pts, seg)
  g.rotateX(-Math.PI / 2)
  g.translate(x, y, 0)
  g.deleteAttribute('uv')
  return finish(g, crease)
}

/** Simple cylinder/cone along the barrel axis. */
export function cyl(r0: number, r1: number, f0: number, f1: number, x = 0, y = 0, seg = 20): BufferGeometry {
  return lathe(
    [
      [0, f0],
      [r0, f0],
      [r1, f1],
      [0, f1],
    ],
    x,
    y,
    seg,
    0.5,
  )
}

/** Hollow tube along the barrel axis (open ended). */
export function tube(rOuter: number, rInner: number, f0: number, f1: number, x = 0, y = 0, seg = 28): BufferGeometry {
  return lathe(
    [
      [rInner, f0],
      [rOuter, f0],
      [rOuter, f1],
      [rInner, f1],
      [rInner, f0],
    ],
    x,
    y,
    seg,
    0.6,
  )
}

/** Cylinder along an arbitrary axis (e.g. vertical pins). axis: 'x' | 'y' | 'z'. */
export function pin(axis: 'x' | 'y' | 'z', r: number, len: number, cx: number, cy: number, f: number, seg = 14): BufferGeometry {
  const g = cyl(r, r, -len / 2, len / 2, 0, 0, seg)
  if (axis === 'x') g.rotateY(Math.PI / 2)
  if (axis === 'y') g.rotateX(Math.PI / 2)
  g.translate(cx, cy, -f)
  return g
}

/** Centre-line + thickness strip: for curved magazines / stocks. */
export function strip(center: (t: number) => [number, number], thick: (t: number) => number, steps = 10): P[] {
  const a: P[] = []
  const b: P[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const [f, y] = center(t)
    const [f2, y2] = center(Math.min(1, t + 0.01))
    const [f1, y1] = center(Math.max(0, t - 0.01))
    let tx = f2 - f1
    let ty = y2 - y1
    const l = Math.hypot(tx, ty) || 1
    tx /= l
    ty /= l
    const h = thick(t) / 2
    a.push([f - ty * h, y + tx * h, 0.001])
    b.push([f + ty * h, y - tx * h, 0.001])
  }
  return [...a, ...b.reverse()]
}

export function finish(g: BufferGeometry, crease = 0.7): BufferGeometry {
  const out = toCreasedNormals(g, crease)
  return out
}

export function flat(g: BufferGeometry): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g
  out.deleteAttribute('uv')
  return out
}

export function moved(g: BufferGeometry, x = 0, y = 0, z = 0): BufferGeometry {
  g.translate(x, y, z)
  return g
}

// ─── Rig builder ────────────────────────────────────────────────────────────

interface Bucket {
  part: string
  mat: MatKey
  geos: BufferGeometry[]
}

/**
 * Collects geometry by (part, material), then bakes it into merged meshes.
 * Parts become named Groups so animation can move them (bolt, slide, mag...).
 */
export class Builder {
  private buckets = new Map<string, Bucket>()
  private pivots = new Map<string, Vector3>()
  private parents = new Map<string, string>()

  add(part: string, mat: MatKey, geo: BufferGeometry): this {
    // Normalise attributes so everything can be merged.
    const g = geo.index ? geo.toNonIndexed() : geo
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
    g.clearGroups()
    const key = `${part}|${mat}`
    let b = this.buckets.get(key)
    if (!b) this.buckets.set(key, (b = { part, mat, geos: [] }))
    b.geos.push(g)
    return this
  }

  pivot(part: string, x: number, y: number, z: number): this {
    this.pivots.set(part, new Vector3(x, y, z))
    return this
  }

  parent(part: string, parent: string): this {
    this.parents.set(part, parent)
    return this
  }

  /** Build renderable groups. `getMat` maps keys to materials. */
  build(getMat: (k: MatKey) => Material, shadows = true): { root: Group; parts: Record<string, Group> } {
    const root = new Group()
    const parts: Record<string, Group> = { body: new Group() }
    parts.body!.name = 'body'
    root.add(parts.body!)
    const names = new Set<string>(['body'])
    for (const b of this.buckets.values()) names.add(b.part)
    for (const p of this.parents.keys()) names.add(p)
    for (const n of names) {
      if (!parts[n]) {
        parts[n] = new Group()
        parts[n]!.name = n
      }
    }
    // Hierarchy
    for (const n of names) {
      if (n === 'body') continue
      const g = parts[n]!
      const par = this.parents.get(n)
      const pv = this.pivots.get(n) ?? new Vector3()
      if (par) {
        const pp = this.pivots.get(par) ?? new Vector3()
        g.position.copy(pv).sub(pp)
        parts[par]!.add(g)
      } else {
        g.position.copy(pv)
        root.add(g)
      }
    }
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geos.map((g) => g.clone()))
      if (!merged) continue
      boxUV(merged, b.mat === 'wood' ? 3 : 4, b.mat === 'wood')
      const piv = this.pivots.get(b.part)
      if (piv) merged.translate(-piv.x, -piv.y, -piv.z)
      const mesh = new Mesh(merged, getMat(b.mat))
      mesh.castShadow = shadows
      mesh.receiveShadow = shadows
      mesh.frustumCulled = false
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      parts[b.part]!.add(mesh)
    }
    return { root, parts }
  }

  /** All geometry merged into a single vertex-coloured mesh geometry (for bot weapons). */
  buildWorld(colorOf: (k: MatKey) => [number, number, number] | null): BufferGeometry {
    const list: BufferGeometry[] = []
    for (const b of this.buckets.values()) {
      const c = colorOf(b.mat)
      if (!c) continue
      for (const g0 of b.geos) {
        const g = g0.clone()
        const n = g.attributes.position!.count
        const col = new Float32Array(n * 3)
        for (let i = 0; i < n; i++) {
          col[i * 3] = c[0]
          col[i * 3 + 1] = c[1]
          col[i * 3 + 2] = c[2]
        }
        g.setAttribute('color', new Float32BufferAttribute(col, 3))
        list.push(g)
      }
    }
    return mergeGeometries(list)!
  }
}

/** Box-project UVs from position/normal (metres * scale). If alongZ, V always runs along the barrel (wood grain). */
export function boxUV(g: BufferGeometry, scale: number, alongZ = false): void {
  const pos = g.attributes.position!
  const nor = g.attributes.normal!
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i))
    const ny = Math.abs(nor.getY(i))
    const nz = Math.abs(nor.getZ(i))
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    let u: number
    let v: number
    if (nx >= ny && nx >= nz) {
      u = alongZ ? y : z
      v = alongZ ? z : y
    } else if (ny >= nz) {
      u = x
      v = z
    } else {
      u = x
      v = y
    }
    uv[i * 2] = u * scale
    uv[i * 2 + 1] = v * scale
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
}

export const IDENTITY = new Matrix4()

/** Find a descendant by name. */
export function findNamed(o: Object3D, name: string): Object3D | null {
  return o.getObjectByName(name) ?? null
}

/** Cylinder between two weapon-local points (x, y, z are weapon coords, z = -f). */
export function rod(p0: [number, number, number], p1: [number, number, number], r0: number, r1 = r0, seg = 10): BufferGeometry {
  const a = new Vector3(...p0)
  const b = new Vector3(...p1)
  const len = a.distanceTo(b)
  const g = new CylinderGeometry(r1, r0, len, seg, 1)
  // CylinderGeometry axis is Y; rotate to a->b
  const dir = b.clone().sub(a).normalize()
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir)
  g.applyQuaternion(q)
  const mid = a.clone().add(b).multiplyScalar(0.5)
  g.translate(mid.x, mid.y, mid.z)
  return flat(g)
}

/** Torus-ish ring in the XY plane (for pin rings, sight rings). Axis along Z. */
export function ring(rMajor: number, rMinor: number, x: number, y: number, f: number, seg = 16): BufferGeometry {
  const g = new TorusGeometry(rMajor, rMinor, 8, seg)
  g.translate(x, y, -f)
  return flat(g)
}

/** Rectangular frame (window) in the XY plane, extruded along the barrel from f0 to f1. */
export function frameXY(cx: number, cy: number, ow: number, oh: number, iw: number, ih: number, f0: number, f1: number, r = 0.003): BufferGeometry {
  const hw = ow / 2
  const hh = oh / 2
  const outer = new Shape()
  rrect(outer, -hw, -hh, ow, oh, r)
  const hole = new Path()
  rrect(hole, -iw / 2, -ih / 2, iw, ih, r * 0.6)
  outer.holes.push(hole)
  const g = new ExtrudeGeometry(outer, { depth: f1 - f0, bevelEnabled: false, curveSegments: 4 })
  // Extrude runs +Z from 0..depth; flip so it spans z = -f1 .. -f0
  g.translate(cx, cy, -f1)
  g.deleteAttribute('uv')
  return finish(g, 0.8)
}

function rrect(p: Path, x: number, y: number, w: number, h: number, r: number): void {
  p.moveTo(x + r, y)
  p.lineTo(x + w - r, y)
  p.quadraticCurveTo(x + w, y, x + w, y + r)
  p.lineTo(x + w, y + h - r)
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  p.lineTo(x + r, y + h)
  p.quadraticCurveTo(x, y + h, x, y + h - r)
  p.lineTo(x, y + r)
  p.quadraticCurveTo(x, y, x + r, y)
}
