import { Vector3 } from 'three'
import type { Actor, BombState, DamageInfo, ObjectiveId, ObjectivePoint, SpawnPoint, Team } from '../../core/types'
import { otherTeam } from '../../core/types'
import { ModeRules, type NetRules } from './rules'

const PLANT_TIME = 5
const DEFUSE_TIME = 7.5
const FUSE_TIME = 45
const ROUND_END_DELAY = 5
const ROUND_INTRO = 3
const PICKUP_RADIUS = 1.4
const DEFUSE_RADIUS = 2.2
/** Planting / defusing is cancelled above this horizontal speed (m/s). */
const STILL_SPEED = 1.5
const SITE_RADIUS = 3
const BLAST_KILL_RADIUS = 10
const BLAST_RADIUS = 18
const PLANT_POINTS = 300
const DEFUSE_POINTS = 300

const _v = new Vector3()

export type RoundEndReason = 'elimination' | 'detonated' | 'defused' | 'time'

/**
 * Search & Destroy (MW2): rounds, no respawns. Attackers carry one bomb (starts at
 * map.bombSpawn) to site A or B, plant (5 s) and defend the 45 s fuse; defenders
 * defuse (7.5 s) or run the clock. Sides swap every (scoreLimit − 1) rounds;
 * scoreLimit is round wins. Map spawn labels are sides: 'tf141' spawns = attack side.
 */
export class SearchDestroyRules extends ModeRules {
  readonly id = 'sd' as const
  respawns = false
  /** Team attacking in round 1. */
  firstAttackers: Team = 'tf141'
  roundOver = false
  roundEndIn = 0
  lastRoundWinner: Team | 'draw' | null = null
  lastRoundReason: RoundEndReason | null = null
  /** Site being planted at (bomb.site is only set once planted). */
  private plantSite: ObjectiveId | null = null
  private planterId: number | null = null
  private blasting = false

  intro() {
    const atk = this.attackersFor(this.mode.round) === this.mode.playerTeam
    return {
      text: 'SEARCH & DESTROY',
      sub: atk ? 'Destroy one of the enemy targets. No respawns.' : 'Defend both targets. No respawns.',
      voice: atk ? 'sd_attack' : 'sd_defend',
    }
  }

  /** Rounds per half: sides swap every this many rounds. */
  get roundsPerHalf() {
    return Math.max(1, this.mode.settings.scoreLimit - 1)
  }

  attackersFor(round: number): Team {
    const half = Math.floor((round - 1) / this.roundsPerHalf)
    return half % 2 === 0 ? this.firstAttackers : otherTeam(this.firstAttackers)
  }

  get attackers(): Team {
    return this.mode.bomb?.attackers ?? this.attackersFor(this.mode.round)
  }

  begin() {
    const map = this.game.map
    this.mode.bombSites = (map.bombSites.length ? map.bombSites : this.synthesiseSites()).map((s) => ({ ...s, position: s.position.clone() }))
    this.startRound()
  }

  /** Fallback sites: two callouts on the defenders' half, ~18 m+ apart. */
  private synthesiseSites(): ObjectivePoint[] {
    const def = this.baseCentre('opfor')
    const atk = this.baseCentre('tf141')
    const flat = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
    const cands = this.game.map.callouts
      .filter((c) => flat(c.center, def) > c.radius + 4 && flat(c.center, def) < flat(c.center, atk))
      .sort((a, b) => flat(a.center, def) - flat(b.center, def))
    const a = cands[0]
    const b = cands.find((c) => a && c !== a && flat(c.center, a.center) >= 18) ?? cands[1]
    if (!a || !b) {
      const skip = new Set<string>()
      return [this.calloutPoint('A', def, SITE_RADIUS, skip), this.calloutPoint('B', def.clone().lerp(atk, 0.3), SITE_RADIUS, skip)]
    }
    return [
      { id: 'A', position: this.groundPoint(a.center.x, a.center.z), radius: SITE_RADIUS },
      { id: 'B', position: this.groundPoint(b.center.x, b.center.z), radius: SITE_RADIUS },
    ]
  }

  private startRound() {
    const attackers = this.attackersFor(this.mode.round)
    const spawn = this.game.map.bombSpawn ?? this.sideCentre('tf141')
    const bomb: BombState = {
      attackers,
      carrier: null,
      position: spawn.clone(),
      planted: false,
      site: null,
      fuseLeft: FUSE_TIME,
      plantProgress: 0,
      defuseProgress: 0,
      carrierId: null,
      plantingId: null,
      defusingId: null,
    }
    this.mode.bomb = bomb
    this.mode.timeLeft = this.mode.settings.timeLimit
    this.roundOver = false
    this.roundEndIn = 0
    this.plantSite = null
    this.planterId = null
    this.game.events.emit('round:phase', { round: this.mode.round, phase: 'start', attackers })
  }

  private sideCentre(side: Team): Vector3 {
    const own = this.spawnsFor(side, false)
    const c = new Vector3()
    if (!own.length) return this.baseCentre(side)
    for (const s of own) c.add(s.position)
    return c.divideScalar(own.length)
  }

  /** Everyone spawns on their side's base each round. */
  chooseSpawn(actor: Actor, _initial: boolean): SpawnPoint {
    const side: Team = actor.team === this.attackers ? 'tf141' : 'opfor'
    const base = this.spawnsFor(side, false)
    if (base.length) return this.leastRecentlyUsed(base)
    return this.bestSpawn(actor, this.allSpawns())
  }

  clockPaused() {
    return this.roundOver || !!this.mode.bomb?.planted
  }

  onTimeUp() {
    if (!this.mode.bomb?.planted) this.endRound(otherTeam(this.attackers), 'time')
  }

  // ─── Per-frame ────────────────────────────────────────────────────────────

  update(dt: number) {
    const mode = this.mode
    const bomb = mode.bomb
    if (!bomb) return
    if (this.roundOver) {
      this.roundEndIn -= dt
      if (this.roundEndIn <= 0 && mode.phase === 'playing') this.nextRound()
      return
    }
    const events = this.game.events

    // Carry / pick up.
    if (bomb.carrier) {
      if (!bomb.carrier.alive) this.drop(bomb.carrier)
      else bomb.position.copy(bomb.carrier.position)
    } else if (!bomb.planted) {
      for (const a of this.game.actors) {
        if (!a.alive || a.team !== bomb.attackers) continue
        if (Math.hypot(a.position.x - bomb.position.x, a.position.z - bomb.position.z) < PICKUP_RADIUS && Math.abs(a.position.y - bomb.position.y) < 2) {
          bomb.carrier = a
          bomb.carrierId = a.id
          bomb.position.copy(a.position)
          events.emit('bomb:pickup', { actor: a })
          break
        }
      }
    }

    // Planting.
    if (bomb.plantingId !== null) {
      const a = this.mode.actorById(bomb.plantingId)
      if (!a || !this.wantsPlant(a) || this.siteAt(a)?.id !== this.plantSite || !this.holding(a)) this.cancelPlant()
      else {
        bomb.plantProgress = Math.min(1, bomb.plantProgress + dt / PLANT_TIME)
        if (bomb.plantProgress >= 1) this.plant(a)
      }
    }

    // Defusing.
    if (bomb.defusingId !== null) {
      const a = this.mode.actorById(bomb.defusingId)
      if (!a || !this.canDefuse(a) || !this.holding(a)) this.cancelDefuse()
      else {
        bomb.defuseProgress = Math.min(1, bomb.defuseProgress + dt / DEFUSE_TIME)
        if (bomb.defuseProgress >= 1) {
          bomb.defuseProgress = 0
          bomb.defusingId = null
          bomb.planted = false
          mode.addPoints(a, DEFUSE_POINTS, 'DEFUSED')
          events.emit('bomb:defused', { actor: a, site: bomb.site ?? 'A' })
          this.endRound(otherTeam(bomb.attackers), 'defused')
          return
        }
      }
    }

    // Fuse.
    if (bomb.planted) {
      bomb.fuseLeft -= dt
      if (bomb.fuseLeft <= 0) {
        bomb.fuseLeft = 0
        this.detonate()
        return
      }
    }
    this.checkWipe()
  }

  private holding(a: Actor) {
    _v.copy(a.velocity).setY(0)
    if (_v.length() > STILL_SPEED) return false
    // The local player must keep F held (when the real input is driving).
    if (a.isPlayer && this.game.input.state.useHeld === false) return false
    return true
  }

  private plant(a: Actor) {
    const bomb = this.mode.bomb!
    bomb.planted = true
    bomb.site = this.plantSite
    bomb.plantProgress = 0
    bomb.plantingId = null
    bomb.carrier = null
    bomb.carrierId = null
    bomb.fuseLeft = FUSE_TIME
    bomb.position.copy(a.position)
    this.planterId = a.id
    this.mode.addPoints(a, PLANT_POINTS, 'PLANTED')
    this.game.events.emit('bomb:planted', { actor: a, site: bomb.site ?? 'A', position: bomb.position.clone() })
    const ours = a.team === this.mode.playerTeam
    this.game.events.emit('match:announce', { text: 'BOMB PLANTED', sub: ours ? 'Defend the bomb' : 'Defuse the bomb', voice: 'sd_planted' })
  }

  private detonate() {
    const bomb = this.mode.bomb!
    const site = bomb.site ?? 'A'
    const pos = bomb.position.clone()
    this.game.events.emit('bomb:exploded', { site, position: pos.clone() })
    this.game.events.emit('grenade:explode', { position: pos.clone().setY(pos.y + 0.3), owner: null })
    // Lethal blast first (wipe checks suppressed so the deaths don't decide the round), then the result.
    this.blasting = true
    const planter = this.mode.actorById(this.planterId)
    for (const a of this.game.actors.slice()) {
      if (!a.alive) continue
      const d = a.position.distanceTo(pos)
      if (d > BLAST_RADIUS) continue
      const amount = d < BLAST_KILL_RADIUS ? 1000 : 150 * (1 - (d - BLAST_KILL_RADIUS) / (BLAST_RADIUS - BLAST_KILL_RADIUS))
      const attacker = planter && this.mode.isEnemy(planter, a) ? planter : null
      this.game.combat.applyDamage({
        victim: a, attacker, weaponId: 'frag', amount, zone: 'torso',
        direction: a.position.clone().sub(pos).normalize(), point: a.position.clone().setY(a.position.y + 1), explosive: true,
      })
    }
    this.blasting = false
    this.endRound(bomb.attackers, 'detonated')
  }

  onKill(info: DamageInfo, _suicide: boolean) {
    const bomb = this.mode.bomb
    if (!bomb) return
    const v = info.victim
    if (bomb.plantingId === v.id) this.cancelPlant()
    if (bomb.defusingId === v.id) this.cancelDefuse()
    if (bomb.carrier === v) this.drop(v)
    this.checkWipe()
  }

  private drop(a: Actor) {
    const bomb = this.mode.bomb!
    bomb.carrier = null
    bomb.carrierId = null
    bomb.position.copy(a.position)
    const g = this.game.collision.groundHeight(a.position.x, a.position.z, a.position.y + 1, 30)
    if (Number.isFinite(g)) bomb.position.y = g
    this.game.events.emit('bomb:dropped', { position: bomb.position.clone() })
  }

  private checkWipe() {
    if (this.roundOver || this.blasting || this.mode.phase !== 'playing') return
    const bomb = this.mode.bomb!
    const atk = this.teamMembers(bomb.attackers)
    const def = this.teamMembers(otherTeam(bomb.attackers))
    const atkAlive = atk.some((a) => a.alive)
    const defAlive = def.some((a) => a.alive)
    if (def.length && !defAlive) this.endRound(bomb.attackers, 'elimination')
    else if (atk.length && !atkAlive && !bomb.planted) this.endRound(otherTeam(bomb.attackers), 'elimination')
  }

  private endRound(winner: Team, reason: RoundEndReason) {
    if (this.roundOver) return
    const mode = this.mode
    const bomb = mode.bomb!
    this.roundOver = true
    this.roundEndIn = ROUND_END_DELAY
    this.lastRoundWinner = winner
    this.lastRoundReason = reason
    bomb.plantingId = bomb.defusingId = null
    bomb.plantProgress = bomb.defuseProgress = 0
    mode.score[winner]++
    this.game.events.emit('score:changed', { ...mode.score })
    this.game.events.emit('round:phase', { round: mode.round, phase: 'end', winner, attackers: bomb.attackers })
    const ours = winner === mode.playerTeam
    const why: Record<RoundEndReason, string> = {
      elimination: ours ? 'Enemies eliminated' : 'Your team was eliminated',
      detonated: 'Target destroyed',
      defused: 'Bomb defused',
      time: 'Time expired',
    }
    if (mode.score[winner] >= mode.settings.scoreLimit) {
      mode.endMatch(winner)
      return
    }
    this.game.events.emit('match:announce', { text: ours ? 'ROUND WIN' : 'ROUND LOSS', sub: why[reason], voice: ours ? 'round_win' : 'round_loss' })
  }

  private nextRound() {
    const mode = this.mode
    const prevAttackers = this.attackers
    mode.round++
    this.game.combat.clearGrenades()
    mode.clearRespawns()
    mode.lastSpawnUse.clear()
    this.startRound()
    for (const a of this.game.actors) mode.spawnActor(a, true)
    mode.introLeft = ROUND_INTRO
    mode.setPhase('intro')
    const atk = this.attackers === mode.playerTeam
    const swapped = this.attackers !== prevAttackers
    this.game.events.emit('match:announce', {
      text: swapped ? 'SWITCHING SIDES' : `ROUND ${mode.round}`,
      sub: atk ? 'Attack: destroy a target' : 'Defend: protect the targets',
      voice: swapped ? 'switching_sides' : 'round_start',
    })
  }

  // ─── Objective API ────────────────────────────────────────────────────────

  /** Bomb site the actor is standing in, if any. */
  siteAt(a: Actor): ObjectivePoint | null {
    for (const s of this.mode.bombSites) if (this.inRadius(a, s)) return s
    return null
  }

  private live() {
    return this.mode.phase === 'playing' && !this.roundOver
  }

  wantsPlant(a: Actor) {
    const bomb = this.mode.bomb
    return !!bomb && this.live() && a.alive && !bomb.planted && bomb.carrier === a && !!this.siteAt(a)
  }

  canDefuse(a: Actor) {
    const bomb = this.mode.bomb
    if (!bomb || !this.live() || !a.alive || !bomb.planted || a.team === bomb.attackers) return false
    return Math.hypot(a.position.x - bomb.position.x, a.position.z - bomb.position.z) <= DEFUSE_RADIUS && Math.abs(a.position.y - bomb.position.y) < 2.5
  }

  beginPlant(a: Actor) {
    const bomb = this.mode.bomb
    if (!bomb || !this.wantsPlant(a)) return false
    if (bomb.plantingId === a.id) return true
    bomb.plantingId = a.id
    bomb.plantProgress = 0
    this.plantSite = this.siteAt(a)!.id
    return true
  }

  beginDefuse(a: Actor) {
    const bomb = this.mode.bomb
    if (!bomb || !this.canDefuse(a)) return false
    if (bomb.defusingId === a.id) return true
    if (bomb.defusingId !== null) return false
    bomb.defusingId = a.id
    bomb.defuseProgress = 0
    return true
  }

  cancel(a: Actor) {
    const bomb = this.mode.bomb
    if (!bomb) return
    if (bomb.plantingId === a.id) this.cancelPlant()
    if (bomb.defusingId === a.id) this.cancelDefuse()
  }

  private cancelPlant() {
    const bomb = this.mode.bomb!
    bomb.plantingId = null
    bomb.plantProgress = 0
    this.plantSite = null
  }

  private cancelDefuse() {
    const bomb = this.mode.bomb!
    bomb.defusingId = null
    bomb.defuseProgress = 0
  }

  getNetState(): NetRules {
    return {
      firstAttackers: this.firstAttackers, roundOver: this.roundOver, roundEndIn: this.roundEndIn,
      plantSite: this.plantSite, planterId: this.planterId,
      lastRoundWinner: this.lastRoundWinner, lastRoundReason: this.lastRoundReason,
    }
  }

  applyNetState(s: NetRules) {
    if (s.firstAttackers === 'tf141' || s.firstAttackers === 'opfor') this.firstAttackers = s.firstAttackers
    this.roundOver = s.roundOver === true
    this.roundEndIn = typeof s.roundEndIn === 'number' ? s.roundEndIn : 0
    this.plantSite = (s.plantSite as ObjectiveId | null) ?? null
    this.planterId = typeof s.planterId === 'number' ? s.planterId : null
    this.lastRoundWinner = (s.lastRoundWinner as Team | 'draw' | null) ?? null
    this.lastRoundReason = (s.lastRoundReason as RoundEndReason | null) ?? null
  }
}
