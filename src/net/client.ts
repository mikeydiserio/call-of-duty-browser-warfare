import { Vector3 } from 'three'
import type { GameEvents, MatchPhase } from '../core/events'
import type { Game } from '../core/game'
import type { Actor, DamageInfo, ObjectiveState, Team, WeaponId } from '../core/types'
import { actorFlags } from './host'
import type { NetHooks } from './hooks'
import type { PeerLink } from './peer'
import { decodeSnapshot, decodeValue, encodePose, MSG_SNAPSHOT, type ReliableMsg, type RosterEntry, type Snapshot, v3 } from './protocol'
import { RemotePlayer } from './remote-player'

const POSE_HZ = 30
/** Local actor id for the host's own player (its net id 0 is our Player's id). */
const HOST_LOCAL_ID = 59999
const _eye = new Vector3()
const _seg = new Vector3()
const _c = new Vector3()

interface PendingShot {
  w: WeaponId
  o: [number, number, number]
  d: [number, number, number][]
}

/**
 * Client-side mirror of the host's match: the local player moves/aims locally and sends its
 * pose; everything else (bots, other humans, mode state) follows host snapshots and events.
 */
export class ClientSession implements NetHooks {
  myNetId = -1
  readonly mirrors = new Map<number, RemotePlayer>()
  /** Smoothed RTT to the host (ms). */
  rtt = 0
  bytesPerSec = 0
  private bytesAcc = 0
  private bytesT = 0
  private poseT = 0
  private poseSeq = 0
  private pending: PendingShot | null = null
  private outbox: ReliableMsg[] = []
  private replaying = false
  private deadT = 0
  private respawnLeft = 0
  private lastRespawnReq = 0
  private latest: Snapshot | null = null
  private lastSeq = -1
  private offs: (() => void)[] = []
  private lockOnClick: (() => void) | null = null
  hostTime = 0

  constructor(
    private game: Game,
    private link: PeerLink,
  ) {
    this.offs.push(
      game.events.on('weapon:fire', ({ shooter, origin }) => {
        if (shooter !== game.player || !this.pending || this.replaying) return
        this.outbox.push({ t: 'fire', ...this.pending, m: v3(origin) })
        this.pending = null
      }),
    )
  }

  dispose() {
    for (const off of this.offs) off()
    this.offs = []
    this.clearMirrors()
    const m = this.game.mode as unknown as Record<string, unknown>
    delete m.respawnIn
    if (this.lockOnClick) this.game.render.renderer.domElement.removeEventListener('pointerdown', this.lockOnClick)
  }

  private actor(netId: number): Actor | null {
    if (netId === this.myNetId) return this.game.player
    return this.mirrors.get(netId) ?? null
  }

  private clearMirrors() {
    for (const m of this.mirrors.values()) m.dispose()
    this.mirrors.clear()
  }

  // ─── Match start / roster ─────────────────────────────────────────────────

  start(msg: Extract<ReliableMsg, { t: 'start' }>) {
    const g = this.game
    this.clearMirrors()
    this.myNetId = msg.you
    ;(g.player as { team: Team }).team = msg.team
    this.applyRoster(msg.roster, false)
    this.respawnLeft = 0
    this.latest = null
    this.lastSeq = -1
    // HUD reads the respawn countdown from the mode; ours comes from the host.
    ;(g.mode as { respawnIn: (a: Actor) => number }).respawnIn = (a) => (a === g.player ? Math.max(0, this.respawnLeft) : 0)
    g.startMatch(g.loadout, msg.settings)
    if (msg.inProgress && msg.phase !== g.mode.phase) g.mode.setPhase(msg.phase as MatchPhase)
    // No user gesture here (the host clicked Start): lock the pointer on the next click.
    if (!g.input.isLocked) {
      const el = g.render.renderer.domElement
      if (this.lockOnClick) el.removeEventListener('pointerdown', this.lockOnClick)
      this.lockOnClick = () => {
        if (g.mode.phase !== 'menu' && !g.paused) g.input.lock()
        el.removeEventListener('pointerdown', this.lockOnClick!)
        this.lockOnClick = null
      }
      el.addEventListener('pointerdown', this.lockOnClick)
    }
  }

  private applyRoster(roster: RosterEntry[], live: boolean) {
    const g = this.game
    const seen = new Set<number>()
    for (const e of roster) {
      if (e.id === this.myNetId) continue
      seen.add(e.id)
      let m = this.mirrors.get(e.id)
      if (!m) {
        m = new RemotePlayer(g, e.id === 0 ? HOST_LOCAL_ID : e.id, e.name, e.team, e.primary, true)
        this.mirrors.set(e.id, m)
        if (live) g.actors.push(m)
      } else {
        m.name = e.name
        m.setTeam(e.team)
      }
    }
    for (const [id, m] of this.mirrors) {
      if (seen.has(id)) continue
      this.mirrors.delete(id)
      g.actors = g.actors.filter((a) => a !== m)
      m.dispose()
    }
  }

  // ─── NetHooks ─────────────────────────────────────────────────────────────

  matchActors(): Actor[] {
    return [this.game.player, ...this.mirrors.values()]
  }

  onShot(shooter: Actor, weaponId: WeaponId, origin: Vector3, dir: Vector3) {
    if (shooter !== this.game.player || this.replaying) return
    if (!this.pending || this.pending.w !== weaponId) this.pending = { w: weaponId, o: v3(origin), d: [] }
    this.pending.d.push(v3(dir))
  }

  onGrenade(owner: Actor, origin: Vector3, velocity: Vector3, fuse: number) {
    if (owner !== this.game.player || this.replaying) return
    this.outbox.push({ t: 'nade', o: v3(origin), v: v3(velocity), fuse })
  }

  onMelee(attacker: Actor) {
    if (attacker === this.game.player) this.outbox.push({ t: 'knife' })
  }

  perksOf(): null {
    return null
  }

  update(dt: number) {
    const g = this.game
    const now = performance.now() / 1000
    const inMatch = g.mode.phase !== 'menu'
    if (inMatch) {
      for (const m of this.mirrors.values()) m.update(dt, now)
      this.applySnapshot()
      // Pose.
      this.poseT += dt
      if (this.poseT >= 1 / POSE_HZ) {
        this.poseT = 0
        const p = g.player
        this.link.sendState(
          encodePose({ id: this.myNetId, x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, pitch: p.pitch, flags: actorFlags(p, g), weapon: p.weaponId, health: p.health }, this.poseSeq++),
        )
      }
      // Respawn: press fire on the death screen.
      if (!g.player.alive) {
        this.deadT += dt
        this.respawnLeft -= dt
        const s = g.input.state
        if (this.deadT > 0.4 && (s.fire || s.firePressed) && now - this.lastRespawnReq > 0.5) {
          this.lastRespawnReq = now
          this.outbox.push({ t: 'respawn' })
        }
      } else this.deadT = 0
    }
    if (this.pending) {
      // A fire with no weapon:fire event (shouldn't happen) still goes out.
      this.outbox.push({ t: 'fire', ...this.pending, m: this.pending.o })
      this.pending = null
    }
    for (const m of this.outbox.splice(0)) this.link.sendReliable(m)
    this.bytesT += dt
    if (this.bytesT >= 1) {
      this.bytesPerSec = (this.link.bytesIn - this.bytesAcc) / this.bytesT
      this.bytesAcc = this.link.bytesIn
      this.bytesT = 0
    }
  }

  // ─── Inbound ──────────────────────────────────────────────────────────────

  handleState(buf: ArrayBuffer) {
    if (new DataView(buf).getUint8(0) !== MSG_SNAPSHOT) return
    const s = decodeSnapshot(buf)
    // Unordered channel: drop stale snapshots (16-bit sequence wrap-aware).
    if (this.lastSeq >= 0 && ((s.seq - this.lastSeq) & 0xffff) > 0x8000) return
    this.lastSeq = s.seq
    const now = performance.now() / 1000
    const g = this.game
    for (const a of s.actors) {
      if (a.id === this.myNetId) {
        if (g.player.alive && a.flags & 1) g.player.health = a.health
        continue
      }
      this.mirrors.get(a.id)?.push(now, a)
    }
    this.latest = s
  }

  private applySnapshot() {
    const s = this.latest
    if (!s) return
    this.latest = null
    const g = this.game
    const m = g.mode
    m.timeLeft = s.timeLeft
    m.introLeft = s.introLeft
    m.round = s.round
    if (s.score.tf141 !== m.score.tf141 || s.score.opfor !== m.score.opfor) {
      m.score = { ...s.score }
      g.events.emit('score:changed', { ...m.score })
    }
    for (const t of ['tf141', 'opfor'] as Team[]) m.uavUntil[t] = s.uav[t] > 0 ? g.time + s.uav[t] : 0
    for (const o of s.objectives) {
      let st = m.objectives.find((x) => x.id === o.id)
      if (!st) {
        const pt = g.map.domFlags.find((f) => f.id === o.id)
        if (!pt) continue
        st = { ...pt, owner: null, capturingTeam: null, progress: 0, contested: false } as ObjectiveState
        m.objectives.push(st)
      }
      st.owner = o.owner
      st.capturingTeam = o.capturing
      st.progress = o.progress
      st.contested = o.contested
    }
    if (s.bomb) {
      const b = s.bomb
      m.bomb ??= { attackers: b.attackers, carrier: null, position: new Vector3(), planted: false, site: null, fuseLeft: 0, plantProgress: 0, defuseProgress: 0 }
      const mb = m.bomb
      mb.attackers = b.attackers
      mb.carrier = b.carrier === 0xffff ? null : this.actor(b.carrier)
      mb.position.set(b.x, b.y, b.z)
      mb.planted = b.planted
      mb.site = b.site
      mb.fuseLeft = b.fuseLeft
      mb.plantProgress = b.plant
      mb.defuseProgress = b.defuse
    } else m.bomb = null
  }

  handle(msg: ReliableMsg, hostTime = this.hostTime) {
    const g = this.game
    switch (msg.t) {
      case 'batch':
        this.hostTime = msg.h
        for (const m of msg.m) this.handle(m, msg.h)
        return
      case 'roster':
        this.applyRoster(msg.roster, g.mode.phase !== 'menu')
        return
      case 'spawn': {
        const p = g.player
        p.health = p.maxHealth
        p.alive = true
        p.timeSinceDamage = 99
        p.spawn(new Vector3(...msg.p), msg.yaw)
        this.respawnLeft = 0
        g.events.emit('actor:spawned', { actor: p })
        return
      }
      case 'respawnIn':
        this.respawnLeft = msg.s
        if (msg.s < 0 && g.player.alive) g.player.alive = false
        return
      case 'stats':
        for (const [id, kills, deaths, assists, score, streak] of msg.s) {
          const a = this.actor(id)
          if (!a) continue
          Object.assign(a.stats, { kills, deaths, assists, score, streak })
        }
        return
      case 'gthrow': {
        const owner = this.actor(msg.owner)
        if (!owner) return
        this.replaying = true
        g.combat.throwGrenade(owner, new Vector3(...msg.o), new Vector3(...msg.v), msg.fuse)
        this.replaying = false
        return
      }
      case 'ev':
        this.reemit(msg.k as keyof GameEvents, msg.p, msg.h, hostTime)
        return
      case 'pong':
        this.rtt = this.rtt ? this.rtt * 0.8 + (performance.now() - msg.at) * 0.2 : performance.now() - msg.at
        return
      default:
    }
  }

  private reemit(k: keyof GameEvents, raw: unknown, health: number | undefined, hostTime: number) {
    const g = this.game
    const d = decodeValue(raw, (id) => this.actor(id)) as Record<string, unknown> | undefined
    if (d === undefined) return
    switch (k) {
      case 'match:phase': {
        const phase = d.phase as MatchPhase
        if (phase === 'menu') {
          if (g.mode.phase !== 'menu') g.quitToMenu()
          return
        }
        if (phase === 'ended') g.mode.winner = (d.winner as Team | 'draw' | undefined) ?? null
        g.mode.setPhase(phase, d.winner as Team | 'draw' | undefined)
        return
      }
      case 'score:changed':
        g.mode.score = { tf141: d.tf141 as number, opfor: d.opfor as number }
        break
      case 'actor:damaged': {
        const v = d.victim as Actor
        if (health !== undefined && v.alive) v.health = Math.max(1, health)
        v.timeSinceDamage = 0
        break
      }
      case 'actor:killed': {
        const v = d.victim as Actor
        // A snapshot may already have marked a mirror dead (state and events use different channels).
        const late = !v.alive && v instanceof RemotePlayer && !v.ragdoll.active
        if (!v.alive && !late) return
        v.health = 0
        v.alive = false
        v.onKilled(d as unknown as DamageInfo)
        if (v === g.player) this.deadT = 0
        break
      }
      case 'uav:changed': {
        const until = (d.until as number) > 0 ? (d.until as number) - hostTime + g.time : 0
        d.until = until
        g.mode.uavUntil[d.team as Team] = until
        break
      }
      case 'bullet:tracer':
        this.whizz(d as unknown as GameEvents['bullet:tracer'])
        break
      default:
    }
    g.events.emit(k, d as never)
  }

  /** Near-miss crack for host-resolved shots passing our head. */
  private whizz(t: GameEvents['bullet:tracer']) {
    const p = this.game.player
    if (!p.alive || t.shooter === p || !this.game.mode.isEnemy(t.shooter, p)) return
    p.getEyePosition(_eye)
    const seg = _seg.subVectors(t.to, t.from)
    const len = seg.length()
    if (len < 0.5) return
    seg.divideScalar(len)
    const s = Math.max(0, Math.min(len, _c.subVectors(_eye, t.from).dot(seg)))
    const c = _c.copy(t.from).addScaledVector(seg, s)
    const dist = c.distanceTo(_eye)
    if (dist < 2.2 && dist > 0.25 && s > 3) this.game.events.emit('bullet:whizz', { actor: p, point: c.clone(), shooter: t.shooter })
  }
}
