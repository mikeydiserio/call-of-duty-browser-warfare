/**
 * Rust terrain: a flat-ish sandy yard enclosed by berms/dunes, plus the distant dune sea.
 * The height function is analytic (deterministic value noise) so props can be seated on it
 * before the collision BVH exists.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  type Group,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CollisionWorld } from '../collision'
import { createTerrainMaterial } from '../materials'
import { getTextures } from '../textures'

// ─── analytic noise ────────────────────────────────────────────────────────

function hash2(ix: number, iz: number, seed: number) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export function vnoise(x: number, z: number, seed = 0) {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz
}

export function fbm(x: number, z: number, oct = 4, seed = 0) {
  let s = 0
  let amp = 0.5
  let f = 1
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, z * f, seed + i * 17)
    f *= 2.03
    amp *= 0.5
  }
  return s / (1 - 0.5 ** oct)
}

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Rounded-square distance from the map centre (so the enclosing berm isn't a circle or a square). */
export function edgeDist(x: number, z: number) {
  const p = 6
  return (Math.abs(x) ** p + Math.abs(z) ** p) ** (1 / p)
}

/** Ground height at (x, z). Playable area is within ±34. */
export function groundY(x: number, z: number): number {
  const d = edgeDist(x, z)
  // gentle yard undulation, killed near the tower pad
  const r0 = Math.hypot(x, z)
  const und = (fbm(x * 0.045, z * 0.045, 3, 3) - 0.5) * 0.45 * sstep(6, 12, r0)
  // perimeter berm
  const bn = fbm(x * 0.06, z * 0.06, 3, 9)
  const berm = sstep(32.5 + bn * 2.5, 44 + bn * 4, d) * (5.5 + bn * 4.5)
  // dune sea beyond
  const far = sstep(44, 140, d)
  const dn = fbm(x * 0.012 + 3.1, z * 0.012 - 1.7, 4, 21)
  const ridge = 1 - Math.abs(Math.sin((x * 0.021 + z * 0.013) + dn * 3.0))
  const dunes = far * (dn * 22 + ridge * 7)
  return und + berm + dunes
}

// ─── ground colouring ──────────────────────────────────────────────────────

export interface Track {
  pts: Vector3[]
  width: number
}

function distToPolyline(x: number, z: number, pts: Vector3[]) {
  let best = 1e9
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l2 = dx * dx + dz * dz
    let t = ((x - a.x) * dx + (z - a.z) * dz) / l2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = a.x + dx * t - x
    const pz = a.z + dz * t - z
    const d = px * px + pz * pz
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

export interface DarkSpot {
  x: number
  z: number
  r: number
  k: number
}

function groundColor(x: number, z: number, tracks: Track[], spots: DarkSpot[], out: Color) {
  const d = edgeDist(x, z)
  const n1 = fbm(x * 0.08, z * 0.08, 3, 41)
  const n2 = fbm(x * 0.3, z * 0.3, 2, 43)
  // base: pale sand, mottled
  let r = 1.0
  let g = 0.97
  let b = 0.93
  const mott = 0.86 + n1 * 0.2 + (n2 - 0.5) * 0.06
  r *= mott
  g *= mott
  b *= mott
  // compacted / trampled yard in the middle is a touch darker & greyer
  const yard = 1 - sstep(24, 36, d)
  r *= 1 - yard * 0.1
  g *= 1 - yard * 0.11
  b *= 1 - yard * 0.1
  // tracks: dark compacted dirt
  for (const t of tracks) {
    const td = distToPolyline(x, z, t.pts)
    const k = (1 - sstep(t.width * 0.25, t.width * 0.75, td)) * (0.65 + n2 * 0.35)
    r *= 1 - k * 0.2
    g *= 1 - k * 0.23
    b *= 1 - k * 0.25
  }
  // dirty patches near structures
  for (const s of spots) {
    const dd = Math.hypot(x - s.x, z - s.z)
    if (dd > s.r) continue
    const k = (1 - sstep(s.r * 0.3, s.r, dd + (n1 - 0.5) * s.r * 0.5)) * s.k
    r *= 1 - k * 0.24
    g *= 1 - k * 0.27
    b *= 1 - k * 0.28
  }
  // berms: lighter, windswept, slightly warmer crests
  const rise = sstep(33, 46, d)
  r = r + (1.04 - r) * rise * 0.7
  g = g + (0.99 - g) * rise * 0.7
  b = b + (0.93 - b) * rise * 0.7
  out.setRGB(r, g, b)
}

// ─── meshes ────────────────────────────────────────────────────────────────

function gridGeometry(half: number, step: number, heightFn: (x: number, z: number) => number, uvScale: number, colorFn?: (x: number, z: number, c: Color) => void) {
  const n = Math.round((half * 2) / step)
  const verts = (n + 1) * (n + 1)
  const pos = new Float32Array(verts * 3)
  const uv = new Float32Array(verts * 2)
  const col = colorFn ? new Float32Array(verts * 3) : null
  const c = new Color()
  let i = 0
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      const x = -half + ix * step
      const z = -half + iz * step
      pos[i * 3] = x
      pos[i * 3 + 1] = heightFn(x, z)
      pos[i * 3 + 2] = z
      uv[i * 2] = x * uvScale
      uv[i * 2 + 1] = -z * uvScale
      if (col && colorFn) {
        colorFn(x, z, c)
        col[i * 3] = c.r
        col[i * 3 + 1] = c.g
        col[i * 3 + 2] = c.b
      }
      i++
    }
  }
  const idx = new Uint32Array(n * n * 6)
  let k = 0
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const a = iz * (n + 1) + ix
      const b = a + 1
      const cc = a + (n + 1)
      const d = cc + 1
      // alternate the diagonal for less directional faceting
      if ((ix + iz) & 1) {
        idx[k++] = a
        idx[k++] = cc
        idx[k++] = b
        idx[k++] = b
        idx[k++] = cc
        idx[k++] = d
      } else {
        idx[k++] = a
        idx[k++] = cc
        idx[k++] = d
        idx[k++] = a
        idx[k++] = d
        idx[k++] = b
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('uv', new BufferAttribute(uv, 2))
  if (col) g.setAttribute('color', new BufferAttribute(col, 3))
  g.setIndex(new BufferAttribute(idx, 1))
  g.computeVertexNormals()
  return g
}

const INNER_HALF = 50

export function buildTerrain(root: Group, collision: CollisionWorld, tracks: Track[], spots: DarkSpot[]) {
  const mat = createTerrainMaterial()
  const colorFn = (x: number, z: number, c: Color) => groundColor(x, z, tracks, spots, c)

  // Inner (playable + berms): 0.5 m visual grid.
  const inner = gridGeometry(INNER_HALF, 0.5, groundY, 1 / 8, colorFn)
  const innerMesh = new Mesh(inner, mat)
  innerMesh.receiveShadow = true
  innerMesh.name = 'terrain'
  root.add(innerMesh)

  // Collision: 1 m grid, same analytic height (undulation wavelength >> 1 m so error is mm).
  const colGeo = gridGeometry(INNER_HALF, 1, groundY, 1)
  const cm = new Mesh(colGeo)
  collision.addMesh(cm, 'sand', false)
  colGeo.dispose()

  // Outer dune sea: polar ring, vertices under the inner square pushed down so they never z-fight.
  const rings = 34
  const segs = 128
  const r0 = 44
  const r1 = 520
  const pos = new Float32Array((rings + 1) * (segs + 1) * 3)
  const uv = new Float32Array((rings + 1) * (segs + 1) * 2)
  const col = new Float32Array((rings + 1) * (segs + 1) * 3)
  const c = new Color()
  let i = 0
  for (let ri = 0; ri <= rings; ri++) {
    const t = ri / rings
    const r = r0 + (r1 - r0) * t ** 1.8
    for (let si = 0; si <= segs; si++) {
      const a = (si / segs) * Math.PI * 2
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const inside = Math.abs(x) < INNER_HALF - 0.5 && Math.abs(z) < INNER_HALF - 0.5
      pos[i * 3] = x
      pos[i * 3 + 1] = groundY(x, z) - (inside ? 0.6 : 0)
      pos[i * 3 + 2] = z
      uv[i * 2] = x / 8
      uv[i * 2 + 1] = -z / 8
      groundColor(x, z, tracks, spots, c)
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
      i++
    }
  }
  const idx: number[] = []
  for (let ri = 0; ri < rings; ri++) {
    for (let si = 0; si < segs; si++) {
      const a = ri * (segs + 1) + si
      const b = a + 1
      const cc = a + segs + 1
      const d = cc + 1
      idx.push(a, b, cc, b, d, cc)
    }
  }
  const outer = new BufferGeometry()
  outer.setAttribute('position', new BufferAttribute(pos, 3))
  outer.setAttribute('uv', new BufferAttribute(uv, 2))
  outer.setAttribute('color', new BufferAttribute(col, 3))
  outer.setIndex(idx)
  outer.computeVertexNormals()
  const outerMesh = new Mesh(outer, mat)
  outerMesh.receiveShadow = true
  outerMesh.name = 'dunes'
  root.add(outerMesh)

  return { innerTris: inner.index!.count / 3, outerTris: idx.length / 3 }
}

// ─── ground decals (tracks, oil, soil) ─────────────────────────────────────

function decalMat(map: ReturnType<typeof getTextures>['oil']) {
  const m = new MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    roughness: 0.95,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: DoubleSide,
  })
  return m
}

/** Ribbon that hugs the terrain along a smooth path; u across, v along (v repeats every `vTile` m). */
export function ribbonGeometry(path: Vector3[], width: number, vTile: number, lift = 0.025) {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  // resample path every 0.5 m
  const pts: Vector3[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.5))
    for (let k = 0; k < n; k++) pts.push(new Vector3().lerpVectors(a, b, k / n))
  }
  pts.push(path[path.length - 1]!.clone())
  let along = 0
  const side = new Vector3()
  const across = 4
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const prev = pts[Math.max(0, i - 1)]!
    const next = pts[Math.min(pts.length - 1, i + 1)]!
    side.set(next.z - prev.z, 0, -(next.x - prev.x)).normalize()
    if (i > 0) along += p.distanceTo(pts[i - 1]!)
    for (let j = 0; j <= across; j++) {
      const u = j / across
      const off = (u - 0.5) * width
      const x = p.x + side.x * off
      const z = p.z + side.z * off
      pos.push(x, groundY(x, z) + lift, z)
      uv.push(u, along / vTile)
    }
    if (i > 0) {
      const base = (i - 1) * (across + 1)
      for (let j = 0; j < across; j++) {
        const a = base + j
        const b = a + 1
        const cc = a + across + 1
        const d = cc + 1
        idx.push(a, cc, b, b, cc, d)
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Small terrain-conforming square patch. */
function patchGeometry(x: number, z: number, size: number, rot: number, lift: number) {
  const n = 6
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const cs = Math.cos(rot)
  const sn = Math.sin(rot)
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const lu = (i / n - 0.5) * size
      const lv = (j / n - 0.5) * size
      const wx = x + lu * cs - lv * sn
      const wz = z + lu * sn + lv * cs
      pos.push(wx, groundY(wx, wz) + lift, wz)
      uv.push(i / n, j / n)
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export interface Patch {
  x: number
  z: number
  size: number
  rot: number
  /** Explicit Y (e.g. on a concrete pad) instead of terrain. */
  y?: number
}


export function buildDecals(root: Group, tracks: Track[], oil: Patch[], soil: Patch[]) {
  const T = getTextures()
  const trackGeos = tracks.map((t) => ribbonGeometry(t.pts, t.width, t.width * 1.2))
  const tg = mergeGeometries(trackGeos, false)
  if (tg) {
    const m = new Mesh(tg, decalMat(T.tracks))
    m.receiveShadow = true
    m.renderOrder = 1
    root.add(m)
  }
  const mk = (list: Patch[], tex: typeof T.oil, lift: number, order: number) => {
    if (!list.length) return
    const geos = list.map((p) => {
      if (p.y !== undefined) {
        const g = patchGeometry(0, 0, p.size, p.rot, 0)
        // flatten to the pad height
        const pa = g.getAttribute('position')
        for (let i = 0; i < pa.count; i++) pa.setXYZ(i, pa.getX(i) + p.x, p.y + lift, pa.getZ(i) + p.z)
        return g
      }
      return patchGeometry(p.x, p.z, p.size, p.rot, lift)
    })
    const g = mergeGeometries(geos, false)
    if (!g) return
    const m = new Mesh(g, decalMat(tex))
    m.receiveShadow = true
    m.renderOrder = order
    root.add(m)
  }
  mk(soil, T.soil, 0.018, 0)
  mk(oil, T.oil, 0.03, 2)
}
