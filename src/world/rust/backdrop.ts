/**
 * Non-colliding distant scenery: rocky mesas, power pylons, far derricks and a refinery
 * silhouette — all beyond the berms, melting into the haze.
 */
import { BufferGeometry, Color, Float32BufferAttribute, type Group, IcosahedronGeometry, LatheGeometry, Mesh, MeshStandardMaterial, Vector2, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { MapBuilder } from '../builder'
import { getTextures } from '../textures'
import { fbm, groundY } from './terrain'

const V = (x: number, y: number, z: number) => new Vector3(x, y, z)

function mesa(seed: number, r: number, h: number) {
  // stepped lathe profile, then displaced for erosion
  const pts: Vector2[] = [new Vector2(0, h)]
  const steps = 5
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const rr = r * (0.55 + 0.45 * t ** 0.6) + (i % 2) * r * 0.04
    pts.push(new Vector2(rr, h * (1 - t ** 1.4)))
  }
  pts.push(new Vector2(r * 1.25, -h * 0.25))
  const g = new LatheGeometry(pts, 40)
  const p = g.getAttribute('position')
  const v = new Vector3()
  const col: number[] = []
  const c = new Color()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const a = Math.atan2(v.z, v.x)
    const n = fbm(Math.cos(a) * 2 + seed, Math.sin(a) * 2 + v.y * 0.05, 4, seed)
    const k = 0.8 + n * 0.45
    v.x *= k
    v.z *= k
    v.y += (n - 0.5) * h * 0.08 * (v.y > h * 0.9 ? 1 : 0.3)
    p.setXYZ(i, v.x, v.y, v.z)
    // banded strata
    const band = 0.5 + 0.5 * Math.sin(v.y * 0.9 + n * 3)
    c.setRGB(0.78 + band * 0.12, 0.62 + band * 0.1, 0.46 + band * 0.08)
    col.push(c.r, c.g, c.b)
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

export function buildBackdrop(root: Group, b: MapBuilder) {
  const T = getTextures()
  const rockMat = new MeshStandardMaterial({ map: T.rock.map, normalMap: T.rock.normalMap, vertexColors: true, roughness: 1, metalness: 0 })
  const mesas: BufferGeometry[] = []
  const spots: [number, number, number, number][] = [
    [-180, -220, 60, 38],
    [-260, -60, 80, 52],
    [210, -240, 70, 30],
    [300, 60, 90, 44],
    [120, 280, 60, 26],
    [-220, 210, 75, 40],
    [-40, -330, 90, 60],
    [40, 340, 70, 34],
  ]
  spots.forEach(([x, z, r, h], i) => {
    const g = mesa(i * 13 + 5, r, h)
    g.translate(x, groundY(x, z) - 4, z)
    mesas.push(g)
  })
  // boulder fields on the far dunes
  for (let i = 0; i < 40; i++) {
    const a = b.rand(0, Math.PI * 2)
    const r = b.rand(70, 200)
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const s = b.rand(2, 7)
    const g = new IcosahedronGeometry(s, 1)
    g.scale(1, 0.6, 1)
    const p = g.getAttribute('position')
    const col: number[] = []
    for (let k = 0; k < p.count; k++) col.push(0.8, 0.66, 0.5)
    g.setAttribute('color', new Float32BufferAttribute(col, 3))
    g.deleteAttribute('uv')
    const uv: number[] = []
    for (let k = 0; k < p.count; k++) uv.push(p.getX(k) * 0.2, p.getY(k) * 0.2)
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
    g.translate(x, groundY(x, z) - s * 0.2, z)
    mesas.push(g.index ? g.toNonIndexed() : g)
  }
  const merged = mergeGeometries(mesas.map((g) => (g.index ? g.toNonIndexed() : g)), false)
  if (merged) {
    const m = new Mesh(merged, rockMat)
    m.receiveShadow = true
    m.name = 'mesas'
    root.add(m)
  }

  // power line: lattice pylons marching across the north-east, wires between
  const pylons: Vector3[] = []
  for (let i = 0; i < 7; i++) {
    const x = -220 + i * 75
    const z = -95 - Math.sin(i * 0.7) * 20
    pylons.push(V(x, groundY(x, z), z))
  }
  for (const p of pylons) pylon(b, p, 26)
  for (let i = 0; i < pylons.length - 1; i++) {
    for (const off of [-4.5, 4.5]) {
      const a = pylons[i]!.clone().add(V(0, 22, off))
      const c = pylons[i + 1]!.clone().add(V(0, 22, off))
      b.wire(a, c, 6, 0.06)
    }
  }
  // far derricks & a refinery silhouette to the south-east
  for (const [x, z, h] of [[150, 90, 30], [175, 120, 24], [-130, 150, 28], [-90, -170, 26]] as [number, number, number][]) farDerrick(b, V(x, groundY(x, z) - 1, z), h)
  refinery(b, V(190, groundY(190, 170), 170))
}

function pylon(b: MapBuilder, base: Vector3, h: number) {
  const legs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  const w0 = 3.2
  const w1 = 0.9
  const at = (sx: number, sz: number, t: number) => {
    const w = w0 + (w1 - w0) * t
    return V(base.x + sx * w, base.y + h * t, base.z + sz * w)
  }
  for (const [sx, sz] of legs) b.beam('rustDark', at(sx, sz, 0), at(sx, sz, 1), 0.25, 0.25, { col: false })
  for (let i = 0; i < 6; i++) {
    const t = i / 6
    const t2 = (i + 1) / 6
    for (let k = 0; k < 4; k++) {
      const [ax, az] = legs[k]!
      const [bx, bz] = legs[(k + 1) % 4]!
      b.beam('rustDark', at(ax, az, t), at(bx, bz, t2), 0.12, 0.12, { col: false })
    }
  }
  // cross arms
  b.beam('rustDark', V(base.x, base.y + h * 0.85, base.z - 5), V(base.x, base.y + h * 0.85, base.z + 5), 0.3, 0.4, { col: false })
  b.beam('rustDark', V(base.x, base.y + h, base.z - 3), V(base.x, base.y + h, base.z + 3), 0.25, 0.3, { col: false })
}

function farDerrick(b: MapBuilder, base: Vector3, h: number) {
  const legs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  const at = (sx: number, sz: number, t: number) => {
    const w = 3 + (0.8 - 3) * t
    return V(base.x + sx * w, base.y + h * t, base.z + sz * w)
  }
  for (const [sx, sz] of legs) b.beam('rustDark', at(sx, sz, 0), at(sx, sz, 1), 0.35, 0.35, { col: false })
  for (let i = 0; i < 7; i++) {
    const t = i / 7
    const t2 = (i + 1) / 7
    for (let k = 0; k < 4; k++) {
      const [ax, az] = legs[k]!
      const [bx, bz] = legs[(k + 1) % 4]!
      b.beam('rustDark', at(ax, az, t), at(bx, bz, t), 0.18, 0.18, { col: false })
      b.beam('rustDark', at(ax, az, t), at(bx, bz, t2), 0.14, 0.14, { col: false })
    }
  }
  b.box('rustDark', 6.5, 2.2, 6.5, base.x, base.y + 1.1, base.z, { col: false })
}

function refinery(b: MapBuilder, base: Vector3) {
  // storage tanks, a cracking column and flare stack
  for (const [dx, dz, r, h] of [[0, 0, 9, 10], [22, 6, 7, 8], [-18, 12, 8, 9], [10, -18, 6, 7]] as [number, number, number, number][]) {
    b.cyl('tank', r, r, h, 'y', base.x + dx, base.y + h / 2, base.z + dz, 24, { col: false })
  }
  b.cyl('pipeGrey', 1.6, 1.8, 36, 'y', base.x + 30, base.y + 18, base.z - 14, 12, { col: false })
  b.cyl('pipeGrey', 1.1, 1.1, 28, 'y', base.x + 35, base.y + 14, base.z - 10, 12, { col: false })
  b.cyl('rustDark', 0.5, 0.7, 48, 'y', base.x - 26, base.y + 24, base.z - 20, 8, { col: false })
}
