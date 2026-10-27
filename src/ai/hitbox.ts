import { Vector3 } from 'three'
import type { ActorHit, HitZone } from '../core/types'
import type { BoneName, SoldierRig } from './soldier-model'

/**
 * Bone-following hit volumes for a soldier: a head sphere plus capsules for the
 * torso, upper/lower arms and thighs/shins. Endpoints are read from the bones'
 * world matrices (already updated by the animator / ragdoll), so what you see
 * is what you hit. A bounding sphere rejects most rays for free.
 */

interface Shape {
  a: BoneName
  /** End bone, or null for a sphere around `a` (offset applies). */
  b: BoneName | null
  /** Local offset (in bone a's frame) for spheres / start point. */
  off: [number, number, number]
  /** Local offset in bone b's frame for the end point. */
  offB: [number, number, number]
  r: number
  zone: HitZone
}

const SHAPES: Shape[] = [
  { a: 'head', b: null, off: [0, 0.11, -0.004], offB: [0, 0, 0], r: 0.118, zone: 'head' },
  { a: 'pelvis', b: 'neck', off: [0, -0.06, 0], offB: [0, -0.07, 0], r: 0.172, zone: 'torso' },
  { a: 'uarmL', b: 'farmL', off: [0, 0, 0], offB: [0, 0, 0], r: 0.068, zone: 'arms' },
  { a: 'uarmR', b: 'farmR', off: [0, 0, 0], offB: [0, 0, 0], r: 0.068, zone: 'arms' },
  { a: 'farmL', b: 'handL', off: [0, 0, 0], offB: [0, -0.06, 0], r: 0.058, zone: 'arms' },
  { a: 'farmR', b: 'handR', off: [0, 0, 0], offB: [0, -0.06, 0], r: 0.058, zone: 'arms' },
  { a: 'thighL', b: 'shinL', off: [0, 0, 0], offB: [0, 0, 0], r: 0.1, zone: 'legs' },
  { a: 'thighR', b: 'shinR', off: [0, 0, 0], offB: [0, 0, 0], r: 0.1, zone: 'legs' },
  { a: 'shinL', b: 'footL', off: [0, 0, 0], offB: [0, -0.02, -0.06], r: 0.078, zone: 'legs' },
  { a: 'shinR', b: 'footR', off: [0, 0, 0], offB: [0, -0.02, -0.06], r: 0.078, zone: 'legs' },
]

const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()

export class SoldierHitboxes {
  private A = SHAPES.map(() => new Vector3())
  private B = SHAPES.map(() => new Vector3())
  private center = new Vector3()
  private radius = 1.3
  private dirty = true
  private result: ActorHit = { distance: 0, point: new Vector3(), zone: 'torso' }

  constructor(private rig: SoldierRig) {}

  /** Mark shapes stale after the skeleton moved. */
  invalidate() {
    this.dirty = true
  }

  /** Cheap reject sphere (pelvis-centred). */
  bounds(out: Vector3): number {
    this.rig.bones.chest.getWorldPosition(out)
    return this.radius
  }

  private refresh() {
    this.dirty = false
    const bones = this.rig.bones
    for (let i = 0; i < SHAPES.length; i++) {
      const s = SHAPES[i]!
      const ba = bones[s.a]
      this.A[i]!.set(s.off[0], s.off[1], s.off[2]).applyMatrix4(ba.matrixWorld)
      if (s.b) this.B[i]!.set(s.offB[0], s.offB[1], s.offB[2]).applyMatrix4(bones[s.b].matrixWorld)
      else this.B[i]!.copy(this.A[i]!)
    }
    // Bounding sphere around all shapes.
    this.center.copy(this.A[1]!).add(this.B[1]!).multiplyScalar(0.5)
    let r = 0
    for (let i = 0; i < SHAPES.length; i++) {
      r = Math.max(r, this.A[i]!.distanceTo(this.center) + SHAPES[i]!.r, this.B[i]!.distanceTo(this.center) + SHAPES[i]!.r)
    }
    this.radius = r
  }

  raycast(origin: Vector3, dir: Vector3, maxDistance: number): ActorHit | null {
    if (this.dirty) this.refresh()
    // Bounding sphere reject.
    _c.subVectors(this.center, origin)
    const tc = _c.dot(dir)
    const d2 = _c.lengthSq() - tc * tc
    if (d2 > this.radius * this.radius) return null
    if (tc + this.radius < 0 || tc - this.radius > maxDistance) return null
    let best = maxDistance
    let zone: HitZone | null = null
    for (let i = 0; i < SHAPES.length; i++) {
      const t = rayCapsule(origin, dir, this.A[i]!, this.B[i]!, SHAPES[i]!.r)
      if (t >= 0 && t < best) {
        best = t
        zone = SHAPES[i]!.zone
      }
    }
    if (!zone) return null
    this.result.distance = best
    this.result.point.copy(origin).addScaledVector(dir, best)
    this.result.zone = zone
    return this.result
  }

  /** World centre of a zone (for aiming). */
  zoneCenter(zone: 'head' | 'chest', out: Vector3): Vector3 {
    if (this.dirty) this.refresh()
    if (zone === 'head') return out.copy(this.A[0]!)
    return out.lerpVectors(this.A[1]!, this.B[1]!, 0.62)
  }
}

/** Ray vs capsule; returns distance or -1. */
export function rayCapsule(o: Vector3, d: Vector3, a: Vector3, b: Vector3, r: number): number {
  const ba = _a.subVectors(b, a)
  const oa = _b.subVectors(o, a)
  const baba = ba.dot(ba)
  if (baba < 1e-8) return raySphere(o, d, a, r)
  const bard = ba.dot(d)
  const baoa = ba.dot(oa)
  const rdoa = d.dot(oa)
  const oaoa = oa.dot(oa)
  const qa = baba - bard * bard
  const qb = baba * rdoa - baoa * bard
  const qc = baba * oaoa - baoa * baoa - r * r * baba
  if (Math.abs(qa) > 1e-8) {
    const h = qb * qb - qa * qc
    if (h >= 0) {
      const t = (-qb - Math.sqrt(h)) / qa
      const y = baoa + t * bard
      if (y > 0 && y < baba && t >= 0) return t
    }
  }
  // Caps.
  const t0 = raySphere(o, d, a, r)
  const t1 = raySphere(o, d, b, r)
  if (t0 < 0) return t1
  if (t1 < 0) return t0
  return Math.min(t0, t1)
}

function raySphere(o: Vector3, d: Vector3, c: Vector3, r: number): number {
  const ocx = o.x - c.x
  const ocy = o.y - c.y
  const ocz = o.z - c.z
  const b = ocx * d.x + ocy * d.y + ocz * d.z
  const cc = ocx * ocx + ocy * ocy + ocz * ocz - r * r
  const h = b * b - cc
  if (h < 0) return -1
  const t = -b - Math.sqrt(h)
  if (t >= 0) return t
  return cc < 0 ? 0 : -1
}
