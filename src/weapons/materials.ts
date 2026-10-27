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
  makeSteel,
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

/**
 * Procedural edge wear: screen-space curvature (|d normal| / |d position|)
 * picks out bevels and sharp radii, which get polished to bare metal / scuffed
 * polymer — the way real parkerized and anodized finishes wear.
 */
/**
 * Image-based-light multiplier shared by every weapon/arm material. Scene
 * environments override per-material envMapIntensity, so the viewmodel sets
 * this each frame (keeps the gun readable in shade) and the menu preview sets
 * it back to 1 around its own render.
 */
export const IBL_BOOST = { value: 1 }

function wear<T extends MeshStandardMaterial>(m: T, color: number, strength: number): T {
  const wearColor = new Color(color)
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWearColor = { value: wearColor }
    sh.uniforms.uWear = { value: strength }
    sh.uniforms.uIblBoost = IBL_BOOST
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uWearColor;\nuniform float uWear;\nuniform float uIblBoost;')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nradiance *= uIblBoost;\niblIrradiance *= uIblBoost;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float wEdge = 0.0;
        #ifndef FLAT_SHADED
        {
          vec3 wn = normalize(vNormal);
          float curv = length(fwidth(wn)) / max(length(fwidth(vViewPosition)), 1e-6);
          wEdge = smoothstep(180.0, 900.0, curv) * uWear;
          #ifdef USE_ROUGHNESSMAP
          wEdge *= smoothstep(0.2, 0.7, texture2D(roughnessMap, vRoughnessMapUv * 3.1).r + 0.2);
          #endif
        }
        #endif
        diffuseColor.rgb = mix(diffuseColor.rgb, uWearColor, wEdge);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, wEdge);')
  }
  m.customProgramCacheKey = () => 'wpnWear'
  return m
}

/** IBL boost only (no edge wear) for fabric, skin, rubber. */
function ibl<T extends MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uIblBoost = IBL_BOOST
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uIblBoost;')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nradiance *= uIblBoost;\niblIrradiance *= uIblBoost;')
  }
  m.customProgramCacheKey = () => 'wpnIbl'
  return m
}

/**
 * Build the shared material table (idempotent). Reflections come from each
 * scene's `environment` (game sky in first person, studio light in the menu
 * preview), so the same materials work in any renderer.
 */
export function initViewmodelMaterials(): void {
  if (ready) return
  ready = true
  sets.gun = makeGunmetal(0x585c61, 0xa8abae)
  sets.blued = makeGunmetal(0x3e434a, 0x8a8f96)
  sets.steel = makeSteel(0xa4a8ac)
  sets.poly = makePolymer()
  sets.wood = makeWood()
  sets.camo = makeCamo()
  sets.glove = makeGlove()
  sets.skin = makeSkin()
  sets.grenade = makeGrenadeBody()

  table.set('metal', wear(std(sets.gun!, { metalness: 0.75, rough: 1, normalScale: 0.5 }), 0x9a9c9e, 0.85))
  table.set('steel', wear(std(sets.steel!, { metalness: 1, rough: 1, normalScale: 0.4 }), 0xd8dadc, 0.4))
  table.set('blued', wear(std(sets.blued!, { metalness: 0.85, rough: 0.85, normalScale: 0.45 }), 0x7c8086, 0.7))
  table.set('poly', wear(std(sets.poly!, { color: 0x313337, metalness: 0.0, rough: 1, normalScale: 0.5 }), 0x55575a, 0.45))
  table.set('polyTan', wear(std(sets.poly!, { color: 0x8c7a58, metalness: 0.0, rough: 1, normalScale: 0.5 }), 0xb8a888, 0.4))
  table.set('wood', wear(std(sets.wood!, { metalness: 0.0, rough: 1, normalScale: 0.7 }), 0xb06a3a, 0.5))
  table.set('rubber', ibl(std(sets.poly!, { color: 0x1c1c1c, metalness: 0, rough: 1.15, normalScale: 0.9 })))
  table.set('brass', ibl(std(null, { color: 0xc89a3c, metalness: 1, rough: 0.28 })))
  table.set('chrome', ibl(std(null, { color: 0xdadde0, metalness: 1, rough: 0.12 })))
  table.set('void', new MeshStandardMaterial({ color: 0x050505, roughness: 0.9, metalness: 0 }))
  table.set(
    'lens',
    new MeshPhysicalMaterial({ color: 0x0b1620, roughness: 0.05, metalness: 0.0, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.02 }),
  )
  table.set('glass', new MeshStandardMaterial({ color: 0x9fc6ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide, envMapIntensity: 2 }))
  table.set('dot', new MeshBasicMaterial({ color: new Color(1, 0.12, 0.05).multiplyScalar(4), toneMapped: false }))
  table.set('glove', ibl(std(sets.glove!, { color: 0x2a2a26, metalness: 0, rough: 1, normalScale: 0.5 })))
  table.set('skin', ibl(std(sets.skin!, { color: 0xffffff, metalness: 0, rough: 1, normalScale: 0.5 })))
  table.set('camo', ibl(std(sets.camo!, { color: 0xffffff, metalness: 0, rough: 1, normalScale: 1.2 })))
  table.set('strap', ibl(std(sets.glove!, { color: 0x3c3a31, metalness: 0, rough: 1, normalScale: 1.2 })))
  table.set('grenade', ibl(std(sets.grenade!, { color: 0xffffff, metalness: 0.35, rough: 1, normalScale: 1.2 })))
  table.set('watch', new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.3 }))

}

export function mat(k: MatKey): Material {
  const m = table.get(k)
  if (!m) throw new Error(`viewmodel materials not initialised (${k})`)
  return m
}

/** Warm desert-afternoon studio: dark sand floor, hazy horizon, bright sun patch + soft box (menu preview). */
export function makeStudioEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene()
  const geo = new SphereGeometry(50, 48, 32)
  const pos = geo.attributes.position!
  const col = new Float32Array(pos.count * 3)
  const top = new Color(0x8a9cb2)
  const hor = new Color(0xcfc8bc)
  const bot = new Color(0x3c3936)
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
