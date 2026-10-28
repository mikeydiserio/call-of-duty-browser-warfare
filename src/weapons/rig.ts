import type { Group, Object3D, Vector3 } from 'three'
import type { WeaponId } from '../core/types'

export type V3 = [number, number, number]

/** A hand placement in weapon-local space (+ finger curls: thumb, index, middle, ring, pinky). */
export interface Sock {
  p: V3
  /** Euler XYZ-ish (applied in 'YXZ' order). */
  r: V3
  grip: number[]
}

export type RigType = 'rifle' | 'pistol' | 'bolt' | 'pump' | 'launcher' | 'grenade' | 'knife'

export interface RigMeta {
  type: RigType
  /** Pistol-grip centre: origin for the bot (world) model. */
  grip: V3
  muzzle: V3
  /** Ejection port position and ejection direction (weapon space). */
  eject: V3
  ejectDir: V3
  /** ADS aligned sight point (weapon space) and eye relief (distance behind it). */
  sight: V3
  relief: number
  /** Viewmodel hip placement. */
  hipPos: V3
  hipRot: V3
  rh: Sock
  lh: Sock
  /** Magazine: top of the well, direction it leaves the gun, length. */
  magWell?: V3
  magDir?: V3
  /** Left-hand pose holding the magazine while pulling it out / inserting. */
  magHold?: Sock
  /** The 'mag' part leaves with the shot (launcher warhead): hidden while empty, never dropped on reload. */
  magSpent?: boolean
  /** Charging handle / bolt handle grab pose (left hand) and its travel (m, rearward). */
  chargeHold?: Sock
  chargeTravel?: number
  /** Slide / bolt / pump travel in metres. */
  travel?: number
  hasScope?: boolean
  /** Shell entry (shotgun) — left hand pose for inserting shells. */
  loadHold?: Sock
  /** Flash scale multiplier. */
  flashScale?: number
  suppressed?: boolean
}

export interface WeaponRig {
  id: WeaponId
  meta: RigMeta
  root: Group
  parts: Record<string, Group>
  muzzle: Object3D
  eject: Object3D
  sight: Vector3
}
