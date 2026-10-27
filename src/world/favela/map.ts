import { Vector3, type Scene } from 'three'
import type { MapData } from '../../core/types'
import type { CollisionWorld } from '../collision'
import {
  addObjectives,
  createMapWorld,
  drawBlueprint,
  finishMap,
  MAP_BOUNDS,
  type MapShape,
} from '../map-common'

type Builder = ReturnType<typeof createMapWorld>['builder']

function house(b: Builder, x: number, z: number, w: number, d: number, height: number, wall: 'concrete' | 'concreteDark' | 'tinTan', ry = 0, awning = true) {
  b.frame(x, 0, z, ry, () => {
    const t = 0.28
    // Front wall has a clear doorway and high lintel; side/back walls keep indoor routes connected.
    const segment = (x0: number, width: number) => b.box(wall, width, height, t, x0, height / 2, d / 2)
    segment(-w / 2 + (w - 2.0) / 4, (w - 2.0) / 2)
    segment(1.0 + (w - 2.0) / 4, (w - 2.0) / 2)
    b.box(wall, 2.0, 0.48, t, 0, height - 0.24, d / 2)
    b.box(wall, w, height, t, 0, height / 2, -d / 2)
    b.box(wall, t, height, d, -w / 2, height / 2, 0)
    b.box(wall, t, height, d, w / 2, height / 2, 0)
    // Weathered window recesses, frames and painted lintels.
    for (const wx of [-w * 0.31, w * 0.31]) {
      b.box('black', 1.05, 0.78, 0.045, wx, 1.88, d / 2 + 0.16, { col: false })
      b.box('woodDark', 1.2, 0.12, 0.13, wx, 2.32, d / 2 + 0.17, { col: false })
      b.box('woodDark', 0.08, 0.92, 0.13, wx - 0.58, 1.88, d / 2 + 0.17, { col: false })
      b.box('woodDark', 0.08, 0.92, 0.13, wx + 0.58, 1.88, d / 2 + 0.17, { col: false })
      b.box('wood', 0.06, 0.82, 0.12, wx, 1.88, d / 2 + 0.18, { col: false })
    }
    b.box('woodDark', 1.75, 2.45, 0.09, 0, 1.38, d / 2 + 0.19, { col: false })
    b.box('wood', 0.13, 0.13, 0.12, 0.55, 1.35, d / 2 + 0.25, { col: false })
    b.box('concreteDark', w + 0.5, 0.24, d + 0.5, 0, height + 0.12, 0)
    // Low parapets make roof edges readable while leaving broad firing positions.
    for (const xx of [-w / 2, w / 2]) b.box(wall, 0.2, 0.42, d + 0.2, xx, height + 0.45, 0, { col: false })
    b.box(wall, w + 0.2, 0.42, 0.2, 0, height + 0.45, -d / 2)
    if (awning) {
      b.box('tinTan', w * 0.72, 0.14, 1.3, -w * 0.06, height - 0.16, d / 2 + 0.78, { ry: 0.06 })
      for (const xx of [-w * 0.4, w * 0.28]) b.box('woodDark', 0.1, 1.15, 0.1, xx, height - 0.72, d / 2 + 1.25)
    }
    // Exterior stair reaches the roof from the alley; each tread has a real walkable collider.
    const stairX = w / 2 + 1.05
    const steps = Math.ceil((height + 0.24) / 0.36)
    for (let i = 0; i < steps; i++) {
      const top = ((i + 1) / steps) * (height + 0.24)
      const zz = -d / 2 + 0.3 + ((i + 0.5) / steps) * (d - 0.6)
      b.box('concreteDark', 1.45, 0.24, 1.4, stairX, top - 0.12, zz)
      b.box('concrete', 1.5, 0.06, 1.43, stairX, top - 0.025, zz, { col: false })
    }
    b.beam('woodDark', new Vector3(stairX - 0.72, 0.2, -d / 2), new Vector3(stairX - 0.72, height + 0.4, d / 2), 0.08, 0.08, { col: false })
    b.beam('woodDark', new Vector3(stairX + 0.72, 0.2, -d / 2), new Vector3(stairX + 0.72, height + 0.4, d / 2), 0.08, 0.08, { col: false })
    // Rooftop water tank, vent and radio aerials give each block a distinct silhouette.
    b.cyl('tank', 0.62, 0.62, 1.2, 'y', -w * 0.25, height + 1.05, -d * 0.22, 14)
    b.cyl('rustDark', 0.7, 0.7, 0.1, 'y', -w * 0.25, height + 1.66, -d * 0.22, 14, { col: false })
    b.box('concreteDark', 0.7, 0.62, 0.6, w * 0.24, height + 0.55, -d * 0.2)
    b.rod('rustDark', new Vector3(w * 0.27, height + 0.86, -d * 0.2), new Vector3(w * 0.27, height + 2.5, -d * 0.2), 0.035, 8, { col: false })
  })
}

function marketStall(b: Builder, x: number, z: number, color: 'contRed' | 'contBlue' | 'contGreen') {
  b.box('woodDark', 3.6, 1.15, 1.5, x, 0.58, z)
  b.box('wood', 3.85, 0.18, 1.75, x, 1.25, z)
  b.box(color, 4.2, 0.16, 2.4, x, 2.12, z, { rz: 0.05 })
  for (const dx of [-1.8, 1.8]) for (const dz of [-0.9, 0.9]) b.box('woodDark', 0.1, 1.9, 0.1, x + dx, 1.05, z + dz)
  for (let i = -1; i <= 1; i++) b.box('wood', 0.65, 0.25, 0.5, x + i * 0.9, 1.5, z - 0.95, { col: false })
}

export function buildFavelaMap(scene: Scene, collision: CollisionWorld): MapData {
  const { root, builder: b } = createMapWorld(collision, 'favela', 'sand')
  // Stone alleys cross the sandy open spaces and connect the courtyard blocks.
  for (const [x, z, w, d] of [
    [0, 0, 11, 68], [-15, 0, 4, 68], [15, 0, 4, 68], [0, -1, 68, 5], [0, 15, 68, 4], [0, -16, 68, 4],
  ] as [number, number, number, number][]) b.box('concreteDark', w, 0.035, d, x, 0.018, z, { col: false })

  const buildings = [
    { x: -21, z: -21, w: 11, d: 12, h: 3.1, m: 'concreteDark' as const, r: 0.03 },
    { x: -2, z: -21, w: 12, d: 11, h: 3.5, m: 'concrete' as const, r: -0.04 },
    { x: 20, z: -21, w: 11, d: 12, h: 3.0, m: 'tinTan' as const, r: 0.04 },
    { x: -22, z: 0, w: 10, d: 13, h: 3.5, m: 'tinTan' as const, r: -0.05 },
    { x: 22, z: 1, w: 11, d: 13, h: 3.1, m: 'concreteDark' as const, r: 0.03 },
    { x: -20, z: 21, w: 12, d: 11, h: 3.0, m: 'concrete' as const, r: 0.05 },
    { x: 0, z: 21, w: 11, d: 12, h: 3.5, m: 'tinTan' as const, r: -0.03 },
    { x: 20, z: 21, w: 11, d: 11, h: 3.2, m: 'concreteDark' as const, r: 0.02 },
  ]
  for (const block of buildings) house(b, block.x, block.z, block.w, block.d, block.h, block.m, block.r)

  // Market lane and courtyard cover: stalls, low walls, crates, cable runs and rooftop clutter.
  marketStall(b, -8, 4.5, 'contRed')
  marketStall(b, 8, -5.2, 'contBlue')
  marketStall(b, 0, 10, 'contGreen')
  for (const [x, z, ry] of [[-11, -9, 0.12], [11, 9, -0.12], [-10, 21, 0.08], [10, -21, -0.08]] as [number, number, number][]) {
    b.box('concreteDark', 4.6, 1.05, 0.5, x, 0.53, z, { ry })
    b.box('concrete', 4.8, 0.13, 0.65, x, 1.08, z, { ry, col: false })
  }
  for (const [x, z] of [[-5, -5], [5, 6], [-8, 14], [8, -14], [-27, 7], [27, -7], [0, 28], [0, -28]] as [number, number][]) {
    b.box('woodDark', 1.6, 0.9, 1.15, x, 0.45, z)
    b.box('wood', 1.7, 0.12, 1.22, x, 0.96, z)
  }
  // Power lines, sagging washing lines and strings of colored laundry over the alleys.
  b.wire(new Vector3(-15, 7.3, -4), new Vector3(15, 8.1, -4), 1.25, 0.018, 'black')
  b.wire(new Vector3(-14, 6.5, 12), new Vector3(14, 7.5, 12), 1.05, 0.016, 'black')
  for (let i = 0; i < 8; i++) {
    const x = -12 + i * 3.4
    const colors = ['contRed', 'contBlue', 'contGreen'] as const
    b.box(colors[i % colors.length]!, 0.72, 0.9, 0.035, x, 6.8 + (i % 2) * 0.2, -4.6, { rz: i % 2 ? 0.08 : -0.05, col: false })
  }
  for (const [x, z] of [[-31, -28], [30, -27], [-31, 28], [31, 29]] as [number, number][]) {
    b.box('concreteDark', 10, 2.8, 0.8, x, 1.4, z, { col: false })
    b.box('concrete', 8, 1.8, 0.65, x, 3.2, z + 0.1, { col: false })
  }

  const flags = [
    { id: 'A' as const, x: -9.5, z: 0, radius: 4.2 },
    { id: 'B' as const, x: 0, z: -1, radius: 4.6 },
    { id: 'C' as const, x: 9.5, z: 0, radius: 4.2 },
  ]
  const sites = [
    { id: 'A' as const, x: -12.5, z: -5.2, radius: 3 },
    { id: 'B' as const, x: 12.5, z: 5.2, radius: 3 },
  ]
  addObjectives(root, b, flags, sites)

  const shapes: MapShape[] = buildings.map(({ x, z, w, d, m, r }) => ({
    x, z, w, d, angle: r,
    color: m === 'tinTan' ? '#817761' : m === 'concrete' ? '#837c6c' : '#66665d',
  }))
  shapes.push(
    { x: -8, z: 4.5, w: 4.2, d: 2.4, color: '#7e4444' },
    { x: 8, z: -5.2, w: 4.2, d: 2.4, color: '#496b79' },
    { x: 0, z: 10, w: 4.2, d: 2.4, color: '#52684c' },
  )
  const minimap = drawBlueprint('#777461', MAP_BOUNDS, shapes, [
    { x: 0, z: 0, w: 11, d: 68 },
    { x: -15, z: 0, w: 4, d: 68 },
    { x: 15, z: 0, w: 4, d: 68 },
    { x: 0, z: -1, w: 68, d: 5 },
    { x: 0, z: 15, w: 68, d: 4 },
    { x: 0, z: -16, w: 68, d: 4 },
  ])
  const map = finishMap(scene, collision, root, b, {
    id: 'favela',
    displayName: 'Favela',
    location: 'Rio de Janeiro, Brazil',
    spawns: [
      ...[-4, 0, 4, 8, 12, 16].map((x) => ({ team: 'tf141' as const, x, z: 29, look: [0, -8] as [number, number] })),
      ...[-16, -12, -8, -4, 0, 4].map((x) => ({ team: 'opfor' as const, x, z: -29, look: [0, 8] as [number, number] })),
      ...[[-29, -4], [29, 5], [-7, -29], [12, 29], [-30, 15], [30, -15], [0, 28], [0, -28]].map(([x, z]) => ({ team: 'any' as const, x, z })),
    ],
    flags,
    sites,
    bombSpawn: [0, -29],
    callouts: [
      { name: 'North Ridge', x: 0, z: -27, radius: 8 },
      { name: 'West Alley', x: -20, z: 0, radius: 8 },
      { name: 'Market', x: 0, z: 1, radius: 9 },
      { name: 'East Alley', x: 21, z: 1, radius: 8 },
      { name: 'South Steps', x: 0, z: 23, radius: 8 },
      { name: 'West Courtyard', x: -12, z: 12, radius: 7 },
      { name: 'Water Tanks', x: 1, z: -20, radius: 7 },
      { name: 'South Blocks', x: 20, z: 21, radius: 8 },
    ],
    environment: {
      sunDirection: new Vector3(-0.62, -0.68, 0.39).normalize(),
      sunColor: 0xffdda9,
      sunIntensity: 3.0,
      skyZenith: 0x83a5bf,
      skyHorizon: 0xd3b990,
      groundColor: 0x82735a,
      fogColor: 0xb9a47f,
      fogDensity: 0.004,
      exposure: 1,
      haze: 0.2,
    },
    minimap,
    menuCameraPath: [
      { position: new Vector3(-29, 5.5, 12), target: new Vector3(-2, 3, -2) },
      { position: new Vector3(-9, 4.2, 7), target: new Vector3(0, 4, -2) },
      { position: new Vector3(18, 5.3, 7), target: new Vector3(0, 4, -1) },
      { position: new Vector3(20, 6.5, -21), target: new Vector3(-4, 3, 1) },
      { position: new Vector3(-17, 6.0, 24), target: new Vector3(1, 4, -5) },
    ],
  })
  console.info(`[favela] map built — ${b.visTris.toLocaleString()} visible triangles`)
  return map
}
