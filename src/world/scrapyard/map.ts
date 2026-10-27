import { Vector3, type Scene } from 'three'
import type { MapData } from '../../core/types'
import type { CollisionWorld } from '../collision'
import {
  addObjectives,
  addPerimeterFence,
  createMapWorld,
  drawBlueprint,
  finishMap,
  MAP_BOUNDS,
  type MapShape,
} from '../map-common'

function container(b: ReturnType<typeof createMapWorld>['builder'], x: number, z: number, y: number, color: 'contBlue' | 'contRed' | 'contGreen', w = 6.2, d = 2.55, ry = 0) {
  b.frame(x, y, z, ry, () => {
    b.box(color, w, 2.55, d, 0, 1.275, 0)
    for (let i = 0; i <= Math.floor(w / 0.55); i++) {
      const xx = -w / 2 + 0.15 + i * 0.55
      b.box('rustDark', 0.055, 2.45, 0.055, xx, 1.27, d / 2 + 0.035, { col: false })
      b.box('rustDark', 0.055, 2.45, 0.055, xx, 1.27, -d / 2 - 0.035, { col: false })
    }
    for (const xx of [-w / 2 + 0.12, w / 2 - 0.12]) for (const zz of [-d / 2 + 0.12, d / 2 - 0.12]) {
      b.box('rustDark', 0.16, 2.6, 0.16, xx, 1.28, zz, { col: false })
    }
    b.box('rustDark', 0.05, 2.0, 0.1, w / 2 + 0.04, 1.25, 0, { col: false })
  })
}

function hangar(b: ReturnType<typeof createMapWorld>['builder'], x: number, z: number, w: number, d: number, mat: 'tin' | 'tinTan') {
  const h = 7.4
  b.box('concreteDark', 0.45, h, d, x - w / 2, h / 2, z)
  b.box(mat, 0.38, h, d, x + w / 2, h / 2, z)
  b.box(mat, w, h, 0.4, x, h / 2, z - d / 2)
  b.box('rustDark', w + 0.7, 0.28, d + 0.7, x, h + 0.03, z)
  // The loading face stays open so the hangars work as routes, not dead-end scenery.
  for (const xx of [x - w / 2 + 0.5, x + w / 2 - 0.5]) {
    b.box('rustDark', 0.42, h, 0.42, xx, h / 2, z + d / 2)
    b.box('rustDark', 0.28, h, 0.28, xx, h / 2, z - d / 2)
  }
  b.box(mat, w, 0.45, 0.45, x, h - 0.25, z + d / 2)
  for (let i = -2; i <= 2; i++) {
    const xx = x + i * (w / 5)
    b.beam('rustDark', new Vector3(xx, h - 0.1, z - d / 2), new Vector3(xx, h + 0.3, z + d / 2), 0.1, 0.12, { col: false })
  }
  for (const zz of [z - d / 2 + 1, z + d / 2 - 1]) b.box('rustDark', w, 0.12, 0.12, x, h - 0.5, zz, { col: false })
}

function wreckedAirliner(b: ReturnType<typeof createMapWorld>['builder']) {
  // Split fuselage and wings read as a crash site while leaving broken sightlines around it.
  b.cyl('tin', 1.28, 1.52, 12.8, 'z', 0, 2.35, 0.1, 18)
  b.cyl('tinTan', 0.05, 1.3, 2.2, 'z', 0, 2.45, -7.1, 16)
  b.cyl('rustDark', 0.94, 1.25, 1.9, 'z', 0, 2.35, 7.0, 14)
  b.box('black', 1.8, 0.48, 1.8, 0, 3.32, -4.8, { col: false })
  b.box('tin', 9.4, 0.2, 2.6, -5.6, 2.25, 0.3, { ry: -0.12 })
  b.box('tinTan', 5.8, 0.2, 2.2, 6.0, 1.65, 1.9, { ry: 0.22 })
  b.box('rustDark', 3.9, 0.15, 1.8, -0.9, 3.05, 6.1, { ry: -0.16 })
  b.box('tin', 0.2, 3.0, 0.22, 0, 3.25, 7.0, { col: false })
  // Torn metal edges and detached engine nacelles.
  for (const [x, z, a] of [[-10.8, -1.3, -0.15], [9.5, 3.4, 0.32], [-3.2, 8.7, 0.48], [6.5, -4.8, -0.28]] as [number, number, number][]) {
    b.box('rustDark', 2.8, 0.18, 1.2, x, 0.72, z, { ry: a })
    b.box('tinTan', 1.25, 0.18, 0.72, x + 0.5, 1.05, z + 0.25, { ry: a + 0.2 })
  }
  for (const x of [-4.4, 4.2]) {
    b.cyl('rustDark', 0.66, 0.66, 2.0, 'z', x, 1.9, -0.3, 14)
    b.cyl('black', 0.24, 0.24, 0.16, 'z', x, 1.9, -1.4, 12, { col: false })
  }
}

export function buildScrapyardMap(scene: Scene, collision: CollisionWorld): MapData {
  const { root, builder: b } = createMapWorld(collision, 'scrapyard', 'concreteDark')
  b.box('concrete', 2.8, 0.025, 66, 0, 0.015, 0, { col: false })
  for (const z of [-24, -20, 20, 24]) {
    for (let x = -30; x <= 30; x += 5) b.box('redwhite', 2.0, 0.025, 0.12, x, 0.035, z, { col: false })
  }
  // Two open service sheds form the long outside lanes.
  hangar(b, -21, -17, 17, 17, 'tinTan')
  hangar(b, 21, 17, 17, 17, 'tin')
  // A smaller repair bay and a concrete office break up the southern lane.
  hangar(b, -18, 17, 11, 10, 'tin')
  b.box('concreteDark', 8, 3.1, 6, 15, 1.55, -20)
  b.box('concrete', 7.6, 0.18, 5.6, 15, 0.09, -20)
  b.box('tinTan', 8.7, 0.24, 6.6, 15, 3.22, -20)
  b.box('black', 0.2, 1.8, 2.2, 10.9, 1.05, -20)
  b.box('tin', 0.15, 1.5, 1.8, 19.1, 1.0, -20)
  wreckedAirliner(b)

  // Salvage lanes: stacked freight, vehicle hulks, drums and engine pallets.
  container(b, -27, 4, 0, 'contBlue', 6.6, 2.6, Math.PI / 2)
  container(b, -27, 11, 0, 'contRed', 6.6, 2.6, Math.PI / 2)
  container(b, -27, 11, 2.6, 'contGreen', 6.6, 2.6, Math.PI / 2)
  container(b, 27, -4, 0, 'contGreen', 6.6, 2.6, Math.PI / 2)
  container(b, 27, -11, 0, 'contRed', 6.6, 2.6, Math.PI / 2)
  container(b, 27, -11, 2.6, 'contBlue', 6.6, 2.6, Math.PI / 2)
  container(b, -8, -25, 0, 'contRed', 5.8, 2.55, -0.12)
  container(b, 5, 25, 0, 'contBlue', 5.8, 2.55, 0.08)
  for (const [x, z, ry] of [[-10, 14, 0.3], [-14, -3, -0.2], [12, 9, 0.18], [9, -15, -0.42], [-7, -14, 0.12]] as [number, number, number][]) {
    b.box('rustDark', 3.4, 0.85, 1.65, x, 0.45, z, { ry })
    b.box('rust', 2.8, 0.32, 1.5, x, 1.02, z, { ry })
    for (const wx of [-1.25, 1.25]) for (const wz of [-0.53, 0.53]) b.cyl('black', 0.43, 0.43, 0.22, 'x', x + wx, 0.42, z + wz, 12, { ry })
  }
  for (const [x, z] of [[-13, 8], [-17, 8], [11, -8], [15, -8], [0, 16], [6, -21], [-6, -20]] as [number, number][]) {
    b.cyl('rustDark', 0.42, 0.42, 1.1, 'y', x, 0.58, z, 14)
    b.cyl('redwhite', 0.43, 0.43, 0.12, 'y', x, 0.72, z, 14, { col: false })
  }
  // Pipe stands and a fuel tank silhouette at the outer service yard.
  for (const x of [-3.4, 3.4]) {
    b.box('rustDark', 0.35, 2.0, 0.35, x, 1.0, -28)
    b.box('rustDark', 0.35, 2.0, 0.35, x, 1.0, -21)
  }
  b.cyl('pipeGrey', 1.3, 1.3, 8.2, 'z', 0, 2.0, -24.5, 20)
  addPerimeterFence(b, 'rustDark')

  const flags = [
    { id: 'A' as const, x: -14, z: 2, radius: 4.2 },
    { id: 'B' as const, x: 0, z: -9, radius: 4.4 },
    { id: 'C' as const, x: 14, z: 1, radius: 4.2 },
  ]
  const sites = [
    { id: 'A' as const, x: 15, z: -8, radius: 3 },
    { id: 'B' as const, x: -14, z: 14, radius: 3 },
  ]
  addObjectives(root, b, flags, sites)

  const shapes: MapShape[] = [
    { x: -21, z: -17, w: 17, d: 17, color: '#727366' },
    { x: 21, z: 17, w: 17, d: 17, color: '#5f6565' },
    { x: -18, z: 17, w: 11, d: 10, color: '#626a68' },
    { x: 15, z: -20, w: 8, d: 6, color: '#716e61' },
    { x: 0, z: 0, w: 9, d: 12, color: '#a09b82', angle: 0.05 },
    { x: -27, z: 7.5, w: 2.6, d: 13, color: '#3e6874' },
    { x: 27, z: -7.5, w: 2.6, d: 13, color: '#4c6955' },
    { x: -8, z: -25, w: 5.8, d: 2.55, color: '#764a42' },
    { x: 5, z: 25, w: 5.8, d: 2.55, color: '#3d6174' },
  ]
  const minimap = drawBlueprint('#292b25', MAP_BOUNDS, shapes, [
    { x: 0, z: 0, w: 5, d: 68 },
    { x: 0, z: 0, w: 68, d: 5 },
  ])
  const map = finishMap(scene, collision, root, b, {
    id: 'scrapyard',
    displayName: 'Scrapyard',
    location: 'Aircraft boneyard, western Nevada',
    spawns: [
      ...[-26, -22, -18, -14, -10, -7].map((z) => ({ team: 'tf141' as const, x: -30.6, z, look: [0, 0] as [number, number] })),
      ...[7, 11, 15, 19, 23, 27].map((z) => ({ team: 'opfor' as const, x: 30.6, z, look: [0, 0] as [number, number] })),
      ...[[-30, 0], [30, 2], [-4, 29], [9, -29], [-13, -27], [16, 28], [-31, 27], [31, -28]].map(([x, z]) => ({ team: 'any' as const, x, z })),
    ],
    flags,
    sites,
    bombSpawn: [29, -25],
    callouts: [
      { name: 'West Hangar', x: -21, z: -17, radius: 9 },
      { name: 'Central Wreck', x: 0, z: 0, radius: 8 },
      { name: 'North Stack', x: -27, z: 8, radius: 7 },
      { name: 'East Hangar', x: 21, z: 17, radius: 9 },
      { name: 'Repair Bay', x: -18, z: 17, radius: 7 },
      { name: 'South Yard', x: 4, z: 24, radius: 8 },
      { name: 'Engine Row', x: 11, z: -9, radius: 7 },
    ],
    environment: {
      sunDirection: new Vector3(-0.72, -0.57, 0.4).normalize(),
      sunColor: 0xffd49e,
      sunIntensity: 3.1,
      skyZenith: 0x8197a8,
      skyHorizon: 0xd4b998,
      groundColor: 0x71604b,
      fogColor: 0xcab091,
      fogDensity: 0.005,
      exposure: 1,
      haze: 0.32,
    },
    minimap,
    menuCameraPath: [
      { position: new Vector3(-28, 3, 9), target: new Vector3(-4, 3, 1) },
      { position: new Vector3(-9, 2.2, -12), target: new Vector3(0, 3, 1) },
      { position: new Vector3(14, 2.4, 12), target: new Vector3(0, 3, 0) },
      { position: new Vector3(28, 3.2, -6), target: new Vector3(3, 2, -1) },
      { position: new Vector3(5, 5, 29), target: new Vector3(0, 2, 0) },
    ],
  })
  console.info(`[scrapyard] map built — ${b.visTris.toLocaleString()} visible triangles`)
  return map
}
