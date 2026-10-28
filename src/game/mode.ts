import { Vector3 } from 'three'
import { CONFIG } from '../core/config'
import type { MatchPhase } from '../core/events'
import type { Game } from '../core/game'
import type {
  Actor,
  BombState,
  DamageInfo,
  GameModeId,
  MatchSettings,
  ObjectiveId,
  ObjectivePoint,
  ObjectiveState,
  SpawnPoint,
  Team,
} from '../core/types'
import { DominationRules } from './modes/dom'
import { FreeForAllRules } from './modes/ffa'
import type { ModeRules } from './modes/rules'
import { SearchDestroyRules } from './modes/sd'
import { TeamDeathmatchRules } from './modes/tdm'

const _p = new Vector3()

/** Plain-JSON snapshot of all mode state (for the net layer). Vectors are [x, y, z]. */
export interface ModeNetState {
  id: GameModeId
  phase: MatchPhase
  round: number
  score: Record<Team, number>
  timeLeft: number
  introLeft: number
  winner: Team | 'draw' | null
  winnerActorId: number | null
  placings: number[]
  uavUntil: Record<Team, number>
  uavActorUntil: Record<number, number>
  respawn: [number, number][]
  objectives: { id: ObjectiveId; owner: Team | null; capturingTeam: Team | null; progressTeam: Team | null; progress: number; contested: boolean }[]
  bomb: {
    attackers: Team
    carrierId: number | null
    plantingId: number | null
    defusingId: number | null
    position: [number, number, number]
    planted: boolean
    site: ObjectiveId | null
    fuseLeft: number
    plantProgress: number
    defuseProgress: number
  } | null
  rules: Record<string, number | string | boolean | null>
}

/**
 * Match rules facade: phase, scoring, spawning, respawn timers, killstreaks, UAV
 * and the objective APIs. Shared logic lives here; per-mode rules (TDM / FFA /
 * Domination / S&D) live in `./modes/*` and are picked from `game.match.mode`
 * in `begin()`. `game.mode` is the one public object everyone reads.
 */
export class GameMode {
  /** Active mode for the current/next match (set from game.match in begin()). */
  id: GameModeId = 'tdm'
  phase: MatchPhase = 'menu'
  /** Domination flags (empty unless id === 'dom'). */
  objectives: ObjectiveState[] = []
  /** S&D bomb sites (empty unless id === 'sd'). */
  bombSites: ObjectivePoint[] = []
  /** Search & Destroy bomb (null unless id === 'sd'). */
  bomb: BombState | null = null
  /** Current round (S&D), 1-based; 1 for non-round modes. */
  round = 1
  /**
   * Team scores: kills (TDM), flag points (DOM), round wins (S&D).
   * FFA: [player team] = local player's kills, [other team] = best opponent's kills (so team-style HUDs stay meaningful).
   */
  score: Record<Team, number> = { tf141: 0, opfor: 0 }
  /** Match clock, or the round clock in S&D (frozen while the bomb is planted). */
  timeLeft = CONFIG.timeLimit
  /** Countdown during the pre-match (or pre-round) intro. */
  introLeft = 0
  /** Game time at which each team's UAV expires (0 = none). Team modes only. */
  uavUntil: Record<Team, number> = { tf141: 0, opfor: 0 }
  /** FFA: game time at which each actor's own UAV expires (by actor id). */
  uavActorUntil: Record<number, number> = {}
  /** Team-mode winner. FFA: the player's team if the player won, the other team if not, 'draw' on a tie. */
  winner: Team | 'draw' | null = null
  /** FFA winner (null in team modes or on a tie). */
  winnerActor: Actor | null = null
  /** Actor ids sorted by final standing (filled at match end; FFA end screen uses the top 3). */
  placingIds: number[] = []
  rules: ModeRules = new TeamDeathmatchRules(this)
  private respawnTimers = new Map<number, number>()
  readonly lastSpawnUse = new Map<SpawnPoint, number>()

  constructor(readonly game: Game) {}

  get playerTeam(): Team {
    return this.game.player.team
  }

  get settings(): MatchSettings {
    return this.game.match
  }

  /** True for team modes; false in Free-for-All. */
  get isTeamMode(): boolean {
    return this.id !== 'ffa'
  }

  /** False in round-based modes (S&D): the dead spectate until the next round. */
  get canRespawn(): boolean {
    return this.rules.respawns
  }

  /** Use this instead of comparing `team` directly: in FFA everyone but yourself is an enemy. */
  isEnemy(a: Actor, b: Actor): boolean {
    if (a === b) return false
    return this.isTeamMode ? a.team !== b.team : true
  }

  actorById(id: number | null | undefined): Actor | null {
    if (id === null || id === undefined) return null
    return this.game.actors.find((a) => a.id === id) ?? null
  }

  /** Final (or live) standings, best first: score/kills, then fewest deaths. */
  get placings(): Actor[] {
    if (this.placingIds.length) return this.placingIds.map((id) => this.actorById(id)).filter((a): a is Actor => !!a)
    return this.rankActors()
  }

  rankActors(): Actor[] {
    const key = this.isTeamMode ? (a: Actor) => a.stats.score : (a: Actor) => a.stats.kills
    return this.game.actors.slice().sort((a, b) => key(b) - key(a) || a.stats.deaths - b.stats.deaths || a.id - b.id)
  }

  setPhase(phase: MatchPhase, winner?: Team | 'draw') {
    this.phase = phase
    this.game.events.emit('match:phase', { phase, winner })
  }

  /** Reset scores, build the rules for game.match.mode, spawn everyone and begin the intro countdown. */
  begin() {
    this.id = this.game.match.mode
    this.rules = createRules(this.id, this)
    this.objectives = []
    this.bombSites = []
    this.bomb = null
    this.round = 1
    this.score = { tf141: 0, opfor: 0 }
    this.timeLeft = this.game.match.timeLimit
    this.uavUntil = { tf141: 0, opfor: 0 }
    this.uavActorUntil = {}
    this.winner = null
    this.winnerActor = null
    this.placingIds = []
    this.respawnTimers.clear()
    this.lastSpawnUse.clear()
    for (const a of this.game.actors) {
      a.stats = { kills: 0, deaths: 0, assists: 0, score: 0, streak: 0, shotsFired: 0, shotsHit: 0, headshots: 0 }
    }
    this.rules.begin()
    for (const a of this.game.actors) this.spawnActor(a, true)
    this.introLeft = 4
    this.setPhase('intro')
    this.game.events.emit('score:changed', { ...this.score })
    this.game.events.emit('match:announce', this.rules.intro())
  }

  update(dt: number) {
    if (this.phase === 'intro') {
      this.introLeft -= dt
      if (this.introLeft <= 0) {
        this.introLeft = 0
        this.setPhase('playing')
        this.game.events.emit('match:announce', { text: 'FIGHT', voice: 'match_start' })
        this.rules.onPlayStart()
      }
      return
    }
    if (this.phase !== 'playing') return
    if (!this.rules.clockPaused()) {
      this.timeLeft -= dt
      if (this.timeLeft <= 0) {
        this.timeLeft = 0
        this.rules.onTimeUp()
        if (this.phase !== 'playing') return
      }
    }
    for (const [id, t] of this.respawnTimers) {
      const left = t - dt
      if (left <= 0) {
        this.respawnTimers.delete(id)
        const a = this.actorById(id)
        if (a && !a.alive) this.spawnActor(a)
      } else this.respawnTimers.set(id, left)
    }
    const now = this.game.time
    for (const team of ['tf141', 'opfor'] as Team[]) {
      if (this.uavUntil[team] > 0 && now > this.uavUntil[team]) {
        this.uavUntil[team] = 0
        this.game.events.emit('uav:changed', { team, active: false, until: 0 })
      }
    }
    for (const key in this.uavActorUntil) {
      const id = Number(key)
      if (now > this.uavActorUntil[id]!) {
        delete this.uavActorUntil[id]
        if (id === this.game.player.id) this.game.events.emit('uav:changed', { team: this.playerTeam, active: false, until: 0 })
      }
    }
    // F to plant / defuse (S&D) — polled here so the player controller stays untouched.
    const input = this.game.input.state
    if (input.usePressed && this.game.player.alive) this.use(this.game.player)
    this.rules.update(dt)
  }

  /** Seconds until the given actor respawns (0 if alive / unknown / no respawns this round). */
  respawnIn(actor: Actor): number {
    return this.respawnTimers.get(actor.id) ?? 0
  }

  /** Player requested an instant respawn (press fire after the minimum delay). */
  requestRespawn(actor: Actor) {
    const t = this.respawnTimers.get(actor.id)
    if (t !== undefined && t < CONFIG.respawnDelay - 1.6) this.respawnTimers.set(actor.id, 0)
  }

  /** Queue a respawn (no-op in modes without respawns). */
  scheduleRespawn(actor: Actor, delay = CONFIG.respawnDelay) {
    if (this.rules.respawns) this.respawnTimers.set(actor.id, delay)
  }

  clearRespawns() {
    this.respawnTimers.clear()
  }

  onKill(info: DamageInfo, suicide: boolean) {
    const killer = info.attacker
    if (!suicide) this.game.streaks.onKill(killer, info.victim)
    this.rules.onKill(info, suicide)
    if (this.phase === 'playing') this.scheduleRespawn(info.victim)
  }

  /** Award score to an actor; shows the "+N" popup for the local player. */
  addPoints(actor: Actor, amount: number, reason: string) {
    actor.stats.score += amount
    if (actor.isPlayer) this.game.events.emit('player:points', { amount, reason })
  }

  // ─── UAV (rewards themselves live in game.streaks) ────────────────────────

  /**
   * Team UAV. In FFA there are no team UAVs: this is true only for the local player's
   * team while the local player's own UAV is up (so the HUD label works); use
   * `isUavActiveFor(actor)` / `uavReveals(viewer, target)` for anything per-actor.
   */
  isUavActive(team: Team) {
    if (!this.isTeamMode) return team === this.playerTeam && this.isUavActiveFor(this.game.player)
    return this.uavUntil[team] > this.game.time
  }

  /** Whether `actor` currently benefits from a UAV (their team's, or their own in FFA). Counter-UAV / EMP jam it. */
  isUavActiveFor(actor: Actor) {
    if (this.game.streaks.jammed(actor)) return false
    if (!this.isTeamMode) return (this.uavActorUntil[actor.id] ?? 0) > this.game.time
    return this.uavUntil[actor.team] > this.game.time
  }

  /** UAV sweep shows `target` to `viewer` (enemy + viewer's UAV up). FFA: only the caller sees everyone. */
  uavReveals(viewer: Actor, target: Actor) {
    return target.alive && this.isEnemy(viewer, target) && this.isUavActiveFor(viewer)
  }

  /** UAV killstreak: 30 s sweep for the caller's team (the caller alone in FFA). */
  activateUav(actor: Actor) {
    const team = actor.team
    if (!this.isTeamMode) {
      const until = Math.max(this.uavActorUntil[actor.id] ?? 0, this.game.time) + CONFIG.uavDuration
      this.uavActorUntil[actor.id] = until
      if (actor.isPlayer) this.game.events.emit('uav:changed', { team, active: true, until })
      return
    }
    this.uavUntil[team] = Math.max(this.uavUntil[team], this.game.time) + CONFIG.uavDuration
    this.game.events.emit('uav:changed', { team, active: true, until: this.uavUntil[team] })
  }

  /** The caller's UAV drone was shot down. */
  cancelUav(actor: Actor) {
    if (!this.isTeamMode) {
      delete this.uavActorUntil[actor.id]
      if (actor.isPlayer) this.game.events.emit('uav:changed', { team: actor.team, active: false, until: 0 })
      return
    }
    this.cancelUavTeam(actor.team, null)
  }

  /** EMP: knock out a team's UAV (FFA: everyone's but `except`'s). */
  cancelUavTeam(team: Team, except: Actor | null) {
    if (!this.isTeamMode) {
      for (const key in this.uavActorUntil) if (Number(key) !== except?.id) delete this.uavActorUntil[Number(key)]
      return
    }
    if (this.uavUntil[team] <= 0) return
    this.uavUntil[team] = 0
    this.game.events.emit('uav:changed', { team, active: false, until: 0 })
  }

  // ─── Match end ────────────────────────────────────────────────────────────

  /** End the match. Team modes pass the winning team; FFA passes the winning actor (null = tie). */
  endMatch(winner: Team | 'draw', winnerActor: Actor | null = null) {
    if (this.phase === 'ended') return
    this.winner = winner
    this.winnerActor = winnerActor
    this.placingIds = this.rankActors().map((a) => a.id)
    this.respawnTimers.clear()
    this.setPhase('ended', winner)
  }

  /** Winner by team score (draw on a tie). */
  endByScore() {
    const a = this.score.tf141
    const b = this.score.opfor
    this.endMatch(a === b ? 'draw' : a > b ? 'tf141' : 'opfor')
  }

  // ─── Objective API (S&D; harmless no-ops in other modes) ───────────────────

  /** True if `actor` carries the bomb and stands inside a bomb site (S&D attackers). */
  wantsPlant(actor: Actor): boolean {
    return this.rules.wantsPlant(actor)
  }

  /** True if `actor` is a defender close enough to the planted bomb to defuse it. */
  canDefuse(actor: Actor): boolean {
    return this.rules.canDefuse(actor)
  }

  /** Start planting (~5 s). The actor must stay inside the site and (nearly) still; returns false if not allowed. */
  beginPlant(actor: Actor): boolean {
    return this.rules.beginPlant(actor)
  }

  /** Start defusing (~7.5 s). The actor must stay by the bomb and (nearly) still. */
  beginDefuse(actor: Actor): boolean {
    return this.rules.beginDefuse(actor)
  }

  /** Abort the actor's in-progress plant or defuse. */
  cancel(actor: Actor) {
    this.rules.cancel(actor)
  }

  /** "Use" key: plants or defuses whichever applies. */
  use(actor: Actor): boolean {
    return this.beginPlant(actor) || this.beginDefuse(actor)
  }

  /** Who a dead actor should spectate (S&D): alive teammates (anyone in FFA), cycled by `index`. Null if none. */
  spectateTarget(actor: Actor, index = 0): Actor | null {
    const pool = this.game.actors.filter((a) => a !== actor && a.alive && !this.isEnemy(actor, a))
    const list = pool.length || this.isTeamMode ? pool : this.game.actors.filter((a) => a !== actor && a.alive)
    if (!list.length) return null
    list.sort((a, b) => a.id - b.id)
    return list[((index % list.length) + list.length) % list.length]!
  }

  // ─── Spawning ─────────────────────────────────────────────────────────────

  /** Pick a spawn via the mode rules and spawn the actor there. */
  spawnActor(actor: Actor, initial = false) {
    const spawn = this.rules.chooseSpawn(actor, initial)
    this.lastSpawnUse.set(spawn, this.game.time)
    _p.copy(spawn.position)
    // Small jitter so simultaneous initial spawns do not overlap.
    if (initial) {
      _p.x += (Math.random() - 0.5) * 0.6
      _p.z += (Math.random() - 0.5) * 0.6
    }
    this.respawnTimers.delete(actor.id)
    actor.health = actor.maxHealth
    actor.alive = true
    actor.timeSinceDamage = 99
    actor.spawn(_p.clone(), spawn.yaw)
    this.game.events.emit('actor:spawned', { actor })
  }

  // ─── Net snapshot ─────────────────────────────────────────────────────────

  getNetState(): ModeNetState {
    const b = this.bomb
    return {
      id: this.id,
      phase: this.phase,
      round: this.round,
      score: { ...this.score },
      timeLeft: this.timeLeft,
      introLeft: this.introLeft,
      winner: this.winner,
      winnerActorId: this.winnerActor?.id ?? null,
      placings: this.placingIds.slice(),
      uavUntil: { ...this.uavUntil },
      uavActorUntil: { ...this.uavActorUntil },
      respawn: [...this.respawnTimers],
      objectives: this.objectives.map((o) => ({
        id: o.id, owner: o.owner, capturingTeam: o.capturingTeam, progressTeam: o.progressTeam, progress: o.progress, contested: o.contested,
      })),
      bomb: b && {
        attackers: b.attackers, carrierId: b.carrierId, plantingId: b.plantingId, defusingId: b.defusingId,
        position: [b.position.x, b.position.y, b.position.z], planted: b.planted, site: b.site, fuseLeft: b.fuseLeft,
        plantProgress: b.plantProgress, defuseProgress: b.defuseProgress,
      },
      rules: this.rules.getNetState(),
    }
  }

  /** Client side: mirror the host's snapshot (does not emit events or spawn actors). */
  applyNetState(s: ModeNetState) {
    if (s.id !== this.id || this.rules.id !== s.id) {
      this.id = s.id
      this.rules = createRules(s.id, this)
      this.rules.begin()
    }
    this.phase = s.phase
    this.round = s.round
    this.score = { ...s.score }
    this.timeLeft = s.timeLeft
    this.introLeft = s.introLeft
    this.winner = s.winner
    this.winnerActor = this.actorById(s.winnerActorId)
    this.placingIds = s.placings.slice()
    this.uavUntil = { ...s.uavUntil }
    this.uavActorUntil = { ...s.uavActorUntil }
    this.respawnTimers = new Map(s.respawn)
    for (const o of s.objectives) {
      const t = this.objectives.find((x) => x.id === o.id)
      if (t) Object.assign(t, o)
    }
    if (s.bomb && this.bomb) {
      const b = this.bomb
      Object.assign(b, { ...s.bomb, position: b.position.set(...s.bomb.position) })
      b.carrier = this.actorById(s.bomb.carrierId)
    }
    this.rules.applyNetState(s.rules)
  }
}

function createRules(id: GameModeId, mode: GameMode): ModeRules {
  switch (id) {
    case 'ffa':
      return new FreeForAllRules(mode)
    case 'dom':
      return new DominationRules(mode)
    case 'sd':
      return new SearchDestroyRules(mode)
    default:
      return new TeamDeathmatchRules(mode)
  }
}

/** @deprecated use GameMode. */
export const TeamDeathmatch = GameMode
