/**
 * MW2 "Rust": a compact late-afternoon desert oil yard. Central rusted tower (reachable by
 * ladders and by walking up the 1.2 m pipeline), ringed by containers, tanks, a derrick and
 * small buildings, enclosed by fences and sand berms. Everything is procedural.
 */
import { Group, type Scene, Vector3 } from 'three'
import { yawFromDirection } from '../../core/math'
import type { Callout, MapData, SpawnPoint, Team } from '../../core/types'
import { MapBuilder } from '../builder'
import type { CollisionWorld } from '../collision'
import { createMaterials } from '../materials'
import { buildBackdrop } from './backdrop'
import { drawMinimap } from './minimap'
import { type Ctx, Instancer, registerPrototypes } from './props'
import { buildDecals, buildTerrain, type DarkSpot, type Patch, type Track } from './terrain'
import { buildTower, TOWER } from './tower'
import { BIG_PIPE, buildScatter, buildZones, ZONES } from './zones'

const V = (x: number, y: number, z: number) => new Vector3(x, y, z)

const BOUNDS = { minX: -34, maxX: 34, minZ: -34, maxZ: 34 }

const TRACKS: Track[] = [
  // gate → past the fuel depot → east of the tower → south road → loading dock
  { pts: [V(28, 0, -40), V(27, 0, -31), V(21, 0, -21), V(16.5, 0, -10), V(16.5, 0, 4), V(13, 0, 17), V(4, 0, 18.4), V(-8, 0, 21), V(-18, 0, 23.4), V(-26, 0, 24), V(-40, 0, 24)], width: 3.4 },
  // spur into the generators
  { pts: [V(14.5, 0, 14), V(20, 0, 19.5), V(31, 0, 18.5)], width: 3.0 },
  // spur to the derrick from the north road
  { pts: [V(18, 0, -16), V(4, 0, -14), V(-10, 0, -16), V(-18, 0, -18.5)], width: 3.0 },
]

const DARK: DarkSpot[] = [
  { x: 0, z: 0.5, r: 9, k: 0.8 },
  { x: -24, z: -23.5, r: 9, k: 0.9 },
  { x: 22, z: 24, r: 8, k: 0.8 },
  { x: 25, z: -8.5, r: 7, k: 0.7 },
  { x: -26, z: -5, r: 7, k: 0.6 },
  { x: -24, z: 27, r: 9, k: 0.5 },
  { x: -17, z: -28, r: 5, k: 0.8 },
]

const OIL: Patch[] = [
  { x: -24, z: -23.5, size: 4.5, rot: 0.4, y: undefined },
  { x: -16.8, z: -27.6, size: 3.2, rot: 1.2 },
  { x: -21.2, z: -20.2, size: 2.2, rot: 2.0 },
  { x: 18.9, z: 21.4, size: 3.0, rot: 0.2 },
  { x: 23.0, z: 27.6, size: 2.4, rot: 1.5 },
  { x: 27.0, z: 19.0, size: 2.8, rot: 2.6 },
  { x: 24.0, z: -8.8, size: 3.5, rot: 0.8 },
  { x: -25.4, z: -6.8, size: 2.6, rot: 0.1 },
  { x: -19.4, z: -7.0, size: 3.4, rot: 2.2 },
  { x: 1.5, z: 2.0, size: 2.6, rot: 0.6, y: TOWER.f0 },
  { x: -2.0, z: -2.2, size: 1.8, rot: 1.6, y: TOWER.f0 },
  { x: 9.0, z: 12.0, size: 2.2, rot: 2.9 },
  { x: -12.0, z: 20.5, size: 2.0, rot: 0.3 },
]

const SOIL: Patch[] = [
  { x: 0, z: -9, size: 8, rot: 0.3 },
  { x: -10, z: 2, size: 9, rot: 1.1 },
  { x: 10, z: 8, size: 8, rot: 2.1 },
  { x: -14, z: -20, size: 10, rot: 0.6 },
  { x: 18, z: -18, size: 9, rot: 2.6 },
  { x: -4, z: 26, size: 9, rot: 1.6 },
  { x: 26, z: 14, size: 7, rot: 0.9 },
  { x: -28, z: 14, size: 8, rot: 2.3 },
]

export function buildRustMap(scene: Scene, collision: CollisionWorld): MapData {
  const t0 = performance.now()
  const root = new Group()
  root.name = 'rust'
  const mats = createMaterials()
  const b = new MapBuilder(mats, collision)
  const c: Ctx = { b, inst: new Instancer(b), ladders: [], fp: [] }
  registerPrototypes(c)

  const terr = buildTerrain(root, collision, TRACKS, DARK)
  buildDecals(root, TRACKS, OIL, SOIL)
  buildTower(c)
  buildZones(c)
  buildScatter(c)
  buildBackdrop(root, b)

  // invisible bounds walls (the player clamps too; this keeps bots & grenades in)
  const wallH = 30
  for (const [x, z, w, d] of [
    [0, BOUNDS.minZ - 0.5, 80, 1],
    [0, BOUNDS.maxZ + 0.5, 80, 1],
    [BOUNDS.minX - 0.5, 0, 1, 80],
    [BOUNDS.maxX + 0.5, 0, 1, 80],
  ] as [number, number, number, number][]) {
    collision.addBox(V(x, wallH / 2 - 2, z), V(w, wallH, d), 'sand')
  }

  const merged = b.finish(root)
  const inst = c.inst.finish(root)
  scene.add(root)
  collision.build()

  // ── spawns (y from the built collision) ──
  const spawns: SpawnPoint[] = []
  const addSpawn = (team: Team | 'any', x: number, z: number, look?: [number, number]) => {
    const y = collision.groundHeight(x, z, 30, 60)
    const [lx, lz] = look ?? [0, 0]
    spawns.push({ team, position: V(x, Number.isFinite(y) ? y + 0.02 : 0.2, z), yaw: yawFromDirection(lx - x, lz - z) })
  }
  // TF141 — Loading Dock (on and in front of the dock)
  addSpawn('tf141', -26.0, 29.0, [0, 10])
  addSpawn('tf141', -22.0, 28.6, [0, 10])
  addSpawn('tf141', -29.0, 24.2, [0, 10])
  addSpawn('tf141', -23.4, 24.2, [0, 10])
  addSpawn('tf141', -18.4, 27.6, [0, 10])
  addSpawn('tf141', -31.0, 28.6, [0, 10])
  // OpFor — Front Gate
  addSpawn('opfor', 26.0, -29.8, [0, -5])
  addSpawn('opfor', 29.4, -28.0, [0, -5])
  addSpawn('opfor', 22.6, -28.8, [0, -5])
  addSpawn('opfor', 27.4, -24.6, [0, -5])
  addSpawn('opfor', 31.6, -23.4, [0, -5])
  addSpawn('opfor', 20.6, -26.6, [0, -5])
  // anywhere — behind cover around the edges
  const anyPts: [number, number][] = [
    [-30.0, -9.0], [-28.5, -2.0], [-22.5, -27.5], [-28.5, -19.0], [-14.5, -29.0], [-1.0, -24.0],
    [5.0, -29.5], [15.5, -21.5], [30.0, -12.5], [30.5, -1.5], [29.5, 10.0], [24.5, 13.5],
    [30.5, 29.5], [18.0, 30.5], [8.0, 30.5], [-3.5, 30.5], [-10.5, 26.5], [-31.0, 12.0],
    [-30.5, 4.5], [-13.0, -6.5], [16.0, -1.0], [1.0, 14.5],
  ]
  for (const [x, z] of anyPts) addSpawn('any', x, z)

  const callouts: Callout[] = [
    { name: 'Front Gate', center: V(ZONES.frontGate.x, 0, ZONES.frontGate.z), radius: ZONES.frontGate.r },
    { name: 'Loading Dock', center: V(ZONES.loadingDock.x, 0, ZONES.loadingDock.z), radius: ZONES.loadingDock.r },
    { name: 'Tower', center: V(0, 0, 0.5), radius: ZONES.tower.r },
    { name: 'Pipeline', center: V(ZONES.pipeline.x, 0, ZONES.pipeline.z), radius: ZONES.pipeline.r },
    { name: 'Oil Derrick', center: V(ZONES.derrick.x, 0, ZONES.derrick.z), radius: ZONES.derrick.r },
    { name: 'Blue Containers', center: V(ZONES.blueContainers.x, 0, ZONES.blueContainers.z), radius: ZONES.blueContainers.r },
    { name: 'Red Containers', center: V(ZONES.redContainers.x, 0, ZONES.redContainers.z), radius: ZONES.redContainers.r },
    { name: 'Generators', center: V(ZONES.generators.x, 0, ZONES.generators.z), radius: ZONES.generators.r },
    { name: 'Control Room', center: V(ZONES.controlRoom.x, 0, ZONES.controlRoom.z), radius: ZONES.controlRoom.r },
    { name: 'Maintenance', center: V(ZONES.maintenance.x, 0, ZONES.maintenance.z), radius: ZONES.maintenance.r },
    { name: 'Fuel Depot', center: V(ZONES.fuelDepot.x, 0, ZONES.fuelDepot.z), radius: ZONES.fuelDepot.r },
    { name: 'Comms Station', center: V(ZONES.comms.x, 0, ZONES.comms.z), radius: ZONES.comms.r },
  ]

  // Sun from the west-south-west, ~25° up. sunDirection points from the sun into the scene.
  const az = Math.PI * (22.5 / 180)
  const el = Math.PI * (25 / 180)
  const toSun = V(-Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el))

  const minimap = drawMinimap(BOUNDS, c.fp, TRACKS, [BIG_PIPE])

  const menuCameraPath = [
    { position: V(-27, 1.4, 17), target: V(-4, 5.5, 2) }, // low along the big pipe toward the tower
    { position: V(-12, 2.2, 13), target: V(0, 7, 0) },
    { position: V(10, 1.3, 13), target: V(-1, 6, -1) }, // under the pipe rack
    { position: V(17, 2.0, -3), target: V(6, -0.5, -20) }, // across to the blue containers
    { position: V(20, 3.2, -18), target: V(-6, 6, -2) },
    { position: V(-10, 1.6, -18), target: V(-24, 9, -24) }, // derrick silhouette against the sky
    { position: V(-18, 4.5, -4), target: V(2, 8, 2) },
    { position: V(-22, 2.6, 19), target: V(0, 4, 0) },
  ]

  const dt = performance.now() - t0
  console.info(
    `[rust] map built in ${dt.toFixed(0)} ms — ${merged.meshes} merged meshes, ${inst.meshes} instanced (${c.inst.count} inst), ` +
      `vis tris ${(b.visTris / 1000).toFixed(0)}k + inst ${(inst.tris / 1000).toFixed(0)}k + terrain ${((terr.innerTris + terr.outerTris) / 1000).toFixed(0)}k, ` +
      `col tris ${(b.colTris / 1000).toFixed(0)}k, ladders ${c.ladders.length}`,
  )

  return {
    id: 'rust',
    displayName: 'Rust',
    location: 'Oil yard, Afghanistan border',
    root,
    bounds: { ...BOUNDS },
    spawns,
    ladders: c.ladders,
    nav: [],
    callouts,
    environment: {
      sunDirection: toSun.clone().negate().normalize(),
      sunColor: 0xffd29a,
      sunIntensity: 3.4,
      skyZenith: 0x8d9fae,
      skyHorizon: 0xdcbf94,
      groundColor: 0x7a5f40,
      fogColor: 0xcdb08a,
      fogDensity: 0.0075,
      exposure: 1,
      haze: 0.55,
    },
    minimap,
    menuCameraPath,
  }
}
