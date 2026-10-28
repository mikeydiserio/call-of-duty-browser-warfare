import type { Object3D } from 'three'
import { Vector3 } from 'three'
import { type AnimInput, SoldierAnimator } from '../ai/animator'
import { SoldierHitboxes } from '../ai/hitbox'
import { Ragdoll } from '../ai/ragdoll'
import { buildSoldier, type SoldierRig } from '../ai/soldier-model'
import { CONFIG } from '../core/config'
import type { Game } from '../core/game'
import { clamp, lerp, wrapAngle } from '../core/math'
import type { Actor, ActorHit, ActorStats, DamageInfo, PerkId, Team, WeaponId } from '../core/types'
import type { KillstreakId } from '../game/killstreaks/defs'
import { WEAPONS } from '../weapons/defs'
import { createWorldWeaponModel } from '../weapons/world-models'
import { type ActorState, F_ADS, F_ALIVE, F_GROUNDED, F_RELOAD, F_SPRINT, F_STANCE_SHIFT } from './protocol'

/** Interpolation delay behind the newest sample (seconds). */
export const INTERP_DELAY = 0.1
const CORPSE_TIME = 8

interface Sample {
  t: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  flags: number
}

const _eye = new Vector3()

/**
 * An actor driven by the network: a remote human on the host, or any non-local actor
 * (bots, other humans, the host) on a client. Rendered with the AI soldier rig, hit-tested
 * with its bone-following hitboxes, interpolated ~100 ms behind the newest state.
 */
export class RemotePlayer implements Actor {
  readonly isPlayer = false
  alive = false
  health: number = CONFIG.maxHealth
  readonly maxHealth = CONFIG.maxHealth
  readonly position = new Vector3()
  readonly velocity = new Vector3()
  yaw = 0
  pitch = 0
  stance: 0 | 1 | 2 = 0
  stats: ActorStats = { kills: 0, deaths: 0, assists: 0, score: 0, streak: 0, shotsFired: 0, shotsHit: 0, headshots: 0 }
  timeSinceDamage = 99
  weaponId: WeaponId
  perks: PerkId[] = []
  killstreaks: KillstreakId[] = []
  /** Host side: called when the game mode spawns this actor (forwarded to its owner). */
  onSpawn: ((position: Vector3, yaw: number) => void) | null = null
  /** Host side: grenades thrown this life (loose anti-cheat). */
  nadesThisLife = 0
  lastFireAt = -10

  rig: SoldierRig
  anim: SoldierAnimator
  hitboxes: SoldierHitboxes
  ragdoll: Ragdoll
  private models = new Map<WeaponId, Object3D>()
  private buf: Sample[] = []
  private bodyYaw = 0
  private stanceF = 0
  private flags = 0
  private corpseT = 0
  private readonly animIn: AnimInput
  private readonly lastPos = new Vector3()

  constructor(
    private game: Game,
    readonly id: number,
    public name: string,
    public team: Team,
    weapon: WeaponId,
    /** Client mirrors take alive/health from snapshots; host proxies have them set by combat/mode. */
    readonly mirror: boolean,
  ) {
    this.weaponId = weapon
    this.rig = buildSoldier(team, seeded(id * 7919 + 13))
    this.anim = new SoldierAnimator(this.rig, null)
    this.hitboxes = new SoldierHitboxes(this.rig)
    this.ragdoll = new Ragdoll(this.rig, game.collision)
    this.setWeapon(weapon)
    this.rig.root.visible = false
    game.render.scene.add(this.rig.root)
    this.animIn = {
      dt: 0, position: this.position, bodyYaw: 0, aimYaw: 0, aimPitch: 0, velocity: this.velocity, grounded: true,
      stance: 0, sprint: false, aim: 0, action: 'none', actionT: 0, emptyReload: false, pistol: false, ladder: null, lod: false,
    }
  }

  /** Rebuild the soldier (team change between matches). */
  setTeam(team: Team) {
    if (team === this.team) return
    this.team = team
    const visible = this.rig.root.visible
    for (const m of this.models.values()) m.removeFromParent()
    this.rig.root.removeFromParent()
    this.rig.dispose()
    this.rig = buildSoldier(team, seeded(this.id * 7919 + 13))
    this.anim = new SoldierAnimator(this.rig, null)
    this.hitboxes = new SoldierHitboxes(this.rig)
    this.ragdoll = new Ragdoll(this.rig, this.game.collision)
    for (const m of this.models.values()) this.rig.root.add(m)
    const w = this.weaponId
    this.weaponId = 'knife'
    this.setWeapon(w)
    this.rig.root.visible = visible
    this.game.render.scene.add(this.rig.root)
  }

  private setWeapon(id: WeaponId) {
    if (id === this.weaponId && this.models.has(id)) return
    if (id === 'frag' || id === 'knife') return
    this.weaponId = id
    let m = this.models.get(id)
    if (!m) {
      m = createWorldWeaponModel(id)
      m.traverse((o) => (o.castShadow = true))
      this.rig.root.add(m)
      this.models.set(id, m)
    }
    for (const [k, o] of this.models) o.visible = k === id
    this.anim.setWeapon(m)
  }

  // ─── Network input ────────────────────────────────────────────────────────

  push(now: number, s: ActorState) {
    const last = this.buf[this.buf.length - 1]
    this.buf.push({ t: now, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, flags: s.flags })
    if (this.buf.length > 24) this.buf.shift()
    // Teleports (spawns, first sample): snap instead of sliding across the map.
    if (!last || Math.hypot(s.x - last.x, s.y - last.y, s.z - last.z) > 4) {
      this.buf = [this.buf[this.buf.length - 1]!]
      this.position.set(s.x, s.y, s.z)
      this.lastPos.copy(this.position)
    }
    this.setWeapon(s.weapon)
    if (this.mirror) {
      const alive = (s.flags & F_ALIVE) !== 0
      if (alive && !this.alive) this.revive(s)
      else if (!alive && this.alive) {
        // The kill event normally follows on the reliable channel; if it never comes
        // (joined late), update() hides the body after a grace period.
        this.alive = false
        this.corpseT = 0
      }
      this.health = s.health
    }
  }

  private revive(s: ActorState) {
    this.buf = [{ t: performance.now() / 1000, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, flags: s.flags }]
    this.position.set(s.x, s.y, s.z)
    this.lastPos.copy(this.position)
    this.yaw = this.bodyYaw = s.yaw
    this.alive = true
    this.health = this.maxHealth
    this.timeSinceDamage = 99
    this.resetBody()
  }

  private resetBody() {
    this.ragdoll.stop()
    this.corpseT = 0
    this.anim.reset(0)
    this.rig.root.visible = true
    const m = this.models.get(this.weaponId)
    if (m && m.parent !== this.rig.root) {
      this.rig.root.add(m)
      m.position.set(0, 0, 0)
      m.rotation.set(0, 0, 0)
    }
    this.hitboxes.invalidate()
  }

  // ─── Actor contract ───────────────────────────────────────────────────────

  getEyePosition(out: Vector3): Vector3 {
    if (!this.alive) return out.copy(this.position).setY(this.position.y + 0.3)
    const s = this.stanceF
    const h = s <= 1 ? lerp(CONFIG.eyeHeight[0], CONFIG.eyeHeight[1], s) : lerp(CONFIG.eyeHeight[1], CONFIG.eyeHeight[2], s - 1)
    return out.set(this.position.x, this.position.y + h, this.position.z)
  }

  raycast(origin: Vector3, dir: Vector3, maxDistance: number): ActorHit | null {
    if (!this.alive || !this.rig.root.visible) return null
    return this.hitboxes.raycast(origin, dir, maxDistance)
  }

  onKilled(info: DamageInfo) {
    this.alive = false
    this.rig.root.visible = true
    this.health = 0
    this.rig.root.updateMatrixWorld(true)
    this.ragdoll.start(this.velocity, info)
    this.hitboxes.invalidate()
    this.corpseT = 0
  }

  spawn(position: Vector3, yaw: number) {
    this.buf = [{ t: performance.now() / 1000, x: position.x, y: position.y, z: position.z, yaw, pitch: 0, flags: F_ALIVE | F_GROUNDED }]
    this.position.copy(position)
    this.lastPos.copy(position)
    this.velocity.set(0, 0, 0)
    this.yaw = this.bodyYaw = yaw
    this.pitch = 0
    this.stance = 0
    this.stanceF = 0
    this.nadesThisLife = 0
    this.resetBody()
    this.animate(0.016)
    this.onSpawn?.(position, yaw)
  }

  // ─── Frame ────────────────────────────────────────────────────────────────

  update(dt: number, now: number) {
    if (!this.alive) {
      this.corpseT += dt
      if (this.ragdoll.active) {
        this.ragdoll.update(dt)
        if (this.corpseT > CORPSE_TIME) this.ragdoll.sink(Math.min(1, (this.corpseT - CORPSE_TIME) / 1.5))
      }
      if (this.corpseT > CORPSE_TIME + 1.5 || (!this.ragdoll.active && this.corpseT > 1)) this.rig.root.visible = false
      return
    }
    this.interpolate(now - INTERP_DELAY)
    if (dt > 0) {
      this.velocity.subVectors(this.position, this.lastPos).divideScalar(dt)
      if (this.velocity.lengthSq() > 400) this.velocity.set(0, 0, 0)
    }
    this.lastPos.copy(this.position)
    const st = ((this.flags >> F_STANCE_SHIFT) & 3) as 0 | 1 | 2
    this.stance = st > 2 ? 2 : st
    this.stanceF += (this.stance - this.stanceF) * Math.min(1, dt * 10)
    this.animate(dt)
  }

  private interpolate(t: number) {
    const b = this.buf
    if (!b.length) return
    let i = b.length - 1
    while (i > 0 && b[i - 1]!.t > t) i--
    const s1 = b[i]!
    const s0 = i > 0 ? b[i - 1]! : s1
    let k = s1.t > s0.t ? (t - s0.t) / (s1.t - s0.t) : 1
    k = clamp(k, 0, 1)
    this.position.set(lerp(s0.x, s1.x, k), lerp(s0.y, s1.y, k), lerp(s0.z, s1.z, k))
    this.yaw = s0.yaw + wrapAngle(s1.yaw - s0.yaw) * k
    this.pitch = lerp(s0.pitch, s1.pitch, k)
    this.flags = k < 0.5 ? s0.flags : s1.flags
  }

  private animate(dt: number) {
    const a = this.animIn
    a.dt = dt
    const diff = wrapAngle(this.yaw - this.bodyYaw)
    const moving = Math.hypot(this.velocity.x, this.velocity.z) > 0.5
    if (moving || Math.abs(diff) > 0.85) this.bodyYaw = wrapAngle(this.bodyYaw + diff * Math.min(1, dt * (moving ? 8 : 5)))
    a.bodyYaw = this.bodyYaw
    a.aimYaw = this.yaw
    a.aimPitch = this.pitch
    a.grounded = (this.flags & F_GROUNDED) !== 0
    a.stance = this.stanceF
    a.sprint = (this.flags & F_SPRINT) !== 0 && moving
    a.aim = (this.flags & F_ADS) !== 0 ? 1 : 0.3
    const reloading = (this.flags & F_RELOAD) !== 0
    a.action = reloading ? 'reload' : 'none'
    a.actionT = reloading ? (performance.now() / 1000 / 2) % 1 : 0
    a.pistol = WEAPONS[this.weaponId].class === 'pistol'
    this.anim.update(a)
    if (this.anim.footDown && a.grounded) {
      const sp = Math.hypot(this.velocity.x, this.velocity.z)
      if (sp > 1.2) {
        const surface = this.game.collision.surfaceBelow(this.position.x, this.position.y, this.position.z)
        const intensity = clamp(sp / CONFIG.sprintSpeed, 0.2, 1) * (this.stance === 1 ? 0.45 : 1)
        this.game.events.emit('actor:footstep', { actor: this, surface, position: this.position, intensity })
      }
    }
    this.hitboxes.invalidate()
  }

  /** Visual recoil when this actor fires. */
  kick() {
    this.anim.fireKick(0.6)
  }

  muzzle(out: Vector3): Vector3 {
    return this.alive ? this.anim.muzzle(out) : this.getEyePosition(out)
  }

  eye(): Vector3 {
    return this.getEyePosition(_eye)
  }

  dispose() {
    this.rig.root.removeFromParent()
    this.rig.dispose()
  }
}

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
