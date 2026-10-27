/**
 * First-person viewmodel: arms + weapon rigs, procedural spring-driven
 * animation (MW2 feel) and pooled effects. Lives in the renderer's
 * viewmodelScene; the viewmodel camera stays at the origin looking down -Z,
 * so "camera space" == viewmodel world space.
 *
 * The WeaponSystem owns gameplay state and hands us an AnimInput each frame;
 * everything here is presentation only.
 */
import { Euler, Group, Mesh, MeshStandardMaterial, type PerspectiveCamera, Quaternion, type Scene, Vector3 } from 'three'
import type { RenderContext, WeaponId } from '../core/types'
import { clamp, damp, lerp, smoothstep, Spring } from '../core/math'
import type { MovementState } from './weapon-system'
import { Arm } from './hands'
import { initViewmodelMaterials, mat } from './materials'
import { getViewRig, type Pose, type ViewRig } from './rigs'
import { type BrassKind, WeaponFx } from './fx'
import { CylinderGeometry } from 'three'

export type ActionKind =
  | 'none'
  | 'reload'
  | 'shellStart'
  | 'shell'
  | 'shellEnd'
  | 'bolt'
  | 'pump'
  | 'drop'
  | 'raise'
  | 'knife'
  | 'fragPull'
  | 'fragHold'
  | 'fragThrow'

export interface AnimInput {
  action: ActionKind
  /** 0..1 progress through the action (fragHold: seconds held). */
  u: number
  /** The current reload started from an empty magazine. */
  empty: boolean
  /** Rounds in the magazine (pistol slide lock). */
  ammo: number
  ads: number
  sprint: number
  ladder: number
  move: MovementState
  time: number
  /** Extra smoothing time for the very first raise after spawning. */
  firstRaise: boolean
}

export const VM_FOV = 52
const VM_FOV_ADS = 40

const seg = (u: number, a: number, b: number) => smoothstep(a, b, u)
const easeIO = (t: number) => t * t * (3 - 2 * t)

// temps
const _p = new Vector3()
const _q = new Quaternion()
const _q2 = new Quaternion()
const _v = new Vector3()
const _v2 = new Vector3()
const _e = new Euler(0, 0, 0, 'YXZ')
const IDQ = new Quaternion()

/** A blendable hand target in some holder's space. */
interface HandTarget {
  p: Vector3
  q: Quaternion
  grip: number[]
}
const mkTarget = (): HandTarget => ({ p: new Vector3(), q: new Quaternion(), grip: [0, 0, 0, 0, 0] })
function setT(t: HandTarget, p: Pose) {
  t.p.copy(p.p)
  t.q.copy(p.q)
  for (let i = 0; i < 5; i++) t.grip[i] = p.grip[i]!
}
function blendT(t: HandTarget, b: HandTarget | Pose, w: number) {
  if (w <= 0) return
  t.p.lerp(b.p, w)
  t.q.slerp(b.q, w)
  for (let i = 0; i < 5; i++) t.grip[i] = lerp(t.grip[i]!, b.grip[i]!, w)
}
/** Holder-space target -> camera space. */
function toCam(t: HandTarget, holderPos: Vector3, holderQ: Quaternion) {
  t.p.applyQuaternion(holderQ).add(holderPos)
  t.q.premultiply(holderQ)
}

const OPEN = [0.15, 0.1, 0.12, 0.15, 0.2]

export class Viewmodel {
  readonly root = new Group()
  readonly gun = new Group()
  readonly fx: WeaponFx
  private armR: Arm
  private armL: Arm
  private rig!: ViewRig
  private knife: ViewRig
  private frag: ViewRig
  private knifeHolder = new Group()
  private fragHolder = new Group()
  private shellProp: Mesh
  private scene: Scene
  private cam: PerspectiveCamera

  // poses
  private hipPos = new Vector3()
  private hipQ = new Quaternion()
  private adsPos = new Vector3()
  // anim state
  private bobPhase = 0
  private bobAmp = 0
  private sprintBob = 0
  private crouch = 0
  private prone = 0
  private air = 0
  private swayYaw = new Spring(140, 15)
  private swayPitch = new Spring(140, 15)
  private swayRoll = new Spring(110, 13)
  private kBack = new Spring(260, 20)
  private kPitch = new Spring(240, 19)
  private kYaw = new Spring(220, 18)
  private kRoll = new Spring(200, 16)
  private land = new Spring(150, 13)
  private impact = new Spring(320, 18)
  private slideT = 0
  private lastMagOut = false
  private lastShellEject = -1
  private rh = mkTarget()
  private lh = mkTarget()
  private tmpT = mkTarget()
  private tmpT2 = mkTarget()

  constructor(ctx: RenderContext) {
    initViewmodelMaterials(ctx.renderer)
    this.armR = new Arm(false)
    this.armL = new Arm(true)
    this.scene = ctx.viewmodelScene
    this.cam = ctx.viewmodelCamera
    this.cam.position.set(0, 0, 0)
    this.cam.quaternion.identity()
    this.cam.fov = VM_FOV
    this.cam.near = 0.01
    this.cam.updateProjectionMatrix()
    this.scene.add(this.root)
    this.root.add(this.gun, this.knifeHolder, this.fragHolder)
    this.root.add(this.armR.hand.root, this.armR.forearm.root, this.armL.hand.root, this.armL.forearm.root)
    this.fx = new WeaponFx(this.scene)
    this.knife = getViewRig('knife')
    this.knifeHolder.add(this.knife.root)
    this.knifeHolder.visible = false
    this.frag = getViewRig('frag')
    this.fragHolder.add(this.frag.root)
    this.fragHolder.visible = false
    const shellGeo = new CylinderGeometry(0.0105, 0.0105, 0.066, 12, 1)
    shellGeo.rotateX(Math.PI / 2)
    this.shellProp = new Mesh(shellGeo, new MeshStandardMaterial({ color: 0x9c1d16, roughness: 0.55 }))
    this.shellProp.visible = false
    this.armL.hand.holdPoint.add(this.shellProp)
    const brassCap = new Mesh(new CylinderGeometry(0.0112, 0.0112, 0.014, 12, 1).rotateX(Math.PI / 2).translate(0, 0, 0.033), mat('brass'))
    this.shellProp.add(brassCap)
  }

  /** Pre-build every weapon rig so switching never hitches (call during loading). */
  prewarm(ids: WeaponId[]) {
    for (const id of ids) getViewRig(id)
  }

  setWeapon(id: WeaponId) {
    const r = getViewRig(id)
    if (this.rig === r) return
    if (this.rig) {
      this.gun.remove(this.rig.root)
      this.resetParts(this.rig)
    }
    this.rig = r
    this.gun.add(r.root)
    this.fx.attachFlash(r.muzzle)
    const m = r.meta
    this.hipPos.set(...m.hipPos)
    this.hipQ.setFromEuler(_e.set(m.hipRot[0], m.hipRot[1], m.hipRot[2], 'YXZ'))
    // ADS: put the sight line on the camera axis at eye-relief distance.
    this.adsPos.set(-m.sight[0], -m.sight[1], -m.relief - m.sight[2])
    this.slideT = 0
  }

  get weaponId() {
    return this.rig?.id
  }

  private resetParts(r: ViewRig) {
    for (const [k, g] of Object.entries(r.parts)) {
      const rest = r.rest[k]!
      g.position.copy(rest.p)
      g.quaternion.copy(rest.q)
      g.visible = true
    }
  }

  setVisible(v: boolean) {
    this.root.visible = v
  }

  /** Per-shot feedback: kick springs, flash, smoke, brass, slide blowback. */
  onFire(recoilV: number, recoilH: number, ads: number, cls: string, suppressed: boolean) {
    const m = this.rig.meta
    const a = 1 - ads * 0.55
    const heavy = clamp(recoilV / 1.2, 0.35, 2.5)
    this.kBack.impulse(0.32 * heavy * a + 0.1)
    this.kPitch.impulse((0.9 + Math.random() * 0.4) * heavy * a)
    this.kYaw.impulse((Math.random() - 0.5) * recoilH * 1.6 * a)
    this.kRoll.impulse((Math.random() - 0.35) * 1.4 * heavy * a)
    this.fx.muzzleFlash(m.flashScale ?? 1, suppressed)
    if (cls === 'pistol') this.slideT = 0.06
    if (m.type === 'rifle' || m.type === 'pistol') this.ejectBrass(cls === 'pistol' ? 'pistol' : 'rifle')
    if (Math.random() < (cls === 'sniper' || cls === 'shotgun' ? 1 : 0.35)) {
      this.rig.muzzle.getWorldPosition(_v)
      this.fx.puff(_v, cls === 'sniper' || cls === 'shotgun' ? 1.6 : 1)
    }
  }

  ejectBrass(kind: BrassKind) {
    const r = this.rig
    r.eject.getWorldPosition(_v)
    _v2.set(...r.meta.ejectDir).normalize().applyQuaternion(this.gun.quaternion)
    this.fx.eject(kind, _v, _v2)
  }

  /** Viewmodel muzzle -> NDC (x, y in -1..1). */
  muzzleNdc(out: Vector3): Vector3 {
    const m = this.knifeHolder.visible || this.fragHolder.visible ? this.gun : this.rig.muzzle
    m.updateWorldMatrix(true, false)
    out.setFromMatrixPosition(m.matrixWorld)
    return out.project(this.cam)
  }

  update(dt: number, a: AnimInput) {
    const rig = this.rig
    const meta = rig.meta
    const type = meta.type
    const mv = a.move
    const pistol = type === 'pistol'

    // ── base: hip <-> ADS ──
    const e = easeIO(clamp(a.ads, 0, 1))
    const free = 1 - e * 0.92 // how much "life" the gun has (ADS keeps it steady)
    const pos = _p.copy(this.hipPos).lerp(this.adsPos, e)
    const rot = _q.copy(this.hipQ).slerp(IDQ, e)
    let ox = 0
    let oy = 0
    let oz = 0
    let rx = 0
    let ry = 0
    let rz = 0

    // ── idle breathing ──
    const t = a.time
    oy += Math.sin(t * 1.6) * 0.0018 * free
    ox += Math.sin(t * 0.8) * 0.0009 * free
    rx += Math.sin(t * 1.6 + 0.7) * 0.0045 * free
    rz += Math.sin(t * 0.8 + 0.3) * 0.004 * free

    // ── walk / sprint bob (figure-8) ──
    const grounded = mv.grounded && !mv.onLadder
    const spd = grounded ? clamp(mv.speed / Math.max(mv.maxSpeed, 0.5), 0, 1.25) : 0
    this.bobAmp = damp(this.bobAmp, spd, 9, dt)
    this.sprintBob = damp(this.sprintBob, a.sprint, 8, dt)
    const stepsPerSec = lerp([2.5, 1.9, 1.2][mv.stance]!, 3.3, this.sprintBob)
    if (spd > 0.05) this.bobPhase += stepsPerSec * Math.PI * dt * clamp(0.35 + spd * 0.65, 0.35, 1.2)
    const ph = this.bobPhase
    const amp = this.bobAmp * lerp(1, 2.1, this.sprintBob) * (1 - e * 0.82)
    ox += Math.sin(ph) * 0.0105 * amp
    oy += (Math.cos(2 * ph) * 0.0055 - 0.003) * amp
    rz += Math.sin(ph) * 0.028 * amp
    ry += Math.sin(ph) * 0.012 * amp
    rx += Math.cos(2 * ph) * 0.012 * amp

    // ── stances, air, landing ──
    this.crouch = damp(this.crouch, mv.stance === 1 ? 1 : 0, 9, dt)
    this.prone = damp(this.prone, mv.stance === 2 ? 1 : 0, 7, dt)
    ox += (-0.006 * this.crouch - 0.01 * this.prone) * free
    oy += (0.004 * this.crouch + 0.008 * this.prone) * free
    rz += (0.03 * this.crouch + 0.06 * this.prone) * free
    this.air = damp(this.air, mv.grounded || mv.onLadder ? 0 : 1, 6, dt)
    if (mv.jumped) this.land.impulse(0.18)
    if (mv.landImpulse > 0) this.land.impulse(-clamp(mv.landImpulse, 0, 12) * 0.035)
    const ld = this.land.update(0, dt)
    oy += ld * 0.25 * free - this.air * 0.012 * free
    rx += ld * 0.6 * free + this.air * 0.03 * free

    // ── look sway (gun lags behind the view) ──
    const sx = clamp(mv.lookDX, -60, 60)
    const sy = clamp(mv.lookDY, -60, 60)
    const sway = lerp(1, 0.22, e)
    const sYaw = this.swayYaw.update(sx * 0.0016 * sway, dt)
    const sPitch = this.swayPitch.update(sy * 0.0013 * sway, dt)
    const sRoll = this.swayRoll.update(-sx * 0.0024 * sway, dt)
    ry += sYaw
    rx -= sPitch
    rz += sRoll
    ox -= sYaw * 0.06
    oy += sPitch * 0.05

    // ── recoil ──
    const kb = this.kBack.update(0, dt)
    const kp = this.kPitch.update(0, dt)
    const ky = this.kYaw.update(0, dt)
    const kr = this.kRoll.update(0, dt)
    const im = this.impact.update(0, dt)
    oz += kb * 0.075
    oy += kp * 0.004 + im * 0.02
    rx += kp * 0.055 + im * 0.25
    ry += ky * 0.03
    rz += kr * 0.03

    // ── sprint pose ──
    const sp = easeIO(clamp(a.sprint, 0, 1))
    if (sp > 0) {
      if (pistol) {
        ox += -0.02 * sp
        oy += -0.035 * sp
        oz += 0.03 * sp
        rx += -0.55 * sp
        ry += 0.25 * sp
        rz += 0.2 * sp
      } else {
        ox += -0.02 * sp
        oy += -0.015 * sp
        oz += 0.05 * sp
        rx += -0.18 * sp
        ry += 0.5 * sp
        rz += 0.38 * sp
      }
      // big rhythmic sprint swing
      rz += Math.sin(ph) * 0.06 * sp
      ry += Math.sin(ph) * 0.05 * sp
      oy += Math.abs(Math.cos(ph)) * -0.012 * sp
    }

    // ── action animation ──
    let lower = clamp(a.ladder, 0, 1)
    const act = a.action
    const u = a.u
    // default hand targets (gun space)
    setT(this.rh, rig.poses.rh)
    setT(this.lh, rig.poses.lh)
    let rhOn: 'gun' | 'knife' | 'frag' = 'gun'
    let lhOn: 'gun' | 'frag' | 'free' = 'gun'
    let magOff = 0
    let magVis = true
    let chargeT = 0
    let boltT = 0
    let boltRot = 0
    let pumpT = 0
    let shellVis = false
    // pistol slide: blowback + lock back when empty
    this.slideT = Math.max(0, this.slideT - dt)
    let slideT = this.slideT > 0 ? Math.sin((this.slideT / 0.06) * Math.PI) : 0
    if (pistol && a.ammo === 0 && act !== 'reload' && act !== 'raise' && act !== 'drop') slideT = 1
    const parts = rig.parts

    switch (act) {
      case 'drop':
        lower = Math.max(lower, easeIO(u))
        break
      case 'raise':
        lower = Math.max(lower, 1 - easeIO(clamp(u, 0, 1)))
        if (a.firstRaise) rx += (1 - easeIO(u)) * 0.4
        break
      case 'reload': {
        const empty = a.empty
        const tilt = seg(u, 0.0, 0.16) - seg(u, empty ? 0.86 : 0.8, 1)
        if (pistol) {
          rx += 0.3 * tilt
          rz += -0.35 * tilt
          ry += 0.15 * tilt
          ox += -0.02 * tilt
          oy += 0.05 * tilt
        } else {
          rx += 0.3 * tilt
          rz += -0.5 * tilt
          ry += 0.12 * tilt
          ox += -0.06 * tilt
          oy += 0.085 * tilt
          oz += 0.04 * tilt
        }
        // magazine path
        const out = seg(u, 0.14, 0.26) * 0.05 + seg(u, 0.26, 0.4) * 0.32
        const back = 1 - seg(u, 0.44, 0.58)
        const ins = 1 - seg(u, 0.58, 0.66)
        const magIn = u >= 0.42
        if (!magIn) magOff = out
        else magOff = back * 0.37 + ins * 0.05 * (1 - back)
        if (empty && u > 0.18 && u < 0.44) magVis = false
        // magazine drop on empty: free-falling copy
        const dropNow = empty && u > 0.18 && u < 0.44
        if (dropNow && !this.lastMagOut && rig.mag) this.fx.dropMag(rig.mag)
        this.lastMagOut = dropNow
        // left hand: base -> mag -> (pouch) -> mag -> base / charging handle
        const mh = rig.poses.magHold
        if (mh) {
          setT(this.tmpT, mh)
          if (empty && u > 0.18 && u < 0.44) {
            // hand goes to the pouch on its own
            const away = seg(u, 0.2, 0.4)
            this.tmpT.p.y -= away * 0.32
            this.tmpT.p.z += away * 0.06
          } else {
            _v.set(...(rig.meta.magDir ?? [0, -1, 0])).normalize().multiplyScalar(magOff)
            this.tmpT.p.add(_v)
          }
          const toMag = seg(u, 0.04, 0.15) * (1 - seg(u, 0.68, 0.78))
          blendT(this.lh, this.tmpT, toMag)
          // impact when the mag seats
          if (u > 0.64 && u < 0.67) this.impact.velocity += dt * 18
        }
        if (empty) {
          const ch = rig.poses.chargeHold
          if (ch && !pistol) {
            setT(this.tmpT2, ch)
            const w = seg(u, 0.68, 0.74) * (1 - seg(u, 0.84, 0.92))
            chargeT = seg(u, 0.74, 0.79) * (1 - seg(u, 0.8, 0.82))
            this.tmpT2.p.z += chargeT * (rig.meta.chargeTravel ?? 0.05)
            blendT(this.lh, this.tmpT2, w)
            if (type === 'bolt') {
              boltRot = seg(u, 0.72, 0.75) * (1 - seg(u, 0.82, 0.85))
              boltT = seg(u, 0.75, 0.78) * (1 - seg(u, 0.79, 0.82))
            }
          } else if (pistol) {
            // slide stays locked until the slide-release flick
            slideT = u < 0.74 ? 1 : 1 - seg(u, 0.74, 0.77)
            if (ch) {
              setT(this.tmpT2, ch)
              const w = seg(u, 0.67, 0.72) * (1 - seg(u, 0.78, 0.88))
              this.tmpT2.p.z += slideT * (rig.meta.travel ?? 0.04)
              blendT(this.lh, this.tmpT2, w)
            }
          }
        }
        break
      }
      case 'bolt': {
        // right hand leaves the grip to work the bolt; gun cants left
        const tilt = seg(u, 0.0, 0.18) - seg(u, 0.78, 1)
        rz += -0.22 * tilt
        rx += 0.06 * tilt
        oy += -0.01 * tilt
        boltRot = seg(u, 0.18, 0.3) * (1 - seg(u, 0.62, 0.72))
        boltT = seg(u, 0.3, 0.44) * (1 - seg(u, 0.5, 0.62))
        if (u >= 0.44 && this.lastShellEject < 0.44) this.ejectBrass('sniper')
        const ch = rig.poses.chargeHold
        if (ch) {
          setT(this.tmpT, ch)
          // follow the handle (rotate up = move up/in, back = +z)
          this.tmpT.p.y += boltRot * 0.035
          this.tmpT.p.x -= boltRot * 0.02
          this.tmpT.p.z += boltT * (rig.meta.travel ?? 0.1)
          blendT(this.rh, this.tmpT, seg(u, 0.04, 0.18) * (1 - seg(u, 0.74, 0.92)))
        }
        break
      }
      case 'pump': {
        pumpT = seg(u, 0.05, 0.32) * (1 - seg(u, 0.42, 0.72))
        if (u >= 0.32 && this.lastShellEject < 0.32) this.ejectBrass('shell')
        rx += 0.05 * pumpT
        rz += 0.04 * pumpT
        oz += 0.01 * pumpT
        break
      }
      case 'shellStart':
      case 'shell':
      case 'shellEnd': {
        // gun rolled right to expose the loading port; left hand feeds shells from below
        const tilt = act === 'shellStart' ? seg(u, 0, 0.8) : act === 'shellEnd' ? 1 - seg(u, 0.1, 0.7) : 1
        rz += 0.5 * tilt
        rx += 0.1 * tilt
        ox += -0.02 * tilt
        const lp = rig.poses.loadHold
        if (lp) {
          setT(this.tmpT, lp)
          if (act === 'shell') {
            // down to the vest, back up with a shell, push it in
            const down = seg(u, 0.0, 0.25) * (1 - seg(u, 0.3, 0.6))
            const push = seg(u, 0.62, 0.8) * (1 - seg(u, 0.84, 1))
            this.tmpT.p.y -= down * 0.22
            this.tmpT.p.z += down * 0.05
            this.tmpT.p.y += push * 0.02
            this.tmpT.p.z -= push * 0.035
            shellVis = u > 0.25 && u < 0.8
            if (u > 0.78 && u < 0.81) this.impact.velocity += dt * 10
          }
          const w = act === 'shellStart' ? seg(u, 0.1, 0.9) : act === 'shellEnd' ? 1 - seg(u, 0.2, 0.8) : 1
          blendT(this.lh, this.tmpT, w)
        }
        if (act === 'shellEnd' && a.empty) {
          pumpT = seg(u, 0.55, 0.72) * (1 - seg(u, 0.78, 0.95))
        }
        break
      }
      case 'knife': {
        // gun ducks down-left, knife slashes right -> left
        const gunOut = seg(u, 0.0, 0.14) * (1 - seg(u, 0.62, 0.95))
        lower = Math.max(lower, gunOut)
        rhOn = 'knife'
        const kh = this.knifeHolder
        kh.visible = u > 0.03 && u < 0.82
        const swing = seg(u, 0.14, 0.34)
        const outW = seg(u, 0.03, 0.14) * (1 - seg(u, 0.55, 0.8))
        kh.position.set(lerp(0.24, -0.14, swing), lerp(-0.07, -0.1, swing) - (1 - outW) * 0.3, lerp(-0.36, -0.42, swing))
        _e.set(lerp(0.25, 0.0, swing), lerp(-0.5, 0.9, swing), lerp(1.35, 1.6, swing), 'YXZ')
        kh.quaternion.setFromEuler(_e)
        break
      }
      case 'fragPull':
      case 'fragHold':
      case 'fragThrow': {
        lower = Math.max(lower, act === 'fragPull' ? seg(u, 0, 0.35) : 1)
        rhOn = 'frag'
        lhOn = 'frag'
        const fh = this.fragHolder
        fh.visible = act !== 'fragThrow' || u < 0.32
        const pin = this.frag.parts.pin
        const spoon = this.frag.parts.spoon
        let x = 0.1
        let y = -0.13
        let z = -0.32
        let px = 0.2
        let py = 0.1
        let pz = 0.0
        if (act === 'fragPull') {
          const up = seg(u, 0.15, 0.55)
          y = lerp(-0.4, -0.13, up)
          const pull = seg(u, 0.62, 0.88)
          if (pin) pin.position.set(this.frag.rest.pin!.p.x - pull * 0.09, this.frag.rest.pin!.p.y + pull * 0.02, this.frag.rest.pin!.p.z + pull * 0.03)
          if (pin) pin.visible = true
          if (spoon) spoon.rotation.z = 0
          lhOn = u > 0.4 ? 'frag' : 'free'
        } else if (act === 'fragHold') {
          // wind-up: arm cocked back, slight cook tremble
          const w = seg(u, 0, 0.35)
          x = lerp(0.1, 0.2, w)
          y = lerp(-0.13, -0.07, w)
          z = lerp(-0.32, -0.2, w)
          px += w * 0.6
          py -= w * 0.3
          pz += w * 0.2
          if (pin) pin.visible = false
          if (spoon) spoon.rotation.z = 0
          lhOn = 'free'
        } else {
          const th = seg(u, 0.0, 0.32)
          x = lerp(0.2, -0.02, th)
          y = lerp(-0.07, 0.02, th) - seg(u, 0.32, 0.75) * 0.35
          z = lerp(-0.2, -0.55, th)
          px = lerp(0.8, -0.6, th)
          py = 0.0
          if (pin) pin.visible = false
          if (spoon) spoon.rotation.z = th * 1.2
          lhOn = 'free'
        }
        fh.position.set(x, y, z)
        _e.set(px, py, pz, 'YXZ')
        fh.quaternion.setFromEuler(_e)
        break
      }
    }
    this.lastShellEject = act === 'bolt' || act === 'pump' ? u : -1
    if (act !== 'knife') this.knifeHolder.visible = false
    if (act !== 'fragPull' && act !== 'fragHold' && act !== 'fragThrow') this.fragHolder.visible = false

    // ── lowered (switch / ladder / knife / frag) ──
    if (lower > 0) {
      const l = easeIO(lower)
      ox += -0.04 * l
      oy += -0.26 * l
      oz += 0.06 * l
      rx += -0.7 * l
      rz += 0.35 * l
      ry += 0.2 * l
    }

    // ── compose gun transform ──
    this.gun.position.set(pos.x + ox, pos.y + oy, pos.z + oz)
    _e.set(rx, ry, rz, 'YXZ')
    _q2.setFromEuler(_e)
    this.gun.quaternion.copy(rot).multiply(_q2)
    this.gun.visible = lower < 0.995 || rhOn === 'gun'

    // ── parts ──
    const rest = rig.rest
    if (parts.mag && rest.mag) {
      _v.set(...(rig.meta.magDir ?? [0, -1, 0])).normalize().multiplyScalar(magOff)
      parts.mag.position.copy(rest.mag.p).add(_v)
      parts.mag.rotation.x = magOff * (pistol ? 0 : -0.6)
      parts.mag.visible = magVis
    }
    if (parts.charge && rest.charge) parts.charge.position.z = rest.charge.p.z + chargeT * (rig.meta.chargeTravel ?? 0.05)
    if (parts.slide && rest.slide) parts.slide.position.z = rest.slide.p.z + slideT * (rig.meta.travel ?? 0.04)
    if (parts.pump && rest.pump) parts.pump.position.z = rest.pump.p.z + pumpT * (rig.meta.travel ?? 0.08)
    if (parts.bolt && rest.bolt) parts.bolt.position.z = rest.bolt.p.z + boltT * (rig.meta.travel ?? 0.1)
    if (parts.boltHandle) parts.boltHandle.rotation.z = boltRot * 1.15
    // pump hand follows the fore-end
    if (type === 'pump' && pumpT > 0) this.lh.p.z += pumpT * (rig.meta.travel ?? 0.08)
    this.shellProp.visible = shellVis

    // ── hands ──
    this.gun.updateMatrix()
    // right
    if (rhOn === 'gun') toCam(this.rh, this.gun.position, this.gun.quaternion)
    else {
      const holder = rhOn === 'knife' ? this.knifeHolder : this.fragHolder
      const r = rhOn === 'knife' ? this.knife : this.frag
      setT(this.rh, r.poses.rh)
      toCam(this.rh, holder.position, holder.quaternion)
    }
    // left
    if (lhOn === 'gun') toCam(this.lh, this.gun.position, this.gun.quaternion)
    else if (lhOn === 'frag') {
      setT(this.lh, this.frag.poses.lh)
      toCam(this.lh, this.fragHolder.position, this.fragHolder.quaternion)
    } else {
      // relaxed, low and out of the way
      this.lh.p.set(-0.16, -0.3, -0.3)
      this.lh.q.setFromEuler(_e.set(0.4, -0.4, 2.6, 'YXZ'))
      for (let i = 0; i < 5; i++) this.lh.grip[i] = OPEN[i]!
    }
    this.applyHand(this.armR, this.rh)
    this.applyHand(this.armL, this.lh)

    // ── viewmodel FOV ──
    const fov = lerp(VM_FOV, VM_FOV_ADS, e)
    if (Math.abs(this.cam.fov - fov) > 0.01) {
      this.cam.fov = fov
      this.cam.updateProjectionMatrix()
    }

    this.root.updateMatrixWorld(true)
    this.fx.update(dt)
  }

  private applyHand(arm: Arm, t: HandTarget) {
    const h = arm.hand
    h.root.position.copy(t.p)
    h.root.quaternion.copy(t.q)
    h.setGrip(t.grip)
    arm.solve()
  }

  /** Debug: live-tune a hand sock / hip pose of the current rig (weapon space, YXZ euler). */
  debugSock(which: 'rh' | 'lh' | 'magHold' | 'chargeHold' | 'loadHold' | 'hip', p?: number[], r?: number[], grip?: number[], id?: WeaponId) {
    const rig = id ? getViewRig(id) : this.rig
    if (which === 'hip') {
      if (p) this.hipPos.set(p[0]!, p[1]!, p[2]!)
      if (r) this.hipQ.setFromEuler(_e.set(r[0]!, r[1]!, r[2]!, 'YXZ'))
      return
    }
    const pose = rig.poses[which]
    if (!pose) return
    if (p) pose.p.set(p[0]!, p[1]!, p[2]!)
    if (r) pose.q.setFromEuler(_e.set(r[0]!, r[1]!, r[2]!, 'YXZ'))
    if (grip) for (let i = 0; i < 5; i++) pose.grip[i] = grip[i]!
  }

  reset() {
    this.fx.reset()
    this.kBack.value = this.kBack.velocity = 0
    this.kPitch.value = this.kPitch.velocity = 0
    this.kYaw.value = this.kYaw.velocity = 0
    this.kRoll.value = this.kRoll.velocity = 0
    this.land.value = this.land.velocity = 0
    this.lastMagOut = false
    if (this.rig) this.resetParts(this.rig)
    this.resetParts(this.frag)
  }
}
