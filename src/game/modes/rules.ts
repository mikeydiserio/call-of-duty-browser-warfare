import { Vector3 } from 'three'
import type { GameEvents } from '../../core/events'
import type { Game } from '../../core/game'
import type { Actor, DamageInfo, GameModeId, ObjectiveId, ObjectivePoint, SpawnPoint, Team } from '../../core/types'
import type { GameMode } from '../mode'

const _eye = new Vector3()
const _p = new Vector3()

export type NetRules = Record<string, number | string | boolean | null>

/**
 * Per-mode rules plugged into GameMode. The base class is plain TDM-style
 * behaviour; each mode overrides what it changes. Keep all state in plain
 * fields (numbers, strings, actor ids) so the net layer can snapshot it.
 */
export abstract class ModeRules {
  abstract readonly id: GameModeId
  /** Dead actors respawn after a delay (false in S&D). */
  respawns = true

  constructor(protected mode: GameMode) {}

  protected get game(): Game {
    return this.mode.game
  }

  /** Called from GameMode.begin() after the reset, before the initial spawns. */
  begin() {}
  /** Intro countdown finished. */
  onPlayStart() {}
  /** Banner shown at match start. */
  abstract intro(): GameEvents['match:announce']
  /** While playing, after the clock / respawn / UAV bookkeeping. */
  update(_dt: number) {}
  onKill(_info: DamageInfo, _suicide: boolean) {}
  onTimeUp() {
    this.mode.endByScore()
  }
  clockPaused() {
    return false
  }
  chooseSpawn(actor: Actor, initial: boolean): SpawnPoint {
    if (initial) {
      const base = this.spawnsFor(actor.team, false)
      if (base.length) return this.leastRecentlyUsed(base)
    }
    return this.bestSpawn(actor, this.spawnsFor(actor.team, true))
  }

  // ── objective hooks (S&D overrides) ──
  wantsPlant(_actor: Actor) {
    return false
  }
  canDefuse(_actor: Actor) {
    return false
  }
  beginPlant(_actor: Actor) {
    return false
  }
  beginDefuse(_actor: Actor) {
    return false
  }
  cancel(_actor: Actor) {}

  getNetState(): NetRules {
    return {}
  }
  applyNetState(_s: NetRules) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Map spawns usable in this mode: a team's base (+ 'any' spawns if `withAny`). */
  spawnsFor(team: Team | null, withAny: boolean): SpawnPoint[] {
    return this.game.map.spawns.filter(
      (s) => (!s.modes || s.modes.includes(this.id)) && ((team !== null && s.team === team) || (withAny && s.team === 'any')),
    )
  }

  /** Every spawn usable in this mode. */
  allSpawns(): SpawnPoint[] {
    const list = this.game.map.spawns.filter((s) => !s.modes || s.modes.includes(this.id))
    return list.length ? list : this.game.map.spawns
  }

  leastRecentlyUsed(list: SpawnPoint[]): SpawnPoint {
    const use = this.mode.lastSpawnUse
    return list.slice().sort((x, y) => (use.get(x) ?? -1) - (use.get(y) ?? -1))[0]!
  }

  /**
   * MW2-style spawn logic: far from (and out of sight of) enemies, near friends,
   * avoid recently used points. `bias` adds a per-spawn mode preference.
   */
  bestSpawn(actor: Actor, candidates: SpawnPoint[], bias?: (s: SpawnPoint) => number, friendWeight = 8): SpawnPoint {
    if (!candidates.length) candidates = this.allSpawns()
    const actors = this.game.actors
    const enemies = actors.filter((a) => a.alive && this.mode.isEnemy(actor, a))
    const friends = actors.filter((a) => a.alive && a !== actor && !this.mode.isEnemy(actor, a))
    const col = this.game.collision
    let best = candidates[0]!
    let bestScore = -Infinity
    for (const s of candidates) {
      let score = 0
      _p.copy(s.position).setY(s.position.y + 1.6)
      for (const e of enemies) {
        const d = e.position.distanceTo(s.position)
        score += Math.min(d, 30) * (0.8 * 6) / Math.max(6, enemies.length)
        if (d < 10) score -= 60
        e.getEyePosition(_eye)
        if (d < 45 && col.lineOfSight(_eye, _p)) score -= 80
      }
      for (const f of friends) if (f.position.distanceTo(s.position) < 14) score += friendWeight
      const lastUse = this.mode.lastSpawnUse.get(s)
      if (lastUse !== undefined && this.game.time - lastUse < 6) score -= 40
      if (bias) score += bias(s)
      score += Math.random() * 6
      if (score > bestScore) {
        bestScore = score
        best = s
      }
    }
    return best
  }

  /** Centroid of a team's base spawns (falls back to the map centre). */
  baseCentre(team: Team): Vector3 {
    const own = this.game.map.spawns.filter((s) => s.team === team)
    const c = new Vector3()
    if (!own.length) return c
    for (const s of own) c.add(s.position)
    return c.divideScalar(own.length)
  }

  /** Ground point under (x, z), preferring the lowest walkable floor (not a tower roof). */
  groundPoint(x: number, z: number): Vector3 {
    const col = this.game.collision
    let y = col.groundHeight(x, z, 1.5, 6)
    if (!Number.isFinite(y)) y = col.groundHeight(x, z, 30, 60)
    return new Vector3(x, Number.isFinite(y) ? y : 0, z)
  }

  /** Callout nearest to a point (excluding names in `skip`), as an objective point. */
  calloutPoint(id: ObjectiveId, near: Vector3, radius: number, skip: Set<string>): ObjectivePoint {
    let best = this.game.map.callouts[0]
    let bestD = Infinity
    for (const c of this.game.map.callouts) {
      if (skip.has(c.name)) continue
      const d = Math.hypot(c.center.x - near.x, c.center.z - near.z)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    const at = best ? best.center : near
    if (best) skip.add(best.name)
    return { id, position: this.groundPoint(at.x, at.z), radius }
  }

  /** Horizontal distance check with a generous vertical tolerance (tower floors). */
  inRadius(actor: Actor, p: ObjectivePoint, extra = 0): boolean {
    const dx = actor.position.x - p.position.x
    const dz = actor.position.z - p.position.z
    const r = p.radius + extra
    return dx * dx + dz * dz <= r * r && Math.abs(actor.position.y - p.position.y) < 3.5
  }

  teamMembers(team: Team): Actor[] {
    return this.game.actors.filter((a) => a.team === team)
  }
}
