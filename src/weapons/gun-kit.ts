import { type AnimationClip, type Group, type Mesh, MeshStandardMaterial, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { WeaponId } from '../core/types'
import { withIblBoost } from './materials'

/**
 * MW2 weapon models converted from the CS 1.6 ports by tools/convert_guns.py:
 *   vm_<id>.glb  first-person viewmodel (MW2 arms + gun, skinned, every sequence as a clip)
 *   world.glb    static gun-only meshes for bots, drops and menu previews
 * Everything streams in the background; callers fall back to the procedural
 * models until it arrives (and permanently for weapons without an MW2 model).
 */

const BASE = '/models/guns/'

/** Weapons that have a converted MW2 model (the RPG-7 stays procedural). */
export const MW2_WEAPONS: readonly WeaponId[] = [
  'acr', 'm4a1', 'ak47', 'ump45', 'intervention', 'rpd', 'aa12', 'spas12', 'usp45', 'deagle', 'g18', 'frag', 'knife',
]

export type V3 = [number, number, number]

export interface Mw2Meta {
  id: WeaponId
  /** Model units -> metres. */
  scale: number
  gunBone: string
  /** Game animation role -> sequence name(s); comma-separated for random picks (shoot). */
  roles: Record<string, string>
  sequences: Record<string, { fps: number; frames: number; duration: number }>
  /** ADS: transform applied to the whole viewmodel (camera space) that centres the sight. */
  ads: { p: V3; q: [number, number, number, number]; relief: number }
  /** Points in j_gun space (model units). */
  sightLocal: V3
  muzzleGun: V3
  muzzleSilGun: V3 | null
  brassGun: V3 | null
}

export interface Mw2Asset {
  /** The "vm" root (camera space, already scaled/rotated) holding skeleton + skinned mesh. */
  root: Group
  clips: Map<string, AnimationClip>
  meta: Mw2Meta
}

const loader = new GLTFLoader()
const viewmodels = new Map<WeaponId, Mw2Asset>()
const vmLoads = new Map<WeaponId, Promise<Mw2Asset | null>>()
const worldModels = new Map<WeaponId, Object3D>()
let worldLoad: Promise<void> | null = null
const listeners = new Set<() => void>()

export function hasMw2(id: WeaponId): boolean {
  return MW2_WEAPONS.includes(id)
}

/** Called whenever another gun model finishes loading. Returns an unsubscribe. */
export function onGunsLoaded(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function notify() {
  for (const cb of listeners) cb()
}

/** Gun textures read as painted metal; MW2 arms are cloth and leather. */
function tuneMaterial(m: MeshStandardMaterial, viewmodel: boolean) {
  const arm = m.name.startsWith('arm:')
  m.metalness = arm ? 0 : 0.35
  m.roughness = arm ? 0.85 : 0.55
  if (viewmodel) withIblBoost(m)
}

/** Start (or join) loading one viewmodel. Never rejects. */
export function loadMw2Viewmodel(id: WeaponId): Promise<Mw2Asset | null> {
  if (!hasMw2(id)) return Promise.resolve(null)
  let p = vmLoads.get(id)
  if (p) return p
  p = loader
    .loadAsync(`${BASE}vm_${id}.glb`)
    .then((gltf) => {
      const root = gltf.scene.getObjectByName('vm') as Group | undefined
      const meta = gltf.scene.userData as Mw2Meta
      if (!root || !meta?.roles) throw new Error(`vm_${id}.glb is missing its rig`)
      const tuned = new Set<MeshStandardMaterial>()
      root.traverse((o) => {
        const mesh = o as Mesh
        if (!mesh.isMesh) return
        mesh.frustumCulled = false
        mesh.castShadow = true
        mesh.receiveShadow = true
        const mat = mesh.material as MeshStandardMaterial
        if (!tuned.has(mat)) {
          tuneMaterial(mat, true)
          tuned.add(mat)
        }
      })
      const asset: Mw2Asset = { root, clips: new Map(gltf.animations.map((c) => [c.name, c])), meta }
      viewmodels.set(id, asset)
      notify()
      return asset
    })
    .catch((err: unknown) => {
      console.warn(`[guns] MW2 viewmodel ${id} unavailable, using procedural model`, err)
      return null
    })
  vmLoads.set(id, p)
  return p
}

export function mw2Viewmodel(id: WeaponId): Mw2Asset | null {
  return viewmodels.get(id) ?? null
}

/** Start (or join) loading the static world models. Never rejects. */
export function loadMw2WorldModels(): Promise<void> {
  worldLoad ??= loader
    .loadAsync(`${BASE}world.glb`)
    .then((gltf) => {
      const tuned = new Set<MeshStandardMaterial>()
      for (const node of [...gltf.scene.children]) {
        if (!node.name.startsWith('world-')) continue
        node.traverse((o) => {
          const mesh = o as Mesh
          if (!mesh.isMesh) return
          mesh.castShadow = true
          const mat = mesh.material as MeshStandardMaterial
          if (!tuned.has(mat)) {
            tuneMaterial(mat, false)
            tuned.add(mat)
          }
        })
        worldModels.set(node.name.slice('world-'.length) as WeaponId, node)
      }
      notify()
    })
    .catch((err: unknown) => {
      console.warn('[guns] MW2 world models unavailable, using procedural models', err)
    })
  return worldLoad
}

/** Template for a weapon's static model (barrel -Z, origin at the grip, "muzzle" child). Clone before use. */
export function mw2WorldModel(id: WeaponId): Object3D | null {
  return worldModels.get(id) ?? null
}

/** Kick off every download: world models first (bots need them), then viewmodels one by one. */
export function preloadGuns(first: WeaponId[] = []): void {
  void loadMw2WorldModels().then(async () => {
    const order = [...new Set([...first, ...MW2_WEAPONS])]
    for (const id of order) await loadMw2Viewmodel(id)
  })
}
