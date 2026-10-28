/**
 * MW2 "Rust", built from the original level geometry (assets-src/maps/mp_rust.obj, converted to
 * mp_rust.bin by tools/convert_rust_obj.ts and fetched by preloadRustMap() before boot).
 * Gameplay data — spawns, objectives, callouts, ladders — is authored here in game metres:
 * +X east, −Z north, ground ≈ 0. The yard is ~55 × 53 m inside the chain-link perimeter.
 */
import { Group, type Scene, Vector3 } from 'three'
import { CONFIG } from '../../core/config'
import { yawFromDirection } from '../../core/math'
import type { Callout, Ladder, MapData, ObjectivePoint, SpawnPoint, Team } from '../../core/types'
import { MapBuilder } from '../builder'
import type { CapsuleResult, CollisionWorld } from '../collision'
import { addBounds, addObjectives, type PointSpec, type SpawnSpec } from '../map-common'
import { createMaterials } from '../materials'
import { buildRustGeometry, rustAssets } from './obj-map'

const V = (x: number, y: number, z: number) => new Vector3(x, y, z)

/** Zones (centre + radius), used for callouts. */
const ZONES = {
  derrick: { name: 'Oil Derrick', x: -15.6, z: -18.3, r: 6 },
  pipeline: { name: 'Pipeline', x: 2, z: -21.5, r: 7 },
  redTank: { name: 'Red Tank', x: 3.3, z: -14.1, r: 3.5 },
  northShed: { name: 'North Shed', x: 17.5, z: -13.6, r: 5 },
  tower: { name: 'Tower', x: 3.1, z: -1.5, r: 8 },
  westShack: { name: 'West Shack', x: -24.4, z: -3.2, r: 4.5 },
  eastShack: { name: 'East Shack', x: 24.4, z: -3.2, r: 4.5 },
  rails: { name: 'Rails', x: -10.5, z: 6, r: 5 },
  fuelTanks: { name: 'Fuel Tanks', x: 18.9, z: 19.2, r: 6 },
  southBuilding: { name: 'South Building', x: 1.5, z: 22.5, r: 5 },
  southWest: { name: 'Southwest Yard', x: -18, z: 19, r: 8 },
  northEast: { name: 'Northeast Yard', x: 23, z: -18, r: 6 },
}

const SPAWNS: SpawnSpec[] = [
  // TF141 — southwest yard
  { team: 'tf141', x: -22.5, z: 22.5, look: [0, 0] },
  { team: 'tf141', x: -19.0, z: 23.5, look: [0, 0] },
  { team: 'tf141', x: -24.5, z: 18.5, look: [0, 0] },
  { team: 'tf141', x: -15.5, z: 23.0, look: [0, 0] },
  { team: 'tf141', x: -21.0, z: 15.5, look: [0, 0] },
  { team: 'tf141', x: -12.5, z: 21.0, look: [0, 0] },
  // OpFor — northeast yard
  { team: 'opfor', x: 23.5, z: -19.5, look: [0, 0] },
  { team: 'opfor', x: 20.0, z: -19.0, look: [0, 0] },
  { team: 'opfor', x: 25.0, z: -15.5, look: [0, 0] },
  { team: 'opfor', x: 16.0, z: -19.0, look: [0, 0] },
  { team: 'opfor', x: 24.5, z: -11.0, look: [0, 0] },
  { team: 'opfor', x: 12.5, z: -18.5, look: [0, 0] },
  // anywhere — around the edges
  ...([
    [-25.0, -12.0], [-20.0, -8.0], [-8.0, -15.0], [-24.5, 7.0], [-17.5, 0.5], [-6.0, 14.0],
    [8.5, 15.0], [10.0, 24.0], [25.0, 10.0], [25.0, 25.0], [14.0, 2.0], [-2.0, -10.0],
    [10.0, -9.0], [-25.0, 25.0], [-9.0, 24.0], [25.0, -24.5],
  ] as [number, number][]).map(([x, z]): SpawnSpec => ({ team: 'any', x, z })),
]

/** Domination: A on the TF141 side, B east of the tower, C on the OpFor side. */
const FLAGS: PointSpec[] = [
  { id: 'A', x: -14.5, z: 15.0, radius: 4.5 },
  { id: 'B', x: 12.2, z: 7.7, radius: 5 },
  { id: 'C', x: 15.4, z: -8.4, radius: 4.5 },
]
/** S&D: OpFor attack from the northeast; the sites sit on the TF141 half. */
const SITES: PointSpec[] = [
  { id: 'A', x: -6.0, z: 19.0, radius: 3 },
  { id: 'B', x: -17.5, z: 4.5, radius: 3 },
]
const BOMB_SPAWN = { x: 22.0, z: -21.0 }
const SD_ATTACKERS_FIRST: Team = 'opfor'

/** Climbable ladders (bottom at ground, top where the climber steps off). */
const LADDERS: Ladder[] = []

const _cap: CapsuleResult = { onGround: false, groundNormal: new Vector3(), push: new Vector3(), collided: false }
const _a = new Vector3()
const _b = new Vector3()

/** True if a standing capsule fits at (x, y, z) without touching anything. */
function clearAt(collision: CollisionWorld, x: number, y: number, z: number) {
  const r = CONFIG.capsuleRadius
  _a.set(x, y + r + 0.08, z)
  _b.set(x, y + 1.8 - r, z)
  return !collision.resolveCapsule(_a, _b, r, _cap).collided
}

/** Ground y at the spec, nudged outward in rings until a standing capsule fits on open ground. */
function placeSpawn(collision: CollisionWorld, s: SpawnSpec): SpawnPoint {
  for (let ring = 0; ring <= 6; ring++) {
    const steps = ring === 0 ? 1 : 8
    for (let k = 0; k < steps; k++) {
      const ang = (k / steps) * Math.PI * 2
      const x = s.x + Math.cos(ang) * ring * 0.6
      const z = s.z + Math.sin(ang) * ring * 0.6
      const y = collision.groundHeight(x, z, 30, 60)
      if (!Number.isFinite(y) || y > 1.5 || !clearAt(collision, x, y, z)) continue
      const [lx, lz] = s.look ?? [0, 0]
      return { team: s.team, position: V(x, y + 0.02, z), yaw: yawFromDirection(lx - x, lz - z) }
    }
  }
  console.warn(`[rust] no clear ground near spawn (${s.x}, ${s.z})`)
  const [lx, lz] = s.look ?? [0, 0]
  return { team: s.team, position: V(s.x, 0.2, s.z), yaw: yawFromDirection(lx - s.x, lz - s.z) }
}

function drawMinimap(bounds: MapData['bounds'], flags: ObjectivePoint[], sites: ObjectivePoint[]): HTMLCanvasElement {
  const S = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const g = cv.getContext('2d')!
  g.drawImage(rustAssets().minimap, 0, 0, S, S)
  const X = (x: number) => ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * S
  const Z = (z: number) => ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * S
  // objectives, drawn lightly (the UI overlays live state): flags = letter in a circle, sites = square
  g.font = 'bold 15px "Saira Condensed", "Arial Narrow", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const [list, round] of [[flags, true], [sites, false]] as [ObjectivePoint[], boolean][]) {
    for (const o of list) {
      const x = X(o.position.x)
      const y = Z(o.position.z)
      g.fillStyle = 'rgba(20,20,16,0.45)'
      g.strokeStyle = 'rgba(225,222,205,0.55)'
      g.lineWidth = 1.5
      g.beginPath()
      if (round) g.arc(x, y, 10, 0, Math.PI * 2)
      else g.rect(x - 9, y - 9, 18, 18)
      g.fill()
      g.stroke()
      g.fillStyle = 'rgba(235,232,215,0.75)'
      g.fillText(o.id, x, y + 1)
    }
  }
  const v = g.createRadialGradient(S / 2, S / 2, S * 0.45, S / 2, S / 2, S * 0.72)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.35)')
  g.fillStyle = v
  g.fillRect(0, 0, S, S)
  return cv
}

export function buildRustMap(scene: Scene, collision: CollisionWorld): MapData {
  const t0 = performance.now()
  const root = new Group()
  root.name = 'rust'
  const mats = createMaterials()
  const b = new MapBuilder(mats, collision)

  const geo = buildRustGeometry(root, collision, mats)
  const bounds = geo.bounds
  const flagSpecs = FLAGS.map((f) => ({ ...f, y: geo.groundAt(f.x, f.z) }))
  const siteSpecs = SITES.map((s) => ({ ...s, y: geo.groundAt(s.x, s.z) }))
  addObjectives(root, b, flagSpecs, siteSpecs)
  addBounds(collision, bounds)

  b.finish(root)
  scene.add(root)
  collision.build()

  const spawns = SPAWNS.map((s) => placeSpawn(collision, s))
  const point = (p: PointSpec & { y: number }): ObjectivePoint => ({ id: p.id, position: V(p.x, p.y, p.z), radius: p.radius })
  const domFlags = flagSpecs.map(point)
  const bombSites = siteSpecs.map(point)
  const by = collision.groundHeight(BOMB_SPAWN.x, BOMB_SPAWN.z, 30, 60)
  const bombSpawn = V(BOMB_SPAWN.x, Number.isFinite(by) ? by + 0.05 : 0.1, BOMB_SPAWN.z)
  const callouts: Callout[] = Object.values(ZONES).map((z) => ({ name: z.name, center: V(z.x, 0, z.z), radius: z.r }))

  // Sun from the west-south-west, ~25° up. sunDirection points from the sun into the scene.
  const az = Math.PI * (22.5 / 180)
  const el = Math.PI * (25 / 180)
  const toSun = V(-Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el))

  const menuCameraPath = [
    { position: V(-22, 1.8, 20), target: V(2, 6, -2) }, // across the southwest yard to the tower
    { position: V(-8, 2.4, 12), target: V(4, 7, -2) },
    { position: V(12, 1.6, 14), target: V(19, 2, 20) }, // past the fuel tanks
    { position: V(20, 2.2, 4), target: V(4, 5, -4) },
    { position: V(22, 3.0, -12), target: V(-14, 12, -18) }, // derrick silhouette against the sky
    { position: V(-4, 2.0, -11), target: V(-16, 14, -18) },
    { position: V(-20, 3.5, -4), target: V(3, 6, 0) },
  ]

  console.info(
    `[rust] map built in ${(performance.now() - t0).toFixed(0)} ms — vis tris ${(geo.visTris / 1000).toFixed(0)}k, ` +
      `col tris ${(geo.colTris / 1000).toFixed(0)}k, ${spawns.length} spawns, ladders ${LADDERS.length}`,
  )

  return {
    id: 'rust',
    displayName: 'Rust',
    location: 'Oil yard, Afghanistan border',
    root,
    bounds,
    spawns,
    domFlags,
    bombSites,
    bombSpawn,
    sdAttackersFirst: SD_ATTACKERS_FIRST,
    ladders: LADDERS,
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
    minimap: drawMinimap(bounds, domFlags, bombSites),
    menuCameraPath,
  }
}
