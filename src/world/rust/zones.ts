/**
 * The eleven zones around the tower. North is −Z, east is +X. Playable bounds ±34 m.
 *
 *   Derrick (-24,-23)   Comms (-6,-27)   Blue Containers (9,-19)   Front Gate (25,-27)
 *   Maintenance (-26,-5)                 Fuel Depot (25,-8)
 *   Pipeline (-18,8)        TOWER (0,0)        Red Containers (22,8)
 *   Loading Dock (-24,27)   Control Room (4,23)   Generators (22,24)
 */
import { CylinderGeometry, ExtrudeGeometry, LatheGeometry, Shape, Vector2, Vector3 } from 'three'
import type { MatKey } from '../materials'
import {
  angle,
  barrel,
  barrelCluster,
  container,
  CONT,
  corrugated,
  crate,
  fence,
  ibeam,
  jersey,
  jerseyRow,
  ladder,
  lightPole,
  pallet,
  palletStack,
  pipeline,
  railing,
  rock,
  rot,
  sandbags,
  scrapSheet,
  tireStack,
  utilityPole,
  valve,
  type Ctx,
} from './props'
import { groundY } from './terrain'
import { TOWER } from './tower'

export const ZONES = {
  frontGate: { x: 25, z: -27, r: 8 },
  loadingDock: { x: -24, z: 27, r: 8 },
  tower: { x: 0, z: 0.5, r: 6 },
  pipeline: { x: -17, z: 8, r: 7 },
  derrick: { x: -24, z: -23, r: 8 },
  blueContainers: { x: 9, z: -20, r: 7 },
  redContainers: { x: 22, z: 8, r: 7 },
  generators: { x: 22, z: 24, r: 7 },
  controlRoom: { x: 4, z: 23, r: 6 },
  maintenance: { x: -26, z: -5, r: 6 },
  fuelDepot: { x: 25, z: -8, r: 6 },
  comms: { x: -6, z: -27, r: 6 },
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z)

/**
 * Wall along local X from x0 to x1 at local z, thickness t, height h, with rectangular openings
 * [u0, u1, v0, v1] (u along the wall from x0, v = height). Built from boxes.
 */
function wallWithOpenings(c: Ctx, mat: MatKey, x0: number, x1: number, z: number, y: number, t: number, h: number, openings: [number, number, number, number][], ry = 0) {
  const b = c.b
  const len = x1 - x0
  const ops = openings.slice().sort((a, bb) => a[0] - bb[0])
  let u = 0
  const seg = (ua: number, ub: number, va: number, vb: number) => {
    if (ub - ua < 0.01 || vb - va < 0.01) return
    const cx = x0 + (ua + ub) / 2
    const cy = y + (va + vb) / 2
    if (ry === 0) b.box(mat, ub - ua, vb - va, t, cx, cy, z)
    else b.frame(0, 0, 0, ry, () => b.box(mat, ub - ua, vb - va, t, cx, cy, z))
  }
  for (const [u0, u1, v0, v1] of ops) {
    seg(u, u0, 0, h)
    seg(u0, u1, 0, v0)
    seg(u0, u1, v1, h)
    u = u1
  }
  seg(u, len, 0, h)
}

// ─── Front Gate (NE) ──────────────────────────────────────────────────────

function frontGate(c: Ctx) {
  const b = c.b
  // perimeter fence north & east with the gate opening at x 24..31 on z = -32
  fence(c, -2, -32.5, 23.4, -32.5, { barbed: true })
  fence(c, 31.6, -32.5, 33, -32.5, { barbed: true })
  fence(c, 33, -32.5, 33, -15, { barbed: true })
  // gate pillars
  for (const x of [23.7, 31.3]) {
    const gy = groundY(x, -32.5)
    b.box('concrete', 0.7, 3.2, 0.7, x, gy + 1.5, -32.5)
    b.box('concreteDark', 0.85, 0.15, 0.85, x, gy + 3.15, -32.5)
    b.box('lamp', 0.16, 0.16, 0.16, x, gy + 3.32, -32.5, { col: false })
  }
  // sliding gate, rolled half open, on its own frame
  const gy = groundY(26, -32.9)
  b.frame(21.5, gy, -32.95, 0, () => {
    b.rod('pipeGrey', V(-2.2, 0.2, 0), V(2.2, 0.2, 0), 0.04, 6, { col: false })
    b.rod('pipeGrey', V(-2.2, 2.1, 0), V(2.2, 2.1, 0), 0.04, 6, { col: false })
    b.rod('pipeGrey', V(-2.2, 0.2, 0), V(-2.2, 2.1, 0), 0.04, 6, { col: false })
    b.rod('pipeGrey', V(2.2, 0.2, 0), V(2.2, 2.1, 0), 0.04, 6, { col: false })
    b.rod('pipeGrey', V(-2.2, 0.2, 0), V(2.2, 2.1, 0), 0.03, 6, { col: false })
    b.box('chain', 4.3, 1.85, 0.01, 0, 1.15, 0, { col: false })
    b.colBox(0, 1.1, 0, 4.4, 2.2, 0.08, 'metal')
    for (const x of [-1.8, 1.8]) b.cyl('black', 0.09, 0.09, 0.06, 'z', x, 0.1, 0, 10, { col: false })
  })
  // second leaf swung inward
  b.frame(31.0, groundY(30, -31), -32.3, -1.1, () => {
    b.rod('pipeGrey', V(-3.4, 0.2, 0), V(0, 0.2, 0), 0.04, 6, { col: false })
    b.rod('pipeGrey', V(-3.4, 2.1, 0), V(0, 2.1, 0), 0.04, 6, { col: false })
    b.rod('pipeGrey', V(-3.4, 0.2, 0), V(-3.4, 2.1, 0), 0.04, 6, { col: false })
    b.box('chain', 3.4, 1.85, 0.01, -1.7, 1.15, 0, { col: false })
    b.colBox(-1.7, 1.1, 0, 3.4, 2.2, 0.08, 'metal')
  })
  // guard booth (tin hut with window band)
  const bx = 19.5
  const bz = -29.5
  const by = groundY(bx, bz)
  c.fp.push({ x: bx, z: bz, w: 2.6, d: 2.2, ry: 0.05, kind: 'building' })
  b.frame(bx, by, bz, 0.05, () => {
    b.box('concrete', 2.8, 0.2, 2.4, 0, 0.0, 0)
    corrugated(b, 'tinTan', 2.6, 1.0, 0, 0.6, -1.1, { col: 'metal' })
    corrugated(b, 'tinTan', 2.6, 2.4, 0, 1.3, 1.1, { col: 'metal' })
    corrugated(b, 'tinTan', 2.2, 1.0, 1.3, 0.6, 0, { ry: Math.PI / 2, col: 'metal' })
    corrugated(b, 'tinTan', 1.0, 2.4, -1.3, 1.3, 0.6, { ry: Math.PI / 2, col: 'metal' })
    // window posts & roof
    for (const [x, z] of [[-1.28, -1.08], [1.28, -1.08], [1.28, 1.08], [-1.28, 1.08], [0, -1.08]] as [number, number][]) {
      b.box('rustDark', 0.08, 2.5, 0.08, x, 1.25, z, { col: false })
    }
    corrugated(b, 'tin', 3.0, 2.8, 0, 2.55, 0, { rx: -Math.PI / 2 + 0.08, col: 'metal' })
    b.box('woodDark', 2.2, 0.06, 0.5, 0, 1.0, -0.8, { col: false })
    b.box('black', 0.4, 0.3, 0.3, 0.6, 1.18, -0.8, { col: false })
  })
  // barrier arm
  const ax = 27.5
  const az = -30.4
  const ay = groundY(ax, az)
  b.box('concrete', 0.5, 1.0, 0.5, 23.9, ay + 0.5, az)
  b.frame(23.9, ay + 1.05, az, 0, () => {
    b.box('redwhite', 5.4, 0.1, 0.1, 2.75, 0, 0, { col: false, rz: 0.06 })
  })
  // chicane barriers and spawn cover
  jerseyRow(c, 22.0, -26.5, 28.2, -26.0)
  jerseyRow(c, 29.5, -21.0, 32.5, -22.0)
  sandbags(c, 18.3, -24.2, 0.6, 3.2, 4, { curve: 0.4 })
  barrelCluster(c, 31.5, -29.0, 4, ['barrelRust', 'barrelBlue'], 1)
  palletStack(c, 17.4, -31.2, 0.2, 5)
  palletStack(c, 18.7, -31.4, -0.1, 3)
  crate(c, 30.6, groundY(30.6, -24.4), -24.4, 0.3, 1.2)
  crate(c, 31.6, groundY(31.6, -25.8), -25.8, -0.1, 1.0)
  lightPole(c, 33.4, -28, -Math.PI / 2)
  lightPole(c, 15.5, -32.0, 0)
}

// ─── Loading Dock (SW) ────────────────────────────────────────────────────

function loadingDock(c: Ctx) {
  const b = c.b
  const x0 = -32
  const x1 = -18.5
  const z0 = 26.4
  const z1 = 32.4
  const top = 1.2
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  c.fp.push({ x: cx, z: cz, w: x1 - x0, d: z1 - z0, ry: 0, kind: 'pad' })
  // dock slab with bumpers
  b.box('concrete', x1 - x0, top + 0.6, z1 - z0, cx, top / 2 - 0.3, cz)
  b.box('concreteDark', x1 - x0 + 0.1, 0.12, 0.3, cx, top - 0.06, z0 + 0.1, { col: false })
  for (let x = x0 + 1.2; x < x1 - 0.5; x += 2.6) b.box('rubber', 0.3, 0.45, 0.14, x, top - 0.45, z0 - 0.06)
  // ramp down to the east (walkable incline)
  const rl = 5.2
  b.frame(x1 + rl / 2, 0, (z0 + z1) / 2 - 1.2, 0, () => {
    const ang = Math.atan2(top, rl)
    b.box('concrete', Math.hypot(rl, top) + 0.1, 0.5, 3.4, 0, top / 2 - 0.22, 0, { rz: -ang })
  })
  // steps on the north face
  for (let i = 0; i < 4; i++) b.box('concrete', 1.6, (i + 1) * 0.3, 0.32, -27.5, ((i + 1) * 0.3) / 2, z0 - 0.16 - (3 - i) * 0.32)
  railing(b, [[-28.4, z0], [-28.4, z0 - 1.3]], 0.3, 'pipeYellow', { col: false })
  // dock edge rails segment
  railing(b, [[x0, z0 + 0.1], [-28.4, z0 + 0.1]], top, 'pipeYellow')

  // warehouse wall behind the dock with roll-up doors and a canopy
  const wz = z1 + 0.3
  const wh = 7.0
  for (let x = x0 - 2; x < x1 + 0.1; x += 3.0) {
    const isDoor = Math.abs(x - -27) < 0.1 || Math.abs(x - -21) < 0.1
    if (isDoor) {
      corrugated(b, 'tin', 3.0, wh - 4.0, x + 1.5, top + 4.0 + (wh - 4.0) / 2, wz, { col: 'metal' })
      // roll-up door (horizontal ribs) + housing
      b.frame(x + 1.5, top, wz - 0.05, 0, () => {
        corrugated(b, 'pipeGrey', 4.0, 2.8, 0, 2.0 + 0.6, 0, { rz: Math.PI / 2, col: 'metal' })
        b.cyl('rustDark', 0.25, 0.25, 3.0, 'x', 0, 4.15, -0.1, 12, { col: false })
      })
      b.colBox(x + 1.5, top / 2 + 0.6, wz, 3.0, top + 1.0, 0.2, 'metal')
    } else {
      const m = (['tin', 'tin', 'tinTan', 'tin', 'rust', 'tinTan'] as MatKey[])[Math.floor(((x + 40) / 3) % 6)]!
      corrugated(b, m, 3.0, wh + top + 0.4, x + 1.5, (wh + top + 0.4) / 2 - 0.4, wz, { col: 'metal' })
    }
    ibeam(b, 'rust', V(x, -0.2, wz + 0.2), V(x, wh + top, wz + 0.2), 0.2, 0.2)
  }
  // girts across the cladding
  for (const gy of [top + 2.6, top + 5.2]) ibeam(b, 'rustDark', V(x0 - 2, gy, wz - 0.12), V(x1 + 0.2, gy, wz - 0.12), 0.08, 0.14, { col: false })
  // warehouse roof edge
  ibeam(b, 'rustDark', V(x0 - 2, wh + top, wz + 0.2), V(x1 + 0.2, wh + top, wz + 0.2), 0.15, 0.3, { col: false })
  corrugated(b, 'tin', x1 - x0 + 2.2, 8, cx - 1, wh + top + 0.6, wz + 4.2, { rx: -Math.PI / 2 + 0.15, col: false })
  // canopy over the dock
  const ch = top + 3.8
  for (const x of [x0 + 0.5, cx, x1 - 0.5]) {
    ibeam(b, 'rust', V(x, top, z0 + 0.4), V(x, ch, z0 + 0.4), 0.2, 0.2)
    ibeam(b, 'rustDark', V(x, ch, z0 + 0.4), V(x, ch + 0.5, wz), 0.12, 0.22, { col: false })
  }
  ibeam(b, 'rustDark', V(x0, ch, z0 + 0.4), V(x1, ch, z0 + 0.4), 0.14, 0.26, { col: false })
  corrugated(b, 'tinTan', x1 - x0 + 0.6, wz - z0 + 0.4, cx, ch + 0.28, (z0 + wz) / 2, { rx: -Math.PI / 2 - Math.atan2(0.5, wz - z0), col: 'metal' })
  // clutter on the dock
  palletStack(c, -30.5, 30.2, 0.1, 6, top)
  palletStack(c, -29.1, 30.6, -0.15, 3, top)
  crate(c, -24.0, top, 30.8, 0.1, 1.3)
  crate(c, -22.5, top, 31.0, -0.2, 1.0)
  crate(c, -24.1, top + 1.3, 30.9, 0.4, 0.8)
  barrelCluster(c, -20.3, 29.0, 3, ['barrelBlue', 'barrelRed'], 0, top)
  // containers on the yard floor in front of the dock (spawn cover)
  container(c, -27.6, groundY(-27.6, 21.8), 21.8, 0.12, 'contGreen')
  container(c, -14.6, groundY(-14.6, 31.4), 31.4, -Math.PI / 2 + 0.05, 'contRed', { open: true })
  sandbags(c, -20.7, 22.6, -0.35, 3.0, 4)
  palletStack(c, -16.2, 25.4, 0.4, 2)
  jersey(c, -31.6, 20.4, Math.PI / 2 + 0.06)
  lightPole(c, -18.0, 33.2, Math.PI)
}

// ─── Pipeline (W / SW): the walkable 1.2 m pipe up to the tower ───────────

export const BIG_PIPE: Vector3[] = [
  V(-33.5, -0.3, 13.5),
  V(-23, 0.95, 12.5),
  V(-15.5, 0.95, 6.5),
  V(-TOWER.half - 0.02, TOWER.f1 - 0.6, TOWER.pipeZ),
]

function pipelineZone(c: Ctx) {
  const b = c.b
  pipeline(c, BIG_PIPE, 0.6, 'pipeGrey', { every: 4.5, walkTop: true })
  // end cap flange at the tower
  const e = BIG_PIPE[3]!
  b.cyl('rustDark', 0.68, 0.68, 0.14, 'x', e.x - 0.07, e.y, e.z, 24, { col: false })
  // tall supports under the rising section
  for (const t of [0.3, 0.55, 0.8]) {
    const p = new Vector3().lerpVectors(BIG_PIPE[2]!, e, t)
    const gy = groundY(p.x, p.z)
    const top = p.y - 0.6
    b.frame(p.x, 0, p.z, Math.atan2(-(e.z - BIG_PIPE[2]!.z), e.x - BIG_PIPE[2]!.x) + Math.PI / 2, () => {
      ibeam(b, 'rust', V(-0.7, gy - 0.1, 0), V(-0.7, top, 0), 0.18, 0.18)
      ibeam(b, 'rust', V(0.7, gy - 0.1, 0), V(0.7, top, 0), 0.18, 0.18)
      ibeam(b, 'rustDark', V(-0.85, top - 0.1, 0), V(0.85, top - 0.1, 0), 0.18, 0.2)
      if (top - gy > 1.6) angle(b, 'rustDark', V(-0.7, gy + 0.2, 0), V(0.7, top - 0.3, 0), 0.08, { col: 'metal' })
      b.box('concrete', 2.0, 0.3, 0.6, 0, gy + 0.0, 0)
    })
  }
  // second, smaller line running along the south then north past the tower's west side
  pipeline(c, [V(-33.5, 0.62, 16.2), V(-7.5, 0.62, 16.2), V(-7.5, 0.62, -12.5), V(-3.5, 0.62, -15.5)], 0.42, 'pipeYellow', { every: 5 })
  // a paired low line (crouch cover) north of the tower
  pipeline(c, [V(-16, 0.42, -11.2), V(7.5, 0.42, -11.2)], 0.28, 'rust', { every: 4 })
  pipeline(c, [V(-16, 0.42, -10.3), V(5.0, 0.42, -10.3), V(7.5, 0.42, -8.5)], 0.28, 'pipeGrey', { every: 4 })
  valve(c, -9.1, 17.2, 0.3)
  valve(c, -6.4, -6.2, 1.2)
  c.fp.push({ x: -20, z: 9.5, w: 26, d: 1.2, ry: 0, kind: 'pipe' })
  // cover clutter along the pipe
  sandbags(c, -11.2, 9.5, 0.6, 2.6, 4)
  barrelCluster(c, -24.5, 8.2, 3, ['barrelRust', 'barrelRed'], 1)
  crate(c, -19.0, groundY(-19, 3.0), 3.0, 0.4, 1.1)
  crate(c, -18.0, groundY(-18, 2.3), 2.3, 0.1, 0.8)
  jerseyRow(c, -13.5, 13.2, -10.5, 12.0)
  scrapSheet(c, -27, 6.5, 0.4)
}

// ─── Oil Derrick (NW) ─────────────────────────────────────────────────────

function derrick(c: Ctx) {
  const b = c.b
  const x = -24
  const z = -23.5
  const gy = groundY(x, z)
  const floor = gy + 1.15
  c.fp.push({ x, z, w: 6.4, d: 6.4, ry: 0, kind: 'derrick' })
  // drill floor on concrete footings
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('concrete', 0.8, 1.4, 0.8, x + sx * 2.8, gy + 0.3, z + sz * 2.8)
  b.box('diamond', 6.4, 0.1, 6.4, x, floor - 0.05, z)
  ibeam(b, 'rust', V(x - 3.2, floor - 0.3, z - 3.2), V(x + 3.2, floor - 0.3, z - 3.2), 0.2, 0.4)
  ibeam(b, 'rust', V(x - 3.2, floor - 0.3, z + 3.2), V(x + 3.2, floor - 0.3, z + 3.2), 0.2, 0.4)
  ibeam(b, 'rust', V(x - 3.2, floor - 0.3, z - 3.2), V(x - 3.2, floor - 0.3, z + 3.2), 0.2, 0.4)
  ibeam(b, 'rust', V(x + 3.2, floor - 0.3, z - 3.2), V(x + 3.2, floor - 0.3, z + 3.2), 0.2, 0.4)
  b.colBox(x, floor - 0.6, z, 6.4, 1.1, 6.4, 'metal')
  // stairs up to the floor on the east side
  for (let i = 0; i < 4; i++) {
    const sy = gy + 0.29 * (i + 1)
    b.box('diamond', 0.32, 0.05, 1.2, x + 3.2 + 1.3 - i * 0.32, sy - 0.025, z + 1.6)
    b.colBox(x + 3.2 + 1.3 - i * 0.32, (gy + sy) / 2, z + 1.6, 0.32, sy - gy, 1.2, 'metal')
  }
  railing(b, [[x - 3.2, z - 3.2], [x + 3.2, z - 3.2], [x + 3.2, z + 1.0]], floor, 'pipeYellow')
  railing(b, [[x + 3.2, z + 2.2], [x + 3.2, z + 3.2], [x - 3.2, z + 3.2], [x - 3.2, z - 3.2]], floor, 'pipeYellow')
  // tapered lattice mast
  const H = 17
  const base = 2.4
  const topW = 0.7
  const leg = (sx: number, sz: number, t: number) => {
    const w = base + (topW - base) * t
    return V(x + sx * w, floor + H * t, z + sz * w)
  }
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  for (const [sx, sz] of corners) ibeam(b, 'rust', leg(sx, sz, 0), leg(sx, sz, 1), 0.2, 0.2)
  const levels = 8
  for (let i = 0; i <= levels; i++) {
    const t = i / levels
    const t2 = (i + 1) / levels
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k]!
      const [bx, bz] = corners[(k + 1) % 4]!
      angle(b, 'rustDark', leg(ax, az, t), leg(bx, bz, t), 0.08, { col: false })
      if (i < levels) {
        if (i === 0 && k === 1) continue // keep the east face open at the floor
        angle(b, 'rustDark', leg(ax, az, t), leg(bx, bz, t2), 0.06, { col: false })
        angle(b, 'rustDark', leg(bx, bz, t), leg(ax, az, t2), 0.06, { col: false })
      }
    }
  }
  // crown block + monkey board
  b.box('rust', 1.8, 0.6, 1.8, x, floor + H + 0.3, z, { col: false })
  b.box('grate', 2.6, 0.06, 1.0, x, floor + H * 0.62, z - 1.6, { col: false })
  b.wire(V(x, floor + H, z), V(x, floor + 2.2, z), 0.0, 0.03, 'black')
  b.box('rustDark', 0.6, 1.2, 0.4, x, floor + 2.6, z, { col: false })
  // draw works / doghouse on the floor
  b.box('generator', 2.0, 1.2, 1.2, x - 1.6, floor + 0.6, z + 1.6)
  b.box('rustDark', 1.2, 0.8, 0.9, x + 1.5, floor + 0.4, z - 1.7)
  b.cyl('black', 0.35, 0.35, 1.5, 'x', x - 1.6, floor + 1.45, z + 1.6, 12, { col: false })
  // pipe rack beside the derrick (racked drill pipe)
  for (let i = 0; i < 6; i++) {
    b.rod('rustDark', V(x - 7.4, gy + 0.55 + (i % 2) * 0.12, z - 2 + i * 0.18), V(x - 3.6, gy + 0.55 + (i % 2) * 0.12, z - 2 + i * 0.18), 0.06, 6, { col: false })
  }
  for (const xx of [x - 7, x - 4]) b.box('woodDark', 0.15, 0.5, 1.4, xx, gy + 0.25, z - 1.5)
  // mud tanks (long boxy tanks) to the south
  b.frame(-29, groundY(-29, -14.5), -14.5, Math.PI / 2 - 0.05, () => {
    b.box('tank', 7.5, 2.1, 2.4, 0, 1.05, 0)
    b.box('rustDark', 7.6, 0.2, 2.5, 0, 0.1, 0, { col: false })
    for (let i = -3; i <= 3; i++) b.box('tank', 0.1, 2.0, 2.46, i * 1.1, 1.05, 0, { col: false })
    railing(b, [[-3.7, -1.15], [3.7, -1.15]], 2.1, 'pipeYellow', { col: false })
  })
  c.fp.push({ x: -29, z: -14.5, w: 2.4, d: 7.5, ry: -0.05, kind: 'tank' })
  // pump jack (nodding donkey)
  pumpJack(c, -16.5, -28.5, 0.3)
  barrelCluster(c, -19.5, -19.5, 3, ['barrelRust', 'barrelGrey'])
  tireStack(c, -30.5, -27.8, 4)
  tireStack(c, -31.3, -27.0, 2)
  sandbags(c, -21.5, -17.0, 0.05, 3.0, 4)
  scrapSheet(c, -28.5, -30, 1.1)
}

function pumpJack(c: Ctx, x: number, z: number, ry: number) {
  const b = c.b
  const gy = groundY(x, z)
  c.fp.push({ x, z, w: 6.5, d: 1.8, ry, kind: 'low' })
  b.frame(x, gy, z, ry, () => {
    b.box('concrete', 7.0, 0.4, 2.0, 0, 0.1, 0)
    // samson post (A-frame)
    for (const sz of [-0.55, 0.55]) {
      ibeam(b, 'pipeYellow', V(-0.9, 0.3, sz), V(0, 3.6, sz * 0.2), 0.14, 0.14)
      ibeam(b, 'pipeYellow', V(0.9, 0.3, sz), V(0, 3.6, sz * 0.2), 0.14, 0.14)
    }
    // walking beam with horse head
    b.frame(0, 3.8, 0, 0, () => {
      ibeam(b, 'pipeYellow', V(-3.0, 0, 0), V(2.6, 0, 0), 0.3, 0.45, { col: 'metal' })
      b.box('pipeYellow', 0.5, 1.6, 0.42, -3.1, -0.4, 0, { rz: 0.15 })
      b.cyl('rustDark', 0.25, 0.25, 0.5, 'z', 0, -0.05, 0, 12, { col: false })
    }, 0, 0.08)
    // gearbox + counterweight cranks
    b.box('pipeYellow', 1.3, 1.2, 1.0, 2.4, 0.9, 0)
    for (const sz of [-0.7, 0.7]) b.box('rust', 1.6, 0.9, 0.2, 2.5, 1.2, sz, { rz: 0.6 })
    b.box('generator', 1.2, 0.9, 0.8, 3.3, 0.65, 0.9)
    // well head + polished rod
    b.cyl('rustDark', 0.18, 0.18, 1.0, 'y', -3.3, 0.6, 0, 10)
    b.rod('pipeGrey', V(-3.3, 1.1, 0), V(-3.3, 3.2, 0), 0.025, 6, { col: false })
  })
}

// ─── Comms Station (N) ────────────────────────────────────────────────────

function comms(c: Ctx) {
  const b = c.b
  // shack
  const sx = -8.5
  const sz = -28.5
  const sy = groundY(sx, sz)
  c.fp.push({ x: sx, z: sz, w: 4.4, d: 3.2, ry: 0.08, kind: 'building' })
  b.frame(sx, sy, sz, 0.08, () => {
    b.box('concrete', 4.6, 0.3, 3.4, 0, 0, 0)
    wallWithOpenings(c, 'concrete', -2.2, 2.2, 1.6, 0.15, 0.18, 2.6, [[2.6, 3.6, 0, 2.1]])
    wallWithOpenings(c, 'concrete', -2.2, 2.2, -1.6, 0.15, 0.18, 2.6, [[0.8, 2.0, 1.0, 1.9]])
    b.frame(2.2, 0, 0, Math.PI / 2, () => wallWithOpenings(c, 'concrete', -1.6, 1.6, 0, 0.15, 0.18, 2.6, [[1.1, 2.1, 1.0, 1.8]]))
    b.frame(-2.2, 0, 0, Math.PI / 2, () => wallWithOpenings(c, 'concrete', -1.6, 1.6, 0, 0.15, 0.18, 2.6, []))
    corrugated(b, 'tin', 5.0, 3.8, 0, 2.85, 0, { rx: -Math.PI / 2 + 0.07, col: 'metal' })
    // radio racks inside
    b.box('pipeGrey', 1.6, 1.8, 0.5, -1.0, 1.05, -1.2)
    b.box('black', 1.4, 0.6, 0.05, -1.0, 1.4, -0.93, { col: false })
    b.box('lamp', 0.05, 0.05, 0.02, -0.6, 1.6, -0.9, { col: false })
    b.box('woodDark', 1.6, 0.06, 0.8, 1.1, 0.85, -1.1)
    b.box('black', 0.5, 0.35, 0.4, 1.0, 1.06, -1.1, { col: false })
    // AC unit / dish on the wall
    b.box('pipeGrey', 0.8, 0.5, 0.5, 2.0, 2.2, 1.85, { col: false })
  })
  // lattice mast (triangular)
  const mx = -3.0
  const mz = -29.5
  const my = groundY(mx, mz)
  const H = 22
  const r = 0.55
  b.box('concrete', 2.2, 0.5, 2.2, mx, my + 0.1, mz)
  const legs = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2 + 0.3
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number]
  })
  for (const [lx, lz] of legs) b.rod('redwhite', V(mx + lx, my + 0.3, mz + lz), V(mx + lx, my + H, mz + lz), 0.04, 6, { col: 'metal' })
  for (let y = 0.3; y < H; y += 1.0) {
    for (let k = 0; k < 3; k++) {
      const [ax, az] = legs[k]!
      const [bx, bz] = legs[(k + 1) % 3]!
      b.rod('pipeGrey', V(mx + ax, my + y, mz + az), V(mx + bx, my + y + 1.0, mz + bz), 0.012, 4, { col: false })
      b.rod('pipeGrey', V(mx + ax, my + y, mz + az), V(mx + bx, my + y, mz + bz), 0.012, 4, { col: false })
    }
  }
  // antennas & dish
  b.rod('black', V(mx, my + H, mz), V(mx, my + H + 3.5, mz), 0.03, 5, { col: false })
  b.box('lamp', 0.14, 0.14, 0.14, mx, my + H + 3.6, mz, { col: false })
  b.frame(mx + 0.6, my + H * 0.7, mz + 0.3, 0.7, () => {
    b.cyl('pipeGrey', 0.7, 0.2, 0.3, 'x', 0.15, 0, 0, 16, { col: false })
  })
  for (const yy of [H * 0.85, H * 0.5]) b.box('pipeGrey', 0.2, 1.4, 0.2, mx - 0.55, my + yy, mz - 0.2, { col: false })
  // guy wires
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 1.0
    const ax = mx + Math.cos(a) * 9
    const az = mz + Math.sin(a) * 9
    const cax = Math.max(-33, Math.min(33, ax))
    const caz = Math.max(-33.5, Math.min(33, az))
    const ay = groundY(cax, caz)
    b.box('concrete', 0.6, 0.4, 0.6, cax, ay + 0.1, caz)
    for (const yy of [H * 0.95, H * 0.6]) b.wire(V(mx, my + yy, mz), V(cax, ay + 0.3, caz), 0.15, 0.008, 'black')
  }
  sandbags(c, -6.0, -24.6, 0.1, 3.4, 4, { curve: -0.3 })
  barrelCluster(c, -11.6, -26.0, 2, ['barrelBlue'])
  // small generator for the shack
  b.frame(-11.8, groundY(-11.8, -30.3), -30.3, 0.1, () => {
    b.box('generator', 1.6, 1.1, 0.9, 0, 0.6, 0)
    b.box('black', 1.3, 0.5, 0.05, 0, 0.7, 0.46, { col: false })
    b.cyl('rustDark', 0.06, 0.06, 0.8, 'y', 0.6, 1.4, -0.2, 6, { col: false })
  })
  b.wire(V(-11.0, groundY(-11, -30) + 0.6, -30.0), V(-10.4, groundY(-10.4, -29.2) + 2.2, -29.1), 0.3, 0.02)
}

// ─── Blue Containers (N) ─────────────────────────────────────────────────

function blueContainers(c: Ctx) {
  const ys = (x: number, z: number) => groundY(x, z) - 0.03
  container(c, 6, ys(6, -19.5), -19.5, 0, 'contBlue')
  container(c, 10.5, ys(10.5, -24.5), -24.5, 0.06, 'contBlue')
  container(c, 10.3, ys(10.5, -24.5) + CONT.H, -24.4, -0.05, 'contBlue')
  container(c, 14.3, ys(14.3, -16.5), -16.5, Math.PI / 2 + 0.04, 'contBlue', { open: true })
  container(c, 3.3, ys(3.3, -25.6), -25.6, Math.PI / 2 - 0.1, 'contGreen')
  // crate stairs up to the top of the first container
  crate(c, 1.9, groundY(1.9, -17.6), -17.6, 0.15, 1.0)
  crate(c, 2.0, groundY(2.0, -18.8), -18.8, -0.05, 1.0)
  crate(c, 2.05, groundY(2.0, -18.8) + 1.0, -18.85, 0.08, 1.0)
  palletStack(c, 8.5, -16.8, 0.3, 3)
  barrelCluster(c, 13.4, -21.0, 3, ['barrelBlue', 'barrelRust'], 1)
  sandbags(c, 6.0, -15.6, 0.0, 3.0, 4)
  lightPole(c, 0.4, -21.6, Math.PI / 2 + 0.5)
}

// ─── Red Containers (E) ──────────────────────────────────────────────────

function redContainers(c: Ctx) {
  const ys = (x: number, z: number) => groundY(x, z) - 0.03
  container(c, 21.0, ys(21, 6.5), 6.5, Math.PI / 2, 'contRed')
  container(c, 24.6, ys(24.6, 7.5), 7.5, Math.PI / 2 + 0.03, 'contRed')
  container(c, 21.1, ys(21, 6.5) + CONT.H, 6.8, Math.PI / 2 - 0.04, 'contRed')
  container(c, 18.3, ys(18.3, 13.6), 13.6, 0.35, 'contRed', { open: true })
  container(c, 28.5, ys(28.5, 1.5), 1.5, 0.02, 'contBlue')
  crate(c, 26.8, groundY(26.8, 11.6), 11.6, 0.2, 1.1)
  crate(c, 27.6, groundY(27.6, 12.6), 12.6, -0.1, 0.9)
  barrelCluster(c, 17.4, 4.0, 3, ['barrelRed', 'barrelRust'])
  sandbags(c, 15.5, 8.8, Math.PI / 2 + 0.1, 3.0, 4)
  jerseyRow(c, 28.5, 16.5, 31.5, 17.0)
}

// ─── Fuel Depot (E) ──────────────────────────────────────────────────────

function fuelTank(c: Ctx, x: number, z: number, ry: number, r = 1.35, len = 7.2) {
  const b = c.b
  const gy = groundY(x, z)
  const cy = gy + 0.55 + r
  c.fp.push({ x, z, w: len + 0.6, d: r * 2, ry, kind: 'tank' })
  b.frame(x, cy, z, ry, () => {
    b.cyl('tank', r, r, len, 'x', 0, 0, 0, 28, { col: false })
    // dished ends (lathe, proper UVs)
    for (const sx of [-1, 1]) {
      const prof: Vector2[] = []
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2)
        prof.push(new Vector2(Math.cos(a) * r, Math.sin(a) * r * 0.42))
      }
      const g = new LatheGeometry(prof, 28)
      const uv = g.getAttribute('uv')
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * Math.PI * 2 * r) / 2, (uv.getY(i) * r) / 2)
      b.geo('tank', g, (sx * len) / 2, 0, 0, { rz: -sx * (Math.PI / 2), keepUV: true, col: false })
      g.dispose()
    }
    // collision: coarse cylinder (invisible)
    b.colGeo(new CylinderGeometry(r, r, len + 0.5, 10).rotateZ(Math.PI / 2), 0, 0, 0, 'metal')
    // bands, manway, vent
    for (const bx of [-len * 0.35, 0, len * 0.35]) b.cyl('rustDark', r + 0.02, r + 0.02, 0.1, 'x', bx, 0, 0, 28, { col: false })
    b.cyl('rustDark', 0.32, 0.32, 0.25, 'y', len * 0.2, r + 0.05, 0, 14, { col: false })
    b.cyl('rustDark', 0.06, 0.06, 0.6, 'y', -len * 0.25, r + 0.25, 0, 8, { col: false })
  })
  // cradles
  for (const sx of [-1, 1]) {
    const [wx, wz] = rot(x, z, ry, sx * len * 0.32, 0)
    b.frame(wx, gy, wz, ry, () => {
      b.box('concrete', 0.6, 0.9, r * 2 + 0.2, 0, 0.3, 0)
      b.box('rustDark', 0.3, 0.5, r * 1.6, 0, 0.95, 0, { col: false })
    })
  }
  return cy + r
}

function fuelDepot(c: Ctx) {
  const b = c.b
  const top = fuelTank(c, 25.0, -11.4, 0)
  fuelTank(c, 25.0, -6.0, 0)
  // catwalk between the tanks at tank-crown height
  const cy = top - 0.1
  const z = -8.7
  b.box('grate', 6.5, 0.05, 1.1, 25.0, cy, z, { col: false })
  b.colBox(25.0, cy - 0.06, z, 6.5, 0.12, 1.1, 'metal')
  for (const x of [22.0, 28.0]) {
    for (const zz of [z - 0.5, z + 0.5]) ibeam(b, 'rust', V(x, groundY(x, zz) - 0.1, zz), V(x, cy, zz), 0.12, 0.12)
  }
  railing(b, [[21.75, z - 0.55], [28.25, z - 0.55]], cy, 'pipeYellow')
  railing(b, [[21.75, z + 0.55], [28.25, z + 0.55]], cy, 'pipeYellow')
  railing(b, [[28.25, z - 0.55], [28.25, z + 0.55]], cy, 'pipeYellow')
  ladder(c, V(21.72, groundY(21.7, z), z), cy, V(-1, 0, 0), 0.6, 1.05, true, 'pipeYellow')
  // bund wall
  const bund = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az)
    const ry = Math.atan2(-(bz - az), bx - ax)
    b.box('concrete', len, 0.6, 0.3, (ax + bx) / 2, groundY((ax + bx) / 2, (az + bz) / 2) + 0.2, (az + bz) / 2, { ry })
  }
  bund(20.2, -14.0, 30.0, -14.0)
  bund(30.0, -14.0, 30.0, -3.5)
  bund(20.2, -3.5, 24.0, -3.5)
  bund(26.4, -3.5, 30.0, -3.5)
  bund(20.2, -14.0, 20.2, -10.0)
  bund(20.2, -7.4, 20.2, -3.5)
  // pumps & hose
  b.frame(21.4, groundY(21.4, -2.0), -2.0, 0.2, () => {
    // transfer pump skid: base, motor, pump volute, piping
    b.box('concrete', 2.0, 0.25, 1.0, 0, 0.05, 0)
    ibeam(b, 'rustDark', V(-0.9, 0.25, -0.3), V(0.9, 0.25, -0.3), 0.1, 0.14, { col: false })
    ibeam(b, 'rustDark', V(-0.9, 0.25, 0.3), V(0.9, 0.25, 0.3), 0.1, 0.14, { col: false })
    b.cyl('pipeYellow', 0.28, 0.28, 0.9, 'x', -0.35, 0.65, 0, 16)
    b.cyl('black', 0.3, 0.3, 0.08, 'x', -0.82, 0.65, 0, 16, { col: false })
    b.cyl('pipeYellow', 0.3, 0.3, 0.25, 'z', 0.45, 0.62, 0, 16)
    b.rod('pipeGrey', V(0.45, 0.62, 0), V(0.45, 1.4, 0), 0.08, 10, { col: false })
    b.rod('pipeGrey', V(0.45, 1.4, 0), V(0.45, 1.4, -1.6), 0.08, 10, { col: false })
    b.box('pipeGrey', 0.3, 0.4, 0.2, -0.4, 1.15, 0.0, { col: false })
  })
  pipeline(c, [V(28.8, 0.5, -9.6), V(31.5, 0.5, -9.6), V(31.5, 0.5, 4.5)], 0.18, 'pipeGrey', { every: 3, flanges: false })
  valve(c, 29.6, -8.4, 0.5, 0.9)
  barrelCluster(c, 31.2, -12.6, 4, ['barrelRed', 'barrelRust'])
  palletStack(c, 18.6, -12.6, 0.4, 2)
}

// ─── Generators (SE) ─────────────────────────────────────────────────────

function generatorUnit(c: Ctx, x: number, z: number, ry: number) {
  const b = c.b
  const gy = groundY(x, z)
  c.fp.push({ x, z, w: 4.0, d: 1.9, ry, kind: 'building' })
  b.frame(x, gy, z, ry, () => {
    // skid
    ibeam(b, 'rustDark', V(-2.1, 0.12, -0.75), V(2.1, 0.12, -0.75), 0.15, 0.24, { col: false })
    ibeam(b, 'rustDark', V(-2.1, 0.12, 0.75), V(2.1, 0.12, 0.75), 0.15, 0.24, { col: false })
    // enclosure
    b.box('generator', 3.8, 1.9, 1.7, 0, 1.2, 0)
    b.box('generator', 3.9, 0.08, 1.8, 0, 2.18, 0, { col: false })
    // louvre vents
    for (const sz of [-1, 1]) {
      for (const lx of [-1.2, 1.1]) {
        b.box('black', 0.9, 0.8, 0.02, lx, 1.3, sz * 0.86, { col: false })
        for (let k = 0; k < 6; k++) b.box('generator', 0.9, 0.04, 0.05, lx, 0.98 + k * 0.13, sz * 0.88, { col: false, rx: 0.5 * sz })
      }
      // access door
      b.box('generator', 0.8, 1.4, 0.03, 0.0, 1.05, sz * 0.865, { col: false })
      b.box('black', 0.04, 0.16, 0.04, 0.32, 1.1, sz * 0.89, { col: false })
    }
    // radiator end + exhaust
    b.box('black', 0.05, 1.4, 1.4, 1.93, 1.2, 0, { col: false })
    b.cyl('rustDark', 0.1, 0.1, 1.2, 'y', -1.4, 2.7, 0.4, 10, { col: false })
    b.cyl('rustDark', 0.13, 0.1, 0.15, 'y', -1.4, 3.3, 0.4, 10, { col: false })
    // control panel
    b.box('pipeGrey', 0.5, 0.6, 0.2, -1.6, 1.6, -0.95, { col: false })
    b.box('lamp', 0.05, 0.05, 0.02, -1.5, 1.75, -1.06, { col: false })
  })
}

function generators(c: Ctx) {
  const b = c.b
  generatorUnit(c, 18.6, 23.4, 0.04)
  generatorUnit(c, 23.6, 25.6, -0.05)
  generatorUnit(c, 28.4, 21.0, Math.PI / 2 + 0.03)
  // transformer
  b.frame(25.5, groundY(25.5, 30.4), 30.4, 0, () => {
    b.box('concrete', 2.6, 0.3, 2.0, 0, 0.1, 0)
    b.box('pipeGrey', 1.6, 1.8, 1.2, 0, 1.15, 0)
    for (let k = -3; k <= 3; k++) b.box('pipeGrey', 0.04, 1.3, 1.4, k * 0.22, 1.0, 0, { col: false })
    for (const x of [-0.5, 0, 0.5]) {
      b.cyl('black', 0.07, 0.09, 0.6, 'y', x, 2.35, 0, 8, { col: false })
    }
  })
  fence(c, 23.6, 28.6, 27.6, 28.6, { h: 2.0 })
  // cable runs across the ground
  const gy = (x: number, z: number) => groundY(x, z) + 0.03
  b.wire(V(19.6, gy(19.6, 22.3) + 0.8, 22.3), V(25.5, gy(25.5, 29.5) + 0.2, 29.5), 0.8, 0.035)
  b.wire(V(24.6, gy(24.6, 24.4) + 0.8, 24.4), V(25.2, gy(25.2, 29.5) + 0.2, 29.5), 0.8, 0.035)
  b.wire(V(28.4, gy(28.4, 22.8) + 0.8, 22.8), V(26.0, gy(26, 29.5) + 0.2, 29.5), 0.8, 0.035)
  barrelCluster(c, 20.4, 28.2, 4, ['barrelRed', 'barrelBlue', 'barrelRust'], 1)
  barrelCluster(c, 30.6, 26.0, 3, ['barrelRust'])
  sandbags(c, 14.6, 25.0, Math.PI / 2 - 0.1, 3.2, 4)
  palletStack(c, 16.2, 30.2, 0.2, 4)
  lightPole(c, 31.6, 30.8, Math.PI * 0.75)
}

// ─── Control Room (S) ────────────────────────────────────────────────────

function controlRoom(c: Ctx) {
  const b = c.b
  const x = 4
  const z = 23
  const gy = groundY(x, z)
  const fy = gy + 0.2
  const W = 8.4
  const D = 6.0
  const H = 3.0
  const t = 0.25
  c.fp.push({ x, z, w: W, d: D, ry: 0, kind: 'building' })
  b.frame(x, fy, z, 0, () => {
    b.box('concreteDark', W + 0.4, 0.5, D + 0.4, 0, -0.25, 0)
    // north wall: door + two windows (faces the tower)
    wallWithOpenings(c, 'concrete', -W / 2, W / 2, -D / 2 + t / 2, 0, t, H, [
      [1.2, 2.2, 0, 2.15],
      [3.6, 5.2, 1.0, 2.05],
      [6.3, 7.6, 1.0, 2.05],
    ])
    // south wall: window
    wallWithOpenings(c, 'concrete', -W / 2, W / 2, D / 2 - t / 2, 0, t, H, [[5.0, 6.4, 1.1, 2.0]])
    // west wall: door
    b.frame(-W / 2 + t / 2, 0, 0, -Math.PI / 2, () => wallWithOpenings(c, 'concrete', -D / 2 + t, D / 2 - t, 0, 0, t, H, [[2.6, 3.6, 0, 2.15]]))
    // east wall: window
    b.frame(W / 2 - t / 2, 0, 0, -Math.PI / 2, () => wallWithOpenings(c, 'concrete', -D / 2 + t, D / 2 - t, 0, 0, t, H, [[1.4, 2.8, 1.0, 2.05]]))
    // lintels & sills
    for (const [u0, u1] of [[3.6, 5.2], [6.3, 7.6]] as [number, number][]) {
      b.box('concreteDark', u1 - u0 + 0.2, 0.06, t + 0.1, -W / 2 + (u0 + u1) / 2, 0.98, -D / 2 + t / 2, { col: false })
      // broken window frames
      b.box('rustDark', 0.04, 1.05, 0.05, -W / 2 + (u0 + u1) / 2, 1.52, -D / 2 + t / 2, { col: false })
    }
    // roof slab + parapet with a gap at the ladder
    b.box('concrete', W, 0.25, D, 0, H + 0.125, 0)
    const p = 0.45
    b.box('concrete', W, p, 0.15, 0, H + 0.25 + p / 2, -D / 2 + 0.075)
    b.box('concrete', W - 1.4, p, 0.15, -0.7, H + 0.25 + p / 2, D / 2 - 0.075)
    b.box('concrete', 0.15, p, D, -W / 2 + 0.075, H + 0.25 + p / 2, 0)
    b.box('concrete', 0.15, p, D - 1.5, W / 2 - 0.075, H + 0.25 + p / 2, -0.75)
    // roof clutter: AC units, vents
    b.box('pipeGrey', 1.4, 0.8, 1.0, -2.2, H + 0.65, 0.8)
    b.box('black', 1.2, 0.05, 0.8, -2.2, H + 1.06, 0.8, { col: false })
    b.cyl('rustDark', 0.18, 0.18, 0.6, 'y', 1.8, H + 0.55, -1.4, 10)
    // door frame steel
    b.box('rustDark', 1.1, 0.1, 0.3, -W / 2 + 1.7, 2.2, -D / 2 + t / 2, { col: false })
    // interior: consoles along the south wall, desk, cabinets
    b.box('pipeGrey', 3.6, 1.0, 0.7, -1.4, 0.5, D / 2 - t - 0.35)
    b.box('pipeGrey', 3.6, 0.7, 0.3, -1.4, 1.35, D / 2 - t - 0.2, { rx: -0.3 })
    for (let i = 0; i < 4; i++) {
      b.box('black', 0.6, 0.4, 0.04, -2.8 + i * 0.95, 1.4, D / 2 - t - 0.37, { col: false, rx: -0.3 })
      b.box('lamp', 0.04, 0.04, 0.02, -2.6 + i * 0.95, 1.05, D / 2 - t - 0.71, { col: false })
    }
    b.box('woodDark', 1.8, 0.05, 0.9, 1.8, 0.75, -0.2)
    for (const [lx, lz] of [[1.0, -0.6], [2.6, -0.6], [1.0, 0.2], [2.6, 0.2]] as [number, number][]) b.box('rustDark', 0.05, 0.75, 0.05, lx, 0.375, lz, { col: false })
    b.colBox(1.8, 0.4, -0.2, 1.8, 0.8, 0.9, 'wood')
    b.box('black', 0.5, 0.35, 0.4, 1.6, 0.95, -0.3, { col: false })
    for (let i = 0; i < 3; i++) b.box('pipeGrey', 0.5, 1.4, 0.6, W / 2 - t - 0.3, 0.7, -2.0 + i * 0.6)
    b.box('generator', 0.9, 2.0, 0.4, -W / 2 + t + 0.2, 1.0, 0.8)
    // chair
    b.box('black', 0.5, 0.08, 0.5, 2.0, 0.48, 0.6, { col: false })
    b.box('black', 0.5, 0.5, 0.06, 2.0, 0.75, 0.85, { col: false })
  })
  // roof ladder on the east face
  ladder(c, V(x + W / 2 + 0.1, gy, z + D / 2 - 0.75), fy + H + 0.25, V(1, 0, 0))
  sandbags(c, x - 1.5, z - D / 2 - 1.8, 0, 2.8, 3)
  barrelCluster(c, x + W / 2 + 1.2, z - 1.6, 2, ['barrelBlue'])
  jersey(c, x - W / 2 - 1.6, z + 1.0, Math.PI / 2 + 0.1)
  lightPole(c, x - W / 2 - 0.6, z - D / 2 - 0.6, Math.PI * 0.8)
}

// ─── Maintenance (W) ─────────────────────────────────────────────────────

function maintenance(c: Ctx) {
  const b = c.b
  const x = -26.5
  const z = -5.0
  const gy = groundY(x, z)
  const W = 9.0 // along z
  const D = 6.0 // along x, open to +x
  const hB = 4.2
  const hF = 3.5
  c.fp.push({ x, z, w: D, d: W, ry: 0, kind: 'building' })
  b.frame(x, gy, z, 0, () => {
    b.box('concrete', D + 0.6, 0.4, W + 0.6, 0, -0.1, 0)
    // steel frame
    for (const zz of [-W / 2, 0, W / 2]) {
      ibeam(b, 'rust', V(-D / 2, 0.1, zz), V(-D / 2, hB, zz), 0.2, 0.2)
      ibeam(b, 'rust', V(D / 2, 0.1, zz), V(D / 2, hF, zz), 0.2, 0.2)
      ibeam(b, 'rustDark', V(-D / 2, hB, zz), V(D / 2 + 0.3, hF - 0.06, zz), 0.14, 0.24, { col: false })
    }
    ibeam(b, 'rustDark', V(D / 2, hF, -W / 2), V(D / 2, hF, W / 2), 0.14, 0.26, { col: false })
    // back wall (west) + side walls: corrugated
    for (let k = 0; k < 3; k++) corrugated(b, 'tin', 3.0, hB, -D / 2 - 0.12, hB / 2 + 0.05, -W / 2 + 1.5 + k * 3.0, { ry: Math.PI / 2, col: 'metal' })
    for (const sz of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const hh = hB + (hF - hB) * ((k + 0.5) / 2)
        corrugated(b, k === 1 && sz > 0 ? 'tinTan' : 'tin', 3.0, hh, -D / 2 + 1.5 + k * 3.0, hh / 2 + 0.05, sz * (W / 2 + 0.12), { col: 'metal' })
      }
    }
    // pitched roof
    const rl = Math.hypot(D + 0.6, hB - hF)
    corrugated(b, 'tin', W + 0.8, rl, 0.15, (hB + hF) / 2 + 0.1, 0, { ry: Math.PI / 2, rx: -Math.PI / 2 + Math.atan2(hB - hF, D + 0.6), col: 'metal' })
    // workbench along the back wall
    b.box('woodDark', 0.8, 0.08, 3.6, -D / 2 + 0.6, 0.92, -1.5)
    for (const zz of [-3.2, 0.2]) for (const xx of [-D / 2 + 0.3, -D / 2 + 0.9]) b.box('rustDark', 0.06, 0.9, 0.06, xx, 0.45, zz, { col: false })
    b.colBox(-D / 2 + 0.6, 0.48, -1.5, 0.8, 0.96, 3.6, 'wood')
    b.box('pipeGrey', 0.3, 0.2, 0.4, -D / 2 + 0.6, 1.06, -2.4, { col: false })
    b.box('rust', 0.5, 0.35, 0.3, -D / 2 + 0.55, 1.13, -0.6, { col: false })
    // tool shelves
    for (let k = 0; k < 4; k++) b.box('rustDark', 0.5, 0.04, 2.2, -D / 2 + 0.35, 0.4 + k * 0.55, 2.4, { col: false })
    for (const zz of [1.35, 3.45]) for (const xx of [-D / 2 + 0.12, -D / 2 + 0.58]) b.box('rustDark', 0.04, 2.1, 0.04, xx, 1.05, zz, { col: false })
    b.colBox(-D / 2 + 0.35, 1.05, 2.4, 0.5, 2.1, 2.2, 'metal')
    // engine block on a stand
    b.box('rustDark', 1.0, 0.7, 0.7, 0.3, 0.9, 1.4)
    b.box('black', 0.8, 0.25, 0.5, 0.3, 1.38, 1.4, { col: false })
    ibeam(b, 'pipeYellow', V(-0.2, 0.1, 1.4), V(-0.2, 2.6, 1.4), 0.12, 0.12)
    ibeam(b, 'pipeYellow', V(-0.2, 2.6, 1.4), V(1.0, 2.6, 1.4), 0.12, 0.12, { col: false })
    b.wire(V(0.9, 2.55, 1.4), V(0.3, 1.3, 1.4), 0.0, 0.01)
    // overhead strip lamp
    b.box('lamp', 0.1, 0.04, 1.2, 0.0, hF - 0.1, -1.0, { col: false })
  })
  barrelCluster(c, -24.2, -8.4, 3, ['barrelRed', 'barrelRust'], 0, gy + 0.1)
  tireStack(c, -28.0, -1.8, 4, gy + 0.1)
  tireStack(c, -27.3, -1.4, 2, gy + 0.1)
  pickup(c, -19.0, -7.2, 0.4)
  sandbags(c, -20.4, -1.4, Math.PI / 2 - 0.2, 2.6, 4)
  crate(c, -21.7, groundY(-21.7, -11.2), -11.2, 0.3, 1.1)
}

/** Abandoned pickup truck — iconic MW2 cover. Extruded side profile, open bed, flat tyres. */
function pickup(c: Ctx, x: number, z: number, ry: number) {
  const b = c.b
  const gy = groundY(x, z)
  c.fp.push({ x, z, w: 5.2, d: 2.0, ry, kind: 'low' })
  const W = 1.72
  b.frame(x, gy, z, ry, () => {
    // cab + hood profile (x forward, y up), extruded across the width
    const cab = new Shape()
    cab.moveTo(-0.5, 0.62)
    cab.lineTo(-0.5, 1.92)
    cab.lineTo(0.45, 1.95)
    cab.lineTo(1.05, 1.38)
    cab.lineTo(2.35, 1.3)
    cab.lineTo(2.62, 1.12)
    cab.lineTo(2.62, 0.62)
    cab.closePath()
    const cg = new ExtrudeGeometry(cab, { depth: W, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 2 })
    cg.translate(0, 0, -W / 2)
    b.geo('pipeGrey', cg, 0, 0, 0, { col: false })
    cg.dispose()
    // glass (dark, cracked): side windows + windshield + rear window
    const win = new Shape()
    win.moveTo(-0.38, 1.38)
    win.lineTo(-0.38, 1.82)
    win.lineTo(0.42, 1.84)
    win.lineTo(0.86, 1.4)
    win.closePath()
    const wg = new ExtrudeGeometry(win, { depth: W + 0.14, bevelEnabled: false })
    wg.translate(0, 0, -(W + 0.14) / 2)
    b.geo('black', wg, 0, 0, 0, { col: false })
    wg.dispose()
    b.box('black', 0.02, 0.5, W - 0.2, 0.76, 1.66, 0, { rz: -0.76, col: false })
    b.box('black', 0.02, 0.36, W - 0.3, -0.56, 1.62, 0, { col: false })
    // grille, bumpers, lights
    b.box('rustDark', 0.06, 0.4, W - 0.2, 2.68, 0.9, 0, { col: false })
    b.box('rustDark', 0.16, 0.18, W + 0.1, 2.75, 0.55, 0, { col: false })
    b.box('rustDark', 0.12, 0.16, W + 0.05, -2.62, 0.6, 0, { col: false })
    for (const sz of [-0.68, 0.68]) b.box('lamp', 0.03, 0.1, 0.18, 2.7, 1.05, sz, { col: false })
    // bed
    b.box('pipeGrey', 2.1, 0.06, W, -1.58, 0.75, 0, { col: false })
    for (const sz of [-1, 1]) b.box('pipeGrey', 2.1, 0.5, 0.06, -1.58, 1.0, sz * (W / 2 - 0.03), { col: false })
    b.box('pipeGrey', 0.06, 0.5, W, -2.6, 1.0, 0, { col: false, rz: 0.08 })
    b.box('pipeGrey', 0.06, 0.55, W, -0.56, 1.0, 0, { col: false })
    // junk in the bed
    b.cyl('rust', 0.29, 0.29, 0.88, 'y', -1.9, 1.2, 0.35, 12, { col: false })
    b.box('woodDark', 1.3, 0.1, 0.9, -1.4, 0.85, -0.3, { ry: 0.2, col: false })
    // chassis + wheels (front-left tyre burnt off: rim on the ground)
    b.box('black', 4.6, 0.25, 1.1, 0, 0.45, 0, { col: false })
    for (const [wx, sz, flat] of [[-1.6, -1, false], [-1.6, 1, false], [1.75, -1, true], [1.75, 1, false]] as [number, number, boolean][]) {
      const zz = sz * (W / 2 - 0.08)
      if (flat) b.cyl('rustDark', 0.25, 0.25, 0.2, 'z', wx, 0.25, zz, 12, { col: false })
      else {
        b.cyl('rubber', 0.38, 0.38, 0.26, 'z', wx, 0.37, zz, 16, { col: false })
        b.cyl('rustDark', 0.2, 0.2, 0.28, 'z', wx, 0.37, zz, 10, { col: false })
      }
    }
    b.colBox(-0.05, 0.85, 0, 5.3, 1.0, W + 0.1, 'metal')
    b.colBox(0.2, 1.6, 0, 1.4, 0.7, W, 'metal')
  }, 0, 0.035)
}

// ─── yard filler: cover pieces between zones, perimeter dressing ─────────

function yard(c: Ctx) {
  const b = c.b
  // tower surroundings: low cover so the base isn't a killing floor
  jerseyRow(c, 6.5, -5.0, 6.5, 1.0)
  jerseyRow(c, -2.0, 9.0, 4.0, 9.6)
  sandbags(c, 7.4, 4.5, Math.PI / 2 - 0.3, 2.6, 4, { curve: 0.3 })
  sandbags(c, -6.0, -6.2, 0.4, 2.4, 3)
  crate(c, 8.6, groundY(8.6, -6.8), -6.8, 0.4, 1.2)
  crate(c, 9.6, groundY(9.6, -7.5), -7.5, 0.1, 0.9)
  barrelCluster(c, -3.5, 10.8, 3, ['barrelBlue', 'barrelRed', 'barrelRust'], 1)
  barrelCluster(c, 13.6, -4.0, 3, ['barrelRust', 'barrelGrey'])
  palletStack(c, 3.6, -9.0, 0.2, 3)
  // elevated pipe rack running N-S east of the tower (walk under, shoot over)
  const rx = 12.2
  for (let zz = -11; zz <= 15; zz += 4.33) {
    const gy = groundY(rx, zz)
    ibeam(b, 'rust', V(rx - 0.9, gy - 0.2, zz), V(rx - 0.9, 3.2, zz), 0.2, 0.2)
    ibeam(b, 'rust', V(rx + 0.9, gy - 0.2, zz), V(rx + 0.9, 3.2, zz), 0.2, 0.2)
    ibeam(b, 'rustDark', V(rx - 1.1, 3.3, zz), V(rx + 1.1, 3.3, zz), 0.16, 0.2, { col: false })
    b.box('concrete', 2.3, 0.3, 0.5, rx, gy, zz)
  }
  b.colBox(rx, 3.6, 2, 2.2, 0.6, 26, 'metal')
  pipeline(c, [V(rx - 0.55, 3.62, -11.5), V(rx - 0.55, 3.62, 15.5)], 0.22, 'pipeYellow', { saddles: false })
  pipeline(c, [V(rx, 3.62, -11.5), V(rx, 3.62, 15.5)], 0.18, 'pipeGrey', { saddles: false })
  pipeline(c, [V(rx + 0.55, 3.6, -11.5), V(rx + 0.55, 3.6, 13), V(rx + 0.55, 0.4, 15.6), V(rx + 0.55, 0.4, 19.5)], 0.2, 'rust', { saddles: false })
  c.fp.push({ x: rx, z: 2, w: 2.0, d: 27, ry: 0, kind: 'pipe' })
  // south-centre cover between control room & pipeline
  container(c, -6.5, groundY(-6.5, 24.5) - 0.03, 24.5, -0.25, 'contGreen', { open: true })
  sandbags(c, -9.0, 19.2, 0.2, 2.6, 4)
  palletStack(c, -2.0, 18.0, -0.4, 4)
  crate(c, 10.6, groundY(10.6, 16.6), 16.6, 0.2, 1.1)
  barrel(c, 11.3, 18.0, 'barrelBlue')
  // north-centre between comms and blue containers
  jerseyRow(c, -1.5, -20.5, 1.5, -21.2)
  sandbags(c, -14.0, -19.0, 0.5, 3.0, 4)
  crate(c, -13.0, groundY(-13, -23.5), -23.5, -0.3, 1.2)
  barrelCluster(c, -16.0, -12.8, 2, ['barrelRust'])

  // perimeter: west berm fence, south fence, north-west fence
  fence(c, -33, -32.5, -2, -32.5, { barbed: true })
  fence(c, -33, -32.5, -33, 19, { barbed: true })
  fence(c, -14, 33.2, 33, 33.2, { barbed: true })
  fence(c, 33, -15, 33, 33.2, { barbed: true })
  // perimeter corrugated walls & stacked junk to break the fence line
  for (let i = 0; i < 4; i++) corrugated(b, i % 2 ? 'tinTan' : 'tin', 3.0, 2.6, -33.4, groundY(-33.4, -2 + i * 3) + 1.2, -2 + i * 3, { ry: Math.PI / 2, rz: (i % 2 ? 0.04 : -0.03), col: 'metal' })
  container(c, 31.8, groundY(31.8, 20) - 0.03, 20.0, Math.PI / 2 - 0.03, 'contGreen')
  // utility poles & wires along the south road
  const poles: Vector3[][] = []
  for (const [px, pz] of [[-8, 29.5], [6, 30.4], [18, 31.4], [30, 32]] as [number, number][]) poles.push(utilityPole(c, px, pz, 0.05))
  for (let i = 0; i < poles.length - 1; i++) {
    for (let k = 0; k < 3; k++) b.wire(poles[i]![k]!, poles[i + 1]![k]!, 0.55, 0.01)
  }
  lightPole(c, -9.0, 4.5, -Math.PI / 2)
  lightPole(c, 8.5, -13.0, Math.PI / 2 + 0.6)
}

// ─── scatter (rocks, shrubs, tumbleweeds, debris) ────────────────────────

function scatter(c: Ctx, occupied: (x: number, z: number) => boolean) {
  const b = c.b
  // perimeter rock outcrops on the berms
  for (let i = 0; i < 140; i++) {
    const a = b.rand(0, Math.PI * 2)
    const r = b.rand(35, 48)
    const x = Math.cos(a) * r * 1.05
    const z = Math.sin(a) * r * 1.05
    const s = b.rand(0.5, 2.6) * (b.rand() < 0.15 ? 1.8 : 1)
    rock(c, x, z, s, false)
  }
  // clusters of boulders in the yard corners
  for (const [cx, cz] of [[-31, 10], [-31, -30], [31, -16], [-12, 31], [31, 13], [-33, 24]] as [number, number][]) {
    for (let i = 0; i < 4; i++) rock(c, cx + b.rand(-1.8, 1.8), cz + b.rand(-1.8, 1.8), b.rand(0.35, 0.9))
  }
  // pebbles + shrubs + tumbleweeds across the yard
  let placed = 0
  for (let i = 0; i < 900 && placed < 420; i++) {
    const x = b.rand(-40, 40)
    const z = b.rand(-40, 40)
    if (occupied(x, z)) continue
    const gy = groundY(x, z)
    const roll = b.rand()
    if (roll < 0.55) c.inst.add('pebble', x, gy, z, b.rand(0, 6), b.rand(0.4, 1.4), b.rand(-1, 1), b.rand(-1, 1))
    else if (roll < 0.85) c.inst.add(b.rand() < 0.5 ? 'shrub0' : 'shrub1', x, gy - 0.05, z, b.rand(0, 6), b.rand(0.6, 1.5))
    else if (roll < 0.93) c.inst.add('tumble', x, gy + 0.25, z, b.rand(0, 6), b.rand(0.6, 1.2), b.rand(0, 3), b.rand(0, 3))
    else rock(c, x, z, b.rand(0.12, 0.32), false)
    placed++
  }
  // cinder blocks, tyres, planks
  for (let i = 0; i < 40; i++) {
    const x = b.rand(-30, 30)
    const z = b.rand(-30, 30)
    if (occupied(x, z)) continue
    const gy = groundY(x, z)
    if (b.rand() < 0.6) c.inst.add('cinder', x, gy + 0.09, z, b.rand(0, 6))
    else if (b.rand() < 0.5) c.inst.add('tire', x, gy + 0.1, z, b.rand(0, 6), 1, b.rand(-0.15, 0.15))
    else b.box('woodDark', 2.4, 0.05, 0.2, x, gy + 0.03, z, { ry: b.rand(0, 6), col: false })
  }
  for (let i = 0; i < 8; i++) {
    const x = b.rand(-28, 28)
    const z = b.rand(-28, 28)
    if (occupied(x, z)) continue
    scrapSheet(c, x, z, b.rand(0, 6))
  }
  void pallet
}

// ─── entry ───────────────────────────────────────────────────────────────

export function buildZones(c: Ctx) {
  frontGate(c)
  loadingDock(c)
  pipelineZone(c)
  derrick(c)
  comms(c)
  blueContainers(c)
  redContainers(c)
  fuelDepot(c)
  generators(c)
  controlRoom(c)
  maintenance(c)
  yard(c)
}

export function buildScatter(c: Ctx) {
  const fps = c.fp.slice()
  const occupied = (x: number, z: number) => {
    if (Math.abs(x) < 6.5 && z > -5.5 && z < 7) return true
    for (const f of fps) {
      if (f.kind === 'road') continue
      const cs = Math.cos(f.ry)
      const sn = Math.sin(f.ry)
      const dx = x - f.x
      const dz = z - f.z
      const lx = dx * cs - dz * sn
      const lz = dx * sn + dz * cs
      if (Math.abs(lx) < f.w / 2 + 0.6 && Math.abs(lz) < f.d / 2 + 0.6) return true
    }
    return false
  }
  scatter(c, occupied)
}
