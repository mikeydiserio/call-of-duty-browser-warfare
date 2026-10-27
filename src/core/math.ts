import { Vector3 } from 'three'

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const saturate = (v: number) => clamp(v, 0, 1)
/** Frame-rate independent exponential smoothing. lambda ~ 1/time-constant. */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt))
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
export const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1))
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = saturate((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
export const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}
export const DEG = Math.PI / 180

/** Forward vector for a yaw/pitch pair using the three.js YXZ camera convention (yaw 0 = -Z). */
export function directionFromYawPitch(yaw: number, pitch: number, out = new Vector3()): Vector3 {
  const cp = Math.cos(pitch)
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp)
}

/** Yaw that looks along a horizontal direction (inverse of directionFromYawPitch). */
export const yawFromDirection = (dx: number, dz: number) => Math.atan2(-dx, -dz)

/** Critically-damped spring for procedural animation. */
export class Spring {
  value = 0
  velocity = 0
  constructor(
    public stiffness = 120,
    public damping = 14,
  ) {}
  update(target: number, dt: number) {
    const f = (target - this.value) * this.stiffness - this.velocity * this.damping
    this.velocity += f * dt
    this.value += this.velocity * dt
    return this.value
  }
  impulse(v: number) {
    this.velocity += v
  }
}

/** Deterministic PRNG (mulberry32) for procedural content that must be stable between loads. */
export function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
