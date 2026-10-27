import type { Actor, DamageInfo, ObjectiveId, ObjectivePoint, ObjectiveState, SpawnPoint, Team } from '../../core/types'
import { otherTeam } from '../../core/types'
import { ModeRules, type NetRules } from './rules'

/** Seconds for one player to capture a neutral flag. */
const CAPTURE_TIME = 10
/** Seconds for one player to neutralise an enemy flag (then CAPTURE_TIME more to take it). */
const NEUTRALISE_TIME = 5
/** Extra cappers speed it up: rate × (1 + 0.5 per extra), capped. */
const MAX_CAP_MULT = 2.5
/** Progress lost per second when nobody is capping (full bar in 8 s). */
const DECAY_RATE = 1 / 8
const TICK_SECONDS = 5
const CAPTURE_POINTS = 150
const ATTACK_DEFEND_POINTS = 50
const FLAG_RADIUS = 4.5

/**
 * Domination (MW2): three flags; stand in a flag's radius to capture it.
 * Each owned flag scores 1 point every 5 s; first to scoreLimit (200) or most at time-out.
 */
export class DominationRules extends ModeRules {
  readonly id = 'dom' as const
  private tickT = 0
  /** Flags whose discrete state (owner/capturing/contested) changed this frame. */
  private lastSig = new Map<ObjectiveId, string>()

  intro() {
    return { text: 'DOMINATION', sub: `Capture and hold the flags. First to ${this.mode.settings.scoreLimit} points wins.`, voice: 'dom_intro' }
  }

  begin() {
    const pts = this.game.map.domFlags.length ? this.game.map.domFlags : this.synthesiseFlags()
    this.mode.objectives = pts.map(
      (p): ObjectiveState => ({
        id: p.id, position: p.position.clone(), radius: p.radius,
        owner: null, capturingTeam: null, progressTeam: null, progress: 0, contested: false,
      }),
    )
    this.tickT = TICK_SECONDS
    this.lastSig.clear()
  }

  /** Fallback when the map has no flags yet: A near tf141's half, B at the centre, C near opfor's half. */
  private synthesiseFlags(): ObjectivePoint[] {
    const b = this.game.map.bounds
    const centre = this.groundPoint((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)
    const skip = new Set<string>()
    const mid = (team: Team) => this.baseCentre(team).lerp(centre, 0.5)
    const B = this.calloutPoint('B', centre, FLAG_RADIUS, skip)
    const A = this.calloutPoint('A', mid('tf141'), FLAG_RADIUS, skip)
    const C = this.calloutPoint('C', mid('opfor'), FLAG_RADIUS, skip)
    return [A, B, C]
  }

  update(dt: number) {
    const mode = this.mode
    const events = this.game.events
    for (const f of mode.objectives) {
      const cappers: Record<Team, Actor[]> = { tf141: [], opfor: [] }
      for (const a of this.game.actors) if (a.alive && this.inRadius(a, f)) cappers[a.team].push(a)
      const nT = cappers.tf141.length
      const nO = cappers.opfor.length
      f.contested = nT > 0 && nO > 0
      if (f.contested) {
        f.capturingTeam = null
      } else if (nT === 0 && nO === 0) {
        f.capturingTeam = null
        f.progress = Math.max(0, f.progress - DECAY_RATE * dt)
      } else {
        const team: Team = nT > 0 ? 'tf141' : 'opfor'
        const n = nT + nO
        const mult = Math.min(MAX_CAP_MULT, 1 + 0.5 * (n - 1))
        if (f.owner === team) {
          // Defenders standing on their own flag undo any enemy progress.
          f.capturingTeam = null
          f.progress = Math.max(0, f.progress - (mult / NEUTRALISE_TIME) * dt)
        } else if (f.progressTeam && f.progressTeam !== team && f.progress > 0) {
          // Undo the other team's partial capture first.
          f.capturingTeam = team
          f.progress = Math.max(0, f.progress - (mult / NEUTRALISE_TIME) * dt)
        } else {
          f.capturingTeam = team
          f.progressTeam = team
          const time = f.owner ? NEUTRALISE_TIME : CAPTURE_TIME
          f.progress += (mult / time) * dt
          if (f.progress >= 1) {
            f.progress = 0
            if (f.owner) {
              // Enemy flag → neutral; keep capping to take it.
              const lost = f.owner
              f.owner = null
              if (lost === mode.playerTeam) events.emit('match:announce', { text: `LOSING ${f.id}`, voice: `dom_losing_${f.id.toLowerCase()}` })
            } else {
              this.capture(f, team, cappers[team])
            }
          }
        }
      }
      if (f.progress <= 0 && !f.capturingTeam) f.progressTeam = null
      const sig = `${f.owner}|${f.capturingTeam}|${f.contested}|${f.progressTeam}`
      if (this.lastSig.get(f.id) !== sig) {
        this.lastSig.set(f.id, sig)
        events.emit('objective:state', { id: f.id })
      }
    }

    // Each owned flag scores a point every 5 s.
    this.tickT -= dt
    if (this.tickT <= 0) {
      this.tickT += TICK_SECONDS
      let changed = false
      for (const f of mode.objectives) {
        if (f.owner) {
          mode.score[f.owner]++
          changed = true
        }
      }
      if (changed) {
        events.emit('score:changed', { ...mode.score })
        const limit = mode.settings.scoreLimit
        const t = mode.score.tf141 >= limit
        const o = mode.score.opfor >= limit
        if (t || o) mode.endMatch(t && o ? (mode.score.tf141 === mode.score.opfor ? 'draw' : mode.score.tf141 > mode.score.opfor ? 'tf141' : 'opfor') : t ? 'tf141' : 'opfor')
      }
    }
  }

  private capture(f: ObjectiveState, team: Team, by: Actor[]) {
    f.owner = team
    f.progressTeam = null
    f.capturingTeam = null
    for (const a of by) this.mode.addPoints(a, CAPTURE_POINTS, 'CAPTURE')
    this.game.events.emit('objective:captured', { id: f.id, team, by: by.slice() })
    const ours = team === this.mode.playerTeam
    this.game.events.emit('match:announce', {
      text: ours ? `SECURED ${f.id}` : `LOST ${f.id}`,
      voice: ours ? `dom_secured_${f.id.toLowerCase()}` : `dom_lost_${f.id.toLowerCase()}`,
    })
  }

  /** Kills on or near a flag count as attack / defend bonuses. */
  onKill(info: DamageInfo, suicide: boolean) {
    const killer = info.attacker
    const victim = info.victim
    if (suicide || !killer || !this.mode.isEnemy(killer, victim)) return
    for (const f of this.mode.objectives) {
      if (this.inRadius(killer, f, 2) && f.owner === killer.team) {
        this.mode.addPoints(killer, ATTACK_DEFEND_POINTS, 'DEFEND')
        return
      }
      if (this.inRadius(victim, f, 2)) {
        const defend = f.owner === killer.team
        this.mode.addPoints(killer, ATTACK_DEFEND_POINTS, defend ? 'DEFEND' : 'ATTACK')
        return
      }
    }
  }

  /** Respawn near owned flags, away from enemy-held ones. */
  chooseSpawn(actor: Actor, initial: boolean): SpawnPoint {
    if (initial) return super.chooseSpawn(actor, true)
    const flags = this.mode.objectives
    const enemyTeam = otherTeam(actor.team)
    const owned = flags.filter((f) => f.owner === actor.team)
    const hostile = flags.filter((f) => f.owner === enemyTeam)
    const bias = (s: SpawnPoint) => {
      let b = 0
      if (owned.length) {
        let d = Infinity
        for (const f of owned) d = Math.min(d, f.position.distanceTo(s.position))
        b += d < 22 ? 40 - d : -10
      } else if (s.team === actor.team) b += 25
      for (const f of hostile) if (f.position.distanceTo(s.position) < 14) b -= 50
      for (const f of flags) if (f.position.distanceTo(s.position) < f.radius + 2) b -= 30
      return b
    }
    return this.bestSpawn(actor, this.spawnsFor(actor.team, true), bias)
  }

  getNetState(): NetRules {
    return { tickT: this.tickT }
  }

  applyNetState(s: NetRules) {
    if (typeof s.tickT === 'number') this.tickT = s.tickT
  }
}
