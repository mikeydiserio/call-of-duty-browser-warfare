import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Matrix4,
  Mesh,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  HalfFloatType,
} from 'three'
import {
  BlendFunction,
  BloomEffect,
  EdgeDetectionMode,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
} from 'postprocessing'
import type { Environment, RenderContext } from '../core/types'
import { applySkyUniforms, createSkyMaterial, createSkyMesh, installFogChunks, type SkyUniforms } from './sky'
import { createBloodTexture, ScreenFXEffect } from './post'

export interface ScreenEffects {
  /** 0..1 low-health red/blood vignette (MW2 "jam" overlay). */
  damage: number
  /** 0..1 flashbang/explosion whiteout. */
  flash: number
  /** 0..1 death desaturation/blur. */
  dead: number
  /** 0..1 ADS amount (subtle peripheral blur / vignette). */
  ads: number
  /** 0..1 menu background blur/darken. */
  menu: number
  /** Camera shake strength injected by explosions (decays in renderer). */
  shake: number
}

export type Quality = 'low' | 'medium' | 'high'

interface QualityPreset {
  /** Max device pixel ratio. */
  pixelRatio: number
  shadowSize: number
  shadowRadius: number
  bloom: boolean
  bloomLevels: number
  smaa: boolean
  grain: number
  ca: number
  blur: number
}

const PRESETS: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 1, shadowSize: 1024, shadowRadius: 2.2, bloom: true, bloomLevels: 4, smaa: false, grain: 0, ca: 0, blur: 0.6 },
  medium: { pixelRatio: 1.25, shadowSize: 2048, shadowRadius: 2.0, bloom: true, bloomLevels: 6, smaa: true, grain: 0.035, ca: 0.7, blur: 1 },
  high: { pixelRatio: 1.75, shadowSize: 4096, shadowRadius: 1.8, bloom: true, bloomLevels: 8, smaa: true, grain: 0.045, ca: 1, blur: 1 },
}

const DEFAULT_ENV: Environment = {
  sunDirection: new Vector3(-0.5, -0.45, 0.3).normalize(),
  sunColor: 0xffd9a8,
  sunIntensity: 3,
  skyZenith: 0x8fa0ad,
  skyHorizon: 0xd9b98a,
  groundColor: 0x6b5236,
  fogColor: 0xc9a979,
  fogDensity: 0.006,
  exposure: 1,
  haze: 0.5,
}

/** Map footprint the sun shadow must cover (metres): ±45 incl. berms, up to ~16 m tall. */
const SHADOW_HALF_EXTENT = 52
const SHADOW_MAX_HEIGHT = 18

const _q = new Quaternion()
const _q2 = new Quaternion()
const _v = new Vector3()
const _corner = new Vector3()

function damp(a: number, b: number, lambda: number, dt: number) {
  return a + (b - a) * (1 - Math.exp(-lambda * dt))
}

function noise1(t: number, seed: number) {
  return (
    Math.sin(t * 17.3 + seed * 7.1) * 0.5 +
    Math.sin(t * 29.7 + seed * 3.3 + 1.7) * 0.3 +
    Math.sin(t * 47.9 + seed * 5.9 + 4.1) * 0.2
  )
}

export class GameRenderer implements RenderContext {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 1200)
  readonly viewmodelScene = new Scene()
  readonly viewmodelCamera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 10)
  readonly effects: ScreenEffects = { damage: 0, flash: 0, dead: 0, ads: 0, menu: 0, shake: 0 }

  readonly composer: EffectComposer
  readonly sun = new DirectionalLight(0xffffff, 3)
  readonly hemi = new HemisphereLight(0xaabbdd, 0x806040, 0.5)
  readonly vmSun = new DirectionalLight(0xffffff, 3)
  readonly vmHemi = new HemisphereLight(0xaabbdd, 0x806040, 0.5)
  /** Direction pointing TOWARDS the sun (world space). */
  readonly sunToward = new Vector3(0.5, 0.5, -0.3).normalize()
  environment: Environment = DEFAULT_ENV
  quality: Quality = 'high'
  /** Seconds of renderer time (advances with real dt, also while paused). */
  time = 0

  private readonly worldPass: RenderPass
  private readonly vmPass: RenderPass
  private readonly bloomPass: EffectPass
  private readonly bloom: BloomEffect
  private readonly fxPass: EffectPass
  private readonly fx: ScreenFXEffect
  private readonly smaaPass: EffectPass
  private smaaInChain = true
  private readonly skyMat: ShaderMaterial
  private readonly skyMesh: Mesh
  private readonly bakeScene = new Scene()
  private readonly bakeMat: ShaderMaterial
  private readonly pmrem: PMREMGenerator
  private envTarget: WebGLRenderTarget | null = null
  private preset: QualityPreset = PRESETS.high
  private pixelRatio = 1

  private vmSunTarget = 1
  private vmSunVis = 1
  private vmSunBase = 3
  private exposure = 1
  // smoothed overlay values
  private sDead = 0
  private sMenu = 0
  private sAds = 0

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: false,
      stencil: false,
      depth: false,
      powerPreference: 'high-performance',
    })
    const r = this.renderer
    r.outputColorSpace = SRGBColorSpace
    r.toneMapping = NoToneMapping // tone-mapping happens in the post chain (ACES, HDR buffers)
    r.shadowMap.enabled = true
    r.shadowMap.type = PCFShadowMap // soft (Vogel-disk PCF) in r186
    r.info.autoReset = false
    r.setPixelRatio(1)
    r.setSize(innerWidth, innerHeight)
    r.domElement.style.display = 'block'
    // Defensive: the page ships without CSS — kill the default body margin / scrollbars.
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    document.body.style.background = '#000'
    container.appendChild(r.domElement)
    this.camera.rotation.order = 'YXZ'

    // ── lights ───────────────────────────────────────────────────────────────────
    const sun = this.sun
    sun.castShadow = true
    sun.shadow.bias = -0.00035
    sun.shadow.normalBias = 0.035
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 300
    sun.target.position.set(0, 0, 0)
    this.scene.add(sun, sun.target, this.hemi)
    this.viewmodelScene.add(this.vmSun, this.vmHemi)

    // ── sky ──────────────────────────────────────────────────────────────────────
    this.skyMat = createSkyMaterial(false)
    this.skyMesh = createSkyMesh(this.skyMat, 900)
    this.scene.add(this.skyMesh)
    this.bakeMat = createSkyMaterial(true)
    this.bakeScene.add(createSkyMesh(this.bakeMat, 50))
    this.pmrem = new PMREMGenerator(r)

    // ── post chain ───────────────────────────────────────────────────────────────
    this.composer = new EffectComposer(r, { frameBufferType: HalfFloatType, multisampling: 0, depthBuffer: true })
    this.worldPass = new RenderPass(this.scene, this.camera)
    // First-person weapons: separate scene/camera, depth cleared so they never clip into walls,
    // but drawn into the same HDR buffer so they take the same bloom / tone-map / grade.
    this.vmPass = new RenderPass(this.viewmodelScene, this.viewmodelCamera)
    this.vmPass.ignoreBackground = true
    this.vmPass.skipShadowMapUpdate = true
    this.vmPass.clearPass.setClearFlags(false, true, false)
    this.vmPass.clear = true

    this.bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: 1.05,
      luminanceSmoothing: 0.35,
      intensity: 0.85,
      radius: 0.72,
      levels: 8,
    })
    this.bloomPass = new EffectPass(this.camera, this.bloom)
    this.fx = new ScreenFXEffect(createBloodTexture())
    this.fxPass = new EffectPass(this.camera, this.fx)
    const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR })
    // We never use depth-predicated SMAA; dropping the DEPTH attribute avoids a per-frame depth blit.
    ;(smaa as unknown as { attributes: number }).attributes = EffectAttribute.CONVOLUTION
    this.smaaPass = new EffectPass(this.camera, smaa)

    this.composer.addPass(this.worldPass)
    this.composer.addPass(this.vmPass)
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(this.fxPass)
    this.composer.addPass(this.smaaPass)

    this.setEnvironment(DEFAULT_ENV)
    this.setQuality('high')
    this.resize()
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // Environment
  // ═════════════════════════════════════════════════════════════════════════════

  setEnvironment(env: Environment) {
    this.environment = env
    this.exposure = env.exposure
    this.sunToward.copy(env.sunDirection).normalize().negate()

    const sunCol = new Color(env.sunColor)
    const zenith = new Color(env.skyZenith)
    const horizon = new Color(env.skyHorizon)
    const haze = new Color(env.fogColor)
    const ground = new Color(env.groundColor)

    // Fog (exp²) + sun in-scatter chunk so distance melts into the sky horizon.
    this.scene.fog = new FogExp2(env.fogColor, env.fogDensity)
    this.scene.background = null
    installFogChunks(this.sunToward, sunCol)

    // Sky dome uniforms (main view + env bake share the same palette).
    const elevation = Math.max(this.sunToward.y, 0.12)
    const bounce = ground.clone().multiplyScalar((env.sunIntensity * elevation * 0.8) / Math.PI + 0.15)
    const su: SkyUniforms = {
      sunDir: this.sunToward,
      sunCol,
      zenith,
      horizon,
      haze,
      ground: bounce,
      sunBright: 34,
    }
    applySkyUniforms(this.skyMat, su, false)
    applySkyUniforms(this.bakeMat, su, true)

    // PBR reflections / ambient from the sky itself.
    this.envTarget?.dispose()
    this.envTarget = this.pmrem.fromScene(this.bakeScene, 0, 0.1, 200)
    this.scene.environment = this.envTarget.texture
    this.viewmodelScene.environment = this.envTarget.texture
    this.scene.environmentIntensity = 0.55
    this.viewmodelScene.environmentIntensity = 0.55

    // Sun
    this.sun.color.copy(sunCol)
    this.sun.intensity = env.sunIntensity
    this.vmSun.color.copy(sunCol)
    this.vmSunBase = env.sunIntensity
    this.vmSun.intensity = env.sunIntensity * this.vmSunVis
    this.fitSunShadow()

    // Hemisphere fill: cool sky, warm ground bounce.
    const skyFill = zenith.clone().lerp(new Color(0.55, 0.7, 1.0), 0.4)
    const groundFill = ground.clone().lerp(new Color(1.0, 0.72, 0.42), 0.45)
    for (const h of [this.hemi, this.vmHemi]) {
      h.color.copy(skyFill)
      h.groundColor.copy(groundFill)
      h.intensity = 0.55
    }

    this.fx.set('uExposure', env.exposure)
    this.fx.set('uHaze', env.haze)
  }

  /** Position the sun and fit its orthographic shadow frustum tightly around the map volume. */
  private fitSunShadow() {
    const sun = this.sun
    const dist = 140
    sun.position.copy(this.sunToward).multiplyScalar(dist)
    sun.target.position.set(0, 0, 0)
    sun.updateMatrixWorld(true)
    sun.target.updateMatrixWorld(true)
    const cam = sun.shadow.camera
    cam.position.copy(sun.position)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    const inv = new Matrix4().copy(cam.matrixWorld).invert()
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity
    for (const x of [-SHADOW_HALF_EXTENT, SHADOW_HALF_EXTENT]) {
      for (const y of [-1, SHADOW_MAX_HEIGHT]) {
        for (const z of [-SHADOW_HALF_EXTENT, SHADOW_HALF_EXTENT]) {
          _corner.set(x, y, z).applyMatrix4(inv)
          minX = Math.min(minX, _corner.x)
          maxX = Math.max(maxX, _corner.x)
          minY = Math.min(minY, _corner.y)
          maxY = Math.max(maxY, _corner.y)
          minZ = Math.min(minZ, _corner.z)
          maxZ = Math.max(maxZ, _corner.z)
        }
      }
    }
    // Square frustum (better texel density consistency), small pad. Extra depth towards the sun
    // so tall casters just outside the box still shadow the playable area.
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const half = Math.max(maxX - minX, maxY - minY) / 2 + 1.5
    cam.left = cx - half
    cam.right = cx + half
    cam.bottom = cy - half
    cam.top = cy + half
    cam.near = Math.max(0.5, -maxZ - 40)
    cam.far = -minZ + 12
    cam.updateProjectionMatrix()
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // Quality / sizing
  // ═════════════════════════════════════════════════════════════════════════════

  setQuality(q: Quality) {
    this.quality = q
    const p = (this.preset = PRESETS[q])
    this.pixelRatio = Math.min(devicePixelRatio || 1, p.pixelRatio)
    const sh = this.sun.shadow
    if (sh.mapSize.x !== p.shadowSize) {
      sh.mapSize.set(p.shadowSize, p.shadowSize)
      sh.map?.dispose()
      sh.map = null
    }
    sh.radius = p.shadowRadius
    this.bloom.mipmapBlurPass.levels = p.bloomLevels
    this.bloomPass.enabled = p.bloom
    this.fx.set('uGrain', p.grain)
    this.fx.set('uCA', p.ca)
    this.fx.set('uBlurMax', p.blur)
    if (p.smaa && !this.smaaInChain) {
      this.composer.addPass(this.smaaPass)
      this.smaaInChain = true
    } else if (!p.smaa && this.smaaInChain) {
      this.composer.removePass(this.smaaPass)
      this.smaaInChain = false
    }
    this.resize()
  }

  resize() {
    const w = innerWidth
    const h = innerHeight
    this.renderer.setPixelRatio(this.pixelRatio)
    this.composer.setSize(w, h, true)
    this.syncAspect()
  }

  private syncAspect() {
    const a = innerWidth / innerHeight
    if (this.camera.aspect !== a) {
      this.camera.aspect = a
      this.camera.updateProjectionMatrix()
    }
    if (this.viewmodelCamera.aspect !== a) {
      this.viewmodelCamera.aspect = a
      this.viewmodelCamera.updateProjectionMatrix()
    }
  }

  /** 0..1 — how much of the sun reaches the player (0 = standing in shadow). Dims the viewmodel's sun. */
  setViewmodelSunVisibility(v: number) {
    this.vmSunTarget = Math.min(1, Math.max(0, v))
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // Frame
  // ═════════════════════════════════════════════════════════════════════════════

  render(dt: number) {
    dt = Math.min(dt, 0.1)
    this.time += dt
    const fx = this.effects
    const cam = this.camera

    this.syncAspect()
    this.renderer.info.reset()

    // sky follows the camera
    this.skyMesh.position.copy(cam.position)
    this.skyMat.uniforms.uTime!.value = this.time

    // viewmodel lighting: smooth sun visibility, and keep the light direction consistent with
    // the world sun whatever frame the weapons agent keeps the viewmodel camera in.
    this.vmSunVis = damp(this.vmSunVis, this.vmSunTarget, 9, dt)
    this.vmSun.intensity = this.vmSunBase * (0.04 + 0.96 * this.vmSunVis)
    _q.copy(cam.quaternion).invert()
    _q2.copy(this.viewmodelCamera.quaternion)
    _v.copy(this.sunToward).applyQuaternion(_q).applyQuaternion(_q2).multiplyScalar(10)
    this.vmSun.position.copy(_v)
    this.vmSun.target.position.set(0, 0, 0)
    this.vmSun.updateMatrixWorld(true)
    this.vmSun.target.updateMatrixWorld(true)

    // overlay values
    this.sDead = damp(this.sDead, fx.dead, 5, dt)
    this.sMenu = damp(this.sMenu, fx.menu, 7, dt)
    this.sAds = damp(this.sAds, fx.ads, 14, dt)
    fx.flash = Math.max(0, fx.flash - dt * 1.05)
    this.fx.set('uTime', this.time)
    this.fx.set('uDamage', Math.min(1, Math.max(0, fx.damage)))
    this.fx.set('uFlash', Math.min(1, fx.flash))
    this.fx.set('uDead', this.sDead)
    this.fx.set('uMenu', this.sMenu)
    this.fx.set('uAds', this.sAds)

    // camera trauma shake — applied for this render only, then restored
    const trauma = Math.min(1.5, Math.max(0, fx.shake))
    let shaken = false
    const px = cam.position.x
    const py = cam.position.y
    const pz = cam.position.z
    const qx = cam.quaternion.x
    const qy = cam.quaternion.y
    const qz = cam.quaternion.z
    const qw = cam.quaternion.w
    if (trauma > 0.002) {
      const amp = trauma * trauma
      const t = this.time
      const rx = noise1(t, 1) * 0.045 * amp
      const ry = noise1(t, 2) * 0.045 * amp
      const rz = noise1(t, 3) * 0.07 * amp
      _q.setFromAxisAngle(_v.set(1, 0, 0), rx)
      _q2.setFromAxisAngle(_v.set(0, 1, 0), ry)
      _q.multiply(_q2)
      _q2.setFromAxisAngle(_v.set(0, 0, 1), rz)
      _q.multiply(_q2)
      cam.quaternion.multiply(_q)
      _v.set(noise1(t, 4), noise1(t, 5), noise1(t, 6)).multiplyScalar(0.09 * amp).applyQuaternion(cam.quaternion)
      cam.position.add(_v)
      shaken = true
      fx.shake = Math.max(0, trauma - dt * 1.15) * Math.exp(-dt * 0.9)
    } else {
      fx.shake = 0
    }

    this.composer.render(dt)

    if (shaken) {
      cam.position.set(px, py, pz)
      cam.quaternion.set(qx, qy, qz, qw)
      cam.updateMatrixWorld(true)
    }
  }
}
