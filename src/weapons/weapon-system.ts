/**
 * Player weapon gameplay (MW2 rules) + driver for the first-person viewmodel.
 *
 * Exported API is a contract with the player controller and HUD:
 * `WeaponSystem`, `MovementState`, `HudWeaponState`.
 */
import { Euler, Quaternion, Vector3 } from 'three'
import type { Game } from '../core/game'
import { clamp, damp, DEG, directionFromYawPitch, lerp, rand } from '../core/math'
import type { Actor, InputState, Loadout, WeaponDef, WeaponId } from '../core/types'
import { WEAPONS } from './defs'
import { ScopeOverlay } from './scope'
import { type ActionKind, type AnimInput, Viewmodel } from './viewmodel'

/** Per-frame movement info the player controller hands to the weapon system (for bob/sway/sprint pose). */
export interface MovementState {
  /** Horizontal speed m/s. */
  speed: number
  /** Speed at which bob reaches full amplitude (current max for stance). */
  maxSpeed: number
  sprinting: boolean
  grounded: boolean
  stance: 0 | 1 | 2
  /** >0 on the frame the player lands; impact speed m/s. */
  landImpulse: number
  /** True on the frame a jump starts. */
  jumped: boolean
  onLadder: boolean
  /** Raw look delta this frame (pixels) for weapon sway. */
  lookDX: number
  lookDY: number
}

export interface HudWeaponState {
  weaponId: WeaponId
  weaponName: string
  ammo: number
  reserve: number
  magSize: number
  frags: number
  reloading: boolean
  /** Name of the other carried weapon. */
  otherWeaponName: string
  /** Fire mode label e.g. "AUTO" / "SEMI" / "BOLT". */
  fireMode: string
}

interface Slot {
  def: WeaponDef
  mag: number
  reserve: number
}

/** Frag fuse (s) from the moment the pin is pulled. */
const FRAG_FUSE = 3.5
const FRAG_SPEED = 17
/** Seconds after sprinting stops before the weapon can fire (MW2 sprint-out). */
const SPRINT_OUT = { rifle: 0.26, pistol: 0.17 }
const TRACER_EVERY = 3

const _eye = new Vector3()
const _dir = new Vector3()
const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _muzzle = new Vector3()
const _end = new Vector3()
const _ndc = new Vector3()
const _vel = new Vector3()
const _q = new Quaternion()
const _e = new Euler(0, 0, 0, 'YXZ')

export class WeaponSystem {
  current: WeaponDef = WEAPONS.acr
  /** 0..1 aim-down-sights blend. */
  adsAmount = 0
  /** Current hipfire spread in degrees (for the dynamic crosshair). */
  spread = 3
  /** True while the weapon prevents sprinting from starting (e.g. firing). Reload is cancelled by sprint, MW2 style. */
  blocksSprint = false
  /** Multiplier for the world camera FOV (ADS zoom, sniper scope). */
  fovMultiplier = 1
  /** Multiplier for movement speed (weapon mobility, ADS walk). */
  mobility = 1
  /** True while a sniper scope overlay should be drawn instead of the viewmodel. */
  scoped = false
  /** Debug: animation/gameplay time scale (0 freezes; use with `debugPose`). */
  timeScale = 1

  private recoil = { pitch: 0, yaw: 0 }
  private recoilOut = { pitch: 0, yaw: 0 }
  private slots: Slot[] = [
    { def: WEAPONS.acr, mag: 30, reserve: 120 },
    { def: WEAPONS.usp45, mag: 12, reserve: 48 },
  ]
  private slot = 0
  private pendingSlot = 0
  private frags = 1
  private action: ActionKind = 'none'
  private actionT = 0
  private actionDur = 1
  private actionEmpty = false
  private firstRaise = false
  private meleeDone = false
  private fragThrown = false
  private fragReleaseQueued = false
  private cookT = 0
  private cooldown = 0
  private sprintAmt = 0
  private sprintOut = 0
  private ladderAmt = 0
  private adsRaw = 0
  private adsOn = false
  private heat = 0
  private lastShot = -10
  private shotCount = 0
  private fireBuffer = 0
  private time = 0
  private alive = false
  private scopeSwayX = 0
  private scopeSwayY = 0
  private breath = 1
  /** First-person presentation (player only). */
  readonly vm: Viewmodel | null = null
  private scope: ScopeOverlay | null = null
  private anim: AnimInput
  private hud: HudWeaponState
  private lastStageU = 0
  private frameDt = 0

  constructor(
    protected game: Game,
    protected owner: Actor,
  ) {
    this.anim = {
      action: 'none', u: 0, empty: false, ammo: 0, ads: 0, sprint: 0, ladder: 0,
      move: { speed: 0, maxSpeed: 1, sprinting: false, grounded: true, stance: 0, landImpulse: 0, jumped: false, onLadder: false, lookDX: 0, lookDY: 0 },
      time: 0, firstRaise: false,
    }
    this.hud = { weaponId: 'acr', weaponName: 'ACR', ammo: 30, reserve: 120, magSize: 30, frags: 1, reloading: false, otherWeaponName: '', fireMode: 'AUTO' }
    if (owner.isPlayer) {
      const vm = new Viewmodel(game.render)
      ;(this as { vm: Viewmodel | null }).vm = vm
      vm.prewarm(['acr', 'm4a1', 'ak47', 'ump45', 'intervention', 'spas12', 'usp45', 'deagle'])
      vm.setWeapon(this.current.id)
      vm.setVisible(false)
      this.scope = new ScopeOverlay()
      // Debug handle for automation / screenshots.
      ;(window as unknown as { __weapons: WeaponSystem }).__weapons = this
    }
  }

  /** Reset weapons and ammo for a new life. */
  setLoadout(loadout: Loadout) {
    this.slots[0] = this.freshSlot(loadout.primary)
    this.slots[1] = this.freshSlot(loadout.secondary)
    this.slot = this.pendingSlot = 0
    this.current = this.slots[0]!.def
    this.vm?.setWeapon(this.current.id)
  }

  private freshSlot(id: WeaponId): Slot {
    const def = WEAPONS[id]
    return { def, mag: def.magSize, reserve: def.reserve }
  }

  private get slotState(): Slot {
    return this.slots[this.slot]!
  }

  private hasPerk(p: 'sleightOfHand' | 'steadyAim' | 'commando') {
    return this.game.loadout.perks.includes(p)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Frame
  // ═══════════════════════════════════════════════════════════════════════

  /** Called every frame while the owner is alive. */
  update(dt: number, input: InputState, move: MovementState) {
    const realDt = dt
    dt *= this.timeScale
    this.time += dt
    this.frameDt = dt
    const def = this.current
    const st = this.slotState
    const playing = this.game.mode.phase === 'playing'

    // ── sprint & ladder ──
    const sprinting = move.sprinting && !move.onLadder
    const sprintOutTime = def.class === 'pistol' ? SPRINT_OUT.pistol : SPRINT_OUT.rifle
    if (sprinting) this.sprintOut = sprintOutTime
    else this.sprintOut = Math.max(0, this.sprintOut - dt)
    this.sprintAmt = damp(this.sprintAmt, sprinting ? 1 : 0, sprinting ? 9 : 1 / Math.max(0.05, sprintOutTime * 0.45), dt)
    this.ladderAmt = damp(this.ladderAmt, move.onLadder ? 1 : 0, 8, dt)
    if (sprinting && this.isReloading()) this.cancelReload()

    // ── action timeline ──
    if (this.action !== 'none') this.advanceAction(dt, input)

    // ── inputs that start actions ──
    const busyThrow = this.action === 'fragPull' || this.action === 'fragHold' || this.action === 'fragThrow' || this.action === 'knife'
    if (!move.onLadder && !busyThrow) {
      if (input.fragPressed && this.frags > 0 && this.action !== 'drop') this.startFrag()
      else if (input.meleePressed) this.startKnife()
      else if (this.action !== 'drop' && this.action !== 'raise') {
        let want = -1
        if (input.switchPressed) want = 1 - this.slot
        if (input.slot1Pressed && this.slot !== 0) want = 0
        if (input.slot2Pressed && this.slot !== 1) want = 1
        if (want >= 0) this.startSwitch(want)
        else if (input.reloadPressed && this.action === 'none') this.startReload()
      }
    }

    // ── ADS ──
    const reloadingMag = this.action === 'reload'
    const adsBlocked =
      sprinting || move.onLadder || reloadingMag || this.action === 'bolt' || this.action === 'drop' || this.action === 'raise' ||
      this.action === 'knife' || this.action === 'fragPull' || this.action === 'fragHold' || this.action === 'fragThrow' ||
      this.action === 'shellStart' || this.action === 'shell' || this.action === 'shellEnd'
    const adsWant = input.ads && !adsBlocked
    if (adsWant !== this.adsOn) {
      this.adsOn = adsWant
      this.game.events.emit('weapon:ads', { actor: this.owner, on: adsWant })
    }
    const adsRate = 1 / Math.max(0.05, def.adsTime)
    this.adsRaw = clamp(this.adsRaw + (adsWant ? adsRate : -adsRate * 1.25) * dt, 0, 1)
    if (this.debugAdsHold >= 0) this.adsRaw = this.debugAdsHold
    this.adsAmount = this.adsRaw

    // ── firing ──
    this.cooldown -= dt
    this.fireBuffer = Math.max(0, this.fireBuffer - dt)
    if (input.firePressed) this.fireBuffer = 0.25
    const wantFire = def.auto ? input.fire : input.firePressed || (this.fireBuffer > 0 && input.fire)
    // Shell-by-shell reload is interruptible by fire.
    if ((this.action === 'shellStart' || this.action === 'shell') && input.firePressed && st.mag > 0) {
      this.setAction('shellEnd', 0.32 * this.sohMul())
    }
    const ready = playing && this.action === 'none' && this.cooldown <= 0 && this.sprintOut <= 0 && !move.onLadder && this.ladderAmt < 0.1
    let fired = false
    if (ready && wantFire) {
      if (st.mag > 0) {
        fired = true
        this.fireBuffer = 0
      } else if (input.firePressed) {
        this.game.events.emit('weapon:dryfire', { shooter: this.owner, weaponId: def.id })
        this.cooldown = 0.25
        if (st.reserve > 0) this.startReload()
      }
    }
    // MW2 auto-reload once the trigger is released on an empty mag.
    if (playing && this.action === 'none' && st.mag === 0 && st.reserve > 0 && this.cooldown <= 0 && !input.fire && !fired) this.startReload()

    // ── spread ──
    const moveF = clamp(move.speed / Math.max(move.maxSpeed, 0.5), 0, 1) * 0.65 + (move.grounded || move.onLadder ? 0 : 1)
    if (this.time - this.lastShot > 0.09) this.heat = Math.max(0, this.heat - dt * 2.4)
    const stanceMul = move.stance === 2 ? 0.6 : move.stance === 1 ? 0.8 : 1
    const steady = this.hasPerk('steadyAim') ? 0.65 : 1
    this.spread = (def.hipSpread + (def.hipSpreadMax - def.hipSpread) * clamp(this.heat + moveF, 0, 1)) * stanceMul * steady

    // ── sniper scope sway / hold breath ──
    const isSniper = def.class === 'sniper'
    const holdBreath = isSniper && input.sprint && this.adsRaw > 0.9 && this.breath > 0
    this.breath = holdBreath ? Math.max(0, this.breath - dt / 4.5) : Math.min(1, this.breath + dt / 3)
    const swayK = (holdBreath ? 0.12 : 1) * (move.stance === 2 ? 0.35 : move.stance === 1 ? 0.65 : 1)
    const tt = this.time
    this.scopeSwayX = damp(this.scopeSwayX, (Math.sin(tt * 0.9) * 0.6 + Math.sin(tt * 1.7 + 1) * 0.4) * swayK, 4, dt)
    this.scopeSwayY = damp(this.scopeSwayY, (Math.sin(tt * 1.3 + 0.5) * 0.5 + Math.cos(tt * 0.7) * 0.5) * swayK, 4, dt)

    // ── derived outputs ──
    const zoomAds = isSniper ? 0.85 : def.adsZoom
    this.scoped = isSniper && this.adsRaw > 0.9 && this.alive
    this.fovMultiplier = this.scoped ? def.adsZoom : lerp(1, zoomAds, this.adsRaw)
    this.mobility = def.mobility * (1 - this.adsRaw * 0.42)
    this.blocksSprint =
      this.time - this.lastShot < 0.3 || this.action === 'knife' || this.action === 'fragPull' || this.action === 'fragThrow' || this.action === 'bolt'

    // ── viewmodel ──
    const vm = this.vm
    if (vm) {
      const a = this.anim
      a.action = this.action
      a.u = this.action === 'fragHold' ? clamp(this.actionT / 0.6, 0, 1) : clamp(this.actionT / this.actionDur, 0, 1)
      a.empty = this.actionEmpty
      a.ammo = st.mag
      a.ads = this.adsRaw
      a.sprint = this.sprintAmt
      a.ladder = this.ladderAmt
      a.time = this.time
      a.firstRaise = this.firstRaise
      const m = a.move
      m.speed = move.speed
      m.maxSpeed = move.maxSpeed
      m.sprinting = move.sprinting
      m.grounded = move.grounded
      m.stance = move.stance
      m.landImpulse = move.landImpulse
      m.jumped = move.jumped
      m.onLadder = move.onLadder
      m.lookDX = move.lookDX
      m.lookDY = move.lookDY
      if (fired) vm.onFire(def.recoilV, def.recoilH, this.adsRaw, def.class, false)
      vm.update(this.timeScale === 0 ? 0 : realDt * this.timeScale, a)
      vm.setVisible(this.alive && !this.scoped)
      const h = this.game.render.renderer.domElement.clientHeight || innerHeight
      this.scope?.set(this.scoped, this.scopeSwayX * h * 0.012, this.scopeSwayY * h * 0.012)
    }
    if (fired) this.shoot(move)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Shooting
  // ═══════════════════════════════════════════════════════════════════════

  private shoot(move: MovementState) {
    const def = this.current
    const st = this.slotState
    const owner = this.owner
    st.mag--
    owner.stats.shotsFired++
    // carry the sub-frame remainder so the real rate matches rpm at any frame rate
    this.cooldown = Math.max(this.cooldown, -this.frameDt) + 60 / def.rpm
    this.lastShot = this.time
    this.shotCount++

    owner.getEyePosition(_eye)
    directionFromYawPitch(owner.yaw, owner.pitch, _fwd)
    _q.setFromEuler(_e.set(owner.pitch, owner.yaw, 0, 'YXZ'))
    _right.set(1, 0, 0).applyQuaternion(_q)
    _up.set(0, 1, 0).applyQuaternion(_q)
    this.muzzleWorld(_muzzle)

    // Scope sway moves the actual aim point (what you see is what you hit).
    let sx = 0
    let sy = 0
    if (this.scoped) {
      const vfov = this.game.render.camera.fov * DEG
      sx = this.scopeSwayX * 0.024 * Math.tan(vfov / 2) * 2
      sy = -this.scopeSwayY * 0.024 * Math.tan(vfov / 2) * 2
    }
    const spreadDeg = lerp(this.spread, def.adsSpread, this.adsRaw)
    const pellets = Math.max(1, def.pellets)
    for (let i = 0; i < pellets; i++) {
      const r = Math.tan(spreadDeg * DEG) * Math.sqrt(Math.random())
      const th = Math.random() * Math.PI * 2
      _dir.copy(_fwd)
        .addScaledVector(_right, Math.cos(th) * r + sx)
        .addScaledVector(_up, Math.sin(th) * r + sy)
        .normalize()
      const res = this.game.combat.fireBullet(owner, def.id, _eye, _dir, false)
      if (i === 0 && (this.shotCount % TRACER_EVERY === 1 || pellets > 1 || !def.auto)) {
        _end.copy(res.point)
        this.game.events.emit('bullet:tracer', { from: _muzzle, to: _end, shooter: owner })
      }
    }
    this.game.events.emit('weapon:fire', { shooter: owner, weaponId: def.id, origin: _muzzle, direction: _fwd, suppressed: false })

    // Camera recoil.
    const adsK = 1 - this.adsRaw * 0.25
    const stanceK = move.stance === 2 ? 0.65 : move.stance === 1 ? 0.85 : 1
    this.recoil.pitch += def.recoilV * DEG * rand(0.8, 1.12) * adsK * stanceK
    this.recoil.yaw += rand(-def.recoilH, def.recoilH) * DEG * adsK * stanceK
    // Hip spread bloom.
    this.heat = Math.min(1, this.heat + (def.pellets > 1 ? 0.5 : def.auto ? 0.11 : 0.3))

    // Manual actions.
    if (def.id === 'intervention' && st.mag > 0) this.setAction('bolt', 1.05, 0.12)
    else if (def.id === 'spas12' && st.mag > 0) this.setAction('pump', 0.55, 0.06)
  }

  /** Muzzle in world space: viewmodel muzzle -> NDC -> world camera ray at ~0.6 m. */
  private muzzleWorld(out: Vector3): Vector3 {
    const owner = this.owner
    owner.getEyePosition(_eye)
    if (!this.vm || this.scoped) {
      directionFromYawPitch(owner.yaw, owner.pitch, out)
      _right.set(1, 0, 0).applyQuaternion(_q.setFromEuler(_e.set(owner.pitch, owner.yaw, 0, 'YXZ')))
      return out.multiplyScalar(0.5).addScaledVector(_right, 0.12).add(_eye).setY(_eye.y - 0.08)
    }
    this.vm.muzzleNdc(_ndc)
    const cam = this.game.render.camera
    const ty = Math.tan((cam.fov * DEG) / 2)
    const D = 0.6
    out.set(_ndc.x * ty * cam.aspect * D, _ndc.y * ty * D, -D)
    _q.setFromEuler(_e.set(owner.pitch, owner.yaw, 0, 'YXZ'))
    return out.applyQuaternion(_q).add(_eye)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════════════

  private setAction(a: ActionKind, dur: number, startDelay = 0) {
    this.action = a
    this.actionT = -startDelay
    this.actionDur = dur
    this.lastStageU = -1
    if (a !== 'raise') this.firstRaise = false
  }

  private sohMul() {
    return this.hasPerk('sleightOfHand') ? 0.5 : 1
  }

  isReloading() {
    const a = this.action
    return a === 'reload' || a === 'shellStart' || a === 'shell' || a === 'shellEnd'
  }

  private startReload() {
    const st = this.slotState
    const def = st.def
    if (st.mag >= def.magSize || st.reserve <= 0) return
    if (this.action !== 'none') return
    this.actionEmpty = st.mag === 0
    if (def.class === 'shotgun') this.setAction('shellStart', 0.38 * this.sohMul())
    else this.setAction('reload', (this.actionEmpty ? def.reloadEmptyTime : def.reloadTime) * this.sohMul())
    this.emitReload('start')
  }

  private cancelReload() {
    if (this.action === 'reload') this.vm?.reset()
    this.action = 'none'
    this.actionT = 0
  }

  private emitReload(stage: 'start' | 'magout' | 'magin' | 'boltback' | 'boltforward' | 'end') {
    this.game.events.emit('weapon:reload', { actor: this.owner, weaponId: this.current.id, stage })
  }

  private startSwitch(to: number) {
    if (to === this.slot) return
    if (this.isReloading()) this.cancelReload()
    this.pendingSlot = to
    this.setAction('drop', this.current.class === 'pistol' ? 0.22 : 0.3)
  }

  private startKnife() {
    if (this.action === 'drop' || this.action === 'raise') return
    if (this.isReloading()) this.cancelReload()
    this.meleeDone = false
    this.setAction('knife', 0.62)
  }

  private startFrag() {
    if (this.isReloading()) this.cancelReload()
    this.frags--
    this.fragThrown = false
    this.fragReleaseQueued = false
    this.cookT = 0
    this.setAction('fragPull', 0.5)
  }

  private throwFrag(cook: number, velocityScale = 1) {
    const owner = this.owner
    owner.getEyePosition(_eye)
    directionFromYawPitch(owner.yaw, owner.pitch + 0.1, _dir)
    _q.setFromEuler(_e.set(owner.pitch, owner.yaw, 0, 'YXZ'))
    _right.set(1, 0, 0).applyQuaternion(_q)
    _muzzle.copy(_eye).addScaledVector(_dir, 0.35).addScaledVector(_right, 0.12)
    _muzzle.y -= 0.06
    _vel.copy(_dir).multiplyScalar(FRAG_SPEED * velocityScale)
    _vel.x += owner.velocity.x * 0.5
    _vel.z += owner.velocity.z * 0.5
    this.game.combat.throwGrenade(owner, _muzzle, _vel, Math.max(0, FRAG_FUSE - cook))
    this.fragThrown = true
  }

  private advanceAction(dt: number, input: InputState) {
    this.actionT += dt
    const u = this.actionT / this.actionDur
    const st = this.slotState
    const prev = this.lastStageU
    const cross = (x: number) => prev < x && u >= x
    this.lastStageU = u
    switch (this.action) {
      case 'reload':
        if (cross(0.18)) this.emitReload('magout')
        if (cross(0.64)) {
          const need = st.def.magSize - st.mag
          const take = Math.min(need, st.reserve)
          st.mag += take
          st.reserve -= take
          this.emitReload('magin')
        }
        if (this.actionEmpty) {
          if (cross(0.75)) this.emitReload('boltback')
          if (cross(0.8)) this.emitReload('boltforward')
        }
        if (u >= 1) {
          this.emitReload('end')
          this.action = 'none'
        }
        break
      case 'shellStart':
        if (u >= 1) this.setAction('shell', 0.46 * this.sohMul())
        break
      case 'shell':
        if (cross(0.78)) {
          if (st.reserve > 0 && st.mag < st.def.magSize) {
            st.mag++
            st.reserve--
            this.emitReload('magin')
          }
        }
        if (u >= 1) {
          if (st.mag < st.def.magSize && st.reserve > 0) this.setAction('shell', 0.46 * this.sohMul())
          else this.setAction('shellEnd', (this.actionEmpty ? 0.75 : 0.36) * this.sohMul())
        }
        break
      case 'shellEnd':
        if (this.actionEmpty) {
          if (cross(0.6)) this.emitReload('boltback')
          if (cross(0.78)) this.emitReload('boltforward')
        }
        if (u >= 1) {
          this.emitReload('end')
          this.action = 'none'
          this.actionEmpty = false
        }
        break
      case 'bolt':
        if (cross(0.3)) this.emitReload('boltback')
        if (cross(0.55)) this.emitReload('boltforward')
        if (u >= 1) this.action = 'none'
        break
      case 'pump':
        if (cross(0.1)) this.emitReload('boltback')
        if (cross(0.5)) this.emitReload('boltforward')
        if (u >= 1) this.action = 'none'
        break
      case 'drop':
        if (u >= 1) {
          this.slot = this.pendingSlot
          this.current = this.slotState.def
          this.vm?.setWeapon(this.current.id)
          this.adsRaw = 0
          this.heat = 0
          this.game.events.emit('weapon:switch', { actor: this.owner, weaponId: this.current.id })
          this.setAction('raise', this.current.class === 'pistol' ? 0.32 : 0.42)
        }
        break
      case 'raise':
        if (u >= 1) {
          this.action = 'none'
          this.firstRaise = false
        }
        break
      case 'knife':
        if (!this.meleeDone && u >= 0.24) {
          this.meleeDone = true
          this.game.combat.melee(this.owner)
        }
        if (u >= 1) this.action = 'none'
        break
      case 'fragPull':
        if (!input.fragHeld) this.fragReleaseQueued = true
        if (u >= 0.75) this.cookT += dt
        if (u >= 1) {
          this.setAction('fragHold', 1)
          this.actionT = 0
        }
        break
      case 'fragHold':
        this.cookT += dt
        if (this.cookT >= FRAG_FUSE) {
          // Overcooked: it goes off in your hand.
          this.throwFrag(FRAG_FUSE, 0.02)
          this.setAction('raise', 0.5)
          break
        }
        if ((!input.fragHeld || this.fragReleaseQueued) && this.actionT >= 0.12) this.setAction('fragThrow', 0.48)
        break
      case 'fragThrow':
        this.cookT += dt
        if (!this.fragThrown && u >= 0.3) this.throwFrag(this.cookT)
        if (u >= 1) this.setAction('raise', 0.42)
        break
      default:
        break
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Outputs
  // ═══════════════════════════════════════════════════════════════════════

  /** Camera recoil (radians) accumulated since last call; the player adds it to pitch/yaw. Positive pitch = up. */
  consumeRecoil(): { pitch: number; yaw: number } {
    const r = this.recoilOut
    r.pitch = this.recoil.pitch
    r.yaw = this.recoil.yaw
    this.recoil.pitch = this.recoil.yaw = 0
    return r
  }

  getHudState(): HudWeaponState {
    const h = this.hud
    const st = this.slotState
    const other = this.slots[1 - this.slot]!
    h.weaponId = st.def.id
    h.weaponName = st.def.name
    h.ammo = st.mag
    h.reserve = st.reserve
    h.magSize = st.def.magSize
    h.frags = this.frags
    h.reloading = this.isReloading()
    h.otherWeaponName = other.def.name
    h.fireMode = st.def.class === 'sniper' ? 'BOLT' : st.def.class === 'shotgun' ? 'PUMP' : st.def.auto ? 'AUTO' : 'SEMI'
    return h
  }

  /** Owner died — hide viewmodel, cancel actions, drop cooked grenade. */
  onDeath() {
    if ((this.action === 'fragHold' || (this.action === 'fragThrow' && !this.fragThrown)) && !this.fragThrown) {
      this.throwFrag(this.cookT, 0.05)
    }
    this.alive = false
    this.action = 'none'
    this.adsRaw = this.adsAmount = 0
    this.adsOn = false
    this.scoped = false
    this.fovMultiplier = 1
    this.blocksSprint = false
    this.vm?.setVisible(false)
    this.vm?.reset()
    this.scope?.set(false)
  }

  /** Owner spawned — refill ammo, raise weapon animation. */
  onSpawn() {
    const l = this.game.loadout
    if (this.slots[0]!.def.id !== l.primary || this.slots[1]!.def.id !== l.secondary) this.setLoadout(l)
    for (const s of this.slots) {
      s.mag = s.def.magSize
      s.reserve = s.def.reserve
    }
    this.slot = this.pendingSlot = 0
    this.current = this.slots[0]!.def
    this.vm?.setWeapon(this.current.id)
    this.vm?.reset()
    this.frags = 1
    this.alive = true
    this.heat = 0
    this.cooldown = 0
    this.adsRaw = 0
    this.sprintAmt = 0
    this.sprintOut = 0
    this.recoil.pitch = this.recoil.yaw = 0
    this.breath = 1
    this.firstRaise = true
    this.setAction('raise', 0.6)
    this.firstRaise = true
    this.vm?.setVisible(true)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Debug (automation / screenshots)
  // ═══════════════════════════════════════════════════════════════════════

  /** Force an animation state: e.g. debugPose('reload', 0.3, true). Pair with timeScale = 0 to freeze. */
  debugPose(action: ActionKind, u: number, empty = false) {
    this.action = action
    this.actionDur = 1
    this.actionT = u
    this.lastStageU = u
    this.actionEmpty = empty
  }

  /** Debug: give a weapon in the current slot. */
  debugGive(id: WeaponId) {
    this.slots[this.slot] = this.freshSlot(id)
    this.current = this.slotState.def
    this.vm?.setWeapon(id)
    this.action = 'none'
  }

  /** Debug: pin the ADS blend (-1 releases it back to input). */
  debugAds(v: number) {
    this.debugAdsHold = v
  }
  private debugAdsHold = -1
}
