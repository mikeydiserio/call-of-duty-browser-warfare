import { Vector3 } from 'three'
import { Bot } from '../ai/bot'
import type { GameEvents } from '../core/events'
import type { Game } from '../core/game'
import type { Actor, Loadout, MatchSettings, PerkId, Team, WeaponId } from '../core/types'
import { KILLSTREAKS, type KillstreakId, normalizeKillstreaks } from '../game/killstreaks/defs'
import { WEAPONS } from '../weapons/defs'
import type { NetHooks } from './hooks'
import type { PeerLink } from './peer'
import {
  type ActorState, decodePose, encodeSnapshot, encodeValue, F_ADS, F_ALIVE, F_GROUNDED, F_OPFOR, F_RELOAD, F_SPRINT,
  F_STANCE_SHIFT, MSG_POSE, type ReliableMsg, type RosterEntry, type Snapshot, v3,
} from './protocol'
import { RemotePlayer } from './remote-player'

/** A connected client, as tracked by the host's lobby. */
export interface HostPeer {
  pid: string
  name: string
  netId: number
  link: PeerLink
  loadout: Loadout | null
  /** Team chosen in the lobby (null = auto). */
  wantTeam: Team | null
  /** Team assigned for the current match. */
  team: Team
  ready: boolean
  ping: number
  /** Reliable messages waiting for this frame's batch. */
  queue: ReliableMsg[]
}

/** Events replicated to clients (they re-emit them so HUD / FX / audio work unchanged). */
const RELAY: (keyof GameEvents)[] = [
  'weapon:fire', 'weapon:melee', 'bullet:tracer', 'bullet:impact', 'actor:damaged', 'actor:killed', 'grenade:explode',
  'score:changed', 'killstreak:earned', 'killstreak:used', 'killstreak:state', 'killstreak:sound', 'uav:changed', 'match:phase', 'match:announce',
  'objective:state', 'objective:captured', 'bomb:pickup', 'bomb:dropped', 'bomb:planted', 'bomb:defused', 'bomb:exploded',
  'round:phase',
]
/** Client already predicted these for its own shots. */
const PREDICTED = new Set<string>(['weapon:fire', 'weapon:melee', 'bullet:tracer', 'bullet:impact'])

const SNAPSHOT_HZ = 20
const _eye = new Vector3()

/**
 * Host-side match authority: owns RemotePlayer proxies for every client, validates and
 * resolves their requests with the normal Combat code, broadcasts 20 Hz snapshots and
 * relays gameplay events.
 */
export class HostSession implements NetHooks {
  readonly remotes = new Map<string, RemotePlayer>()
  /** Events emitted while this is set (our own startMatch) are not relayed: clients generate them locally. */
  private suppress = false
  private offs: (() => void)[] = []
  private snapT = 0
  private slowT = 0
  private seq = 0
  /** Measured outgoing bytes per second (all peers). */
  bytesPerSec = 0
  private bytesAcc = 0
  private bytesT = 0
  seed = 0
  /** Debug counters (fire requests received / rejected by validation). */
  counters = { fire: 0, rejected: 0 }

  constructor(
    private game: Game,
    private peers: () => HostPeer[],
  ) {
    for (const k of RELAY) this.offs.push(game.events.on(k, (p) => this.relay(k, p)))
  }

  dispose() {
    for (const off of this.offs) off()
    this.offs = []
    this.removeAllRemotes()
  }

  // ─── Match start ──────────────────────────────────────────────────────────

  /** Assign teams, build proxies, start locally and tell every client. */
  start(settings: MatchSettings, hostTeamWish: Team | null) {
    this.seed = (Math.random() * 2 ** 31) | 0
    const peers = this.peers().filter((p) => p.link.open)
    // Teams: honour choices, auto-balance the rest.
    const count: Record<Team, number> = { tf141: 0, opfor: 0 }
    const humans: { wish: Team | null; set: (t: Team) => void }[] = [
      { wish: hostTeamWish, set: (t) => ((this.game.player as { team: Team }).team = t) },
      ...peers.map((p) => ({ wish: p.wantTeam, set: (t: Team) => (p.team = t) })),
    ]
    for (const h of humans) if (h.wish) count[h.wish]++
    for (const h of humans) {
      if (h.wish) h.set(h.wish)
      else {
        const t: Team = count.tf141 <= count.opfor ? 'tf141' : 'opfor'
        count[t]++
        h.set(t)
      }
    }
    if (settings.mode === 'ffa') {
      // Teams only pick the uniform in FFA; split for variety.
      humans.forEach((h, i) => h.set(i % 2 ? 'opfor' : 'tf141'))
    }
    this.removeAllRemotes()
    for (const p of peers) this.addRemote(p)

    this.suppress = true
    try {
      this.game.startMatch(this.game.loadout, settings)
    } finally {
      this.suppress = false
    }
    const roster = this.roster()
    for (const p of peers) {
      p.link.sendReliable({ t: 'start', settings, seed: this.seed, you: p.netId, team: p.team, roster, phase: this.game.mode.phase, inProgress: false })
    }
    this.flush()
  }

  /** A client connected while the match is running: build its proxy and spawn it. */
  joinInProgress(p: HostPeer) {
    const g = this.game
    // Join the smaller team (team modes).
    const n: Record<Team, number> = { tf141: 0, opfor: 0 }
    for (const a of g.actors) n[a.team]++
    p.team = p.wantTeam ?? (n.tf141 <= n.opfor ? 'tf141' : 'opfor')
    const r = this.addRemote(p)
    g.actors.push(r)
    this.refreshBotMemories()
    p.link.sendReliable({ t: 'start', settings: g.match, seed: this.seed, you: p.netId, team: p.team, roster: this.roster(), phase: g.mode.phase, inProgress: true })
    this.broadcastRoster()
    if (g.mode.id === 'sd' && g.mode.phase === 'playing') {
      // Round-based: wait for the next round.
      r.alive = false
      p.queue.push({ t: 'respawnIn', s: -1 })
    } else g.mode.spawnActor(r)
  }

  /** A client left mid-match. */
  removePeer(pid: string) {
    const r = this.remotes.get(pid)
    if (!r) return
    this.remotes.delete(pid)
    this.game.actors = this.game.actors.filter((a) => a !== r)
    r.dispose()
    this.refreshBotMemories()
    this.broadcastRoster()
  }

  private addRemote(p: HostPeer): RemotePlayer {
    const lo = p.loadout ?? { primary: 'm4a1', secondary: 'usp45', perks: [] }
    const r = new RemotePlayer(this.game, p.netId, p.name, p.team, lo.primary, false)
    r.perks = lo.perks
    r.killstreaks = normalizeKillstreaks(lo.killstreaks)
    r.onSpawn = (pos, yaw) => p.queue.push({ t: 'spawn', p: v3(pos), yaw })
    this.remotes.set(p.pid, r)
    return r
  }

  private removeAllRemotes() {
    for (const r of this.remotes.values()) r.dispose()
    this.remotes.clear()
  }

  private refreshBotMemories() {
    for (const b of this.game.bots.bots) if (b instanceof Bot) b.initMemories(this.game.actors)
  }

  private roster(): RosterEntry[] {
    return this.game.actors.map((a) => {
      const lo = a === this.game.player ? this.game.loadout : null
      const prof = a instanceof Bot ? a.profile : null
      return {
        id: a.id,
        name: a === this.game.player ? this.hostName() : a.name,
        team: a.team,
        bot: a instanceof Bot,
        primary: (prof?.primary ?? lo?.primary ?? a.weaponId) as WeaponId,
        secondary: (prof?.secondary ?? lo?.secondary ?? 'usp45') as WeaponId,
      }
    })
  }

  hostName = () => 'Host'

  broadcastRoster() {
    const roster = this.roster()
    for (const p of this.peers()) p.queue.push({ t: 'roster', roster })
  }

  // ─── NetHooks ─────────────────────────────────────────────────────────────

  matchActors(bots: Actor[]): Actor[] {
    const all = [this.game.player, ...bots, ...this.remotes.values()]
    for (const b of bots) if (b instanceof Bot) b.initMemories(all)
    return all
  }

  onShot() {}
  onMelee() {}

  onGrenade(owner: Actor, origin: Vector3, velocity: Vector3, fuse: number) {
    const msg: ReliableMsg = { t: 'gthrow', owner: owner.id, o: v3(origin), v: v3(velocity), fuse }
    for (const p of this.peers()) if (p.netId !== owner.id) p.queue.push(msg)
  }

  perksOf(actor: Actor): PerkId[] | null {
    return actor instanceof RemotePlayer ? actor.perks : null
  }

  killstreaksOf(actor: Actor): KillstreakId[] | null {
    return actor instanceof RemotePlayer ? actor.killstreaks : null
  }

  update(dt: number) {
    const g = this.game
    const now = performance.now() / 1000
    const inMatch = g.mode.phase !== 'menu'
    if (inMatch) for (const r of this.remotes.values()) r.update(dt, now)
    this.snapT += dt
    if (inMatch && this.snapT >= 1 / SNAPSHOT_HZ) {
      this.snapT = 0
      const buf = encodeSnapshot(this.snapshot())
      for (const p of this.peers()) p.link.sendState(buf)
    }
    this.slowT += dt
    if (inMatch && this.slowT >= 1) {
      this.slowT = 0
      const s = g.actors.map((a) => [a.id, a.stats.kills, a.stats.deaths, a.stats.assists, a.stats.score, a.stats.streak] as [number, number, number, number, number, number])
      for (const p of this.peers()) {
        p.queue.push({ t: 'stats', s })
        const r = this.remotes.get(p.pid)
        if (r && !r.alive && g.mode.phase === 'playing') p.queue.push({ t: 'respawnIn', s: g.mode.respawnIn(r) })
      }
    }
    this.flush()
    // Bandwidth meter.
    this.bytesT += dt
    if (this.bytesT >= 1) {
      let total = 0
      for (const p of this.peers()) total += p.link.bytesOut
      this.bytesPerSec = (total - this.bytesAcc) / this.bytesT
      this.bytesAcc = total
      this.bytesT = 0
    }
  }

  private flush() {
    const h = this.game.time
    for (const p of this.peers()) {
      if (!p.queue.length) continue
      const list = p.queue.splice(0)
      p.link.sendReliable(list.length === 1 && list[0]!.t !== 'ev' ? list[0]! : { t: 'batch', m: list, h })
    }
  }

  private snapshot(): Snapshot {
    const g = this.game
    const m = g.mode
    const actors: ActorState[] = g.actors.map((a) => ({
      id: a.id,
      x: a.position.x,
      y: a.position.y,
      z: a.position.z,
      yaw: a.yaw,
      pitch: a.pitch,
      flags: actorFlags(a, g),
      weapon: a.weaponId,
      health: a.health,
    }))
    const b = m.bomb
    return {
      seq: this.seq++,
      timeLeft: m.timeLeft,
      introLeft: m.introLeft,
      score: m.score,
      round: m.round,
      uav: { tf141: Math.max(0, m.uavUntil.tf141 - g.time), opfor: Math.max(0, m.uavUntil.opfor - g.time) },
      actors,
      objectives: m.objectives.map((o) => ({ id: o.id, owner: o.owner, capturing: o.capturingTeam, progress: o.progress, contested: o.contested })),
      bomb: b
        ? {
            carrier: b.carrier ? b.carrier.id : 0xffff, x: b.position.x, y: b.position.y, z: b.position.z, planted: b.planted,
            site: b.site, fuseLeft: b.fuseLeft, plant: b.plantProgress, defuse: b.defuseProgress, attackers: b.attackers,
          }
        : null,
    }
  }

  // ─── Event relay ──────────────────────────────────────────────────────────

  private relay(k: keyof GameEvents, payload: unknown) {
    if (this.suppress || !this.peers().length) return
    const enc = encodeValue(payload, (a) => a.id)
    const p = payload as Record<string, unknown>
    const owner = (p.shooter ?? p.actor ?? null) as Actor | null
    const extra: { h?: number } = {}
    if (k === 'actor:damaged' || k === 'actor:killed') extra.h = (p.victim as Actor).health
    for (const peer of this.peers()) {
      const remote = this.remotes.get(peer.pid)
      if (PREDICTED.has(k) && owner && remote && owner === remote) continue
      peer.queue.push({ t: 'ev', k, p: enc, ...extra })
    }
    // Feedback that only the attacking client's HUD shows.
    if (k === 'actor:damaged' || k === 'actor:killed') {
      const info = p as unknown as GameEvents['actor:killed']
      const att = info.attacker
      if (!(att instanceof RemotePlayer) || att === info.victim) return
      const peer = this.peers().find((x) => x.netId === att.id)
      if (!peer) return
      if (k === 'actor:damaged') {
        peer.queue.push({ t: 'ev', k: 'player:hitmarker', p: { headshot: info.zone === 'head', kill: info.victim.health <= 0 } })
      } else {
        const pts = 100 + (info.headshot ? 50 : 0)
        peer.queue.push({ t: 'ev', k: 'player:points', p: { amount: pts, reason: info.headshot ? 'HEADSHOT' : '' } })
      }
    }
  }

  // ─── Client requests ──────────────────────────────────────────────────────

  handle(peer: HostPeer, msg: ReliableMsg) {
    const g = this.game
    const r = this.remotes.get(peer.pid)
    switch (msg.t) {
      case 'fire': {
        if (!r || !r.alive || g.mode.phase !== 'playing') return
        const def = WEAPONS[msg.w]
        if (!def || msg.d.length > Math.max(1, def.pellets) || msg.d.length === 0) return
        // Real time, not game time: frame dt is clamped on slow hosts.
        const now = performance.now() / 1000
        this.counters.fire++
        if (now - r.lastFireAt < (60 / def.rpm) * 0.6) return void this.counters.rejected++ // rate of fire (loose: jitter/batching)
        const origin = new Vector3(...msg.o)
        if (origin.distanceTo(r.getEyePosition(_eye)) > 3) return void this.counters.rejected++ // origin must be near the proxy
        r.lastFireAt = now
        const muzzle = new Vector3(...msg.m)
        if (muzzle.distanceTo(origin) > 2) muzzle.copy(origin)
        r.stats.shotsFired++
        r.kick()
        let first: Vector3 | null = null
        for (const d of msg.d) {
          const dir = new Vector3(...d)
          if (dir.lengthSq() < 0.5) continue
          dir.normalize()
          first ??= dir
          g.combat.fireBullet(r, msg.w, origin, dir, true, muzzle)
        }
        if (first) g.events.emit('weapon:fire', { shooter: r, weaponId: msg.w, origin: muzzle, direction: first, suppressed: false })
        return
      }
      case 'nade': {
        if (!r || !r.alive || g.mode.phase !== 'playing' || r.nadesThisLife >= 2) return
        const o = new Vector3(...msg.o)
        if (o.distanceTo(r.getEyePosition(_eye)) > 3) return
        r.nadesThisLife++
        const v = new Vector3(...msg.v)
        if (v.length() > 30) v.setLength(30)
        g.combat.throwGrenade(r, o, v, Math.min(3.5, Math.max(0, msg.fuse)))
        return
      }
      case 'knife':
        if (r && r.alive && g.mode.phase === 'playing') g.combat.melee(r)
        return
      case 'respawn':
        if (r && !r.alive) g.mode.requestRespawn(r)
        return
      case 'ks':
        if (r && r.alive && g.mode.phase === 'playing' && msg.id in KILLSTREAKS) g.streaks.remoteUse(r, msg.id, msg.p, msg.h)
        return
      default:
    }
  }

  /** Pose from a client (state channel). */
  handleState(peer: HostPeer, buf: ArrayBuffer) {
    if (new DataView(buf).getUint8(0) !== MSG_POSE) return
    const r = this.remotes.get(peer.pid)
    if (!r || !r.alive) return
    const s = decodePose(buf)
    if (!(s.flags & F_ALIVE)) return
    s.id = r.id
    r.push(performance.now() / 1000, s)
  }
}

/** Replicated actor flags (shared with the client's pose encoder). */
export function actorFlags(a: Actor, g: Game): number {
  let f = a.alive ? F_ALIVE : 0
  f |= (a.stance & 3) << F_STANCE_SHIFT
  if (a.team === 'opfor') f |= F_OPFOR
  const p = a as { grounded?: boolean; sprinting?: boolean }
  if (p.grounded !== false) f |= F_GROUNDED
  if (p.sprinting) f |= F_SPRINT
  if (a === g.player) {
    if (g.player.weapons.isReloading()) f |= F_RELOAD
    if (g.player.weapons.adsAmount > 0.5) f |= F_ADS
  }
  return f
}
