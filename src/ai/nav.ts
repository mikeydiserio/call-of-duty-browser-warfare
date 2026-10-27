import { DoubleSide, Ray, Vector3 } from 'three'
import { CONFIG } from '../core/config'
import type { Game } from '../core/game'
import type { NavLinkType } from '../core/types'
import type { CapsuleResult } from '../world/collision'

/**
 * Navigation graph auto-generated from the collision world.
 *
 * A grid of columns is sampled over the map bounds; every upward-facing surface
 * in a column (ground, tower floors, pipe tops, container roofs…) becomes a
 * candidate node if a standing (or crouching) capsule fits there. Neighbouring
 * nodes are linked when the step is small and the way is clear; ladders and
 * safe drops/mantles add extra links. Storage is flat typed arrays (CSR links).
 */

export const LINK_WALK = 0
export const LINK_JUMP = 1
export const LINK_LADDER = 2
export const LINK_DROP = 3
const LINK_NAMES: NavLinkType[] = ['walk', 'jump', 'ladder', 'drop']

const CELL = 1.0
const STEP = 0.45
const MANTLE = 1.15
const MAX_DROP = 3.5
const RADIUS = CONFIG.capsuleRadius
const DIRS8: [number, number][] = [
  [1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071],
]

const _o = new Vector3()
const _d = new Vector3()
const _a = new Vector3()
const _b = new Vector3()
const _ray = new Ray()
const _cap: CapsuleResult = { onGround: false, groundNormal: new Vector3(), push: new Vector3(), collided: false }

export interface NavStats {
  nodes: number
  links: number
  buildMs: number
  candidates: number
}

export class NavGraph {
  count = 0
  px: Float32Array
  py: Float32Array
  pz: Float32Array
  /** 0 open … 1 well covered. */
  cover: Float32Array
  /** Bit i set: direction DIRS8[i] is blocked at crouch height within 2.2 m. */
  coverMask: Uint8Array
  /** Bit i set: blocked at standing-eye height (i.e. not peekable over). */
  highMask: Uint8Array
  /** 1 = only crouch fits here. */
  low: Uint8Array
  linkStart: Int32Array
  linkTo: Int32Array
  linkType: Uint8Array
  /** Ladder index for ladder links (-1 otherwise). */
  linkLadder: Int16Array
  /** Spatial hash: column → node range. */
  private gridW = 0
  private gridH = 0
  private minX = 0
  private minZ = 0
  private colStart: Int32Array = new Int32Array(0)
  private colNodes: Int32Array = new Int32Array(0)
  stats: NavStats = { nodes: 0, links: 0, buildMs: 0, candidates: 0 }
  /** Long-sightline nodes for snipers. */
  sniperSpots: number[] = []

  // A* scratch (preallocated).
  private g!: Float32Array
  private f!: Float32Array
  private came!: Int32Array
  private stamp!: Uint32Array
  private closed!: Uint32Array
  private heap!: Int32Array
  private heapPos!: Int32Array
  private search = 1
  /** Extra per-node cost multiplier hook (danger avoidance). */
  extraCost: ((node: number) => number) | null = null

  constructor() {
    this.px = this.py = this.pz = this.cover = new Float32Array(0)
    this.coverMask = this.highMask = this.low = this.linkType = new Uint8Array(0)
    this.linkStart = this.linkTo = new Int32Array(0)
    this.linkLadder = new Int16Array(0)
  }

  static build(game: Game): NavGraph {
    const t0 = performance.now()
    const nav = new NavGraph()
    nav.generate(game)
    nav.stats.buildMs = performance.now() - t0
    return nav
  }

  // ─── Generation ───────────────────────────────────────────────────────────

  private generate(game: Game) {
    const col = game.collision
    const bvh = col.bvh
    const b = game.map.bounds
    const bb = col.geometry?.boundingBox ?? (col.geometry?.computeBoundingBox(), col.geometry?.boundingBox)
    const topY = (bb ? bb.max.y : 30) + 1
    const botY = (bb ? bb.min.y : -5) - 1
    const margin = RADIUS + 0.15
    this.minX = b.minX + margin
    this.minZ = b.minZ + margin
    this.gridW = Math.max(1, Math.floor((b.maxX - margin - this.minX) / CELL) + 1)
    this.gridH = Math.max(1, Math.floor((b.maxZ - margin - this.minZ) / CELL) + 1)
    const W = this.gridW
    const H = this.gridH

    // 1. Candidate surfaces per column (one all-hits ray per column).
    const cx: number[] = []
    const cy: number[] = []
    const cz: number[] = []
    const clow: number[] = []
    const ccol: number[] = []
    let candidates = 0
    const hitsY: number[] = []
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = this.minX + i * CELL
        const z = this.minZ + j * CELL
        hitsY.length = 0
        if (bvh) {
          _ray.origin.set(x, topY, z)
          _ray.direction.set(0, -1, 0)
          const hits = bvh.raycast(_ray, DoubleSide, 0, topY - botY)
          for (const h of hits) {
            // Only faces whose true winding points up are floors.
            if (h.face && h.face.normal.y > 0.7) hitsY.push(h.point.y)
          }
        } else {
          const gy = col.groundHeight(x, z, topY, topY - botY)
          if (Number.isFinite(gy)) hitsY.push(gy)
        }
        hitsY.sort((p, q) => q - p)
        let lastY = Infinity
        for (const y of hitsY) {
          if (lastY - y < 0.3) continue // coincident faces
          lastY = y
          candidates++
          // Headroom.
          _o.set(x, y + 0.05, z)
          _d.set(0, 1, 0)
          const up = col.raycast(_o, _d, CONFIG.capsuleHeight[0])
          const head = up ? up.distance : 99
          if (head < CONFIG.capsuleHeight[1] + 0.02) continue
          const low = head < CONFIG.capsuleHeight[0] - 0.05 ? 1 : 0
          // Capsule fit; nudge away from walls once.
          let nx = x
          let nz = z
          let ok = false
          for (let attempt = 0; attempt < 3; attempt++) {
            const h = low ? CONFIG.capsuleHeight[1] : CONFIG.capsuleHeight[0]
            _a.set(nx, y + RADIUS + 0.12, nz)
            _b.set(nx, y + h - RADIUS, nz)
            col.resolveCapsule(_a, _b, RADIUS, _cap)
            const ph = Math.hypot(_cap.push.x, _cap.push.z)
            if (ph < 0.02 && Math.abs(_cap.push.y) < 0.15) {
              ok = true
              break
            }
            if (_cap.push.y < -0.05 || ph > 0.45) break
            nx += _cap.push.x * 1.15
            nz += _cap.push.z * 1.15
          }
          if (!ok) continue
          // Surface must still be under the nudged point.
          if (nx !== x || nz !== z) {
            _o.set(nx, y + 0.3, nz)
            _d.set(0, -1, 0)
            const dn = col.raycast(_o, _d, 0.6)
            if (!dn || dn.normal.y < 0.7) continue
          }
          cx.push(nx)
          cy.push(y)
          cz.push(nz)
          clow.push(low)
          ccol.push(j * W + i)
        }
      }
    }

    // Merge designer hints (map.nav) as extra nodes.
    const hintBase = cx.length
    for (const h of game.map.nav) {
      cx.push(h.position.x)
      cy.push(h.position.y)
      cz.push(h.position.z)
      clow.push(0)
      const i = Math.round((h.position.x - this.minX) / CELL)
      const j = Math.round((h.position.z - this.minZ) / CELL)
      ccol.push(Math.max(0, Math.min(H - 1, j)) * W + Math.max(0, Math.min(W - 1, i)))
    }
    const n0 = cx.length

    // Spatial hash over candidates.
    const colCount = new Int32Array(W * H + 1)
    for (let k = 0; k < n0; k++) colCount[ccol[k]! + 1]!++
    for (let k = 0; k < W * H; k++) colCount[k + 1]! += colCount[k]!
    const colFill = colCount.slice()
    const colNodes = new Int32Array(n0)
    for (let k = 0; k < n0; k++) colNodes[colFill[ccol[k]!]!++] = k

    // 2. Links.
    const adj: number[][] = Array.from({ length: n0 }, () => [])
    const add = (from: number, to: number, type: number, ladder = -1) => adj[from]!.push(to, type, ladder)
    const half: [number, number][] = [[1, 0], [0, 1], [1, 1], [-1, 1]]
    for (let k = 0; k < hintBase; k++) {
      const c = ccol[k]!
      const ci = c % W
      const cj = (c / W) | 0
      for (const [di, dj] of half) {
        const ni = ci + di
        const nj = cj + dj
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue
        const nc = nj * W + ni
        for (let q = colCount[nc]!; q < colCount[nc + 1]!; q++) {
          const m = colNodes[q]!
          if (m >= hintBase) continue
          this.tryLink(col, k, m, cx, cy, cz, add, di !== 0 && dj !== 0)
        }
      }
    }
    // Hints: link to every grid node within reach.
    for (let k = hintBase; k < n0; k++) {
      for (let m = 0; m < hintBase; m++) {
        const dx = cx[m]! - cx[k]!
        const dz = cz[m]! - cz[k]!
        if (dx * dx + dz * dz > 2.4 || Math.abs(cy[m]! - cy[k]!) > STEP) continue
        _a.set(cx[k]!, cy[k]! + 0.6, cz[k]!)
        _b.set(cx[m]!, cy[m]! + 0.6, cz[m]!)
        if (col.lineOfSight(_a, _b)) {
          add(k, m, LINK_WALK)
          add(m, k, LINK_WALK)
        }
      }
      const h = game.map.nav[k - hintBase]!
      for (const l of h.links) add(k, hintBase + l.to, Math.max(0, LINK_NAMES.indexOf(l.type)))
    }
    // Ladders.
    game.map.ladders.forEach((l, li) => {
      _a.copy(l.bottom).addScaledVector(l.normal, 0.6)
      _b.copy(l.top).addScaledVector(l.normal, -0.7)
      const lo = this.nearestCandidate(_a, cx, cy, cz, colCount, colNodes, 1.6)
      const hi = this.nearestCandidate(_b, cx, cy, cz, colCount, colNodes, 1.6)
      if (lo >= 0 && hi >= 0 && lo !== hi) {
        add(lo, hi, LINK_LADDER, li)
        add(hi, lo, LINK_LADDER, li)
      }
    })

    // 3. Keep only nodes mutually reachable with the spawn area (drops islands,
    // nodes inside solid props, unreachable roofs).
    const keep = new Uint8Array(n0)
    const seeds: number[] = []
    for (const s of game.map.spawns) {
      const k = this.nearestCandidate(s.position, cx, cy, cz, colCount, colNodes, 3)
      if (k >= 0) seeds.push(k)
    }
    if (seeds.length === 0 && n0 > 0) {
      // Fallback: largest-ish component from the lowest node near the centre.
      let best = 0
      let bd = Infinity
      for (let k = 0; k < n0; k++) {
        const d = cx[k]! * cx[k]! + cz[k]! * cz[k]! + cy[k]! * 4
        if (d < bd) {
          bd = d
          best = k
        }
      }
      seeds.push(best)
    }
    // Strongly connected component around the best spawn seed: every kept node can
    // reach every other (one-way drops can otherwise strand bots and fail A*).
    const radj = this.reverse(adj, n0)
    let bestKeep: Uint8Array | null = null
    let bestCount = -1
    const tried = new Set<number>()
    for (const seed of seeds) {
      if (tried.has(seed) || (bestKeep && bestKeep[seed])) continue
      tried.add(seed)
      const fwd = this.flood([seed], adj, n0, null)
      const bwd = this.flood([seed], adj, n0, radj)
      const kk = new Uint8Array(n0)
      let c = 0
      for (let k = 0; k < n0; k++) if (fwd[k] && bwd[k]) (kk[k] = 1), c++
      if (c > bestCount) {
        bestCount = c
        bestKeep = kk
      }
      if (c > n0 * 0.6) break
    }
    let n = 0
    const remap = new Int32Array(n0).fill(-1)
    for (let k = 0; k < n0; k++) {
      if (bestKeep && bestKeep[k]) {
        keep[k] = 1
        remap[k] = n++
      }
    }

    // 4. Compact into typed arrays.
    this.count = n
    this.px = new Float32Array(n)
    this.py = new Float32Array(n)
    this.pz = new Float32Array(n)
    this.cover = new Float32Array(n)
    this.coverMask = new Uint8Array(n)
    this.highMask = new Uint8Array(n)
    this.low = new Uint8Array(n)
    this.linkStart = new Int32Array(n + 1)
    let links = 0
    for (let k = 0; k < n0; k++) {
      if (!keep[k]) continue
      const a = adj[k]!
      for (let q = 0; q < a.length; q += 3) if (keep[a[q]!]) links++
    }
    this.linkTo = new Int32Array(links)
    this.linkType = new Uint8Array(links)
    this.linkLadder = new Int16Array(links)
    let li = 0
    const nodeCol = new Int32Array(n)
    for (let k = 0; k < n0; k++) {
      if (!keep[k]) continue
      const id = remap[k]!
      this.px[id] = cx[k]!
      this.py[id] = cy[k]!
      this.pz[id] = cz[k]!
      this.low[id] = clow[k]!
      nodeCol[id] = ccol[k]!
      this.linkStart[id] = li
      const a = adj[k]!
      for (let q = 0; q < a.length; q += 3) {
        const to = remap[a[q]!]!
        if (to < 0) continue
        this.linkTo[li] = to
        this.linkType[li] = a[q + 1]!
        this.linkLadder[li] = a[q + 2]!
        li++
      }
    }
    this.linkStart[n] = li

    // Final spatial hash.
    const cc = new Int32Array(W * H + 1)
    for (let k = 0; k < n; k++) cc[nodeCol[k]! + 1]!++
    for (let k = 0; k < W * H; k++) cc[k + 1]! += cc[k]!
    const fill = cc.slice()
    this.colNodes = new Int32Array(n)
    for (let k = 0; k < n; k++) this.colNodes[fill[nodeCol[k]!]!++] = k
    this.colStart = cc

    // 5. Cover scores.
    for (let k = 0; k < n; k++) {
      let mask = 0
      let high = 0
      let score = 0
      const crouchY = this.py[k]! + 0.85
      const standY = this.py[k]! + 1.55
      for (let d = 0; d < 8; d++) {
        const [dx, dz] = DIRS8[d]!
        _d.set(dx, 0, dz)
        _o.set(this.px[k]!, crouchY, this.pz[k]!)
        if (col.raycast(_o, _d, 2.2)) {
          mask |= 1 << d
          score += 0.7
          _o.y = standY
          if (col.raycast(_o, _d, 2.2)) {
            high |= 1 << d
            score += 0.3
          }
        }
      }
      this.coverMask[k] = mask
      this.highMask[k] = high
      this.cover[k] = Math.min(1, score / 4)
    }

    this.computeSniperSpots(game)
    this.allocSearch()
    this.stats = { nodes: n, links, buildMs: 0, candidates }
  }

  private tryLink(
    col: Game['collision'], a: number, b: number,
    cx: number[], cy: number[], cz: number[],
    add: (f: number, t: number, ty: number) => void, diagonal: boolean,
  ) {
    const ax = cx[a]!, ay = cy[a]!, az = cz[a]!
    const bx = cx[b]!, by = cy[b]!, bz = cz[b]!
    const dy = by - ay
    const ady = Math.abs(dy)
    if (ady <= STEP) {
      const base = Math.max(ay, by)
      if (!this.clear(col, ax, ay + 0.55 + (base - ay), az, bx, by + 0.55 + (base - by), bz, diagonal)) return
      if (!this.clear(col, ax, ay + 1.25, az, bx, by + 1.25, bz, false)) return
      // Ground continuity at the midpoint.
      const mx = (ax + bx) * 0.5
      const mz = (az + bz) * 0.5
      _o.set(mx, base + 0.5, mz)
      _d.set(0, -1, 0)
      const g = col.raycast(_o, _d, 1.2 + ady)
      if (!g || g.normal.y < 0.6 || g.point.y < Math.min(ay, by) - 0.35) return
      add(a, b, LINK_WALK)
      add(b, a, LINK_WALK)
      return
    }
    if (ady > MAX_DROP || diagonal) return
    // Higher → lower: walk off the edge (drop) and, if short, climb back (mantle-jump).
    const [hi, lo] = dy > 0 ? [b, a] : [a, b]
    const hx = cx[hi]!, hy = cy[hi]!, hz = cz[hi]!
    const lx = cx[lo]!, ly = cy[lo]!, lz = cz[lo]!
    // Clear at the upper level across to the lower column.
    if (!this.clear(col, hx, hy + 0.5, hz, lx, hy + 0.5, lz, false)) return
    if (!this.clear(col, hx, hy + 1.3, hz, lx, hy + 1.3, lz, false)) return
    // Nothing between the lower column's air and its floor.
    _o.set(lx, hy + 0.4, lz)
    _d.set(0, -1, 0)
    const g = col.raycast(_o, _d, hy - ly + 0.5)
    if (!g || Math.abs(g.point.y - ly) > 0.15) return
    add(hi, lo, LINK_DROP)
    if (ady <= MANTLE) {
      // Mantle needs a free approach on the low side at chest height.
      if (this.clear(col, lx, ly + 1.7, lz, hx, hy + 1.7, hz, false)) add(lo, hi, LINK_JUMP)
    }
  }

  /** Two parallel rays (left/right of centre) — approximates the capsule sweep. */
  private clear(col: Game['collision'], ax: number, ay: number, az: number, bx: number, by: number, bz: number, wide: boolean): boolean {
    let dx = bx - ax
    let dy = by - ay
    let dz = bz - az
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-4) return true
    dx /= len
    dy /= len
    dz /= len
    _d.set(dx, dy, dz)
    const off = wide ? RADIUS * 0.8 : 0
    const sx = -dz * off
    const sz = dx * off
    _o.set(ax + sx, ay, az + sz)
    if (col.raycast(_o, _d, len)) return false
    if (off > 0) {
      _o.set(ax - sx, ay, az - sz)
      if (col.raycast(_o, _d, len)) return false
    }
    return true
  }

  private nearestCandidate(p: Vector3, cx: number[], cy: number[], cz: number[], colCount: Int32Array, colNodes: Int32Array, maxD: number): number {
    const W = this.gridW
    const H = this.gridH
    const ci = Math.round((p.x - this.minX) / CELL)
    const cj = Math.round((p.z - this.minZ) / CELL)
    const r = Math.ceil(maxD / CELL)
    let best = -1
    let bd = maxD * maxD
    for (let j = cj - r; j <= cj + r; j++) {
      if (j < 0 || j >= H) continue
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || i >= W) continue
        const c = j * W + i
        for (let q = colCount[c]!; q < colCount[c + 1]!; q++) {
          const k = colNodes[q]!
          const dx = cx[k]! - p.x
          const dy = (cy[k]! - p.y) * 2.5
          const dz = cz[k]! - p.z
          const d = dx * dx + dy * dy + dz * dz
          if (d < bd) {
            bd = d
            best = k
          }
        }
      }
    }
    return best
  }

  private reverse(adj: number[][], n: number): number[][] {
    const radj: number[][] = Array.from({ length: n }, () => [])
    for (let k = 0; k < n; k++) {
      const a = adj[k]!
      for (let q = 0; q < a.length; q += 3) radj[a[q]!]!.push(k)
    }
    return radj
  }

  private flood(seeds: number[], adj: number[][], n: number, radj: number[][] | null): Uint8Array {
    const seen = new Uint8Array(n)
    const stack = [...seeds]
    for (const s of seeds) seen[s] = 1
    while (stack.length) {
      const k = stack.pop()!
      if (radj) {
        for (const m of radj[k]!) if (!seen[m]) (seen[m] = 1), stack.push(m)
      } else {
        const a = adj[k]!
        for (let q = 0; q < a.length; q += 3) {
          const m = a[q]!
          if (!seen[m]) (seen[m] = 1), stack.push(m)
        }
      }
    }
    return seen
  }

  private computeSniperSpots(game: Game) {
    const n = this.count
    if (n === 0) return
    const col = game.collision
    const scored: [number, number][] = []
    const samples = Math.min(n, 260)
    const step = n / samples
    for (let s = 0; s < samples; s++) {
      const k = Math.floor(s * step)
      if (this.low[k]) continue
      _o.set(this.px[k]!, this.py[k]! + 1.5, this.pz[k]!)
      let open = 0
      for (let d = 0; d < 8; d++) {
        const [dx, dz] = DIRS8[d]!
        _d.set(dx, -0.02, dz).normalize()
        const h = col.raycast(_o, _d, 60)
        open += h ? h.distance : 60
      }
      // Long sightlines + height + some cover behind.
      const score = open / 8 + this.py[k]! * 2.2 + this.cover[k]! * 6
      scored.push([score, k])
    }
    scored.sort((a, b) => b[0] - a[0])
    const picked: number[] = []
    for (const [, k] of scored) {
      if (picked.some((p) => Math.hypot(this.px[p]! - this.px[k]!, this.pz[p]! - this.pz[k]!) < 8)) continue
      picked.push(k)
      if (picked.length >= 10) break
    }
    this.sniperSpots = picked
  }

  private allocSearch() {
    const n = Math.max(1, this.count)
    this.g = new Float32Array(n)
    this.f = new Float32Array(n)
    this.came = new Int32Array(n)
    this.stamp = new Uint32Array(n)
    this.closed = new Uint32Array(n)
    this.heap = new Int32Array(n)
    this.heapPos = new Int32Array(n)
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  /** Nearest node to a world point (vertical distance weighted), or -1. */
  nearest(x: number, y: number, z: number, maxD = 4): number {
    const W = this.gridW
    const H = this.gridH
    const ci = Math.round((x - this.minX) / CELL)
    const cj = Math.round((z - this.minZ) / CELL)
    let best = -1
    let bd = Infinity
    for (let r = 0; r <= Math.ceil(maxD / CELL); r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        if (j < 0 || j >= H) continue
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || i >= W) continue
          if (r > 0 && Math.abs(j - cj) !== r && Math.abs(i - ci) !== r) continue
          const c = j * W + i
          for (let q = this.colStart[c]!; q < this.colStart[c + 1]!; q++) {
            const k = this.colNodes[q]!
            const dx = this.px[k]! - x
            let dy = this.py[k]! - y
            dy = dy > 0 ? dy * 3 : -dy * 1.5 // prefer the floor we're standing on
            const dz = this.pz[k]! - z
            const d = dx * dx + dy * dy + dz * dz
            if (d < bd) {
              bd = d
              best = k
            }
          }
        }
      }
      // Ring r guarantees anything within r*CELL was seen.
      if (best >= 0 && bd < (r * CELL) * (r * CELL)) break
    }
    return best
  }

  randomNode(): number {
    return this.count ? Math.floor(Math.random() * this.count) : -1
  }

  /** Random node whose column lies within radius of (x, z) — any floor level. */
  randomNear(x: number, z: number, radius: number): number {
    const W = this.gridW
    const H = this.gridH
    for (let t = 0; t < 16; t++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * radius
      const i = Math.round((x + Math.cos(a) * r - this.minX) / CELL)
      const j = Math.round((z + Math.sin(a) * r - this.minZ) / CELL)
      if (i < 0 || j < 0 || i >= W || j >= H) continue
      const c = j * W + i
      const n = this.colStart[c + 1]! - this.colStart[c]!
      if (n > 0) return this.colNodes[this.colStart[c]! + Math.floor(Math.random() * n)]!
    }
    return this.nearest(x, 0, z, radius + 4)
  }

  linkBetween(a: number, b: number): number {
    for (let q = this.linkStart[a]!; q < this.linkStart[a + 1]!; q++) if (this.linkTo[q] === b) return q
    return -1
  }

  /**
   * A* from start to goal. Writes node ids into `out` (start excluded) and
   * returns the path length, or -1 if unreachable. Allocation-free.
   */
  findPath(start: number, goal: number, out: Int32Array, maxExpand = 6000): number {
    if (start < 0 || goal < 0) return -1
    if (start === goal) {
      out[0] = goal
      return 1
    }
    const s = ++this.search
    const { g, f, came, stamp, closed, heap, heapPos, px, py, pz } = this
    const gx = px[goal]!, gy = py[goal]!, gz = pz[goal]!
    let hn = 0
    const push = (k: number) => {
      let i = hn++
      while (i > 0) {
        const p = (i - 1) >> 1
        if (f[heap[p]!]! <= f[k]!) break
        heap[i] = heap[p]!
        heapPos[heap[i]!] = i
        i = p
      }
      heap[i] = k
      heapPos[k] = i
    }
    const siftUp = (k: number) => {
      let i = heapPos[k]!
      while (i > 0) {
        const p = (i - 1) >> 1
        if (f[heap[p]!]! <= f[k]!) break
        heap[i] = heap[p]!
        heapPos[heap[i]!] = i
        i = p
      }
      heap[i] = k
      heapPos[k] = i
    }
    const pop = () => {
      const top = heap[0]!
      const last = heap[--hn]!
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        if (l >= hn) break
        const r = l + 1
        const c = r < hn && f[heap[r]!]! < f[heap[l]!]! ? r : l
        if (f[heap[c]!]! >= f[last]!) break
        heap[i] = heap[c]!
        heapPos[heap[i]!] = i
        i = c
      }
      if (hn > 0) {
        heap[i] = last
        heapPos[last] = i
      }
      return top
    }
    stamp[start] = s
    g[start] = 0
    f[start] = Math.hypot(px[start]! - gx, py[start]! - gy, pz[start]! - gz)
    came[start] = -1
    push(start)
    let expanded = 0
    const extra = this.extraCost
    while (hn > 0) {
      const cur = pop()
      if (cur === goal) break
      closed[cur] = s
      if (++expanded > maxExpand) return -1
      const cxp = px[cur]!, cyp = py[cur]!, czp = pz[cur]!
      for (let q = this.linkStart[cur]!; q < this.linkStart[cur + 1]!; q++) {
        const m = this.linkTo[q]!
        if (closed[m] === s) continue
        const t = this.linkType[q]!
        let cost = Math.hypot(px[m]! - cxp, (py[m]! - cyp) * (t === LINK_LADDER ? 1.6 : 1), pz[m]! - czp)
        if (t === LINK_JUMP) cost += 1.2
        else if (t === LINK_DROP) cost += 0.6
        else if (t === LINK_LADDER) cost += 2
        if (this.low[m]) cost *= 1.6
        if (extra) cost *= extra(m)
        const ng = g[cur]! + cost
        if (stamp[m] === s && ng >= g[m]!) continue
        const fresh = stamp[m] !== s
        stamp[m] = s
        g[m] = ng
        came[m] = cur
        f[m] = ng + Math.hypot(px[m]! - gx, py[m]! - gy, pz[m]! - gz)
        if (fresh) push(m)
        else siftUp(m)
      }
    }
    if (stamp[goal] !== s) return -1
    // Reconstruct (reverse into out).
    let len = 0
    for (let k = goal; k !== start && k >= 0; k = came[k]!) len++
    if (len > out.length) return -1
    let i = len - 1
    for (let k = goal; k !== start && k >= 0; k = came[k]!) out[i--] = k
    return len
  }
}

export { DIRS8 }

let cache: { key: string; nav: NavGraph } | null = null

/** Build (or reuse) the nav graph for the current map geometry. */
export function getNavGraph(game: Game): NavGraph {
  const geo = game.collision.geometry
  const key = `${game.map.id}:${geo ? geo.getAttribute('position').count : 0}:${game.map.ladders.length}:${game.map.nav.length}`
  if (cache && cache.key === key) return cache.nav
  const nav = NavGraph.build(game)
  cache = { key, nav }
  return nav
}
