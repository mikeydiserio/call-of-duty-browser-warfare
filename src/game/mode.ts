import { Vector3 } from 'three'
import { CONFIG } from '../core/config'
import type { MatchPhase } from '../core/events'
import type { Game } from '../core/game'
import type { Actor, DamageInfo, SpawnPoint, Team } from '../core/types'
import { otherTeam } from '../core/types'

const _eye = new Vector3()
const _p = new Vector3()

/** Team Deathmatch rules: scoring, spawning, respawn timers, killstreaks, UAV. */
export class TeamDeathmatch {
  phase: MatchPhase = 'menu'
  score: Record<Team, number> = { tf141: 0, opfor: 0 }
  timeLeft = CONFIG.timeLimit
  /** Countdown during the pre-match intro. */
  introLeft = 0
  /** Game time at which each team's UAV expires (0 = none). */
  uavUntil: Record<Team, number> = { tf141: 0, opfor: 0 }
  /** Killstreak rewards waiting to be called in by the local player. */
  playerStreaks: ('uav' | 'airstrike')[] = []
  winner: Team | 'draw' | null = null
  private respawnTimers = new Map<number, number>()
  private lastSpawnUse = new Map<SpawnPoint, number>()

  constructor(private game: Game) {}

  get playerTeam(): Team {
    return this.game.player.team
  }

  setPhase(phase: MatchPhase, winner?: Team | 'draw') {
    this.phase = phase
    this.game.events.emit('match:phase', { phase, winner })
  }

  /** Reset scores and spawn everyone; begins the frozen intro countdown. */
  begin() {
    this.score = { tf141: 0, opfor: 0 }
    this.timeLeft = CONFIG.timeLimit
    this.uavUntil = { tf141: 0, opfor: 0 }
    this.playerStreaks = []
    this.winner = null
    this.respawnTimers.clear()
    this.lastSpawnUse.clear()
    for (const a of this.game.actors) {
      a.stats = { kills: 0, deaths: 0, assists: 0, score: 0, streak: 0, shotsFired: 0, shotsHit: 0, headshots: 0 }
    }
    for (const a of this.game.actors) this.spawnActor(a, true)
    this.introLeft = 4
    this.setPhase('intro')
    this.game.events.emit('score:changed', { ...this.score })
    this.game.events.emit('match:announce', { text: 'TEAM DEATHMATCH', sub: 'Kill enemy players. First to 75 kills wins.', voice: 'tdm_intro' })
  }

  update(dt: number) {
    if (this.phase === 'intro') {
      this.introLeft -= dt
      if (this.introLeft <= 0) {
        this.setPhase('playing')
        this.game.events.emit('match:announce', { text: 'FIGHT', voice: 'match_start' })
      }
      return
    }
    if (this.phase !== 'playing') return
    this.timeLeft -= dt
    if (this.timeLeft <= 0) {
      this.timeLeft = 0
      this.end()
      return
    }
    for (const [id, t] of this.respawnTimers) {
      const left = t - dt
      if (left <= 0) {
        this.respawnTimers.delete(id)
        const a = this.game.actors.find((x) => x.id === id)
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
  }

  /** Seconds until the given actor respawns (0 if alive / unknown). */
  respawnIn(actor: Actor): number {
    return this.respawnTimers.get(actor.id) ?? 0
  }

  /** Player requested an instant respawn (press fire after the minimum delay). */
  requestRespawn(actor: Actor) {
    const t = this.respawnTimers.get(actor.id)
    if (t !== undefined && t < CONFIG.respawnDelay - 1.6) this.respawnTimers.set(actor.id, 0)
  }

  onKill(info: DamageInfo, suicide: boolean) {
    const victim = info.victim
    const killer = info.attacker
    if (!suicide && killer && killer.team !== victim.team) {
      this.score[killer.team]++
      this.game.events.emit('score:changed', { ...this.score })
      this.checkStreak(killer)
      if (this.score[killer.team] >= CONFIG.scoreLimit) {
        this.end()
        return
      }
      // Lead-change / near-win announcer lines.
      const s = this.score[killer.team]
      if (s === CONFIG.scoreLimit - 5) {
        const ours = killer.team === this.playerTeam
        this.game.events.emit('match:announce', { text: ours ? 'FIVE KILLS TO WIN' : 'ENEMY FIVE KILLS FROM VICTORY', voice: ours ? 'near_win' : 'near_loss' })
      }
    } else if (suicide) {
      this.score[victim.team] = Math.max(0, this.score[victim.team] - 1)
      this.game.events.emit('score:changed', { ...this.score })
    }
    this.respawnTimers.set(victim.id, CONFIG.respawnDelay)
  }

  /** Player activates the oldest held killstreak. */
  usePlayerStreak() {
    const s = this.playerStreaks.shift()
    if (!s) return
    this.activateStreak(this.game.player, s)
  }

  isUavActive(team: Team) {
    return this.uavUntil[team] > this.game.time
  }

  private checkStreak(killer: Actor) {
    const streak = killer.stats.streak
    let reward: 'uav' | 'airstrike' | null = null
    if (streak === CONFIG.uavStreak) reward = 'uav'
    if (!reward) return
    this.game.events.emit('killstreak:earned', { actor: killer, streak: reward })
    if (killer.isPlayer) this.playerStreaks.push(reward)
    else window.setTimeout(() => this.phase === 'playing' && this.activateStreak(killer, reward), 1500 + Math.random() * 2500)
  }

  private activateStreak(actor: Actor, streak: 'uav' | 'airstrike') {
    if (streak === 'uav') {
      const team = actor.team
      this.uavUntil[team] = Math.max(this.uavUntil[team], this.game.time) + CONFIG.uavDuration
      this.game.events.emit('killstreak:used', { actor, streak, team })
      this.game.events.emit('uav:changed', { team, active: true, until: this.uavUntil[team] })
    }
  }

  private end() {
    const a = this.score.tf141
    const b = this.score.opfor
    this.winner = a === b ? 'draw' : a > b ? 'tf141' : 'opfor'
    this.setPhase('ended', this.winner)
  }

  /** Pick the safest spawn for this actor's team and spawn it. */
  spawnActor(actor: Actor, initial = false) {
    const spawn = this.chooseSpawn(actor.team, initial)
    this.lastSpawnUse.set(spawn, this.game.time)
    _p.copy(spawn.position)
    // Small jitter so simultaneous initial spawns do not overlap.
    if (initial) {
      _p.x += (Math.random() - 0.5) * 0.6
      _p.z += (Math.random() - 0.5) * 0.6
    }
    actor.health = actor.maxHealth
    actor.alive = true
    actor.timeSinceDamage = 99
    actor.spawn(_p.clone(), spawn.yaw)
    this.game.events.emit('actor:spawned', { actor })
  }

  private chooseSpawn(team: Team, initial: boolean): SpawnPoint {
    const spawns = this.game.map.spawns
    const own = spawns.filter((s) => s.team === team)
    const any = spawns.filter((s) => s.team === 'any')
    if (initial && own.length) {
      // Initial spawns: cycle through the team's base spawns.
      const sorted = own.slice().sort((x, y) => (this.lastSpawnUse.get(x) ?? -1) - (this.lastSpawnUse.get(y) ?? -1))
      return sorted[0]!
    }
    const candidates = [...own, ...any]
    const enemies = this.game.actors.filter((a) => a.alive && a.team === otherTeam(team))
    const friends = this.game.actors.filter((a) => a.alive && a.team === team)
    let best = candidates[0]!
    let bestScore = -Infinity
    for (const s of candidates) {
      let score = 0
      _p.copy(s.position).setY(s.position.y + 1.6)
      for (const e of enemies) {
        const d = e.position.distanceTo(s.position)
        score += Math.min(d, 30) * 0.8
        if (d < 10) score -= 60
        e.getEyePosition(_eye)
        if (d < 45 && this.game.collision.lineOfSight(_eye, _p)) score -= 80
      }
      for (const f of friends) {
        const d = f.position.distanceTo(s.position)
        if (d < 14) score += 8
      }
      const lastUse = this.lastSpawnUse.get(s)
      if (lastUse !== undefined && this.game.time - lastUse < 6) score -= 40
      score += Math.random() * 6
      if (score > bestScore) {
        bestScore = score
        best = s
      }
    }
    return best
  }
}
