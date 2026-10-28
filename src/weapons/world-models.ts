// Third-person weapon models for bots, drops and remote players: the textured
// MW2 meshes from world.glb when loaded, otherwise the procedural profiles baked
// into one vertex-coloured mesh per weapon (one draw call).
import { type BufferGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three'
import type { WeaponId } from '../core/types'
import { mw2WorldModel } from './gun-kit'
import { WORLD_COLORS, type MatKey } from './materials'
import { getSpec } from './rigs'

const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.45 })
const geoCache = new Map<WeaponId, BufferGeometry>()

const toRGB = (hex: number): [number, number, number] => {
  // vertex colours are linear
  const c = (v: number) => Math.pow(v / 255, 2.2)
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)]
}

function geometryFor(id: WeaponId): BufferGeometry {
  let g = geoCache.get(id)
  if (g) return g
  const spec = getSpec(id)
  g = spec.b.buildWorld((k: MatKey) => {
    const c = WORLD_COLORS[k]
    return c === undefined ? null : toRGB(c)
  })
  const [gx, gy, gz] = spec.meta.grip
  g.translate(-gx, -gy, -gz)
  g.computeBoundingSphere()
  geoCache.set(id, g)
  return g
}

/**
 * Third-person weapon model held by bots. Origin at the pistol grip, barrel
 * pointing down -Z, real-world scale in metres. Child named "muzzle" marks the
 * barrel tip (for muzzle flash / tracer origin). Shared geometry/materials —
 * cheap to call many times.
 */
export function createWorldWeaponModel(id: WeaponId): Object3D {
  const mw2 = mw2WorldModel(id)
  if (mw2) {
    const copy = mw2.clone()
    copy.name = `wm_${id}`
    copy.position.set(0, 0, 0)
    return copy
  }
  const root = new Group()
  root.name = `wm_${id}`
  const mesh = new Mesh(geometryFor(id), mat)
  mesh.castShadow = true
  mesh.receiveShadow = false
  root.add(mesh)
  const meta = getSpec(id).meta
  const muzzle = new Group()
  muzzle.name = 'muzzle'
  muzzle.position.set(meta.muzzle[0] - meta.grip[0], meta.muzzle[1] - meta.grip[1], meta.muzzle[2] - meta.grip[2])
  root.add(muzzle)
  return root
}
