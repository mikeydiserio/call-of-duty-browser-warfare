/**
 * First-person weapon effects, all living in the viewmodel scene and fully
 * pooled: muzzle flash (3 procedural star variants + side jets + light),
 * muzzle smoke wisps, ejected brass / shotgun shells, dropped magazines.
 */
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  PointLight,
  type Scene,
  type Texture,
  Vector3,
} from 'three'
import { rand } from '../core/math'
import { mat } from './materials'
import { makeFlashTextures, makeSmokeTexture } from './textures'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type BrassKind = 'rifle' | 'pistol' | 'shell' | 'sniper'

interface Particle {
  mesh: Mesh
  vel: Vector3
  spin: Vector3
  life: number
  max: number
}

const GRAVITY = 9.8

export class WeaponFx {
  readonly flash = new Group()
  private flashFront: Mesh
  private flashSideA: Mesh
  private flashSideB: Mesh
  private flashMats: MeshBasicMaterial[]
  private textures: Texture[]
  private flashT = 0
  readonly light = new PointLight(0xffb36b, 0, 3.5, 2)
  private smoke: Particle[] = []
  private smokeI = 0
  private brass: Particle[] = []
  private brassI = 0
  private brassGeo: Record<BrassKind, import('three').BufferGeometry>
  private brassMat: Record<BrassKind, import('three').Material>
  private dropped: { obj: Object3D; vel: Vector3; spin: Vector3; life: number } | null = null
  private droppedParent: Group

  constructor(private scene: Scene) {
    this.textures = makeFlashTextures()
    const mk = () =>
      new MeshBasicMaterial({
        map: this.textures[0]!,
        color: new Color(2.4, 2.1, 1.7),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      })
    this.flashMats = [mk(), mk(), mk()]
    // Front star (faces the camera)
    this.flashFront = new Mesh(new PlaneGeometry(1, 1), this.flashMats[0]!)
    // Side jets: plane in the barrel's vertical/horizontal plane, texture +u along the barrel (-Z).
    const side = new PlaneGeometry(1, 1)
    side.translate(0.5, 0, 0) // starts at the muzzle and extends forward
    side.rotateY(Math.PI / 2) // +x -> -z
    this.flashSideA = new Mesh(side, this.flashMats[1]!)
    const sideB = side.clone()
    sideB.rotateZ(Math.PI / 2)
    this.flashSideB = new Mesh(sideB, this.flashMats[2]!)
    for (const m of [this.flashFront, this.flashSideA, this.flashSideB]) {
      m.frustumCulled = false
      m.renderOrder = 10
      this.flash.add(m)
    }
    this.flash.visible = false
    scene.add(this.light)

    // Smoke wisps
    const smokeTex = makeSmokeTexture()
    const smokeGeo = new PlaneGeometry(1, 1)
    for (let i = 0; i < 14; i++) {
      const m = new Mesh(
        smokeGeo,
        new MeshBasicMaterial({ map: smokeTex, color: 0xb8b0a4, transparent: true, opacity: 0, depthWrite: false, toneMapped: true }),
      )
      m.visible = false
      m.frustumCulled = false
      m.renderOrder = 9
      scene.add(m)
      this.smoke.push({ mesh: m, vel: new Vector3(), spin: new Vector3(), life: 0, max: 1 })
    }

    // Brass
    const caseGeo = (r: number, len: number, neck: number) => {
      const body = new CylinderGeometry(r, r, len * 0.78, 10, 1)
      body.translate(0, len * 0.39, 0)
      const shoulder = new CylinderGeometry(neck, r, len * 0.1, 10, 1)
      shoulder.translate(0, len * 0.83, 0)
      const n = new CylinderGeometry(neck, neck, len * 0.12, 10, 1)
      n.translate(0, len * 0.94, 0)
      const g = mergeGeometries([body.toNonIndexed(), shoulder.toNonIndexed(), n.toNonIndexed()])!
      g.translate(0, -len / 2, 0)
      return g
    }
    const shellHull = new CylinderGeometry(0.0105, 0.0105, 0.052, 12, 1)
    const shellHead = new CylinderGeometry(0.0112, 0.0112, 0.014, 12, 1)
    shellHead.translate(0, -0.03, 0)
    this.brassGeo = {
      rifle: caseGeo(0.0049, 0.045, 0.0032),
      pistol: new CylinderGeometry(0.0059, 0.0059, 0.023, 10, 1),
      sniper: caseGeo(0.0072, 0.07, 0.0045),
      shell: mergeGeometries([shellHull.toNonIndexed(), shellHead.toNonIndexed()], true)!,
    }
    const hullMat = new MeshStandardMaterial({ color: 0x9c1d16, roughness: 0.55, metalness: 0 })
    this.brassMat = { rifle: mat('brass'), pistol: mat('brass'), sniper: mat('brass'), shell: mat('brass') }
    for (let i = 0; i < 24; i++) {
      const m = new Mesh(this.brassGeo.rifle, this.brassMat.rifle)
      m.visible = false
      m.frustumCulled = false
      m.castShadow = false
      scene.add(m)
      this.brass.push({ mesh: m, vel: new Vector3(), spin: new Vector3(), life: 0, max: 1 })
    }
    this.shellMats = [hullMat, mat('brass')]
    this.droppedParent = new Group()
    scene.add(this.droppedParent)
  }

  private shellMats: import('three').Material[]

  /** Re-home the flash onto a weapon's muzzle node. */
  attachFlash(muzzle: Object3D) {
    muzzle.add(this.flash)
  }

  muzzleFlash(scale: number, suppressed = false) {
    if (scale <= 0) return
    const v = (Math.random() * 3) | 0
    const s = scale * rand(0.85, 1.2) * (suppressed ? 0.35 : 1)
    this.flashMats[0]!.map = this.textures[v]!
    this.flashMats[1]!.map = this.textures[(v + 1) % 3]!
    this.flashMats[2]!.map = this.textures[(v + 2) % 3]!
    this.flashFront.scale.setScalar(0.17 * s)
    this.flashFront.rotation.z = Math.random() * Math.PI * 2
    this.flashSideA.scale.set(0.24 * s, 0.11 * s, 1)
    this.flashSideB.scale.set(0.24 * s, 0.11 * s, 1)
    this.flash.rotation.z = Math.random() * Math.PI
    this.flash.visible = true
    this.flashT = 0.05
    this.light.intensity = 9 * scale
  }

  /** Spawn a smoke wisp at a vm-space point. */
  puff(at: Vector3, strength: number) {
    const p = this.smoke[this.smokeI]!
    this.smokeI = (this.smokeI + 1) % this.smoke.length
    p.mesh.position.copy(at)
    p.vel.set(rand(-0.02, 0.02), rand(0.05, 0.12), rand(-0.12, -0.04))
    p.spin.set(0, 0, rand(-1, 1))
    p.life = 0
    p.max = rand(0.7, 1.2) * strength
    p.mesh.scale.setScalar(0.03)
    p.mesh.visible = true
  }

  /** Eject a case from vm-space `at` along vm-space `dir`. */
  eject(kind: BrassKind, at: Vector3, dir: Vector3) {
    const p = this.brass[this.brassI]!
    this.brassI = (this.brassI + 1) % this.brass.length
    p.mesh.geometry = this.brassGeo[kind]
    p.mesh.material = kind === 'shell' ? this.shellMats : this.brassMat[kind]
    p.mesh.position.copy(at)
    const sp = kind === 'shell' ? 1.6 : kind === 'pistol' ? 1.9 : 2.4
    p.vel.copy(dir).multiplyScalar(sp * rand(0.85, 1.15))
    p.vel.x += rand(-0.2, 0.2)
    p.vel.y += rand(-0.1, 0.4)
    p.mesh.rotation.set(0, 0, Math.PI / 2)
    p.spin.set(rand(-25, 25), rand(-10, 10), rand(-35, -15))
    p.life = 0
    p.max = 0.85
    p.mesh.visible = true
  }

  /** Drop a magazine copy (vm space transform taken from `src`). */
  dropMag(src: Object3D) {
    if (this.dropped) this.droppedParent.remove(this.dropped.obj)
    const obj = getDropCopy(src)
    src.updateWorldMatrix(true, false)
    src.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale)
    this.droppedParent.add(obj)
    this.dropped = { obj, vel: new Vector3(rand(-0.1, 0.1), -0.4, 0.05), spin: new Vector3(rand(-3, 3), 0, rand(-4, 4)), life: 0 }
  }

  update(dt: number) {
    if (this.flashT > 0) {
      this.flashT -= dt
      if (this.flashT <= 0) {
        this.flash.visible = false
        this.light.intensity = 0
      } else this.light.intensity *= 0.55
      this.light.position.setFromMatrixPosition(this.flash.matrixWorld)
    }
    for (const p of this.smoke) {
      if (!p.mesh.visible) continue
      p.life += dt
      const t = p.life / p.max
      if (t >= 1) {
        p.mesh.visible = false
        continue
      }
      p.mesh.position.addScaledVector(p.vel, dt)
      p.vel.y += 0.05 * dt
      p.mesh.rotation.z += p.spin.z * dt
      p.mesh.scale.setScalar(0.03 + t * 0.11)
      ;(p.mesh.material as MeshBasicMaterial).opacity = Math.sin(Math.min(1, t * 3) * Math.PI * 0.5) * (1 - t) * 0.22
    }
    for (const p of this.brass) {
      if (!p.mesh.visible) continue
      p.life += dt
      if (p.life >= p.max) {
        p.mesh.visible = false
        continue
      }
      p.vel.y -= GRAVITY * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      p.mesh.rotation.x += p.spin.x * dt
      p.mesh.rotation.y += p.spin.y * dt
      p.mesh.rotation.z += p.spin.z * dt
    }
    const d = this.dropped
    if (d) {
      d.life += dt
      d.vel.y -= GRAVITY * dt
      d.obj.position.addScaledVector(d.vel, dt)
      d.obj.rotation.x += d.spin.x * dt
      d.obj.rotation.z += d.spin.z * dt
      if (d.life > 1.2) {
        this.droppedParent.remove(d.obj)
        this.dropped = null
      }
    }
  }

  reset() {
    this.flash.visible = false
    this.light.intensity = 0
    for (const p of this.smoke) p.mesh.visible = false
    for (const p of this.brass) p.mesh.visible = false
    if (this.dropped) this.droppedParent.remove(this.dropped.obj)
    this.dropped = null
  }

  get flashVisible() {
    return this.flash.visible
  }
}

const dropCopies = new WeakMap<Object3D, Object3D>()
function getDropCopy(src: Object3D): Object3D {
  let c = dropCopies.get(src)
  if (!c) {
    c = src.clone(true) // shares geometry + materials
    dropCopies.set(src, c)
  }
  c.visible = true
  return c
}
