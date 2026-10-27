import { Vector3 } from 'three'
import type { ActorHit, HitZone } from '../core/types'

/**
 * Stance-aware body hitboxes for the local player (head sphere + torso / arm /
 * leg capsules). Preallocated: a missed ray allocates nothing.
 */

const SHAPES = 6
const A = Array.from({ length: SHAPES }, () => new Vector3())
const B = Array.from({ length: SHAPES }, () => new Vector3())
const RADIUS = new Float32Array(SHAPES)
const ZONES: HitZone[] = ['head', 'torso', 'arms', 'arms', 'legs', 'legs']

const set = (i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number) => {
  A[i]!.set(ax, ay, az)
  B[i]!.set(bx, by, bz)
  RADIUS[i] = r
}

/** Rebuild the six shapes for a stance. pos = feet, eye = current eye height above feet. */
function buildShapes(px: number, py: number, pz: number, yaw: number, stance: 0 | 1 | 2, eye: number) {
  const fx = -Math.sin(yaw)
  const fz = -Math.cos(yaw)
  const rx = Math.cos(yaw)
  const rz = -Math.sin(yaw)

  if (stance === 2) {
    // Lying along the facing direction; camera sits at the head end.
    set(0, px + fx * 0.12, py + 0.3, pz + fz * 0.12, px + fx * 0.12, py + 0.3, pz + fz * 0.12, 0.13)
    set(1, px - fx * 0.1, py + 0.2, pz - fz * 0.1, px - fx * 0.62, py + 0.2, pz - fz * 0.62, 0.17)
    set(2, px + fx * 0.32 - rx * 0.2, py + 0.13, pz + fz * 0.32 - rz * 0.2, px - fx * 0.05 - rx * 0.2, py + 0.13, pz - fz * 0.05 - rz * 0.2, 0.07)
    set(3, px + fx * 0.32 + rx * 0.2, py + 0.13, pz + fz * 0.32 + rz * 0.2, px - fx * 0.05 + rx * 0.2, py + 0.13, pz - fz * 0.05 + rz * 0.2, 0.07)
    set(4, px - fx * 0.68 - rx * 0.08, py + 0.12, pz - fz * 0.68 - rz * 0.08, px - fx * 1.2 - rx * 0.08, py + 0.12, pz - fz * 1.2 - rz * 0.08, 0.1)
    set(5, px - fx * 0.68 + rx * 0.08, py + 0.12, pz - fz * 0.68 + rz * 0.08, px - fx * 1.2 + rx * 0.08, py + 0.12, pz - fz * 1.2 + rz * 0.08, 0.1)
    return
  }

  // Head centre sits just below the eyes.
  set(0, px, py + eye - 0.03, pz, px, py + eye - 0.03, pz, 0.135)
  if (stance === 0) {
    set(1, px, py + eye - 0.3, pz, px, py + eye - 0.8, pz, 0.2)
    set(2, px - rx * 0.27 + fx * 0.06, py + eye - 0.38, pz - rz * 0.27 + fz * 0.06, px - rx * 0.27 + fx * 0.14, py + eye - 0.78, pz - rz * 0.27 + fz * 0.14, 0.07)
    set(3, px + rx * 0.27 + fx * 0.06, py + eye - 0.38, pz + rz * 0.27 + fz * 0.06, px + rx * 0.27 + fx * 0.14, py + eye - 0.78, pz + rz * 0.27 + fz * 0.14, 0.07)
    set(4, px - rx * 0.1, py + eye - 0.85, pz - rz * 0.1, px - rx * 0.11, py + 0.08, pz - rz * 0.11, 0.1)
    set(5, px + rx * 0.1, py + eye - 0.85, pz + rz * 0.1, px + rx * 0.11, py + 0.08, pz + rz * 0.11, 0.1)
  } else {
    // Crouched: shorter torso, folded legs.
    set(1, px, py + eye - 0.28, pz, px, py + eye - 0.62, pz, 0.2)
    set(2, px - rx * 0.27 + fx * 0.1, py + eye - 0.34, pz - rz * 0.27 + fz * 0.1, px - rx * 0.27 + fx * 0.18, py + eye - 0.6, pz - rz * 0.27 + fz * 0.18, 0.07)
    set(3, px + rx * 0.27 + fx * 0.1, py + eye - 0.34, pz + rz * 0.27 + fz * 0.1, px + rx * 0.27 + fx * 0.18, py + eye - 0.6, pz + rz * 0.27 + fz * 0.18, 0.07)
    set(4, px - rx * 0.11, py + 0.46, pz - rz * 0.11, px - rx * 0.11 + fx * 0.12, py + 0.1, pz - rz * 0.11 + fz * 0.12, 0.11)
    set(5, px + rx * 0.11, py + 0.46, pz + rz * 0.11, px + rx * 0.11 + fx * 0.12, py + 0.1, pz + rz * 0.11 + fz * 0.12, 0.11)
  }
}

/** Ray vs capsule (a→b, radius ra). Returns hit distance or -1. Handles a == b (sphere). */
function rayCapsule(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  a: Vector3, b: Vector3, ra: number,
): number {
  const bax = b.x - a.x
  const bay = b.y - a.y
  const baz = b.z - a.z
  const oax = ox - a.x
  const oay = oy - a.y
  const oaz = oz - a.z
  const baba = bax * bax + bay * bay + baz * baz
  if (baba < 1e-8) return raySphere(ox, oy, oz, dx, dy, dz, a.x, a.y, a.z, ra)
  const bard = bax * dx + bay * dy + baz * dz
  const baoa = bax * oax + bay * oay + baz * oaz
  const rdoa = dx * oax + dy * oay + dz * oaz
  const oaoa = oax * oax + oay * oay + oaz * oaz
  const qa = baba - bard * bard
  if (qa < 1e-8) {
    // Ray parallel to the axis: only the end caps can be hit.
    const t0 = raySphere(ox, oy, oz, dx, dy, dz, a.x, a.y, a.z, ra)
    const t1 = raySphere(ox, oy, oz, dx, dy, dz, b.x, b.y, b.z, ra)
    if (t0 < 0) return t1
    if (t1 < 0) return t0
    return Math.min(t0, t1)
  }
  const qb = baba * rdoa - baoa * bard
  const qc = baba * oaoa - baoa * baoa - ra * ra * baba
  const h = qb * qb - qa * qc
  if (h < 0) return -1
  const t = (-qb - Math.sqrt(h)) / qa
  const y = baoa + t * bard
  if (y > 0 && y < baba) return t >= 0 ? t : -1
  // Hit past an end: test that end's sphere.
  const cx = y <= 0 ? a.x : b.x
  const cy = y <= 0 ? a.y : b.y
  const cz = y <= 0 ? a.z : b.z
  return raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, ra)
}

function raySphere(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, r: number,
): number {
  const ex = ox - cx
  const ey = oy - cy
  const ez = oz - cz
  const b = ex * dx + ey * dy + ez * dz
  const c = ex * ex + ey * ey + ez * ez - r * r
  const h = b * b - c
  if (h < 0) return -1
  const t = -b - Math.sqrt(h)
  return t >= 0 ? t : -1
}

/** Nearest body hit along a normalised ray, or null. */
export function raycastBody(
  px: number, py: number, pz: number,
  yaw: number, stance: 0 | 1 | 2, eye: number,
  origin: Vector3, dir: Vector3, maxDistance: number,
): ActorHit | null {
  // Cheap bounding-sphere reject.
  const bs = raySphereBound(origin, dir, px, py + 0.9, pz, 1.55)
  if (!bs) return null
  buildShapes(px, py, pz, yaw, stance, eye)
  let best = maxDistance
  let bestZone = -1
  for (let i = 0; i < SHAPES; i++) {
    const t = rayCapsule(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, A[i]!, B[i]!, RADIUS[i]!)
    if (t >= 0 && t < best) {
      best = t
      bestZone = i
    }
  }
  if (bestZone < 0) return null
  return {
    distance: best,
    point: new Vector3(origin.x + dir.x * best, origin.y + dir.y * best, origin.z + dir.z * best),
    zone: ZONES[bestZone]!,
  }
}

function raySphereBound(o: Vector3, d: Vector3, cx: number, cy: number, cz: number, r: number): boolean {
  const ex = o.x - cx
  const ey = o.y - cy
  const ez = o.z - cz
  const c = ex * ex + ey * ey + ez * ez - r * r
  if (c <= 0) return true
  const b = ex * d.x + ey * d.y + ez * d.z
  if (b > 0) return false
  return b * b - c >= 0
}
