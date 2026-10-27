/**
 * The central tower — Rust's hotspot. Open rusted steel frame on a concrete pad:
 *   F0 ground (0.15), F1 diamond-plate deck (3.6) with a south balcony, F2 grated deck (7.2),
 *   roof platform (10.5) with a corrugated canopy. Ladders: east + west ground→F1, balcony→F2,
 *   F2→roof. The big pipeline arrives at the F1 west edge (top of pipe = deck height).
 */
import { Vector3 } from 'three'
import type { MatKey } from '../materials'
import { angle, barrelCluster, corrugated, crate, ibeam, ladder, palletStack, railing, type Ctx } from './props'

export const TOWER = {
  half: 4,
  f0: 0.15,
  f1: 3.6,
  f2: 7.2,
  roof: 10.5,
  roofHalf: 3,
  balconyZ: 5.4,
  /** Pipe entry on the F1 west edge. */
  pipeZ: 2,
}

type Edge = { from: number; to: number; kind: 'rail' | 'half' | 'wall' | 'gap' }

/** Build an edge of a deck from a list of spans along the edge. Edge runs along X at fixed z, or along Z at fixed x. */
function deckEdge(c: Ctx, axis: 'x' | 'z', fixed: number, y: number, spans: Edge[], outward: number, wallMat: MatKey = 'tin') {
  const b = c.b
  for (const s of spans) {
    const a = s.from
    const e = s.to
    const len = e - a
    const mid = (a + e) / 2
    const pts: [number, number][] = axis === 'x' ? [[a, fixed], [e, fixed]] : [[fixed, a], [fixed, e]]
    if (s.kind === 'rail') railing(b, pts, y, 'rust')
    else if (s.kind === 'half' || s.kind === 'wall') {
      const h = s.kind === 'half' ? 1.15 : 2.7
      const off = 0.05 * outward
      if (axis === 'x') corrugated(b, wallMat, len, h, mid, y + h / 2 + 0.02, fixed + off, { col: 'metal' })
      else corrugated(b, wallMat, len, h, fixed + off, y + h / 2 + 0.02, mid, { ry: Math.PI / 2, col: 'metal' })
      // top capping angle + a rail above half walls so it reads as a balustrade
      const p0 = axis === 'x' ? new Vector3(a, y + h + 0.03, fixed + off) : new Vector3(fixed + off, y + h + 0.03, a)
      const p1 = axis === 'x' ? new Vector3(e, y + h + 0.03, fixed + off) : new Vector3(fixed + off, y + h + 0.03, e)
      angle(b, 'rustDark', p0, p1, 0.06)
    }
  }
}

function deckFrame(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, mat: MatKey, thick = 0.06) {
  const b = c.b
  const w = x1 - x0
  const d = z1 - z0
  b.box(mat, w, thick, d, (x0 + x1) / 2, y - thick / 2, (z0 + z1) / 2, { col: false })
  // solid collider (grates included so they're walkable)
  b.colBox((x0 + x1) / 2, y - 0.06, (z0 + z1) / 2, w, 0.12, d, 'metal')
  // perimeter girders
  const gy = y - thick - 0.16
  ibeam(b, 'rust', new Vector3(x0, gy, z0), new Vector3(x1, gy, z0), 0.16, 0.32, { col: false })
  ibeam(b, 'rust', new Vector3(x0, gy, z1), new Vector3(x1, gy, z1), 0.16, 0.32, { col: false })
  ibeam(b, 'rust', new Vector3(x0, gy, z0), new Vector3(x0, gy, z1), 0.16, 0.32, { col: false })
  ibeam(b, 'rust', new Vector3(x1, gy, z0), new Vector3(x1, gy, z1), 0.16, 0.32, { col: false })
  // joists
  for (let x = x0 + 1; x < x1 - 0.5; x += 1.0) {
    ibeam(b, 'rustDark', new Vector3(x, y - thick - 0.1, z0), new Vector3(x, y - thick - 0.1, z1), 0.1, 0.2, { col: false })
  }
  b.colBox((x0 + x1) / 2, gy, (z0 + z1) / 2, w, 0.32, d, 'metal')
}

export function buildTower(c: Ctx) {
  const b = c.b
  const H = TOWER.half
  const { f0, f1, f2, roof } = TOWER
  const R = TOWER.roofHalf

  c.fp.push({ x: 0, z: 0.7, w: 8.4, d: 9.8, ry: 0, kind: 'tower' })

  // concrete pad + column plinths
  b.box('concrete', 10.4, 0.6, 11.6, 0, f0 - 0.3, 0.6)
  b.box('concreteDark', 10.6, 0.08, 11.8, 0, f0 - 0.5, 0.6, { col: false })

  // columns
  const colsXZ: [number, number][] = []
  for (const x of [-H, 0, H]) for (const z of [-H, 0, H]) if (!(x === 0 && z === 0)) colsXZ.push([x, z])
  for (const [x, z] of colsXZ) {
    ibeam(b, 'rust', new Vector3(x, f0, z), new Vector3(x, f2 + 0.02, z), 0.3, 0.3)
    b.box('concreteDark', 0.6, 0.25, 0.6, x, f0 + 0.12, z)
    b.box('rustDark', 0.45, 0.03, 0.45, x, f0 + 0.26, z, { col: false })
  }
  // balcony posts
  for (const x of [-H, H]) {
    ibeam(b, 'rust', new Vector3(x, f0, TOWER.balconyZ), new Vector3(x, f1, TOWER.balconyZ), 0.2, 0.2)
    b.box('concreteDark', 0.45, 0.25, 0.45, x, f0 + 0.12, TOWER.balconyZ)
  }
  // roof columns + canopy posts
  for (const x of [-R, R]) {
    for (const z of [-R, R]) {
      ibeam(b, 'rust', new Vector3(x, f2, z), new Vector3(x, roof, z), 0.22, 0.22)
    }
  }
  for (const x of [-R, R]) {
    for (const z of [0.2, R]) ibeam(b, 'rust', new Vector3(x, roof, z), new Vector3(x, roof + 2.4, z), 0.14, 0.14)
  }

  // decks
  deckFrame(c, -H, H, -H, TOWER.balconyZ, f1, 'diamond')
  deckFrame(c, -H, H, -H, H, f2, 'grate')
  deckFrame(c, -R - 0.2, R + 0.2, -R - 0.05, R + 0.2, roof, 'diamond')
  // canopy roof over the south half of the top
  corrugated(b, 'tin', 6.8, 3.6, 0, roof + 2.45, 1.6, { rx: -Math.PI / 2 + 0.06, col: 'metal' })
  ibeam(b, 'rustDark', new Vector3(-R - 0.3, roof + 2.38, 0.2), new Vector3(R + 0.3, roof + 2.38, 0.2), 0.1, 0.16, { col: false })
  ibeam(b, 'rustDark', new Vector3(-R - 0.3, roof + 2.38, R), new Vector3(R + 0.3, roof + 2.38, R), 0.1, 0.16, { col: false })

  // ── bracing (X braces on faces, leaving ladder / pipe / walkway bays open) ──
  const brace = (a: Vector3, e: Vector3) => angle(b, 'rustDark', a, e, 0.1, { col: 'metal' })
  const xBrace = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number) => {
    brace(new Vector3(ax, y0 + 0.3, az), new Vector3(bx, y1 - 0.4, bz))
    brace(new Vector3(bx, y0 + 0.3, bz), new Vector3(ax, y1 - 0.4, az))
  }
  // ground level: north face both bays, south face west bay; east/west bays used for access
  xBrace(-H, -H - 0.12, 0, -H - 0.12, f0, f1)
  xBrace(0, -H - 0.12, H, -H - 0.12, f0, f1)
  xBrace(H + 0.12, 0, H + 0.12, H, f0, f1)
  // F1→F2: east & west faces
  xBrace(H + 0.12, -H, H + 0.12, 0, f1, f2)
  xBrace(-H - 0.12, 0, -H - 0.12, H, f1, f2)
  xBrace(-H, H + 0.12, 0, H + 0.12, f1, f2)
  // knee braces at the top bays
  for (const x of [-R, R]) brace(new Vector3(x, roof - 1.4, -R), new Vector3(x, roof - 0.15, -R + 1.3))

  // ── ladders ──
  const lEast = new Vector3(H + 0.1, f0, -1.5)
  ladder(c, lEast, f1, new Vector3(1, 0, 0))
  const lWest = new Vector3(-H - 0.1, f0, -2.5)
  ladder(c, lWest, f1, new Vector3(-1, 0, 0))
  const lBal = new Vector3(1.6, f1, H + 0.1)
  ladder(c, lBal, f2, new Vector3(0, 0, 1))
  const lRoof = new Vector3(-1.0, f2, -R - 0.1)
  ladder(c, lRoof, roof, new Vector3(0, 0, -1))

  // ── F1 edges ──
  const gap = 0.5
  // north: corrugated wall on the west half, rail east half
  deckEdge(c, 'x', -H, f1, [
    { from: -H, to: 0, kind: 'wall' },
    { from: 0, to: H, kind: 'half' },
  ], -1, 'tinTan')
  // east: half wall, gap at ladder
  deckEdge(c, 'z', H, f1, [
    { from: -H, to: lEast.z - gap, kind: 'rail' },
    { from: lEast.z + gap, to: H, kind: 'half' },
    { from: H, to: TOWER.balconyZ, kind: 'rail' },
  ], 1)
  // west: gap at ladder and at pipe entry
  deckEdge(c, 'z', -H, f1, [
    { from: -H, to: lWest.z - gap, kind: 'rail' },
    { from: lWest.z + gap, to: TOWER.pipeZ - 0.75, kind: 'half' },
    { from: TOWER.pipeZ + 0.75, to: TOWER.balconyZ, kind: 'rail' },
  ], -1)
  // balcony south edge
  deckEdge(c, 'x', TOWER.balconyZ, f1, [
    { from: -H, to: -1.2, kind: 'half' },
    { from: -1.2, to: H, kind: 'rail' },
  ], 1, 'tinTan')

  // ── F2 edges ──
  deckEdge(c, 'x', -H, f2, [{ from: -H, to: H, kind: 'rail' }], -1)
  deckEdge(c, 'z', H, f2, [
    { from: -H, to: -0.5, kind: 'half' },
    { from: -0.5, to: H, kind: 'rail' },
  ], 1)
  deckEdge(c, 'z', -H, f2, [
    { from: -H, to: 1.0, kind: 'rail' },
    { from: 1.0, to: H, kind: 'wall' },
  ], -1, 'tinTan')
  deckEdge(c, 'x', H, f2, [
    { from: -H, to: lBal.x - gap, kind: 'half' },
    { from: lBal.x + gap, to: H, kind: 'rail' },
  ], 1)

  // ── roof edges ──
  deckEdge(c, 'x', -R - 0.05, roof, [
    { from: -R - 0.2, to: lRoof.x - gap, kind: 'rail' },
    { from: lRoof.x + gap, to: R + 0.2, kind: 'half' },
  ], -1)
  deckEdge(c, 'x', R + 0.2, roof, [{ from: -R - 0.2, to: R + 0.2, kind: 'half' }], 1)
  deckEdge(c, 'z', -R - 0.2, roof, [{ from: -R - 0.05, to: R + 0.2, kind: 'rail' }], -1)
  deckEdge(c, 'z', R + 0.2, roof, [{ from: -R - 0.05, to: R + 0.2, kind: 'rail' }], 1)

  // ── cover & clutter on the decks ──
  crate(c, 2.6, f1, -2.8, 0.1, 1.1, 1.0)
  crate(c, 2.75, f1 + 1.0, -2.75, 0.5, 0.7)
  crate(c, -2.2, f1, 4.5, -0.2, 0.9)
  barrelCluster(c, -3.0, -0.4, 2, ['barrelRust', 'barrelBlue'], 0, f1)
  // F2 cover: steel cabinet + spool
  b.box('generator', 1.4, 1.5, 0.7, 2.8, f2 + 0.75, 2.9)
  b.box('black', 1.2, 0.3, 0.05, 2.8, f2 + 1.1, 2.54, { col: false })
  b.cyl('woodDark', 0.55, 0.55, 0.7, 'z', -2.6, f2 + 0.55, 2.4, 14)
  b.cyl('black', 0.3, 0.3, 0.72, 'z', -2.6, f2 + 0.55, 2.4, 10, { col: false })
  // roof: sandbag-ish cover crates
  crate(c, 1.8, roof, -1.6, 0.3, 0.9)
  crate(c, -2.0, roof, 1.9, 0.0, 1.0, 0.8)

  // ── ground floor clutter ──
  crate(c, 1.6, f0, -2.6, 0.2, 1.2)
  crate(c, 1.55, f0 + 1.2, -2.55, -0.1, 0.8)
  palletStack(c, -1.8, 2.6, 0.3, 4, f0)
  barrelCluster(c, 2.8, 2.6, 3, ['barrelBlue', 'barrelRust'], 0, f0)
  // electrical box on a column
  b.box('pipeGrey', 0.6, 0.8, 0.25, 0, f0 + 1.4, -H + 0.3, { col: false })
  b.wire(new Vector3(0, f0 + 1.0, -H + 0.3), new Vector3(0, f0 + 0.05, -H + 2.5), 0.05, 0.02)
  // cable runs up a column
  b.rod('black', new Vector3(H - 0.2, f0, -H + 0.2), new Vector3(H - 0.2, f2, -H + 0.2), 0.025, 5, { col: false })
  // warning lamp on the canopy
  b.box('lamp', 0.12, 0.12, 0.12, R, roof + 2.6, R, { col: false })
}
