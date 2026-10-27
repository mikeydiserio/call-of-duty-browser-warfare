import {
  BackSide,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector2,
  type Material,
  type Texture,
  type WebGLRenderer,
} from 'three'
import {
  makeCamo,
  makeGlove,
  makeGrenadeBody,
  makeGunmetal,
  makePolymer,
  makeSkin,
  makeWood,
  type PBRSet,
} from './textures'

export type MatKey =
  | 'metal' // parkerized receiver steel
  | 'steel' // bright steel (bolt, blade, slide)
  | 'blued' // dark blued barrel / slide
  | 'poly' // black polymer
  | 'polyTan' // FDE polymer
  | 'wood'
  | 'rubber'
  | 'brass'
  | 'lens'
  | 'glass'
  | 'dot'
  | 'void'
  | 'glove'
  | 'skin'
  | 'camo'
  | 'strap'
  | 'grenade'
  | 'watch'
  | 'chrome'

/** Approximate flat colours for the baked bot-weapon geometry. */
export const WORLD_COLORS: Partial<Record<MatKey, number>> = {
  metal: 0x2c2e31,
  steel: 0x77797c,
  blued: 0x1b1d20,
  poly: 0x1f2022,
  polyTan: 0x8a7655,
  wood: 0x6b3a1c,
  rubber: 0x141414,
  brass: 0x9a7b36,
  lens: 0x12202c,
  glass: 0x1a2630,
  void: 0x050505,
  grenade: 0x4a5236,
  chrome: 0x9a9a9a,
}

const table = new Map<MatKey, Material>()
let envTex: Texture | null = null
const sets: Record<string, PBRSet> = {}
let ready = false

function std(set: PBRSet | null, o: { color?: number; metalness: number; rough?: number; repeat?: number; normalScale?: number; envI?: number; side?: boolean }): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    metalness: o.metalness,
    roughness: o.rough ?? 1,
    envMapIntensity: o.envI ?? 1,
    side: o.side ? DoubleSide : undefined,
  })
  if (set) {
    m.map = set.map
    m.roughnessMap = set.rough
    m.normalMap = set.normal
    m.normalScale = new Vector2(o.normalScale ?? 1, o.normalScale ?? 1)
  }
  return m
}

/** Build the shared material table. Call once, after a renderer exists. */
export function initViewmodelMaterials(renderer: WebGLRenderer): void {
  if (ready) return
  ready = true
  envTex = makeEnvironment(renderer)
  sets.gun = makeGunmetal(0x34373a, 0x9a9c9e)
  sets.blued = makeGunmetal(0x1d2023, 0x6a6c6e)
  sets.steel = makeGunmetal(0x8c8e90, 0xd0d2d4)
  sets.poly = makePolymer()
  sets.wood = makeWood()
  sets.camo = makeCamo()
  sets.glove = makeGlove()
  sets.skin = makeSkin()
  sets.grenade = makeGrenadeBody()

  table.set('metal', std(sets.gun!, { color: 0xffffff, metalness: 0.8, rough: 0.9, normalScale: 0.35 }))
  table.set('steel', std(sets.steel!, { color: 0xffffff, metalness: 0.95, rough: 0.7, normalScale: 0.5 }))
  table.set('blued', std(sets.blued!, { color: 0xffffff, metalness: 0.9, rough: 0.8, normalScale: 0.6 }))
  table.set('poly', std(sets.poly!, { color: 0x34363a, metalness: 0.0, rough: 1, normalScale: 0.3 }))
  table.set('polyTan', std(sets.poly!, { color: 0x9a8560, metalness: 0.0, rough: 1, normalScale: 0.3 }))
  table.set('wood', std(sets.wood!, { color: 0x9a6f52, metalness: 0.0, rough: 1, normalScale: 0.6 }))
  table.set('rubber', std(sets.poly!, { color: 0x1a1a1a, metalness: 0, rough: 1, normalScale: 0.6 }))
  table.set('brass', std(null, { color: 0xc89a3c, metalness: 1, rough: 0.28 }))
  table.set('chrome', std(null, { color: 0xdadde0, metalness: 1, rough: 0.12 }))
  table.set('void', new MeshStandardMaterial({ color: 0x050505, roughness: 0.9, metalness: 0 }))
  table.set(
    'lens',
    new MeshPhysicalMaterial({ color: 0x0b1620, roughness: 0.05, metalness: 0.0, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.02 }),
  )
  table.set('glass', new MeshStandardMaterial({ color: 0x9fc6ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide, envMapIntensity: 2 }))
  table.set('dot', new MeshBasicMaterial({ color: new Color(1, 0.12, 0.05).multiplyScalar(4), toneMapped: false }))
  table.set('glove', std(sets.glove!, { color: 0x2a2a26, metalness: 0, rough: 1, normalScale: 0.5 }))
  table.set('skin', std(sets.skin!, { color: 0xffffff, metalness: 0, rough: 1, normalScale: 0.5 }))
  table.set('camo', std(sets.camo!, { color: 0xffffff, metalness: 0, rough: 1, normalScale: 1.2 }))
  table.set('strap', std(sets.glove!, { color: 0x3c3a31, metalness: 0, rough: 1, normalScale: 1.2 }))
  table.set('grenade', std(sets.grenade!, { color: 0xffffff, metalness: 0.35, rough: 1, normalScale: 1.2 }))
  table.set('watch', new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.3 }))

  for (const m of table.values()) {
    if ('envMap' in m) (m as MeshStandardMaterial).envMap = envTex
    if (m instanceof MeshStandardMaterial) m.envMapIntensity = (m.envMapIntensity ?? 1) * 1.1
  }
}

export function mat(k: MatKey): Material {
  const m = table.get(k)
  if (!m) throw new Error(`viewmodel materials not initialised (${k})`)
  return m
}

export function getEnvTexture(): Texture | null {
  return envTex
}

/** Warm desert-afternoon studio: dark sand floor, hazy horizon, bright sun patch + soft box. */
function makeEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene()
  const geo = new SphereGeometry(50, 48, 32)
  const pos = geo.attributes.position!
  const col = new Float32Array(pos.count * 3)
  const top = new Color(0x7f98b4)
  const hor = new Color(0xe0c49a)
  const bot = new Color(0x4a3c2c)
  const tmp = new Color()
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50
    if (y > 0) tmp.copy(hor).lerp(top, Math.pow(y, 0.55))
    else tmp.copy(hor).lerp(bot, Math.pow(-y, 0.4))
    col[i * 3] = tmp.r
    col[i * 3 + 1] = tmp.g
    col[i * 3 + 2] = tmp.b
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3))
  const sky = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, toneMapped: false }))
  scene.add(sky)
  // Sun and a big soft box (key light reflections on the metal)
  const sun = new Mesh(new SphereGeometry(5, 16, 12), new MeshBasicMaterial({ color: new Color(1, 0.9, 0.7).multiplyScalar(30), toneMapped: false }))
  sun.position.set(18, 26, 14)
  scene.add(sun)
  const box = new Mesh(new SphereGeometry(10, 16, 12), new MeshBasicMaterial({ color: new Color(0.9, 0.95, 1).multiplyScalar(3.2), toneMapped: false }))
  box.position.set(-30, 18, -10)
  box.scale.set(1, 0.5, 1)
  scene.add(box)
  const pm = new PMREMGenerator(renderer)
  const rt = pm.fromScene(scene, 0.03)
  pm.dispose()
  geo.dispose()
  return rt.texture
}
