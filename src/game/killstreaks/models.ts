/**
 * Procedural killstreak models (no assets). Every model faces -Z (nose forward), +Y up,
 * origin at the centre of mass. Spinning parts are named 'rotor' / 'tail' / 'prop'.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  type BufferGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three'

export type ModelKind =
  | 'attackHeli'
  | 'paveLow'
  | 'deliveryHeli'
  | 'chopper'
  | 'jet'
  | 'harrier'
  | 'bomber'
  | 'ac130'
  | 'uav'
  | 'missile'
  | 'sentry'
  | 'crate'
  | 'marker'

let mats: Record<string, Material> | null = null
function M() {
  if (mats) return mats
  const std = (color: number, roughness = 0.6, metalness = 0.35) => new MeshStandardMaterial({ color, roughness, metalness })
  mats = {
    olive: std(0x4a5040, 0.75, 0.3),
    grey: std(0x6c7278, 0.55, 0.45),
    darkGrey: std(0x34383c, 0.6, 0.5),
    black: std(0x141516, 0.5, 0.4),
    bomber: std(0x2d3033, 0.45, 0.35),
    glass: new MeshStandardMaterial({ color: 0x1b2a33, roughness: 0.08, metalness: 0.6 }),
    rotor: new MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.7, metalness: 0.2, transparent: true, opacity: 0.55, side: DoubleSide }),
    tan: std(0x8a7a58, 0.85, 0.05),
    crateWood: std(0x5d4a30, 0.9, 0.0),
    strap: std(0x2a2a24, 0.9, 0.0),
    flame: new MeshBasicMaterial({ color: 0xffb060, toneMapped: false }),
    smoke: new MeshBasicMaterial({ color: 0xff3a2a, toneMapped: false }),
    led: new MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }),
  }
  return mats
}

const geoCache = new Map<string, BufferGeometry>()
function box(w: number, h: number, d: number) {
  const k = `b${w},${h},${d}`
  let g = geoCache.get(k)
  if (!g) geoCache.set(k, (g = new BoxGeometry(w, h, d)))
  return g
}
/** Cylinder along Z (radius at front r0, back r1). */
function tubeZ(r0: number, r1: number, len: number, seg = 14) {
  const k = `c${r0},${r1},${len},${seg}`
  let g = geoCache.get(k)
  if (!g) {
    g = new CylinderGeometry(r1, r0, len, seg)
    g.rotateX(-Math.PI / 2)
    geoCache.set(k, g)
  }
  return g
}
function cylY(r: number, h: number, seg = 12) {
  const k = `y${r},${h},${seg}`
  let g = geoCache.get(k)
  if (!g) geoCache.set(k, (g = new CylinderGeometry(r, r, h, seg)))
  return g
}

function add(parent: Group, geo: BufferGeometry, mat: Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new Mesh(geo, mat)
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  m.scale.set(sx, sy, sz)
  m.castShadow = true
  parent.add(m)
  return m
}

function rotorDisc(parent: Group, name: string, r: number, blades: number, y: number, z: number, axis: 'y' | 'x' = 'y', x = 0) {
  const g = new Group()
  g.name = name
  g.position.set(x, y, z)
  const m = M()
  for (let i = 0; i < blades; i++) {
    const b = new Mesh(box(r * 2, 0.04, 0.32), m.black!)
    b.rotation.y = (i / blades) * Math.PI
    g.add(b)
  }
  const disc = new Mesh(cylY(r, 0.02, 32), m.rotor!)
  g.add(disc)
  add(g, cylY(0.18, 0.3), m.darkGrey!, 0, 0.1, 0)
  if (axis === 'x') g.rotation.z = Math.PI / 2
  parent.add(g)
  return g
}

function attackHeli(paint: Material): Group {
  // AH-64-ish: narrow tandem cockpit, stub wings with pods, chin gun.
  const g = new Group()
  const m = M()
  add(g, tubeZ(0.7, 0.55, 5.2), paint, 0, 0, -0.4)
  add(g, box(1.1, 1.1, 2.6), paint, 0, 0.15, -0.2)
  add(g, tubeZ(0.5, 0.18, 2.2), paint, 0, 0.1, -3.9)
  add(g, box(0.9, 0.7, 1.9), m.glass!, 0, 0.75, -1.9, 0.12)
  add(g, tubeZ(0.28, 0.12, 6.2), paint, 0, 0.35, 3.7)
  add(g, box(0.12, 1.7, 1.0), paint, 0, 1.1, 6.6, 0.3)
  add(g, box(2.4, 0.08, 0.6), paint, 0, 0.5, 6.3)
  add(g, box(4.4, 0.12, 0.9), paint, 0, -0.1, -0.2)
  for (const s of [-1, 1]) {
    add(g, tubeZ(0.26, 0.26, 1.8, 10), m.darkGrey!, s * 1.7, -0.45, -0.3)
    add(g, tubeZ(0.38, 0.32, 1.9, 12), m.darkGrey!, s * 0.85, 0.9, 0.4)
  }
  add(g, box(0.5, 0.4, 0.5), m.black!, 0, -0.75, -3.3)
  add(g, tubeZ(0.06, 0.06, 1.4, 8), m.black!, 0, -0.85, -4.0)
  add(g, cylY(0.07, 0.9), m.black!, -0.8, -1.1, -1.1)
  add(g, cylY(0.07, 0.9), m.black!, 0.8, -1.1, -1.1)
  rotorDisc(g, 'rotor', 7.2, 4, 1.35, -0.2)
  rotorDisc(g, 'tail', 1.4, 4, 1.2, 6.65, 'x', 0.18)
  return g
}

function heavyHeli(paint: Material, guns: boolean): Group {
  // MH-53 Pave Low: bulky hull, refuelling probe, sponsons, big six-blade rotor.
  const g = new Group()
  const m = M()
  add(g, box(2.6, 2.4, 9.5), paint, 0, 0, 0)
  add(g, tubeZ(1.3, 1.2, 1.6, 16), paint, 0, 0.05, -5.4, 0, 0, 0, 1, 0.92, 1)
  add(g, box(2.0, 1.0, 1.3), m.glass!, 0, 0.75, -5.9, 0.35)
  add(g, tubeZ(0.08, 0.06, 4, 8), m.darkGrey!, 0.9, 0.4, -7.8)
  add(g, box(1.5, 1.6, 3.6), paint, 0, 1.6, -0.6)
  add(g, tubeZ(0.9, 0.35, 7.5), paint, 0, 0.8, 8.2)
  add(g, box(0.18, 2.6, 1.6), paint, 0, 2.2, 11.8, 0.25)
  for (const s of [-1, 1]) {
    add(g, box(1.0, 1.2, 3.8), paint, s * 1.75, -0.6, 0.6)
    add(g, cylY(0.35, 0.3), m.black!, s * 1.8, -1.35, 0.6, Math.PI / 2, 0, 0)
    if (guns) add(g, tubeZ(0.08, 0.08, 1.6, 8), m.black!, s * 1.45, 0.1, -3.4)
  }
  add(g, cylY(0.3, 0.3), m.black!, 0, -1.3, -4.4, Math.PI / 2, 0, 0)
  rotorDisc(g, 'rotor', 11, 6, 2.6, -0.4)
  rotorDisc(g, 'tail', 2.2, 4, 2.6, 12.4, 'x', 0.25)
  return g
}

function jet(paint: Material, harrier: boolean): Group {
  const g = new Group()
  const m = M()
  add(g, tubeZ(0.75, 0.65, 13), paint, 0, 0, 0)
  add(g, new ConeGeometry(0.75, 3.2, 14).rotateX(-Math.PI / 2), paint, 0, 0, -8.1)
  add(g, box(1.0, 0.7, 2.6), m.glass!, 0, 0.7, -4.6, 0.08)
  // swept wings: two flattened boxes per side
  for (const s of [-1, 1]) {
    add(g, box(5.6, 0.16, 3.2), paint, s * 3.3, harrier ? 0.4 : -0.1, 0.8, 0, s * (harrier ? 0.42 : 0.5))
    add(g, box(2.6, 0.12, 1.6), paint, s * 1.9, 0.1, 6.0, 0, s * 0.5)
    add(g, box(0.9, 0.9, 3.8), paint, s * 1.0, -0.1, -1.6)
  }
  add(g, box(0.14, 2.3, 2.2), paint, harrier ? 0 : -0.9, 1.3, 5.6, 0, 0, harrier ? 0 : -0.25)
  if (!harrier) add(g, box(0.14, 2.3, 2.2), paint, 0.9, 1.3, 5.6, 0, 0, 0.25)
  const burn = new Mesh(new ConeGeometry(0.5, 2.6, 10).rotateX(Math.PI / 2), m.flame!)
  burn.name = 'flame'
  burn.position.set(0, 0, 7.6)
  g.add(burn)
  if (harrier) for (const s of [-1, 1]) add(g, tubeZ(0.42, 0.42, 0.8, 10), m.darkGrey!, s * 1.45, -0.5, -0.4, Math.PI / 2)
  return g
}

function bomber(): Group {
  // B-2 flying wing: wide sawtooth trailing edge.
  const g = new Group()
  const m = M()
  const wing = add(g, box(28, 0.9, 7), m.bomber!, 0, 0, 0, 0, 0, 0)
  wing.scale.set(1, 1, 1)
  for (const s of [-1, 1]) {
    add(g, box(15, 0.7, 5), m.bomber!, s * 7.5, 0, -2.2, 0, s * 0.62)
    add(g, box(5, 0.6, 3), m.bomber!, s * 9, 0, 4.6, 0, -s * 0.6)
    add(g, box(5, 0.6, 3), m.bomber!, s * 3.5, 0, 4.6, 0, s * 0.6)
  }
  add(g, tubeZ(1.8, 2.2, 9, 12), m.bomber!, 0, 0.5, -1.5, 0, 0, 0, 1, 0.45, 1)
  add(g, box(2.6, 0.5, 1.5), m.glass!, 0, 1.15, -5)
  return g
}

function ac130(): Group {
  const g = new Group()
  const m = M()
  const p = m.grey!
  add(g, tubeZ(2.1, 1.6, 26), p, 0, 0, 0)
  add(g, new SphereGeometry(2.1, 16, 10), p, 0, 0, -13, 0, 0, 0, 1, 0.9, 1.4)
  add(g, box(40, 0.5, 4.2), p, 0, 1.6, -1)
  add(g, box(0.4, 6.5, 4.5), p, 0, 4.6, 12.5, -0.15)
  add(g, box(14, 0.35, 3.2), p, 0, 1.6, 12.6)
  for (const x of [-14, -7, 7, 14]) {
    add(g, tubeZ(0.65, 0.55, 4.6, 12), m.darkGrey!, x, 1.1, -2)
    rotorDisc(g, 'prop', 2.1, 4, 1.1, -4.4 + 0, 'y', x).rotation.x = Math.PI / 2
  }
  // gun ports on the left side
  add(g, tubeZ(0.18, 0.18, 2.4, 10), m.black!, -2.2, -0.6, -4, 0, Math.PI / 2)
  add(g, tubeZ(0.12, 0.12, 1.8, 10), m.black!, -2.0, -0.6, 0, 0, Math.PI / 2)
  return g
}

function uav(): Group {
  const g = new Group()
  const m = M()
  add(g, tubeZ(0.35, 0.22, 4.5), m.grey!, 0, 0, 0)
  add(g, box(10, 0.1, 0.8), m.grey!, 0, 0.1, -0.2)
  add(g, box(2.4, 0.08, 0.5), m.grey!, 0, 0.2, 2.1, 0, 0, 0)
  add(g, new SphereGeometry(0.42, 12, 8), m.darkGrey!, 0, 0.2, -1.8)
  rotorDisc(g, 'prop', 0.6, 2, 0, 2.35, 'y').rotation.x = Math.PI / 2
  return g
}

function missile(): Group {
  const g = new Group()
  const m = M()
  add(g, tubeZ(0.22, 0.22, 3.2, 12), m.grey!, 0, 0, 0)
  add(g, new ConeGeometry(0.22, 0.7, 12).rotateX(-Math.PI / 2), m.darkGrey!, 0, 0, -1.95)
  for (let i = 0; i < 4; i++) add(g, box(0.9, 0.05, 0.6), m.darkGrey!, 0, 0, 1.3, 0, 0, (i * Math.PI) / 2)
  const burn = new Mesh(new ConeGeometry(0.2, 1.4, 10).rotateX(Math.PI / 2), m.flame!)
  burn.name = 'flame'
  burn.position.set(0, 0, 2.3)
  g.add(burn)
  return g
}

function sentry(): Group {
  const g = new Group()
  const m = M()
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    add(g, box(0.06, 0.95, 0.06), m.black!, Math.sin(a) * 0.32, 0.42, Math.cos(a) * 0.32, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5)
  }
  const head = new Group()
  head.name = 'head'
  head.position.y = 0.95
  add(head, box(0.42, 0.32, 0.62), m.olive!, 0, 0, 0)
  add(head, box(0.26, 0.24, 0.34), m.darkGrey!, 0.28, 0, 0.05)
  add(head, tubeZ(0.05, 0.05, 0.9, 8), m.black!, 0, 0.04, -0.72)
  add(head, tubeZ(0.08, 0.08, 0.22, 10), m.black!, 0, 0.04, -1.1)
  add(head, box(0.04, 0.04, 0.04), m.led!, 0.12, 0.18, -0.28)
  g.add(head)
  return g
}

function crate(): Group {
  const g = new Group()
  const m = M()
  add(g, box(1.2, 0.95, 1.2), m.tan!, 0, 0.475, 0)
  for (const x of [-0.3, 0.3]) add(g, box(0.08, 0.97, 1.22), m.strap!, x, 0.475, 0)
  add(g, box(1.24, 0.12, 1.24), m.crateWood!, 0, 0.06, 0)
  add(g, box(0.2, 0.06, 0.2), m.led!, 0, 0.98, 0)
  return g
}

function marker(): Group {
  const g = new Group()
  const m = M()
  add(g, cylY(0.045, 0.16, 10), m.olive!, 0, 0.08, 0)
  const glow = add(g, new SphereGeometry(0.05, 8, 6), m.smoke!, 0, 0.18, 0)
  glow.castShadow = false
  return g
}

export function buildModel(kind: ModelKind, friendly = true): Group {
  const m = M()
  let g: Group
  switch (kind) {
    case 'attackHeli':
      g = attackHeli(m.olive!)
      break
    case 'chopper':
      g = attackHeli(m.darkGrey!)
      break
    case 'paveLow':
      g = heavyHeli(m.darkGrey!, true)
      break
    case 'deliveryHeli':
      g = heavyHeli(friendly ? m.olive! : m.tan!, false)
      break
    case 'jet':
      g = jet(m.grey!, false)
      break
    case 'harrier':
      g = jet(m.grey!, true)
      break
    case 'bomber':
      g = bomber()
      break
    case 'ac130':
      g = ac130()
      break
    case 'uav':
      g = uav()
      break
    case 'missile':
      g = missile()
      break
    case 'sentry':
      g = sentry()
      break
    case 'crate':
      g = crate()
      break
    default:
      g = marker()
  }
  g.name = `ks_${kind}`
  return g
}

/** Spin rotors / props; called per frame with the model's own clock. */
export function animateModel(g: Group, t: number) {
  for (const c of g.children) {
    if (c.name === 'rotor') c.rotation.y = t * 26
    else if (c.name === 'tail') c.rotation.x = t * 40
    else if (c.name === 'prop') c.rotation.y = t * 30
    else if (c.name === 'flame') c.scale.setScalar(0.85 + Math.sin(t * 60) * 0.15)
  }
}
