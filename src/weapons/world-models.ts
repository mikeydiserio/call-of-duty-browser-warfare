// STUB — owned by the weapons agent. Keep the exported signature; the AI agent uses it for bots.
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three'
import type { WeaponId } from '../core/types'

const mat = new MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 })

/**
 * Third-person weapon model held by bots. Origin at the pistol grip, barrel
 * pointing down -Z, real-world scale in metres. Child named "muzzle" marks the
 * barrel tip (for muzzle flash / tracer origin). Shared geometry/materials —
 * cheap to call many times.
 */
export function createWorldWeaponModel(id: WeaponId): Object3D {
  const g = new Group()
  const len = id === 'intervention' ? 1.2 : id === 'usp45' || id === 'deagle' ? 0.22 : 0.85
  const body = new Mesh(new BoxGeometry(0.06, 0.1, len), mat)
  body.position.set(0, 0.05, -len * 0.35)
  g.add(body)
  const muzzle = new Group()
  muzzle.name = 'muzzle'
  muzzle.position.set(0, 0.06, -len * 0.85)
  g.add(muzzle)
  return g
}
