import type { BufferGeometry, Mesh, MeshStandardMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Textured Task Force 141 characters converted from Smoky's CT Afghan Force pack
 * (tools/convert_tf141.py). Each "body-<model>" mesh is a complete operator already
 * skinned to the 17-bone soldier rig in BONE_ORDER, sharing one atlas material.
 * Until the kit loads (or if it fails), buildSoldier falls back to the procedural TF141.
 */

interface Tf141Kit {
  bodies: { name: string; geometry: BufferGeometry }[]
  material: MeshStandardMaterial
}

const URL = '/models/tf141/tf141.glb'
/** What each operator wears on his head, matching the procedural headgear labels. */
const HEADGEAR: Record<string, string> = { ct_sas: 'bare', ct_gign: 'boonie', ct_gsg9: 'balaclava', ct_urban: 'cap' }

let kit: Tf141Kit | null = null
let loading: Promise<void> | null = null

/** Start (or join) the background load. Never rejects. */
export function loadTf141Kit(): Promise<void> {
  loading ??= new GLTFLoader()
    .loadAsync(URL)
    .then((gltf) => {
      const bodies: Tf141Kit['bodies'] = []
      let material: MeshStandardMaterial | null = null
      gltf.scene.traverse((o) => {
        const mesh = o as Mesh
        if (!mesh.isMesh || !mesh.name.startsWith('body-')) return
        bodies.push({ name: mesh.name.slice('body-'.length), geometry: mesh.geometry })
        material ??= mesh.material as MeshStandardMaterial
      })
      if (!material || !bodies.length) throw new Error('tf141.glb is missing bodies')
      const mat = material as MeshStandardMaterial
      mat.name = 'tf141'
      mat.envMapIntensity = 0.6
      kit = { bodies, material: mat }
    })
    .catch((err: unknown) => {
      console.warn('[tf141] textured models unavailable, using procedural operators', err)
    })
  return loading
}

export function tf141KitReady(): boolean {
  return kit !== null
}

export interface Tf141Body {
  geometry: BufferGeometry
  material: MeshStandardMaterial
  headgear: string
}

/** Pick a random operator from the loaded kit, or null if the kit isn't loaded. */
export function buildTf141Body(rnd: () => number): Tf141Body | null {
  if (!kit) return null
  const body = kit.bodies[Math.floor(rnd() * kit.bodies.length)]!
  // Cloned because each rig disposes its own geometry when the soldier is removed.
  return { geometry: body.geometry.clone(), material: kit.material, headgear: HEADGEAR[body.name] ?? 'bare' }
}
