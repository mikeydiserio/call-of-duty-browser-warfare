import { Euler, Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import { clamp, damp, Spring } from '../core/math'
import { type BoneName, DIM, type SoldierRig } from './soldier-model'

/**
 * Procedural animation for a soldier rig. Everything is computed per frame:
 * gait-phase foot placement solved with two-bone leg IK (planted feet, hip
 * bob), aim-driven spine/neck pitch, a weapon pose blended between ready /
 * aim / sprint / reload / throw / melee / ladder, and two-bone arm IK onto the
 * weapon's grips. No keyframes, no allocations.
 */

export type AnimAction = 'none' | 'reload' | 'throw' | 'melee' | 'switch'

export interface AnimInput {
  dt: number
  /** Feet position (world). */
  position: Vector3
  bodyYaw: number
  aimYaw: number
  aimPitch: number
  /** World velocity. */
  velocity: Vector3
  grounded: boolean
  /** 0 stand … 1 crouch … 2 prone (smoothed float). */
  stance: number
  sprint: boolean
  /** 0..1 shouldered aim. */
  aim: number
  action: AnimAction
  /** 0..1 progress of the action. */
  actionT: number
  /** Reload was from empty (adds a charging-handle pull). */
  emptyReload: boolean
  pistol: boolean
  /** Ladder: null, or the yaw facing the rungs. */
  ladder: number | null
  /** Low detail (far away): skip arm IK refinement and foot rolling. */
  lod: boolean
}

const UP = new Vector3(0, 1, 0)
const _q = new Quaternion()
const _q2 = new Quaternion()
const _qAim = new Quaternion()
const _qGun = new Quaternion()
const _qInv = new Quaternion()
const _e = new Euler(0, 0, 0, 'YXZ')
const _m = new Matrix4()
const _v = new Vector3()
const _v2 = new Vector3()
const _v3 = new Vector3()
const _hip = new Vector3()
const _tgt = new Vector3()
const _knee = new Vector3()
const _pole = new Vector3()
const _fwd = new Vector3()
const _right = new Vector3()
const _down = new Vector3()
const _gunPos = new Vector3()
const _gripR = new Vector3()
const _gripL = new Vector3()
const _s1 = new Vector3()
const _bx = new Vector3()
const _by = new Vector3()
const _bz = new Vector3()
const _one = new Vector3(1, 1, 1)

/** World quaternion from a limb "down" axis (bone -Y) and a forward hint (bone -Z). */
export function basisQuat(down: Vector3, fwd: Vector3, out: Quaternion): Quaternion {
  _by.copy(down).negate().normalize()
  _bz.copy(fwd).negate()
  _bz.addScaledVector(_by, -_bz.dot(_by))
  if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1).addScaledVector(_by, -_by.z)
  _bz.normalize()
  _bx.crossVectors(_by, _bz)
  _m.makeBasis(_bx, _by, _bz)
  return out.setFromRotationMatrix(_m)
}

/** Set a bone's local quaternion so its world rotation equals `world`. */
function setWorldQuat(bone: Object3D, world: Quaternion) {
  bone.parent!.getWorldQuaternion(_qInv).invert()
  bone.quaternion.multiplyQuaternions(_qInv, world)
}

/** Two-bone IK: returns the middle-joint position for root→target with a pole. */
function solveIK(root: Vector3, target: Vector3, l1: number, l2: number, pole: Vector3, outMid: Vector3, outEnd: Vector3) {
  _v.subVectors(target, root)
  let d = _v.length()
  if (d < 1e-5) _v.set(0, -1, 0), (d = 1e-5)
  _v.divideScalar(d)
  d = clamp(d, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.002)
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
  _v2.copy(pole).addScaledVector(_v, -pole.dot(_v))
  if (_v2.lengthSq() < 1e-6) _v2.set(0, 0, -1)
  _v2.normalize()
  outMid.copy(root).addScaledVector(_v, a).addScaledVector(_v2, h)
  outEnd.copy(root).addScaledVector(_v, d)
}

export class SoldierAnimator {
  phase = Math.random() * Math.PI * 2
  private moveW = 0
  private runW = 0
  private crouchW = 0
  private proneW = 0
  private sprintW = 0
  private aimW = 0
  private airW = 0
  private ladderW = 0
  private hipTwist = 0
  private moveAngle = 0
  private breath = Math.random() * 10
  private climb = 0
  /** Recoil springs (gun pitch, gun pull-back). */
  readonly kickPitch = new Spring(260, 22)
  readonly kickBack = new Spring(300, 24)
  readonly flinchX = new Spring(140, 12)
  readonly flinchZ = new Spring(140, 12)
  /** Gun world transform (for the muzzle). */
  readonly gunQuat = new Quaternion()
  readonly gunPos = new Vector3()
  /** Feet that touched down this frame (bit 0 left, bit 1 right). */
  footDown = 0
  private lastU = [0, 0]

  constructor(
    private rig: SoldierRig,
    private weapon: Object3D | null,
  ) {}

  setWeapon(w: Object3D | null) {
    this.weapon = w
  }

  fireKick(strength: number) {
    this.kickPitch.impulse(strength * 9)
    this.kickBack.impulse(strength * 1.1)
  }

  flinch(dirX: number, dirZ: number, amount: number) {
    this.flinchX.impulse(dirZ * amount * 6)
    this.flinchZ.impulse(-dirX * amount * 6)
  }

  update(inp: AnimInput) {
    const dt = inp.dt
    const b = this.rig.bones
    const root = this.rig.root
    this.footDown = 0

    // ── Blend weights
    const cy = Math.cos(inp.bodyYaw)
    const sy = Math.sin(inp.bodyYaw)
    // Body frame: forward (-Z rotated), right.
    const fx = -sy, fz = -cy
    const rx = cy, rz = -sy
    const vx = inp.velocity.x, vz = inp.velocity.z
    const speed = Math.hypot(vx, vz)
    const vf = vx * fx + vz * fz
    const vr = vx * rx + vz * rz
    const climbing = inp.ladder !== null
    this.moveW = damp(this.moveW, climbing ? 0 : clamp(speed / 0.7, 0, 1), 10, dt)
    this.runW = damp(this.runW, clamp((speed - 2.6) / 3.2, 0, 1), 6, dt)
    this.sprintW = damp(this.sprintW, inp.sprint && !climbing ? 1 : 0, 8, dt)
    this.crouchW = damp(this.crouchW, clamp(inp.stance, 0, 1), 9, dt)
    this.proneW = damp(this.proneW, clamp(inp.stance - 1, 0, 1), 6, dt)
    this.aimW = damp(this.aimW, inp.aim, 10, dt)
    this.airW = damp(this.airW, !inp.grounded && !climbing ? 1 : 0, 10, dt)
    this.ladderW = damp(this.ladderW, climbing ? 1 : 0, 10, dt)
    if (speed > 0.3) this.moveAngle = Math.atan2(vr, vf)
    // Hips turn toward the move direction (strafe = diagonal hips), backwards uses mirrored twist.
    let tw = this.moveAngle
    if (tw > Math.PI * 0.6) tw -= Math.PI
    else if (tw < -Math.PI * 0.6) tw += Math.PI
    this.hipTwist = damp(this.hipTwist, -clamp(tw, -1, 1) * 0.5 * this.moveW * (1 - this.sprintW * 0.8), 8, dt)

    // ── Gait phase
    const cycleLen = 1.45 + this.runW * 0.85 - this.crouchW * 0.35
    if (!climbing) this.phase += (Math.max(speed, 0.0) / cycleLen) * Math.PI * 2 * dt
    this.phase %= Math.PI * 200
    this.breath += dt
    const stanceFrac = 0.62 - this.runW * 0.22
    const strideHalf = stanceFrac * cycleLen * 0.5 * this.moveW

    // ── Root
    const rootYaw = climbing ? inp.ladder! : inp.bodyYaw
    root.position.copy(inp.position)
    root.rotation.set(0, rootYaw, 0)

    // ── Pelvis
    const kick = this.kickPitch.update(0, dt)
    const back = this.kickBack.update(0, dt)
    const flX = this.flinchX.update(0, dt)
    const flZ = this.flinchZ.update(0, dt)
    const bob = (0.012 + this.runW * 0.03) * this.moveW * Math.cos(this.phase * 2)
    const pelvisH = 0.955 - 0.035 * this.runW * this.moveW - 0.34 * this.crouchW + bob * (1 - this.crouchW * 0.5) - this.airW * 0.02
    const sway = Math.sin(this.phase) * 0.018 * this.moveW
    b.pelvis.position.set(sway, pelvisH, 0)
    const lean = -(0.05 * this.runW + 0.22 * this.sprintW) * this.moveW - 0.32 * this.crouchW
    _e.set(lean + flX * 0.3, this.hipTwist, flZ * 0.2 + sway * 0.8, 'YXZ')
    b.pelvis.quaternion.setFromEuler(_e)

    // ── Spine chain: counter twist + aim pitch + body-yaw lag.
    const yawLag = climbing ? 0 : clamp(wrapAngle(inp.aimYaw - inp.bodyYaw), -1.1, 1.1)
    const pitch = clamp(inp.aimPitch, -1.2, 1.2) * (1 - this.ladderW)
    const unlean = -lean
    const tw2 = -this.hipTwist + yawLag
    _e.set(unlean * 0.45 + pitch * 0.25 + flX * 0.6, tw2 * 0.45, flZ * 0.5, 'YXZ')
    b.spine.quaternion.setFromEuler(_e)
    const breathe = Math.sin(this.breath * 1.7) * 0.012 * (1 - this.moveW)
    _e.set(unlean * 0.3 + pitch * 0.3 + breathe + flX * 0.4, tw2 * 0.4, flZ * 0.3, 'YXZ')
    b.chest.quaternion.setFromEuler(_e)
    _e.set(unlean * 0.1 + pitch * 0.15, tw2 * 0.1, 0, 'YXZ')
    b.neck.quaternion.setFromEuler(_e)
    _e.set(unlean * 0.15 + pitch * 0.25 - this.sprintW * 0.1 + (climbing ? 0.35 : 0), tw2 * 0.05, 0, 'YXZ')
    b.head.quaternion.setFromEuler(_e)

    // Prone: tilt the whole body forward around the feet and slide back so the hips stay at the position.
    if (this.proneW > 0.001) {
      const pr = this.proneW
      root.rotation.set(-pr * Math.PI * 0.47, rootYaw, 0, 'YXZ')
      root.position.x -= fx * pr * 0.9
      root.position.z -= fz * pr * 0.9
      root.position.y += pr * 0.12
    }

    root.updateMatrixWorld(true)

    // ── Legs (IK)
    const gy = inp.position.y
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? -1 : 1
      const thigh = side === 0 ? b.thighL : b.thighR
      const shin = side === 0 ? b.shinL : b.shinR
      const foot = side === 0 ? b.footL : b.footR
      thigh.getWorldPosition(_hip)
      const ph = this.phase + (side === 0 ? 0 : Math.PI)
      const u = (((ph / (Math.PI * 2)) % 1) + 1) % 1
      // Foot offset along the move direction and lift.
      let along: number
      let lift: number
      if (u < stanceFrac) {
        along = strideHalf * (1 - (2 * u) / stanceFrac)
        lift = 0
        if (this.lastU[side]! >= stanceFrac || this.lastU[side]! > u) {
          if (this.moveW > 0.4) this.footDown |= 1 << side
        }
      } else {
        const w = (u - stanceFrac) / (1 - stanceFrac)
        const sm = w * w * (3 - 2 * w)
        along = strideHalf * (-1 + 2 * sm)
        lift = Math.sin(w * Math.PI) * (0.1 + this.runW * 0.16) * this.moveW
      }
      this.lastU[side] = u
      // Move direction (world).
      const mdx = speed > 0.05 ? vx / speed : fx
      const mdz = speed > 0.05 ? vz / speed : fz
      // Stance width along body right; crouch: one knee forward, feet wider.
      const width = 0.115 + this.crouchW * 0.05
      const crouchStagger = this.crouchW * (1 - this.moveW) * (side === 0 ? 0.16 : -0.08)
      _tgt.set(
        inp.position.x + rx * s * width + mdx * along + fx * crouchStagger,
        gy + DIM.ankleHeight + lift,
        inp.position.z + rz * s * width + mdz * along + fz * crouchStagger,
      )
      if (this.airW > 0.01) {
        // Tuck the legs while airborne.
        _tgt.x = damp(_tgt.x, _hip.x + fx * (side === 0 ? 0.15 : -0.1), 1, this.airW)
        _tgt.z = damp(_tgt.z, _hip.z + fz * (side === 0 ? 0.15 : -0.1), 1, this.airW)
        _tgt.y = Math.max(_tgt.y, _hip.y - 0.62 * this.airW - 0.25 * (1 - this.airW))
      }
      if (this.ladderW > 0.01) {
        // Feet on the rungs, alternating.
        const c = this.climb + (side === 0 ? 0 : Math.PI)
        _tgt.set(_hip.x + fx * 0.12 + rx * s * 0.02, _hip.y - 0.78 + Math.max(0, Math.sin(c)) * 0.28, _hip.z + fz * 0.12 + rz * s * 0.02)
      }
      if (this.proneW > 0.5) {
        // Legs trail behind along the body.
        _v3.set(0, -1, 0).applyQuaternion(root.quaternion)
        _tgt.copy(_hip).addScaledVector(_v3, 0.84).addScaledVector(UP, 0.0)
        _tgt.x += rx * s * 0.12
        _tgt.z += rz * s * 0.12
      }
      // Knees point forward (slightly out).
      _pole.set(fx + rx * s * 0.15, 0.1, fz + rz * s * 0.15)
      if (this.proneW > 0.5) _pole.set(0, -1, 0)
      solveIK(_hip, _tgt, DIM.thigh, DIM.shin, _pole, _knee, _v3)
      _down.subVectors(_knee, _hip)
      _fwd.copy(_pole)
      basisQuat(_down, _fwd, _q)
      setWorldQuat(thigh, _q)
      thigh.updateMatrixWorld(false)
      _down.subVectors(_v3, _knee)
      basisQuat(_down, _fwd, _q2)
      shin.quaternion.copy(_q).invert().multiply(_q2)
      shin.updateMatrixWorld(false)
      // Foot: flat with the ground (heel/toe roll on the swing when near).
      const toe = inp.lod ? 0 : (u >= stanceFrac ? Math.sin(((u - stanceFrac) / (1 - stanceFrac)) * Math.PI) * 0.35 * this.moveW : 0)
      if (this.proneW > 0.5) {
        _down.set(0, 0, 1).applyQuaternion(root.quaternion)
        _fwd.set(0, -1, 0)
      } else if (this.ladderW > 0.5) {
        _down.set(0, -1, 0)
        _fwd.set(fx, 0, fz)
      } else {
        _down.set(0, -1, 0)
        _fwd.set(fx * Math.cos(toe), -Math.sin(toe), fz * Math.cos(toe))
        // Point toes a little along the hip twist.
        _down.x += 0
      }
      basisQuat(_down, _fwd, _q)
      foot.quaternion.copy(_q2).invert().multiply(_q)
      foot.updateMatrixWorld(false)
    }

    // ── Weapon pose (world)
    this.computeGunPose(inp, rootYaw, fx, fz, rx, rz, kick, back)
    const wpn = this.weapon
    if (wpn) {
      // Weapon is parented to the rig root.
      _qInv.copy(root.quaternion).invert()
      wpn.position.copy(this.gunPos).sub(root.position).applyQuaternion(_qInv)
      wpn.quaternion.multiplyQuaternions(_qInv, this.gunQuat)
      wpn.updateMatrixWorld(true)
    }

    // ── Arms (IK onto grips)
    this.solveArms(inp, fx, fz, rx, rz)
  }

  private computeGunPose(inp: AnimInput, rootYaw: number, fx: number, fz: number, rx: number, rz: number, kick: number, back: number) {
    const b = this.rig.bones
    b.uarmR.getWorldPosition(_s1) // right shoulder
    const aimYaw = this.ladderW > 0.5 ? rootYaw : inp.aimYaw
    const pitch = clamp(inp.aimPitch, -1.25, 1.25)
    _e.set(pitch + kick * 0.02, aimYaw, 0, 'YXZ')
    _qAim.setFromEuler(_e)
    // Shouldered aim: grip ~ under the right eye line, stock in the shoulder pocket.
    const aimOff = inp.pistol ? _v.set(-0.2, 0.04, -0.42) : _v.set(-0.07, -0.06, -0.24)
    const readyOff = inp.pistol ? _v2.set(-0.15, -0.14, -0.32) : _v2.set(-0.06, -0.14, -0.22)
    _gunPos.copy(readyOff).lerp(aimOff, this.aimW)
    _gunPos.z += back * 0.05
    _gunPos.applyQuaternion(_qAim).add(_s1)
    // Ready (not aiming) dips the muzzle ~12°.
    _e.set(pitch - (1 - this.aimW) * 0.2 + kick * 0.03, aimYaw, 0, 'YXZ')
    _qGun.setFromEuler(_e)

    // Sprint: rifle canted across the chest, muzzle low-left, bobbing with the stride.
    const spr = this.sprintW * this.moveW
    if (spr > 0.01) {
      const stepBob = Math.sin(this.phase * 2) * 0.025
      _v3.set(-0.14 + Math.sin(this.phase) * 0.02, -0.2 + stepBob, -0.16)
      _e.set(0, rootYaw, 0, 'YXZ')
      _q.setFromEuler(_e)
      _v3.applyQuaternion(_q).add(_s1)
      _gunPos.lerp(_v3, spr)
      _e.set(-0.55 + stepBob * 2, rootYaw + 0.75, 0.55 + Math.sin(this.phase) * 0.06, 'YXZ')
      _q.setFromEuler(_e)
      _qGun.slerp(_q, spr)
    }
    // Actions.
    const t = inp.actionT
    if (inp.action === 'reload') {
      const w = Math.sin(Math.min(1, t * 1.15) * Math.PI) // in/out envelope
      const tilt = clamp(w * 1.6, 0, 1)
      _e.set(0.25, rootYaw + 0.35, -0.7, 'YXZ')
      _q.setFromEuler(_e)
      _e.set(0, rootYaw, 0, 'YXZ')
      _q2.setFromEuler(_e)
      _v3.set(-0.14, -0.12, -0.2).applyQuaternion(_q2).add(_s1)
      _gunPos.lerp(_v3, tilt)
      _qGun.slerp(_q, tilt)
    } else if (inp.action === 'throw' || inp.action === 'melee' || inp.action === 'switch') {
      // Gun lowered in the left hand.
      const w = inp.action === 'switch' ? Math.sin(t * Math.PI) : clamp(Math.sin(t * Math.PI) * 2, 0, 1)
      _e.set(-0.9, rootYaw + 0.5, 0.4, 'YXZ')
      _q.setFromEuler(_e)
      _e.set(0, rootYaw, 0, 'YXZ')
      _q2.setFromEuler(_e)
      _v3.set(-0.3, -0.38, -0.12).applyQuaternion(_q2).add(_s1)
      _gunPos.lerp(_v3, w)
      _qGun.slerp(_q, w)
    }
    if (this.ladderW > 0.01) {
      // Slung across the back while climbing.
      b.chest.getWorldPosition(_v3)
      _e.set(0, rootYaw, 0, 'YXZ')
      _q2.setFromEuler(_e)
      _v.set(0.05, 0.1, 0.2).applyQuaternion(_q2)
      _v3.add(_v)
      _gunPos.lerp(_v3, this.ladderW)
      _e.set(-1.1, rootYaw + Math.PI, 0.5, 'YXZ')
      _q.setFromEuler(_e)
      _qGun.slerp(_q, this.ladderW)
    }
    void fx, void fz, void rx, void rz
    this.gunPos.copy(_gunPos)
    this.gunQuat.copy(_qGun)
  }

  private solveArms(inp: AnimInput, fx: number, fz: number, rx: number, rz: number) {
    const b = this.rig.bones
    const t = inp.actionT
    // Grip points in gun space (origin at the pistol grip, barrel −Z).
    _gripR.set(0, -0.035, 0.035)
    if (inp.pistol) _gripL.set(0.01, -0.06, 0.04)
    else _gripL.set(-0.005, -0.02, -0.3)
    _gripR.applyQuaternion(this.gunQuat).add(this.gunPos)
    _gripL.applyQuaternion(this.gunQuat).add(this.gunPos)

    b.chest.getWorldPosition(_v3)
    _e.set(0, inp.bodyYaw, 0, 'YXZ')
    _q.setFromEuler(_e)
    const bodyPoint = (x: number, y: number, z: number, out: Vector3) => out.set(x, y, z).applyQuaternion(_q).add(_v3)

    let lHandFree = false
    if (inp.action === 'reload') {
      // Left hand: mag out → pouch → mag in → (charging handle).
      const magPt = _v.set(0, -0.13, -0.13).applyQuaternion(this.gunQuat).add(this.gunPos)
      const pouch = bodyPoint(-0.1, -0.08, -0.2, _v2)
      if (t < 0.2) _gripL.lerp(magPt, t / 0.2)
      else if (t < 0.42) _gripL.copy(magPt).lerp(pouch, smooth((t - 0.2) / 0.22))
      else if (t < 0.62) _gripL.copy(pouch).lerp(magPt, smooth((t - 0.42) / 0.2))
      else if (inp.emptyReload && t < 0.85) {
        const ch = _v2.set(-0.045, 0.05, -0.02).applyQuaternion(this.gunQuat).add(this.gunPos)
        _gripL.copy(magPt).lerp(ch, smooth(clamp((t - 0.62) / 0.1, 0, 1)))
        if (t > 0.75) _gripL.z += 0
      } else {
        const ch = inp.emptyReload ? _v2.set(-0.045, 0.05, -0.02).applyQuaternion(this.gunQuat).add(this.gunPos) : magPt
        _gripL.lerp(ch, 1 - smooth((t - (inp.emptyReload ? 0.85 : 0.62)) / (inp.emptyReload ? 0.15 : 0.38)))
      }
      lHandFree = true
    }
    let rHandFree = false
    if (inp.action === 'throw') {
      // Right arm: wind-up behind the head, overhand release at t≈0.55.
      const wind = bodyPoint(0.22, 0.42, 0.22, _v)
      const rel = bodyPoint(0.08, 0.38, -0.55, _v2)
      if (t < 0.45) _gripR.lerp(wind, smooth(t / 0.45))
      else if (t < 0.65) _gripR.copy(wind).lerp(rel, smooth((t - 0.45) / 0.2))
      else _gripR.copy(rel).lerp(_gripR, smooth((t - 0.65) / 0.35))
      rHandFree = true
    } else if (inp.action === 'melee') {
      const cock = bodyPoint(0.24, 0.12, 0.05, _v)
      const stab = bodyPoint(0.02, 0.18, -0.62, _v2)
      if (t < 0.35) _gripR.lerp(cock, smooth(t / 0.35))
      else if (t < 0.55) _gripR.copy(cock).lerp(stab, smooth((t - 0.35) / 0.2))
      else _gripR.copy(stab).lerp(_gripR, smooth((t - 0.55) / 0.45))
      rHandFree = true
    }
    this.rig.knife.visible = inp.action === 'melee'
    if (this.ladderW > 0.5) {
      // Hands on the rails, alternating reach.
      this.climb = inp.position.y * 4.2
      b.uarmL.getWorldPosition(_v)
      _gripL.set(_v.x + fx * 0.3, inp.position.y + 1.55 + Math.max(0, Math.sin(this.climb)) * 0.25, _v.z + fz * 0.3)
      b.uarmR.getWorldPosition(_v)
      _gripR.set(_v.x + fx * 0.3, inp.position.y + 1.55 + Math.max(0, Math.sin(this.climb + Math.PI)) * 0.25, _v.z + fz * 0.3)
      lHandFree = rHandFree = true
    }

    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? -1 : 1
      const uarm = side === 0 ? b.uarmL : b.uarmR
      const farm = side === 0 ? b.farmL : b.farmR
      const hand = side === 0 ? b.handL : b.handR
      const target = side === 0 ? _gripL : _gripR
      uarm.getWorldPosition(_hip)
      // Elbows: down, out and slightly back.
      _pole.set(rx * s * 0.7 - fx * 0.25, -1, rz * s * 0.7 - fz * 0.25)
      solveIK(_hip, target, DIM.upperArm, DIM.foreArm + 0.04, _pole, _knee, _v3)
      _down.subVectors(_knee, _hip)
      _fwd.copy(_pole).negate()
      basisQuat(_down, _fwd, _q)
      setWorldQuat(uarm, _q)
      uarm.updateMatrixWorld(false)
      _down.subVectors(_v3, _knee)
      basisQuat(_down, _fwd, _q2)
      farm.quaternion.copy(_q).invert().multiply(_q2)
      farm.updateMatrixWorld(false)
      // Hand orientation: wrap the grip (fingers down/forward along the gun) or free.
      const free = side === 0 ? lHandFree : rHandFree
      if (!free && !inp.lod) {
        if (side === 1 || inp.pistol) {
          _down.set(0, -1, -0.25).applyQuaternion(this.gunQuat)
          _fwd.set(0, 0, -1).applyQuaternion(this.gunQuat)
        } else {
          _down.set(0.55, -1, 0).applyQuaternion(this.gunQuat)
          _fwd.set(0, 0, -1).applyQuaternion(this.gunQuat)
        }
      } else {
        _down.copy(_v3).sub(_knee)
        _fwd.set(fx, 0, fz)
      }
      basisQuat(_down, _fwd, _q)
      hand.quaternion.copy(_q2).invert().multiply(_q)
      hand.updateMatrixWorld(true)
    }
  }

  /** World position of the weapon's muzzle (falls back to the gun pose). */
  muzzle(out: Vector3): Vector3 {
    const m = this.weapon?.getObjectByName('muzzle')
    if (m) return m.getWorldPosition(out)
    return out.set(0, 0, -0.7).applyQuaternion(this.gunQuat).add(this.gunPos)
  }

  /** Bone lookup by name (debug). */
  bone(name: BoneName) {
    return this.rig.bones[name]
  }

  /** Reset pose blending after a respawn. */
  reset(stance: number) {
    this.crouchW = stance >= 1 ? 1 : 0
    this.proneW = stance >= 2 ? 1 : 0
    this.moveW = this.runW = this.sprintW = this.airW = this.ladderW = 0
    this.hipTwist = 0
    this.kickPitch.value = this.kickPitch.velocity = 0
    this.kickBack.value = this.kickBack.velocity = 0
    this.flinchX.value = this.flinchX.velocity = 0
    this.flinchZ.value = this.flinchZ.velocity = 0
    this.rig.root.scale.copy(_one)
  }
}

function smooth(t: number) {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}
