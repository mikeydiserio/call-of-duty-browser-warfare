import {
  Color,
  DoubleSide,
  MeshStandardMaterial,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import type { Surface } from '../core/types'
import { getTextures, type PBR } from './textures'

export type MatKey =
  | 'sand'
  | 'rock'
  | 'rust'
  | 'rustDark'
  | 'tin'
  | 'tinTan'
  | 'concrete'
  | 'concreteDark'
  | 'wood'
  | 'woodDark'
  | 'diamond'
  | 'grate'
  | 'contBlue'
  | 'contRed'
  | 'contGreen'
  | 'pipeYellow'
  | 'pipeGrey'
  | 'barrelBlue'
  | 'barrelRed'
  | 'generator'
  | 'tank'
  | 'sandbag'
  | 'chain'
  | 'rubber'
  | 'black'
  | 'tarp'
  | 'lamp'
  | 'redwhite'
  | 'dune'

export interface MatDef {
  mat: MeshStandardMaterial
  /** Texture tile size in metres (u / v). */
  tw: number
  th: number
  surface: Surface
}

export type Mats = Record<MatKey, MatDef>

function pbrMat(t: PBR, o: { color?: number; metal?: number; normalScale?: number; side?: boolean; alpha?: boolean } = {}) {
  const m = new MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.orm,
    metalnessMap: t.orm,
    roughness: 1,
    metalness: o.metal ?? 0.6,
    color: o.color ?? 0xffffff,
  })
  const ns = o.normalScale ?? 1
  m.normalScale.set(ns, ns)
  if (o.side) m.side = DoubleSide
  if (o.alpha) m.alphaTest = 0.5
  return m
}

export function createMaterials(): Mats {
  const T = getTextures()
  const def = (mat: MeshStandardMaterial, tw: number, th: number, surface: Surface): MatDef => ({ mat, tw, th, surface })
  const flat = (color: number, rough = 0.9, metal = 0): MeshStandardMaterial =>
    new MeshStandardMaterial({ color, roughness: rough, metalness: metal })

  const lamp = new MeshStandardMaterial({ color: 0x222222, emissive: new Color(0xffc477), emissiveIntensity: 2.2, roughness: 0.4 })
  const tarp = flat(0x5b5a3e, 0.95)
  tarp.side = DoubleSide

  return {
    sand: def(pbrMat(T.sand, { metal: 0 }), 8, 8, 'sand'),
    rock: def(pbrMat(T.rock, { metal: 0 }), 4, 4, 'concrete'),
    rust: def(pbrMat(T.rust), 2, 2, 'metal'),
    rustDark: def(pbrMat(T.rust, { color: 0x8a7a70 }), 2, 2, 'metal'),
    tin: def(pbrMat(T.tin, { side: true }), 1, 2, 'metal'),
    tinTan: def(pbrMat(T.tinTan, { side: true }), 1, 2, 'metal'),
    concrete: def(pbrMat(T.concrete, { metal: 0 }), 3, 3, 'concrete'),
    concreteDark: def(pbrMat(T.concrete, { metal: 0, color: 0xa39d92 }), 3, 3, 'concrete'),
    wood: def(pbrMat(T.wood, { metal: 0 }), 1, 1, 'wood'),
    woodDark: def(pbrMat(T.wood, { metal: 0, color: 0x9c8a78 }), 1, 1, 'wood'),
    diamond: def(pbrMat(T.diamond), 0.5, 0.5, 'metal'),
    grate: def(pbrMat(T.grate, { side: true, alpha: true }), 0.5, 0.5, 'metal'),
    contBlue: def(pbrMat(T.contBlue), 3.05, 2.6, 'metal'),
    contRed: def(pbrMat(T.contRed), 3.05, 2.6, 'metal'),
    contGreen: def(pbrMat(T.contGreen), 3.05, 2.6, 'metal'),
    pipeYellow: def(pbrMat(T.pipeYellow), 1, 2, 'metal'),
    pipeGrey: def(pbrMat(T.pipeGrey), 1, 2, 'metal'),
    barrelBlue: def(pbrMat(T.barrelBlue), 1.8, 0.9, 'metal'),
    barrelRed: def(pbrMat(T.barrelRed), 1.8, 0.9, 'metal'),
    generator: def(pbrMat(T.generator), 1.5, 1.5, 'metal'),
    tank: def(pbrMat(T.tank), 2, 2, 'metal'),
    sandbag: def(pbrMat(T.sandbag, { metal: 0 }), 1, 1, 'sand'),
    chain: def(pbrMat(T.chain, { side: true, alpha: true }), 0.25, 0.25, 'metal'),
    rubber: def(flat(0x1e1c1a, 0.95), 1, 1, 'dirt'),
    black: def(flat(0x141414, 0.7, 0.3), 1, 1, 'metal'),
    tarp: def(tarp, 1, 1, 'dirt'),
    lamp: def(lamp, 1, 1, 'glass'),
    redwhite: def(flat(0xa63a2a, 0.7), 1, 1, 'metal'),
    dune: def(flat(0xffffff, 1), 1, 1, 'sand'),
  }
}

/** Sand terrain material: vertex-coloured, with texture-tile breakup so the 8 m repeat is invisible. */
export function createTerrainMaterial(): MeshStandardMaterial {
  const T = getTextures()
  const m = new MeshStandardMaterial({
    map: T.sand.map,
    normalMap: T.sand.normalMap,
    roughnessMap: T.sand.orm,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  })
  m.normalScale.set(1.1, 1.1)
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    const u = shader.uniforms as Record<string, IUniform>
    void u
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 s1 = texture2D( map, vMapUv );
        vec4 s2 = texture2D( map, vMapUv * 0.2317 + vec2( 0.37, 0.11 ) );
        vec4 s3 = texture2D( map, vMapUv * 3.31 + vec2( 0.52, 0.27 ) );
        vec3 breakup = mix( vec3( 1.0 ), s2.rgb * 1.75, 0.55 );
        vec3 detail = mix( vec3( 1.0 ), s3.rgb * 1.7, 0.3 );
        diffuseColor.rgb *= s1.rgb * breakup * detail;
      #endif`,
    )
  }
  return m
}
