import type { BufferGeometry, Mesh, MeshStandardMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Textured OpFor character parts converted from the MW2 Insurgency pack
 * (tools/convert_opfor.py). Every part is already skinned to the 17-bone soldier
 * rig in BONE_ORDER, so a soldier is just body + head + kit merged into one
 * geometry sharing one atlas material. Until the kit loads (or if it fails),
 * buildSoldier falls back to the procedural militia.
 */

type Category = 'body' | 'head' | 'kit' | 'glasses' | 'helmet'

interface Part {
  name: string
  geometry: BufferGeometry
}

interface OpforKit {
  parts: Record<Category, Part[]>
  material: MeshStandardMaterial
}

const URL = '/models/opfor/opfor.glb'
/** Heads whose top is bare enough to take the MICH helmet without clipping a head wrap. */
const HELMET_HEADS = new Set(['ARAB_HEAD_5_1'])
/** Heads the glasses were authored against (the civilian VIP set). */
const GLASSES_HEADS = new Set(['ARAB_HEAD_5', 'ARAB_HEAD_5_1', 'ARAB_HEAD_5_2'])

let kit: OpforKit | null = null
let loading: Promise<void> | null = null

/** Start (or join) the background load. Never rejects. */
export function loadOpforKit(): Promise<void> {
  loading ??= new GLTFLoader()
    .loadAsync(URL)
    .then((gltf) => {
      const parts: OpforKit['parts'] = { body: [], head: [], kit: [], glasses: [], helmet: [] }
      let material: MeshStandardMaterial | null = null
      gltf.scene.traverse((o) => {
        const mesh = o as Mesh
        if (!mesh.isMesh) return
        const cut = mesh.name.indexOf('-')
        const category = mesh.name.slice(0, cut) as Category
        parts[category]?.push({ name: mesh.name.slice(cut + 1), geometry: mesh.geometry })
        material ??= mesh.material as MeshStandardMaterial
      })
      if (!material || !parts.body.length || !parts.head.length) throw new Error('opfor.glb is missing parts')
      const mat = material as MeshStandardMaterial
      mat.name = 'opfor'
      mat.envMapIntensity = 0.6
      kit = { parts, material: mat }
    })
    .catch((err: unknown) => {
      console.warn('[opfor] textured models unavailable, using procedural militia', err)
    })
  return loading
}

export function opforKitReady(): boolean {
  return kit !== null
}

export interface OpforBody {
  geometry: BufferGeometry
  material: MeshStandardMaterial
  headgear: string
}

/** Assemble a random OpFor from the loaded parts, or null if the kit isn't loaded. */
export function buildOpforBody(rnd: () => number): OpforBody | null {
  if (!kit) return null
  const pick = <A>(arr: readonly A[]): A => arr[Math.floor(rnd() * arr.length)]!
  const { parts } = kit
  const head = pick(parts.head)
  const chosen = [pick(parts.body), head]
  if (parts.kit.length && rnd() < 0.85) chosen.push(pick(parts.kit))
  let headgear = head.name
  if (HELMET_HEADS.has(head.name) && parts.helmet.length && rnd() < 0.5) {
    chosen.push(parts.helmet[0]!)
    headgear = 'helmet'
  } else if (GLASSES_HEADS.has(head.name) && parts.glasses.length && rnd() < 0.4) {
    chosen.push(parts.glasses[0]!)
  }
  const geometry = mergeGeometries(chosen.map((p) => p.geometry))
  if (!geometry) throw new Error('[opfor] parts have mismatched attributes')
  geometry.computeBoundingSphere()
  return { geometry, material: kit.material, headgear }
}
