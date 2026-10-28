/**
 * Loader for the imported MW2 "mp_rust" geometry (converted from assets-src/maps/mp_rust.obj by
 * tools/convert_rust_obj.ts). The binary is fetched once before the game boots; building the
 * map from it is then synchronous like every other map.
 *
 * The source has no textures, so each CoD material name is mapped onto one of our procedural
 * PBR materials (UVs are box-projected in world metres to match their tile sizes). CoD blend
 * decals become translucent overlays that never collide.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from 'three'
import type { Surface } from '../../core/types'
import { projectBoxUV } from '../builder'
import type { CollisionWorld } from '../collision'
import type { MatKey, Mats } from '../materials'

interface GroupInfo {
  name: string
  decal: boolean
  vertices: number
  indices: number
  index32: boolean
  pos: number
  nor: number
  idx: number
}

interface Header {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  groups: GroupInfo[]
}

export interface RustObjAssets {
  header: Header
  body: ArrayBuffer
  minimap: HTMLImageElement
}

const BASE = import.meta.env.BASE_URL
let assets: RustObjAssets | null = null
let loading: Promise<RustObjAssets> | null = null

/** Fetch the converted map + its baked minimap. Call (and await) before the first buildMap('rust'). */
export function preloadRustMap(): Promise<RustObjAssets> {
  loading ??= (async () => {
    const [bin, minimap] = await Promise.all([
      fetch(`${BASE}maps/mp_rust.bin`).then((r) => {
        if (!r.ok) throw new Error(`mp_rust.bin: HTTP ${r.status}`)
        return r.arrayBuffer()
      }),
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('mp_rust_minimap.png failed to load'))
        img.src = `${BASE}maps/mp_rust_minimap.png`
      }),
    ])
    const dv = new DataView(bin)
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3))
    if (magic !== 'RMAP' || dv.getUint32(4, true) !== 1) throw new Error('mp_rust.bin: unsupported format — re-run tools/convert_rust_obj.ts')
    const len = dv.getUint32(8, true)
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(bin, 12, len))) as Header
    const bodyStart = 12 + ((len + 3) & ~3)
    assets = { header, body: bin.slice(bodyStart), minimap }
    return assets
  })()
  return loading
}

export function rustAssets(): RustObjAssets {
  if (!assets) throw new Error('Rust map geometry not loaded — await preloadRustMap() first')
  return assets
}

// ─── material mapping ────────────────────────────────────────────────────

interface Look {
  mat: MatKey
  /** false = visual only. */
  col: boolean
  surface?: Surface
  tint?: number
}

/** First match wins. Names are the CoD material names from the export. */
const LOOKS: [RegExp, Look][] = [
  [/water/, { mat: 'black', col: false, surface: 'water' }],
  [/wire/, { mat: 'black', col: false }],
  [/vegitation/, { mat: 'tarp', col: false }],
  [/fence_chainlink/, { mat: 'chain', col: true, surface: 'metal' }],
  [/floorgrate|grating/, { mat: 'grate', col: true }],
  [/diamondplate/, { mat: 'diamond', col: true }],
  [/window/, { mat: 'black', col: true, surface: 'glass' }],
  [/door/, { mat: 'panel', col: true }],
  [/cargocontainerwhite/, { mat: 'tinTan', col: true, tint: 0xe6e1d4 }],
  [/cargocontainer/, { mat: 'rustDark', col: true }],
  [/aluminum_siding/, { mat: 'tin', col: true }],
  [/fire_esc|rust_03/, { mat: 'rustDark', col: true }],
  [/rust/, { mat: 'rust', col: true }],
  [/wood_wall_siding_lightgreen/, { mat: 'wood', col: true, tint: 0x9fb39a }],
  [/wood/, { mat: 'wood', col: true }],
  [/plaster|stonewall|concretewall/, { mat: 'concreteDark', col: true }],
  [/concrete/, { mat: 'concrete', col: true }],
  [/rock|cliff/, { mat: 'rock', col: true, surface: 'dirt' }],
  [/dirt|sand|grass|ground/, { mat: 'sand', col: true }],
]
const FALLBACK: Look = { mat: 'concrete', col: true }

function lookFor(name: string): Look {
  for (const [re, look] of LOOKS) if (re.test(name)) return look
  return FALLBACK
}

function decalMaterial(base: MeshStandardMaterial, name: string): MeshStandardMaterial {
  const m = base.clone()
  m.transparent = true
  m.depthWrite = false
  m.polygonOffset = true
  m.polygonOffsetFactor = -1
  m.polygonOffsetUnits = -4
  if (/oil|stain|grime/.test(name)) {
    m.map = null
    m.color = new Color(0x231d17)
    m.opacity = 0.5
  } else {
    // a darker, browner pass of the same surface breaks up the large repeats
    m.color = new Color(0x9b8a74)
    m.opacity = 0.45
  }
  return m
}

const _m = new Matrix4()

/**
 * Add the imported geometry under `root` and register its solid parts with `collision`.
 * Returns the yard bounds and a ground probe over the visual meshes (usable before
 * collision.build()).
 */
export function buildRustGeometry(root: Group, collision: CollisionWorld, mats: Mats) {
  const { header, body } = rustAssets()
  const b = header.bounds
  // collide only near the yard; the backdrop beyond the perimeter walls is scenery
  const colMinX = b.minX - 10, colMaxX = b.maxX + 10, colMinZ = b.minZ - 10, colMaxZ = b.maxZ + 10
  const colTris: Partial<Record<Surface, number[]>> = {}
  const solid: Mesh[] = []
  const decalMats = new Map<MeshStandardMaterial, MeshStandardMaterial>()
  let tris = 0

  for (const g of header.groups) {
    const look = lookFor(g.name)
    const def = mats[look.mat]
    const pos = new Float32Array(body, g.pos, g.vertices * 3)
    const nor = new Int8Array(body, g.nor, g.vertices * 3)
    const idx = g.index32 ? new Uint32Array(body, g.idx, g.indices) : new Uint16Array(body, g.idx, g.indices)

    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('normal', new BufferAttribute(nor, 3, true))
    geo.setIndex(new BufferAttribute(idx, 1))
    projectBoxUV(geo, 1 / def.tw, 1 / def.th)
    geo.computeBoundingBox()
    geo.computeBoundingSphere()

    let mat = def.mat
    if (g.decal) {
      let dm = decalMats.get(mat)
      if (!dm || /oil|stain|grime/.test(g.name)) {
        dm = decalMaterial(mat, g.name)
        if (!/oil|stain|grime/.test(g.name)) decalMats.set(mat, dm)
      }
      mat = dm
    } else if (look.tint !== undefined) {
      mat = mat.clone()
      mat.color.setHex(look.tint)
    }
    const mesh = new Mesh(geo, mat)
    mesh.name = `rust_${g.name}`
    mesh.castShadow = !g.decal && look.surface !== 'water'
    mesh.receiveShadow = true
    if (g.decal) mesh.renderOrder = 1
    root.add(mesh)
    tris += g.indices / 3

    if (g.decal || !look.col) continue
    solid.push(mesh)
    const out = (colTris[look.surface ?? def.surface] ??= [])
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]! * 3, c = idx[t + 1]! * 3, d = idx[t + 2]! * 3
      const cx = (pos[a]! + pos[c]! + pos[d]!) / 3
      const cz = (pos[a + 2]! + pos[c + 2]! + pos[d + 2]!) / 3
      if (cx < colMinX || cx > colMaxX || cz < colMinZ || cz > colMaxZ) continue
      out.push(pos[a]!, pos[a + 1]!, pos[a + 2]!, pos[c]!, pos[c + 1]!, pos[c + 2]!, pos[d]!, pos[d + 1]!, pos[d + 2]!)
    }
  }

  let colCount = 0
  for (const [surface, list] of Object.entries(colTris) as [Surface, number[]][]) {
    const cg = new BufferGeometry()
    cg.setAttribute('position', new BufferAttribute(new Float32Array(list), 3))
    collision.addGeometry(cg, _m.identity(), surface)
    cg.dispose()
    colCount += list.length / 9
  }

  // Ground probe for placing props before the collision BVH exists.
  const ray = new Raycaster()
  const down = new Vector3(0, -1, 0)
  const from = new Vector3()
  const groundAt = (x: number, z: number, fromY = 40) => {
    ray.set(from.set(x, fromY, z), down)
    ray.far = fromY + 20
    const hit = ray.intersectObjects(solid, false)[0]
    return hit ? hit.point.y : 0
  }

  return { bounds: { ...b }, groundAt, visTris: tris, colTris: colCount }
}
