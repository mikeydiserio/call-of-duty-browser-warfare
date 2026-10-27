/**
 * Menu weapon preview: renders the exact viewmodel weapon rigs (same cached
 * geometry, materials and textures — no arms) on a studio turntable inside a
 * DOM element. One small WebGLRenderer is shared by every preview and by the
 * thumbnail generator; it only renders while a preview is mounted + visible.
 */
import {
  ACESFilmicToneMapping,
  Box3,
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { WeaponId } from '../core/types'
import { IBL_BOOST, initViewmodelMaterials, makeStudioEnvironment } from './materials'
import { getViewRig } from './rigs'

const FOV = 24
/** Muzzle to the right, turned ~25° toward the viewer. */
const HERO_YAW = -Math.PI / 2 + 0.45
const _box = new Box3()
const _size = new Vector3()
const _center = new Vector3()

interface Stage {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  shadow: Mesh
}

let stage: Stage | null = null

function getStage(): Stage {
  if (stage) return stage
  initViewmodelMaterials()
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab;'
  const scene = new Scene()
  scene.environment = makeStudioEnvironment(renderer)
  scene.environmentIntensity = 0.8
  // Warm key (late-afternoon sun), cool rim from behind, soft hemi fill.
  const key = new DirectionalLight(0xfff0dc, 3.4)
  key.position.set(2.5, 3, 3.2)
  const rim = new DirectionalLight(0xbcd2ff, 1.5)
  rim.position.set(-3, 1.6, -3)
  const top = new DirectionalLight(0xffffff, 0.7)
  top.position.set(0, 5, 0.5)
  scene.add(key, rim, top, new HemisphereLight(0xb8c6d8, 0x5a4632, 0.55))
  // Soft contact shadow under the weapon.
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62)
  grd.addColorStop(0, 'rgba(0,0,0,0.55)')
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const shadow = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false }))
  scene.add(shadow)
  const camera = new PerspectiveCamera(FOV, 16 / 9, 0.01, 20)
  stage = { renderer, scene, camera, shadow }
  return stage
}

/** A turntable-ready copy of a weapon rig (shares geometry/materials with the viewmodel). */
interface Model {
  id: WeaponId
  pivot: Group
  radius: number
  height: number
}
const models = new Map<WeaponId, Model>()

function getModel(id: WeaponId): Model {
  let m = models.get(id)
  if (m) return m
  const rig = getViewRig(id)
  const copy = rig.root.clone(true)
  // Rest pose for animated parts; drop viewmodel-only children (muzzle flash).
  for (const [name, rest] of Object.entries(rig.rest)) {
    const part = copy.getObjectByName(name)
    if (part) {
      part.position.copy(rest.p)
      part.quaternion.copy(rest.q)
      part.visible = true
    }
  }
  const flash = copy.getObjectByName('vmFlash')
  flash?.parent?.remove(flash)
  copy.updateMatrixWorld(true)
  _box.setFromObject(copy)
  _box.getSize(_size)
  _box.getCenter(_center)
  copy.position.sub(_center)
  const pivot = new Group()
  pivot.add(copy)
  m = { id, pivot, radius: Math.max(_size.x, _size.y, _size.z) * 0.5, height: _size.y }
  models.set(id, m)
  return m
}

const thumbs = new Map<WeaponId, string>()

/** Side-profile image of a weapon rendered from the real model (cached data URL). */
export function weaponThumbnail(id: WeaponId, w = 240, h = 96): string {
  const key = id
  const hit = thumbs.get(key)
  if (hit) return hit
  const st = getStage()
  const m = getModel(id)
  const prevParent = m.pivot.parent
  const prevRot = m.pivot.rotation.clone()
  const prevScale = m.pivot.scale.x
  // render this model alone: hide whatever the live preview is showing
  const hidden: Group[] = []
  for (const o of models.values()) {
    if (o !== m && o.pivot.visible) {
      o.pivot.visible = false
      hidden.push(o.pivot)
    }
  }
  st.scene.add(m.pivot)
  m.pivot.rotation.set(0.05, -Math.PI / 2 + 0.12, 0)
  m.pivot.scale.setScalar(1)
  st.shadow.visible = false
  st.renderer.setPixelRatio(1)
  st.renderer.setSize(w * 2, h * 2, false)
  frame(st.camera, m, w / h, 1.06, 1.06)
  const boost = IBL_BOOST.value
  IBL_BOOST.value = 1
  st.renderer.render(st.scene, st.camera)
  IBL_BOOST.value = boost
  const url = st.renderer.domElement.toDataURL('image/png')
  st.scene.remove(m.pivot)
  if (prevParent) prevParent.add(m.pivot)
  m.pivot.rotation.copy(prevRot)
  m.pivot.scale.setScalar(prevScale)
  st.shadow.visible = true
  for (const p of hidden) p.visible = true
  active?.refit()
  thumbs.set(key, url)
  return url
}

/**
 * Fit the camera so the model fills the frame: its length spans 1/margin of
 * the width, unless that would make it taller than 1/vMargin of the height
 * (pistols) — so every weapon reads at the same visual size.
 */
function frame(cam: PerspectiveCamera, m: Model, aspect: number, margin: number, vMargin = 1.12) {
  cam.aspect = aspect
  const vt = Math.tan((FOV * Math.PI) / 360)
  const ht = vt * aspect
  const dist = Math.max((m.radius * margin) / ht, (m.height * 0.5 * vMargin) / vt)
  cam.position.set(0, m.radius * 0.18, dist)
  cam.lookAt(0, 0, 0)
  cam.near = dist * 0.05
  cam.far = dist * 4
  cam.updateProjectionMatrix()
}

let active: WeaponPreview | null = null

export class WeaponPreview {
  private host: HTMLElement | null = null
  private visible = false
  private model: Model | null = null
  private yaw = HERO_YAW
  private yawVel = 0
  private idle = 10
  private pitch = 0.1
  private dragging = false
  private lastX = 0
  private lastY = 0
  private spinIn = 1
  private time = 0
  private last = 0
  private raf = 0
  private ro: ResizeObserver | null = null
  private w = 0
  private h = 0
  /** Debug: lock the turntable to a fixed yaw/pitch (radians). */
  debugAngle: [number, number] | null = null
  /** Debug: camera distance multiplier (close-ups). */
  debugZoom = 1

  mount(el: HTMLElement) {
    this.host = el
    if (this.visible) this.attach()
  }

  setVisible(v: boolean) {
    if (v === this.visible) return
    this.visible = v
    if (v) this.attach()
    else this.detach()
  }

  setWeapon(id: WeaponId) {
    if (this.model?.id === id) return
    const st = getStage()
    if (this.model) st.scene.remove(this.model.pivot)
    this.model = getModel(id)
    st.scene.add(this.model.pivot)
    this.spinIn = 0
    this.yaw = HERO_YAW - 1.6 // whip in from behind, settle on the hero angle
    this.yawVel = 0
    this.idle = 1.5
    if (this.host && active === this) {
      const c = st.renderer.domElement
      c.style.transition = 'none'
      c.style.opacity = '0.25'
      void c.offsetWidth
      c.style.transition = 'opacity 0.35s ease-out'
      c.style.opacity = '1'
    }
  }

  dispose() {
    this.detach()
    if (this.model && stage) stage.scene.remove(this.model.pivot)
    this.model = null
    this.host = null
  }

  private attach() {
    if (!this.host) return
    const st = getStage()
    const c = st.renderer.domElement
    if (active && active !== this) active.detach()
    active = this
    this.host.appendChild(c)
    c.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.host)
    this.resize()
    if (this.model && this.model.pivot.parent !== st.scene) st.scene.add(this.model.pivot)
    this.last = performance.now()
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.tick)
  }

  private detach() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro?.disconnect()
    this.ro = null
    if (!stage) return
    const c = stage.renderer.domElement
    c.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    if (active === this) {
      c.remove()
      active = null
    }
  }

  /** Re-apply this preview's canvas size (after the shared renderer was used elsewhere). */
  refit() {
    this.w = this.h = 0
    this.resize()
  }

  private resize() {
    if (!this.host || !stage) return
    const w = Math.max(32, this.host.clientWidth)
    const h = Math.max(32, this.host.clientHeight)
    if (w === this.w && h === this.h) return
    this.w = w
    this.h = h
    stage.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5))
    stage.renderer.setSize(w, h, false)
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true
    this.lastX = e.clientX
    this.lastY = e.clientY
    if (stage) stage.renderer.domElement.style.cursor = 'grabbing'
  }

  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.yaw += dx * 0.012
    this.yawVel = dx * 0.6
    this.idle = 0
    this.pitch = Math.max(-0.5, Math.min(0.6, this.pitch + dy * 0.006))
  }

  private onUp = () => {
    this.dragging = false
    if (stage) stage.renderer.domElement.style.cursor = 'grab'
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000))
    this.last = now
    if (!this.visible || !this.model || !this.host || this.w < 40) return
    this.time += dt
    const st = getStage()
    // drag inertia, then ease back to a gently swaying 3/4 hero angle
    if (!this.dragging && !this.debugAngle) {
      this.yawVel *= Math.exp(-dt * 2.5)
      this.yaw += this.yawVel * dt
      this.idle += dt
      if (this.idle > 1.5) {
        const target = HERO_YAW + Math.sin(this.time * 0.32) * 0.42
        let d = target - this.yaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        this.yaw += d * Math.min(1, dt * 1.2)
      }
      this.pitch += (0.1 - this.pitch) * Math.min(1, dt * 0.8)
    }
    this.yaw %= Math.PI * 2
    if (this.debugAngle) {
      this.yaw = this.debugAngle[0]
      this.pitch = this.debugAngle[1]
      this.yawVel = 0
      this.spinIn = 1
    }
    this.spinIn = Math.max(0, Math.min(1, this.spinIn + dt / 0.5))
    const e = 1 - Math.pow(1 - this.spinIn, 3)
    const extra = (1 - e) * 1.6
    const p = this.model.pivot
    p.rotation.set(this.pitch + Math.sin(this.time * 0.9) * 0.015, this.yaw + extra, Math.sin(this.time * 0.6) * 0.02)
    p.position.y = Math.sin(this.time * 1.3) * this.model.radius * 0.012
    p.scale.setScalar(0.88 + 0.12 * e)
    st.shadow.position.y = -this.model.height * 0.5 - this.model.radius * 0.18
    st.shadow.scale.set(this.model.radius * 2.4, 1, this.model.radius * 1.1)
    frame(st.camera, this.model, this.w / this.h, 1.2 * this.debugZoom, 1.35 * this.debugZoom)
    const boost = IBL_BOOST.value
    IBL_BOOST.value = 1
    st.renderer.render(st.scene, st.camera)
    IBL_BOOST.value = boost
  }
}

// Debug handle for automation.
;(window as unknown as { __preview: unknown }).__preview = { stage: () => stage, active: () => active }
