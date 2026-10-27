import { Quaternion, Vector3 } from 'three'
import { CONFIG } from '../core/config'
import type { DamageInfo } from '../core/types'
import type { CollisionWorld } from '../world/collision'
import { basisQuat } from './animator'
import type { BoneName, SoldierRig } from './soldier-model'

/**
 * Verlet ragdoll: 15 particles at the joints, a rigid torso block, stiff neck
 * and length-constrained limbs, with ground/wall collision through
 * collision.raycast. Starts from the live animated pose with the body's
 * velocity plus a damage impulse, then drives the bones from the particles.
 */

const P = {
  pelvis: 0, chest: 1, head: 2,
  shL: 3, elL: 4, wrL: 5, shR: 6, elR: 7, wrR: 8,
  hipL: 9, knL: 10, anL: 11, hipR: 12, knR: 13, anR: 14,
} as const
const N = 15
const RADII = [0.14, 0.14, 0.12, 0.08, 0.06, 0.05, 0.08, 0.06, 0.05, 0.1, 0.08, 0.07, 0.1, 0.08, 0.07]
/** Source bone (and local offset) for each particle. */
const SRC: [BoneName, number, number, number][] = [
  ['pelvis', 0, 0, 0], ['neck', 0, -0.03, 0], ['head', 0, 0.11, 0],
  ['uarmL', 0, 0, 0], ['farmL', 0, 0, 0], ['handL', 0, 0, 0],
  ['uarmR', 0, 0, 0], ['farmR', 0, 0, 0], ['handR', 0, 0, 0],
  ['thighL', 0, 0, 0], ['shinL', 0, 0, 0], ['footL', 0, 0, 0],
  ['thighR', 0, 0, 0], ['shinR', 0, 0, 0], ['footR', 0, 0, 0],
]
const TORSO = [P.pelvis, P.chest, P.shL, P.shR, P.hipL, P.hipR]
const LINKS: [number, number, number][] = [] // a, b, stiffness
for (let i = 0; i < TORSO.length; i++) for (let j = i + 1; j < TORSO.length; j++) LINKS.push([TORSO[i]!, TORSO[j]!, 1])
LINKS.push(
  [P.chest, P.head, 1], [P.shL, P.head, 0.6], [P.shR, P.head, 0.6],
  [P.shL, P.elL, 1], [P.elL, P.wrL, 1], [P.shR, P.elR, 1], [P.elR, P.wrR, 1],
  [P.hipL, P.knL, 1], [P.knL, P.anL, 1], [P.hipR, P.knR, 1], [P.knR, P.anR, 1],
)
/** Minimum-distance (soft) constraints that stop limbs folding through each other. */
const MINS: [number, number, number][] = [
  [P.wrL, P.shL, 0.18], [P.wrR, P.shR, 0.18], [P.anL, P.hipL, 0.4], [P.anR, P.hipR, 0.4],
  [P.anL, P.anR, 0.12], [P.knL, P.knR, 0.12], [P.head, P.pelvis, 0.45], [P.wrL, P.chest, 0.12], [P.wrR, P.chest, 0.12],
]

const H = 1 / 60
const _d = new Vector3()
const _v = new Vector3()
const _q = new Quaternion()
const _qp = new Quaternion()
const _right = new Vector3()
const _up = new Vector3()
const _fwd = new Vector3()
const _down = new Vector3()
const _o = new Vector3()

export class Ragdoll {
  private pos = Array.from({ length: N }, () => new Vector3())
  private prev = Array.from({ length: N }, () => new Vector3())
  private rest = new Float32Array(LINKS.length)
  /** Cached floor contact per particle (skips raycasts once settled). */
  private gValid = new Uint8Array(N)
  private gx = new Float32Array(N)
  private gy = new Float32Array(N)
  private gz = new Float32Array(N)
  private acc = 0
  private sleepT = 0
  active = false
  asleep = false
  /** Seconds since death. */
  age = 0

  constructor(private rig: SoldierRig, private world: CollisionWorld) {}

  start(velocity: Vector3, info: DamageInfo) {
    const b = this.rig.bones
    this.rig.root.updateMatrixWorld(true)
    for (let i = 0; i < N; i++) {
      const [name, x, y, z] = SRC[i]!
      this.pos[i]!.set(x, y, z).applyMatrix4(b[name].matrixWorld)
    }
    for (let k = 0; k < LINKS.length; k++) {
      const [a, c] = LINKS[k]!
      this.rest[k] = this.pos[a]!.distanceTo(this.pos[c]!)
    }
    // Initial velocities: body motion + impulse at the hit zone.
    const dir = _d.copy(info.direction)
    dir.y = Math.max(dir.y, -0.2)
    dir.normalize()
    const head = info.zone === 'head'
    const base = info.explosive ? 6.5 : info.weaponId === 'intervention' || info.weaponId === 'spas12' ? 3.4 : info.weaponId === 'knife' ? 2.2 : 1.9
    for (let i = 0; i < N; i++) {
      let s = base * 0.35
      if (info.explosive) s = base * (0.8 + Math.random() * 0.4)
      else if (head && (i === P.head || i === P.chest)) s = base * (i === P.head ? 2.2 : 1.1)
      else if (info.zone === 'torso' && (i === P.chest || i === P.pelvis || i === P.shL || i === P.shR)) s = base * 0.9
      else if (info.zone === 'legs' && (i >= P.hipL)) s = base * 0.9
      else if (info.zone === 'arms' && i >= P.shL && i <= P.wrR) s = base * 0.8
      _v.copy(velocity).multiplyScalar(0.85).addScaledVector(dir, s)
      if (info.explosive) _v.y += 3.5 + Math.random() * 1.5
      // Knees buckle forward so bodies crumple instead of toppling like planks.
      if (i === P.knL || i === P.knR) {
        _v.x += -Math.sin(this.rig.root.rotation.y) * 0.9
        _v.z += -Math.cos(this.rig.root.rotation.y) * 0.9
        _v.y -= 0.4
      }
      _v.x += (Math.random() - 0.5) * 0.4
      _v.z += (Math.random() - 0.5) * 0.4
      this.prev[i]!.copy(this.pos[i]!).addScaledVector(_v, -H)
    }
    this.acc = 0
    this.sleepT = 0
    this.age = 0
    this.gValid.fill(0)
    this.active = true
    this.asleep = false
    // The skeleton is driven in world space from now on: neutralise the root.
    this.rig.root.position.set(0, 0, 0)
    this.rig.root.rotation.set(0, 0, 0)
    this.rig.root.updateMatrixWorld(true)
  }

  stop() {
    this.active = false
  }

  update(dt: number) {
    if (!this.active) return
    this.age += dt
    if (this.asleep) return
    this.acc = Math.min(this.acc + dt, H * 4)
    let moved = 0
    while (this.acc >= H) {
      this.acc -= H
      moved = Math.max(moved, this.step())
    }
    // Sleep once settled.
    if (moved < 0.003) this.sleepT += dt
    else this.sleepT = 0
    if (this.sleepT > 0.45 || this.age > 5) this.asleep = true
    this.pose()
  }

  private step(): number {
    const g = CONFIG.gravity * H * H
    let maxMove = 0
    for (let i = 0; i < N; i++) {
      const p = this.pos[i]!
      const q = this.prev[i]!
      const vx = (p.x - q.x) * 0.985
      const vy = (p.y - q.y) * 0.985
      const vz = (p.z - q.z) * 0.985
      q.copy(p)
      p.x += vx
      p.y += vy - g
      p.z += vz
    }
    for (let it = 0; it < 5; it++) {
      for (let k = 0; k < LINKS.length; k++) {
        const [a, c, st] = LINKS[k]!
        const pa = this.pos[a]!
        const pc = this.pos[c]!
        _d.subVectors(pc, pa)
        const len = _d.length()
        if (len < 1e-6) continue
        const diff = ((len - this.rest[k]!) / len) * 0.5 * st
        pa.addScaledVector(_d, diff)
        pc.addScaledVector(_d, -diff)
      }
      for (const [a, c, minD] of MINS) {
        const pa = this.pos[a]!
        const pc = this.pos[c]!
        _d.subVectors(pc, pa)
        const len = _d.length()
        if (len >= minD || len < 1e-6) continue
        const diff = ((len - minD) / len) * 0.5
        pa.addScaledVector(_d, diff)
        pc.addScaledVector(_d, -diff)
      }
    }
    // Collision: sweep prev→pos (extended by the particle radius, so resting
    // particles keep touching the floor).
    for (let i = 0; i < N; i++) {
      const p = this.pos[i]!
      const q = this.prev[i]!
      const r = RADII[i]!
      _d.subVectors(p, q)
      const len = _d.length()
      maxMove = Math.max(maxMove, len)
      if (len < 1e-5) continue
      // Slow particle over a cached floor patch: clamp without a raycast.
      if (this.gValid[i] && len < 0.04 && Math.abs(p.x - this.gx[i]!) < 0.2 && Math.abs(p.z - this.gz[i]!) < 0.2) {
        const fy = this.gy[i]! + r
        if (p.y < fy) {
          p.y = fy
          q.x = p.x - (p.x - q.x) * 0.45
          q.z = p.z - (p.z - q.z) * 0.45
          if (q.y < p.y) q.y = p.y
        }
        continue
      }
      _d.divideScalar(len)
      // Start slightly behind so a particle sitting on the floor still sees it.
      _o.copy(q).addScaledVector(_d, -0.02)
      const hit = this.world.raycast(_o, _d, len + r + 0.02)
      if (hit) {
        p.copy(hit.point).addScaledVector(hit.normal, r)
        if (hit.normal.y > 0.85) {
          this.gValid[i] = 1
          this.gx[i] = p.x
          this.gy[i] = hit.point.y
          this.gz[i] = p.z
        }
        // Friction: kill most tangential velocity, no bounce.
        _v.subVectors(p, q).multiplyScalar(0.45)
        q.copy(p).sub(_v)
      }
    }
    return maxMove
  }

  /** Drive the bones from the particles (world space; root is identity). */
  private pose() {
    const b = this.rig.bones
    const X = this.pos
    // Torso basis.
    _right.subVectors(X[P.hipR]!, X[P.hipL]!).normalize()
    _up.subVectors(X[P.chest]!, X[P.pelvis]!).normalize()
    _fwd.crossVectors(_up, _right) // -Z direction (forward)
    _down.copy(_up).negate()
    basisQuat(_down, _fwd, _q)
    b.pelvis.position.copy(X[P.pelvis]!)
    b.pelvis.quaternion.copy(_q)
    _qp.copy(_q)
    // Spine & chest use the shoulder line.
    _right.subVectors(X[P.shR]!, X[P.shL]!).normalize()
    _fwd.crossVectors(_up, _right)
    basisQuat(_down, _fwd, _q)
    this.setLocal('spine', _q)
    this.setLocal('chest', _q)
    _down.subVectors(X[P.chest]!, X[P.head]!)
    basisQuat(_down, _fwd, _q)
    this.setLocal('neck', _q)
    this.setLocal('head', _q)
    this.limb('uarmL', X[P.shL]!, X[P.elL]!, true)
    this.limb('farmL', X[P.elL]!, X[P.wrL]!, true)
    this.limb('handL', X[P.wrL]!, null, true)
    this.limb('uarmR', X[P.shR]!, X[P.elR]!, true)
    this.limb('farmR', X[P.elR]!, X[P.wrR]!, true)
    this.limb('handR', X[P.wrR]!, null, true)
    this.limb('thighL', X[P.hipL]!, X[P.knL]!, false)
    this.limb('shinL', X[P.knL]!, X[P.anL]!, false)
    this.limb('footL', X[P.anL]!, null, false)
    this.limb('thighR', X[P.hipR]!, X[P.knR]!, false)
    this.limb('shinR', X[P.knR]!, X[P.anR]!, false)
    this.limb('footR', X[P.anR]!, null, false)
    this.rig.root.updateMatrixWorld(true)
  }

  private limb(name: BoneName, a: Vector3, c: Vector3 | null, arm: boolean) {
    const bone = this.rig.bones[name]
    if (!c) {
      // Hands/feet keep a relaxed pose relative to the forearm/shin.
      if (arm) bone.quaternion.identity()
      else bone.quaternion.copy(_qFoot)
      bone.updateMatrixWorld(false)
      return
    }
    bone.parent!.getWorldQuaternion(_qp)
    _down.subVectors(c, a)
    // Forward hint from the parent (knees forward, elbows back).
    _fwd.set(0, 0, -1).applyQuaternion(_qp)
    basisQuat(_down, _fwd, _q)
    bone.quaternion.copy(_qp.invert()).multiply(_q)
    bone.updateMatrixWorld(false)
  }

  private setLocal(name: BoneName, world: Quaternion) {
    const bone = this.rig.bones[name]
    bone.parent!.getWorldQuaternion(_qp)
    bone.quaternion.copy(_qp.invert()).multiply(world)
    bone.updateMatrixWorld(false)
  }

  /** Sink the corpse into the ground (0..1). */
  sink(amount: number) {
    this.rig.bones.pelvis.position.y = this.pos[P.pelvis]!.y - amount * 0.7
    this.rig.root.updateMatrixWorld(true)
  }

  /** Approximate body centre (for camera / debugging). */
  center(out: Vector3) {
    return out.copy(this.pos[P.pelvis]!)
  }
}

/** Relaxed foot: ~70° plantar flex relative to the shin (toes point away from the knee). */
const _qFoot = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.25)
