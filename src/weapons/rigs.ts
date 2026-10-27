/** Assembles procedural weapon models into animatable viewmodel rigs (cached per weapon). */
import { Euler, type Group, Object3D, Quaternion, Vector3 } from 'three'
import type { WeaponId } from '../core/types'
import type { Builder } from './geo'
import { mat } from './materials'
import { buildFrag, buildIntervention, buildKnife } from './models-extra'
import { buildDeagle, buildSPAS12, buildUSP } from './models-other'
import { buildACR, buildAK47, buildM4A1, buildUMP45, type ModelSpec } from './models-rifles'
import type { RigMeta, Sock, WeaponRig } from './rig'

export const BUILDERS: Record<WeaponId, () => ModelSpec> = {
  acr: buildACR,
  m4a1: buildM4A1,
  ak47: buildAK47,
  ump45: buildUMP45,
  intervention: buildIntervention,
  spas12: buildSPAS12,
  usp45: buildUSP,
  deagle: buildDeagle,
  frag: buildFrag,
  knife: buildKnife,
}

const specCache = new Map<WeaponId, ModelSpec>()
/** Builder + metadata for a weapon (geometry generated once, shared by viewmodel and world model). */
export function getSpec(id: WeaponId): ModelSpec {
  let s = specCache.get(id)
  if (!s) specCache.set(id, (s = BUILDERS[id]()))
  return s
}

/** A sock as a ready-to-blend position + quaternion. */
export interface Pose {
  p: Vector3
  q: Quaternion
  grip: number[]
}

export function poseOf(s: Sock): Pose {
  return {
    p: new Vector3(...s.p),
    q: new Quaternion().setFromEuler(new Euler(s.r[0], s.r[1], s.r[2], 'YXZ')),
    grip: s.grip.slice(),
  }
}

export interface ViewRig extends WeaponRig {
  poses: { rh: Pose; lh: Pose; magHold?: Pose; chargeHold?: Pose; loadHold?: Pose }
  /** Rest transforms of animated parts, so animation can be applied as offsets. */
  rest: Record<string, { p: Vector3; q: Quaternion }>
  /** Mag geometry container (for spawning dropped mag copies). */
  mag: Group | null
}

const rigCache = new Map<WeaponId, ViewRig>()

export function getViewRig(id: WeaponId): ViewRig {
  let r = rigCache.get(id)
  if (r) return r
  const spec = getSpec(id)
  const { root, parts } = (spec.b as Builder).build(mat, true)
  const meta: RigMeta = spec.meta
  root.name = `vm_${id}`
  const muzzle = new Object3D()
  muzzle.position.set(...meta.muzzle)
  muzzle.name = 'muzzle'
  root.add(muzzle)
  const eject = new Object3D()
  eject.position.set(...meta.eject)
  root.add(eject)
  const rest: ViewRig['rest'] = {}
  for (const [k, g] of Object.entries(parts)) rest[k] = { p: g.position.clone(), q: g.quaternion.clone() }
  r = {
    id,
    meta,
    root,
    parts,
    muzzle,
    eject,
    sight: new Vector3(...meta.sight),
    poses: {
      rh: poseOf(meta.rh),
      lh: poseOf(meta.lh),
      magHold: meta.magHold ? poseOf(meta.magHold) : undefined,
      chargeHold: meta.chargeHold ? poseOf(meta.chargeHold) : undefined,
      loadHold: meta.loadHold ? poseOf(meta.loadHold) : undefined,
    },
    rest,
    mag: parts.mag ?? null,
  }
  rigCache.set(id, r)
  return r
}

