import { type Bone, Group, type Interpolant, Matrix3, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import type { WeaponId } from '../core/types'
import type { Mw2Asset, Mw2Meta } from './gun-kit'

/**
 * One MW2 first-person viewmodel (arms + gun) posed by sampling its clips
 * directly: the WeaponSystem's action timeline decides which sequence and at
 * what time, so reloads/draws stay in lock-step with gameplay. A short
 * crossfade hides sequence changes (GoldSrc never blended them).
 *
 *   holder (procedural sway / recoil / lowering, pivots on the gun)
 *     └ ads (lerps the whole model onto the sight line)
 *         └ vm root (camera space, scaled) — skeleton + skinned mesh
 */

interface Channel {
  target: Object3D
  quat: boolean
  interp: Interpolant
}

interface Clip {
  name: string
  duration: number
  channels: Channel[]
}

// Gun-local axes (x rearward, y right, z up) -> weapon space (+x right, +y up, -z forward).
const GUN_TO_WEAPON = new Matrix4().setFromMatrix3(new Matrix3().set(0, 1, 0, 0, 0, 1, 1, 0, 0))
const WEAPON_IN_GUN = new Quaternion().setFromRotationMatrix(GUN_TO_WEAPON.clone().transpose())

const _q = new Quaternion()
const _v = new Vector3()

export class Mw2Rig {
  readonly id: WeaponId
  readonly meta: Mw2Meta
  /** Outer group: the viewmodel applies procedural motion here. */
  readonly holder = new Group()
  /** ADS blend lives here (camera space). */
  readonly ads = new Group()
  /** Barrel tip, oriented like the procedural rigs (-Z forward, metres). */
  readonly muzzle = new Object3D()
  readonly muzzleSil: Object3D | null = null
  readonly eject = new Object3D()
  /** Gun origin in camera space at the bind pose: the procedural pivot. */
  readonly pivot = new Vector3()
  readonly adsP: Vector3
  readonly adsQ: Quaternion
  private clips = new Map<string, Clip>()
  private bones: Object3D[] = []
  private rest = new Map<Object3D, { p: Vector3; q: Quaternion }>()
  // crossfade state
  private cur: { clip: Clip; t: number } | null = null
  private prev: { clip: Clip; t: number } | null = null
  private fade = 1
  private fadeTime = 0.12
  private silenced = false

  constructor(asset: Mw2Asset) {
    this.meta = asset.meta
    this.id = asset.meta.id
    const root = asset.root
    root.removeFromParent()
    this.ads.add(root)
    this.holder.add(this.ads)
    root.traverse((o) => {
      if ((o as Bone).isBone) {
        this.bones.push(o)
        this.rest.set(o, { p: o.position.clone(), q: o.quaternion.clone() })
      }
    })
    for (const c of asset.clips.values()) {
      const channels: Channel[] = []
      for (const track of c.tracks) {
        const dot = track.name.lastIndexOf('.')
        const target = root.getObjectByName(track.name.slice(0, dot))
        const prop = track.name.slice(dot + 1)
        if (!target || (prop !== 'position' && prop !== 'quaternion')) continue
        channels.push({ target, quat: prop === 'quaternion', interp: track.InterpolantFactoryMethodLinear() })
      }
      this.clips.set(c.name, { name: c.name, duration: c.duration, channels })
    }
    // tags hang off j_gun with weapon-space orientation and metre scale
    const gun = root.getObjectByName(this.meta.gunBone) ?? root
    const s = 1 / this.meta.scale
    const attach = (o: Object3D, p: [number, number, number]) => {
      o.position.set(p[0], p[1], p[2])
      o.quaternion.copy(WEAPON_IN_GUN)
      o.scale.setScalar(s)
      gun.add(o)
    }
    attach(this.muzzle, this.meta.muzzleGun)
    this.muzzle.name = 'muzzle'
    if (this.meta.muzzleSilGun) {
      this.muzzleSil = new Object3D()
      attach(this.muzzleSil, this.meta.muzzleSilGun)
    }
    attach(this.eject, this.meta.brassGun ?? this.meta.muzzleGun)
    root.updateMatrixWorld(true)
    gun.getWorldPosition(this.pivot)
    this.adsP = new Vector3(...this.meta.ads.p)
    this.adsQ = new Quaternion(...this.meta.ads.q)
  }

  get muzzleNode(): Object3D {
    return this.silenced && this.muzzleSil ? this.muzzleSil : this.muzzle
  }

  /** Pick the silenced or bare sequence set (M4A1 / USP park the suppressor off-screen in the bare set). */
  setSilenced(on: boolean) {
    this.silenced = on
  }

  /** Sequence name for a role, honouring the silencer variant; null if this model lacks it. */
  seq(role: string): string | null {
    const roles = this.meta.roles
    const name = (!this.silenced && roles[`${role}_unsil`]) || roles[role]
    if (!name) return null
    if (!name.includes(',')) return name
    const all = name.split(',')
    return all[Math.floor(Math.random() * all.length)]!
  }

  has(role: string): boolean {
    return role in this.meta.roles
  }

  duration(name: string | null): number {
    return name ? (this.clips.get(name)?.duration ?? 0) : 0
  }

  /**
   * Pose the rig at `t` seconds into sequence `name` (clamped; `loop` wraps).
   * Changing sequence starts a crossfade from the last pose; `cut` skips it.
   */
  play(name: string, t: number, dt: number, loop = false, cut = false) {
    const clip = this.clips.get(name)
    if (!clip) return
    const d = clip.duration
    t = d <= 0 ? 0 : loop ? ((t % d) + d) % d : Math.min(Math.max(t, 0), d)
    if (!this.cur || this.cur.clip !== clip) {
      this.prev = cut ? null : this.cur
      this.fade = cut || !this.prev ? 1 : 0
      this.cur = { clip, t }
    }
    this.cur.t = t
    this.fade = Math.min(1, this.fade + dt / this.fadeTime)
    if (this.prev && this.fade < 1) {
      this.apply(this.prev.clip, this.prev.t, 1)
      this.apply(clip, t, this.fade)
    } else {
      this.prev = null
      this.apply(clip, t, 1)
    }
  }

  /** Snap back to the bind pose (idle frame 0) and forget the crossfade. */
  reset() {
    for (const b of this.bones) {
      const r = this.rest.get(b)!
      b.position.copy(r.p)
      b.quaternion.copy(r.q)
    }
    this.cur = this.prev = null
    this.fade = 1
  }

  private apply(clip: Clip, t: number, w: number) {
    for (const ch of clip.channels) {
      const v = ch.interp.evaluate(t) as Float32Array
      const o = ch.target
      if (ch.quat) {
        _q.set(v[0]!, v[1]!, v[2]!, v[3]!)
        if (w >= 1) o.quaternion.copy(_q)
        else o.quaternion.slerp(_q, w)
      } else {
        _v.set(v[0]!, v[1]!, v[2]!)
        if (w >= 1) o.position.copy(_v)
        else o.position.lerp(_v, w)
      }
    }
  }
}
