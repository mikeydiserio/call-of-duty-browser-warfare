import { CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3, type Scene } from 'three'
import type { Callout, Environment, MapData, ObjectiveId, ObjectivePoint, SpawnPoint, Team } from '../core/types'
import { yawFromDirection } from '../core/math'
import type { CollisionWorld } from './collision'
import { MapBuilder } from './builder'
import { createMaterials, type MatKey } from './materials'

export const MAP_BOUNDS = { minX: -34, maxX: 34, minZ: -34, maxZ: 34 }
export type SpawnSpec = { team: Team | 'any'; x: number; z: number; look?: [number, number] }
export type PointSpec = { id: ObjectiveId; x: number; z: number; radius: number }
export type MapShape = { x: number; z: number; w: number; d: number; color: string; angle?: number }

export interface MapBlueprint {
  id: string
  displayName: string
  location: string
  bounds?: typeof MAP_BOUNDS
  spawns: SpawnSpec[]
  flags: PointSpec[]
  sites: PointSpec[]
  bombSpawn: [number, number]
  callouts: { name: string; x: number; z: number; radius: number }[]
  environment: Environment
  minimap: HTMLCanvasElement
  menuCameraPath: { position: Vector3; target: Vector3 }[]
}

/**
 * `bounds` sets the playable area (default MAP_BOUNDS); pass the same object as the
 * blueprint's `bounds` in finishMap so nav, minimap and spawns agree.
 */
export function createMapWorld(collision: CollisionWorld, id: string, ground: MatKey, bounds: typeof MAP_BOUNDS = MAP_BOUNDS) {
  const root = new Group()
  root.name = id
  const builder = new MapBuilder(createMaterials(), collision)
  // A single walkable slab keeps the ground collision continuous beneath the set dressing.
  const w = bounds.maxX - bounds.minX + 4
  const d = bounds.maxZ - bounds.minZ + 4
  builder.box(ground, w, 0.8, d, (bounds.minX + bounds.maxX) / 2, -0.4, (bounds.minZ + bounds.maxZ) / 2)
  addBounds(collision, bounds)
  return { root, builder }
}

export function addBounds(collision: CollisionWorld, bounds: typeof MAP_BOUNDS = MAP_BOUNDS) {
  const h = 40
  const y = h / 2 - 2
  const cx = (bounds.minX + bounds.maxX) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2
  const sx = bounds.maxX - bounds.minX + 12
  const sz = bounds.maxZ - bounds.minZ + 12
  for (const [x, z, w, d] of [
    [cx, bounds.minZ - 0.5, sx, 1],
    [cx, bounds.maxZ + 0.5, sx, 1],
    [bounds.minX - 0.5, cz, 1, sz],
    [bounds.maxX + 0.5, cz, 1, sz],
  ] as [number, number, number, number][]) collision.addBox(new Vector3(x, y, z), new Vector3(w, h, d), 'concrete')
}

export function addPerimeterFence(b: MapBuilder, mat: MatKey = 'rustDark') {
  for (const z of [-32.5, 32.5]) {
    for (let x = -32; x <= 32; x += 4) b.box(mat, 0.12, 2.7, 0.12, x, 1.35, z, { col: false })
    for (const y of [0.6, 1.8]) b.box(mat, 66, 0.09, 0.09, 0, y, z, { col: false })
  }
  for (const x of [-32.5, 32.5]) {
    for (let z = -32; z <= 32; z += 4) b.box(mat, 0.12, 2.7, 0.12, x, 1.35, z, { col: false })
    for (const y of [0.6, 1.8]) b.box(mat, 0.09, 0.09, 66, x, y, 0, { col: false })
  }
}

export function addObjectives(root: Group, b: MapBuilder, flags: PointSpec[], sites: PointSpec[]) {
  const poleMat = new MeshStandardMaterial({ color: 0x75736c, roughness: 0.55, metalness: 0.7 })
  for (const flag of flags) {
    b.box('concreteDark', 0.5, 0.18, 0.5, flag.x, 0.09, flag.z)
    b.cyl('black', 0.045, 0.045, 3.1, 'y', flag.x, 1.7, flag.z, 8)
    const group = new Group()
    group.name = `domflag_${flag.id}`
    group.position.set(flag.x, 0, flag.z)
    const pole = new Mesh(new CylinderGeometry(0.035, 0.045, 3.1, 8), poleMat)
    pole.position.y = 1.7
    pole.name = 'pole'
    group.add(pole)
    const cloth = new Mesh(new PlaneGeometry(1.25, 0.78), new MeshStandardMaterial({ color: 0xe5e0d2, roughness: 0.95, side: DoubleSide }))
    cloth.name = 'cloth'
    cloth.position.set(0.65, 2.65, 0)
    group.add(cloth)
    root.add(group)
  }
  for (const site of sites) {
    b.box('concrete', 2.2, 0.16, 1.5, site.x, 0.08, site.z)
    b.box('panel', 1.55, 1.05, 0.72, site.x, 0.65, site.z)
    b.box('redwhite', 1.6, 0.12, 0.75, site.x, 0.37, site.z)
    const group = new Group()
    group.name = `bombsite_${site.id}`
    root.add(group)
  }
}

export function finishMap(
  scene: Scene,
  collision: CollisionWorld,
  root: Group,
  b: MapBuilder,
  spec: MapBlueprint,
): MapData {
  b.finish(root)
  scene.add(root)
  collision.build()
  const bounds = spec.bounds ?? MAP_BOUNDS
  const spawns: SpawnPoint[] = spec.spawns.map((s) => {
    const y = collision.groundHeight(s.x, s.z, 20, 40)
    const [lx, lz] = s.look ?? [0, 0]
    return {
      team: s.team,
      position: new Vector3(s.x, Number.isFinite(y) ? y + 0.03 : 0.03, s.z),
      yaw: yawFromDirection(lx - s.x, lz - s.z),
    }
  })
  const point = (p: PointSpec): ObjectivePoint => ({ id: p.id, position: new Vector3(p.x, 0.12, p.z), radius: p.radius })
  const callouts: Callout[] = spec.callouts.map((c) => ({ name: c.name, center: new Vector3(c.x, 0, c.z), radius: c.radius }))
  const bombY = collision.groundHeight(spec.bombSpawn[0], spec.bombSpawn[1], 20, 40)
  return {
    id: spec.id,
    displayName: spec.displayName,
    location: spec.location,
    root,
    bounds: { ...bounds },
    spawns,
    domFlags: spec.flags.map(point),
    bombSites: spec.sites.map(point),
    bombSpawn: new Vector3(spec.bombSpawn[0], Number.isFinite(bombY) ? bombY + 0.05 : 0.05, spec.bombSpawn[1]),
    sdAttackersFirst: 'opfor',
    ladders: [],
    nav: [],
    callouts,
    environment: spec.environment,
    minimap: spec.minimap,
    menuCameraPath: spec.menuCameraPath,
  }
}

export function drawBlueprint(
  base: string,
  bounds: typeof MAP_BOUNDS,
  shapes: MapShape[],
  roads: { x: number; z: number; w: number; d: number }[] = [],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const S = canvas.width
  const sx = S / (bounds.maxX - bounds.minX)
  const px = (x: number) => (x - bounds.minX) * sx
  const pz = (z: number) => (z - bounds.minZ) * sx
  ctx.fillStyle = base
  ctx.fillRect(0, 0, S, S)
  ctx.strokeStyle = 'rgba(224,232,204,.09)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 16; i++) {
    const p = (i / 16) * S
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, S)
    ctx.moveTo(0, p)
    ctx.lineTo(S, p)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(196,192,170,.22)'
  for (const r of roads) ctx.fillRect(px(r.x - r.w / 2), pz(r.z - r.d / 2), r.w * sx, r.d * sx)
  for (const shape of shapes) {
    ctx.save()
    ctx.translate(px(shape.x), pz(shape.z))
    ctx.rotate(shape.angle ?? 0)
    ctx.fillStyle = shape.color
    ctx.fillRect((-shape.w / 2) * sx, (-shape.d / 2) * sx, shape.w * sx, shape.d * sx)
    ctx.strokeStyle = 'rgba(10,13,10,.7)'
    ctx.lineWidth = 2
    ctx.strokeRect((-shape.w / 2) * sx, (-shape.d / 2) * sx, shape.w * sx, shape.d * sx)
    ctx.restore()
  }
  ctx.strokeStyle = 'rgba(213,227,183,.45)'
  ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, S - 3, S - 3)
  return canvas
}
