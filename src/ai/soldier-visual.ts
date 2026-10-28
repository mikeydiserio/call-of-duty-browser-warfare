import { type Material, type MeshStandardMaterial, type Object3D, Vector3 } from 'three'
import { CONFIG } from '../core/config'
import type { Game } from '../core/game'
import { clamp, damp, wrapAngle, yawFromDirection } from '../core/math'
import type { ActorHit, DamageInfo, Ladder, Team, WeaponId } from '../core/types'
import { WEAPONS } from '../weapons/defs'
import { createWorldWeaponModel } from '../weapons/world-models'
import { type AnimAction, type AnimInput, SoldierAnimator } from './animator'
import { SoldierHitboxes } from './hitbox'
import { Ragdoll } from './ragdoll'
import { buildSoldier, type SoldierRig } from './soldier-model'

/**
 * Pose sample that drives a soldier visual. Everything a remote player's
 * snapshot carries (the NET agent fills it from interpolated state).
 */
export interface SoldierPose {
  /** Feet position (world). */
  position: Vector3
  /** World velocity (drives the gait). */
  velocity: Vector3
  /** View yaw/pitch (Actor convention). */
  yaw: number
  pitch: number
  stance: 0 | 1 | 2
  grounded: boolean
  sprinting: boolean
  /** 0..1 shouldered aim (ADS / firing). */
  aim: number
  weaponId: WeaponId
  /** Ladder being climbed, or null. */
  ladder?: Ladder | null
  /** Optional upper-body action with 0..1 progress. */
  action?: AnimAction
  actionT?: number
  emptyReload?: boolean
}

const CORPSE_TIME = 10
const FADE_TIME = 1.6
const _v = new Vector3()

/**
 * The bots' soldier (procedural model, IK animation, bone hitboxes, ragdoll,
 * weapon models, corpse fade) packaged for any externally driven actor, e.g.
 * remote human players. Call update(pose, dt) every frame while alive, fire()
 * per shot, die() on death and respawn() when it comes back.
 */
export class SoldierVisual {
  readonly rig: SoldierRig
  readonly anim: SoldierAnimator
  readonly hitboxes: SoldierHitboxes
  readonly ragdoll: Ragdoll
  alive = true
  private weapons = new Map<WeaponId, Object3D>()
  private weaponId: WeaponId | null = null
  private bodyYaw = 0
  private turning = false
  private stanceF = 0
  private corpseT = 0
  private dropped: Object3D | null = null
  private dropVel = new Vector3()
  private dropRest = false
  private readonly baseMat: Material
  private readonly fadeMat: MeshStandardMaterial
  private readonly input: AnimInput

  constructor(
    private game: Game,
    readonly team: Team,
    seed: number,
  ) {
    let s = seed >>> 0
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    this.rig = buildSoldier(team, rnd)
    this.anim = new SoldierAnimator(this.rig, null)
    this.hitboxes = new SoldierHitboxes(this.rig)
    this.ragdoll = new Ragdoll(this.rig, game.collision)
    this.baseMat = this.rig.mesh.material as Material
    this.fadeMat = (this.baseMat as MeshStandardMaterial).clone()
    this.fadeMat.transparent = true
    this.input = {
      dt: 0, position: new Vector3(), bodyYaw: 0, aimYaw: 0, aimPitch: 0, velocity: new Vector3(), grounded: true,
      stance: 0, sprint: false, aim: 0, action: 'none', actionT: 0, emptyReload: false, pistol: false, ladder: null, lod: false,
    }
    game.render.scene.add(this.rig.root)
  }

  get root(): Object3D {
    return this.rig.root
  }

  private setWeapon(id: WeaponId) {
    if (this.weaponId === id) return
    if (this.weaponId) this.weapons.get(this.weaponId)!.visible = false
    let w = this.weapons.get(id)
    if (!w) {
      w = createWorldWeaponModel(id)
      w.traverse((o) => {
        o.castShadow = true
      })
      this.rig.root.add(w)
      this.weapons.set(id, w)
    }
    w.visible = true
    this.weaponId = id
    this.anim.setWeapon(w)
  }

  /** Drive the skeleton from a pose sample. `lod` 0 full … 2 cheapest. */
  update(pose: SoldierPose, dt: number, lod = 0) {
    if (!this.alive) {
      this.updateCorpse(dt)
      return
    }
    this.setWeapon(pose.weaponId)
    const a = this.input
    const moving = Math.hypot(pose.velocity.x, pose.velocity.z) > 0.5
    const diff = wrapAngle(pose.yaw - this.bodyYaw)
    if (Math.abs(diff) > 1.05) this.turning = true
    else if (Math.abs(diff) < 0.12) this.turning = false
    if (moving || this.turning) this.bodyYaw = wrapAngle(this.bodyYaw + diff * Math.min(1, dt * (moving ? 8 : 6)))
    this.stanceF = damp(this.stanceF, pose.stance, 9, dt)
    a.dt = dt
    a.position.copy(pose.position)
    a.velocity.copy(pose.velocity)
    a.bodyYaw = this.bodyYaw
    a.aimYaw = pose.yaw
    a.aimPitch = pose.pitch
    a.grounded = pose.grounded
    a.stance = this.stanceF
    a.sprint = pose.sprinting && moving
    a.aim = clamp(pose.aim, 0, 1)
    a.action = pose.action ?? 'none'
    a.actionT = clamp(pose.actionT ?? 0, 0, 1)
    a.emptyReload = !!pose.emptyReload
    a.pistol = WEAPONS[pose.weaponId].class === 'pistol' || WEAPONS[pose.weaponId].class === 'machinePistol'
    a.ladder = pose.ladder ? yawFromDirection(-pose.ladder.normal.x, -pose.ladder.normal.z) : null
    a.lod = lod > 0
    this.anim.update(a)
    this.hitboxes.invalidate()
  }

  /** Recoil kick for one shot. */
  fire() {
    const c = this.weaponId ? WEAPONS[this.weaponId].class : 'assault'
    this.anim.fireKick(c === 'sniper' || c === 'shotgun' ? 1.6 : c === 'pistol' ? 0.8 : 0.6)
  }

  /** Hit flinch (damage direction). */
  flinch(info: DamageInfo) {
    this.anim.flinch(info.direction.x, info.direction.z, info.zone === 'head' ? 1.2 : 0.6)
  }

  /** World position of the weapon's muzzle. */
  muzzle(out: Vector3): Vector3 {
    return this.anim.muzzle(out)
  }

  /** Ray vs the animated hitboxes (null when dead). */
  raycast(origin: Vector3, dir: Vector3, maxDistance: number): ActorHit | null {
    if (!this.alive) return null
    return this.hitboxes.raycast(origin, dir, maxDistance)
  }

  /** Start the ragdoll and drop the gun. */
  die(info: DamageInfo, velocity: Vector3) {
    if (!this.alive) return
    this.alive = false
    this.rig.knife.visible = false
    const w = this.weaponId ? this.weapons.get(this.weaponId) : null
    if (w) {
      this.game.render.scene.attach(w)
      this.dropped = w
      this.dropVel.copy(velocity).multiplyScalar(0.6).addScaledVector(info.direction, 1.2)
      this.dropVel.y += 1.2
      this.dropRest = false
    }
    this.ragdoll.start(velocity, info)
    this.hitboxes.invalidate()
    this.corpseT = 0
  }

  /** Back to life (call before the next update). */
  respawn(position: Vector3, yaw: number) {
    this.alive = true
    this.ragdoll.stop()
    this.rig.mesh.material = this.baseMat
    this.rig.mesh.castShadow = true
    this.rig.root.visible = true
    if (this.dropped) {
      this.rig.root.add(this.dropped)
      this.dropped.visible = true
      this.dropped = null
    }
    this.bodyYaw = yaw
    this.stanceF = 0
    this.anim.reset(0)
    this.input.position.copy(position)
  }

  private updateCorpse(dt: number) {
    this.corpseT += dt
    this.ragdoll.update(dt)
    if (this.corpseT > CORPSE_TIME) {
      const s = Math.min(1, (this.corpseT - CORPSE_TIME) / FADE_TIME)
      if (this.rig.mesh.material !== this.fadeMat) this.rig.mesh.material = this.fadeMat
      this.fadeMat.opacity = 1 - s * s * (3 - 2 * s)
      this.rig.mesh.castShadow = this.fadeMat.opacity > 0.55
      this.ragdoll.sink(s * 0.2)
      if (this.dropped && s > 0.6) this.dropped.visible = false
      if (s >= 1) this.rig.root.visible = false
    }
    const g = this.dropped
    if (g && !this.dropRest) {
      this.dropVel.y -= CONFIG.gravity * dt
      const sp = this.dropVel.length()
      _v.copy(this.dropVel).divideScalar(sp || 1)
      const hit = this.game.collision.raycast(g.position, _v, sp * dt + 0.05)
      if (hit) {
        g.position.copy(hit.point).addScaledVector(hit.normal, 0.04)
        g.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2, 'YXZ')
        this.dropRest = true
      } else g.position.addScaledVector(this.dropVel, dt)
    }
  }

  dispose() {
    this.fadeMat.dispose()
    this.rig.root.removeFromParent()
    this.dropped?.removeFromParent()
    this.rig.dispose()
  }
}

/** Soldier model for an externally driven actor (remote players). Added to the scene. */
export function createSoldierVisual(game: Game, team: Team, seed: number): SoldierVisual {
  return new SoldierVisual(game, team, seed)
}
