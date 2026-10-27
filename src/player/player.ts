import { Vector3 } from 'three'
import { CONFIG } from '../core/config'
import type { Game } from '../core/game'
import { clamp, damp, DEG, lerp, smoothstep, Spring, wrapAngle, yawFromDirection } from '../core/math'
import type { Actor, ActorHit, ActorStats, DamageInfo, InputState, Ladder, Loadout, PerkId, Surface, Team, WeaponId } from '../core/types'
import type { CapsuleResult } from '../world/collision'
import { type MovementState, WeaponSystem } from '../weapons/weapon-system'
import { raycastBody } from './hitboxes'

/** Feel tunables. Everything in metres / seconds / radians. */
const T = {
  radPerPx: 0.0022,
  maxPitch: 88 * DEG,
  // collision
  stepHeight: 0.32,
  snapDown: 0.3,
  walkableNy: 0.7, // ~45 degrees
  maxSubstep: 0.14,
  // locomotion
  groundAccel: 62,
  groundDecel: 90,
  airAccel: 7,
  lightweight: 1.07,
  strafeSprint: 0.4,
  coyote: 0.09,
  jumpBuffer: 0.4,
  // sprint
  sprintTime: 4,
  sprintRegen: 1.5,
  sprintResume: 1,
  // dive-to-prone
  diveTime: 0.55,
  diveSpeed: 6.4,
  // ladder
  climbSpeed: 2.5,
  ladderOffset: 0.42,
  // mantle
  mantleMax: 1.25,
  mantleMin: 0.42,
  airMantleTime: 0.65,
} as const

const STANCE_SPEED = [CONFIG.walkSpeed, CONFIG.crouchSpeed, CONFIG.proneSpeed] as const
/** Footsteps per second at full stance speed: stand, crouch, prone (sprint handled separately). */
const STEP_RATE = [2.5, 1.9, 1.2] as const
const BOB_AMP = [0.011, 0.007, 0.004] as const
const HALF_PI = Math.PI / 2

const _a = new Vector3()
const _b = new Vector3()
const _p0 = new Vector3()
const _pA = new Vector3()
const _o = new Vector3()
const _d = new Vector3()
const FOOT_X = [0, 1, -1, 0, 0] as const
const FOOT_Z = [0, 0, 0, 1, -1] as const

const capRadius = (stance: 0 | 1 | 2) => (stance === 2 ? 0.25 : CONFIG.capsuleRadius)
const capHeight = (stance: 0 | 1 | 2) => (stance === 2 ? 0.54 : CONFIG.capsuleHeight[stance])

export class Player implements Actor {
  readonly id = 0
  readonly name = 'Player'
  readonly team: Team = 'tf141'
  readonly isPlayer = true
  alive = false
  health = CONFIG.maxHealth
  readonly maxHealth = CONFIG.maxHealth
  readonly position = new Vector3()
  readonly velocity = new Vector3()
  yaw = 0
  pitch = 0
  stance: 0 | 1 | 2 = 0
  stats: ActorStats = { kills: 0, deaths: 0, assists: 0, score: 0, streak: 0, shotsFired: 0, shotsHit: 0, headshots: 0 }
  timeSinceDamage = 99
  /** Who killed us last (for the death screen). */
  lastKiller: Actor | null = null
  readonly weapons: WeaponSystem

  // ── public movement state (read by UI / audio) ──
  grounded = false
  sprinting = false
  onLadder = false
  mantling = false
  /** Seconds of sprint left (4 s without Marathon). */
  stamina: number = T.sprintTime
  /** Horizontal speed (m/s, measured from real displacement). */
  speed = 0

  // ── internals ──
  private exhausted = false
  private eyeH: number = CONFIG.eyeHeight[0]
  private capR = CONFIG.capsuleRadius
  private capH: number = CONFIG.capsuleHeight[0]
  private readonly capRes: CapsuleResult = { onGround: false, groundNormal: new Vector3(0, 1, 0), push: new Vector3(), collided: false }
  private coyote = 0
  private jumpBuffer = 0
  private jumpedThisFrame = false
  private landImpact = 0
  private timeSinceSpawn = 0
  private stepOffset = 0
  private floorNy = 1
  private airMantle = 0
  private jumpStartY = 0
  private readonly lastSafe = new Vector3()
  private safeTimer = 0

  // dive
  private diveT = 0
  private readonly diveDir = new Vector3()

  // ladder
  private ladder: Ladder | null = null
  private ladderVy = 0
  private ladderCooldown = 0
  private ladderTurn = 0
  private ladderDown = false
  private ladderStepAcc = 0
  private dismountT = -1
  private dismountDur = 0.38
  private readonly dismountFrom = new Vector3()
  private readonly dismountTo = new Vector3()

  // mantle
  private mantleT = 0
  private mantleDur = 0.7
  private readonly mantleFrom = new Vector3()
  private readonly mantleTo = new Vector3()

  // sprint / FOV
  private sprintFov = 1
  private fovRatio = 1
  private lastFov = 0
  private lastAspect = 0

  // camera feel
  private bobPhase = 0
  private bobAmp = 0
  private bobX = 0
  private bobY = 0
  private bobRoll = 0
  private strafeRoll = 0
  private stepIndex = 0
  private mantleTilt = 0
  private recoilDebt = 0
  private hitFlash = 0
  private readonly landDip = new Spring(110, 12)
  private readonly kickPitch = new Spring(150, 16)
  private readonly flinchPitch = new Spring(140, 12)
  private readonly flinchYaw = new Spring(140, 12)
  private readonly flinchRoll = new Spring(140, 12)
  private readonly diveKick = new Spring(70, 10)
  private camEye = 1.62
  private camBack = 0
  private camRoll = 0

  // death cam
  private deathT = 0
  private deathEye = 1.6
  private deathRoll = 0.5
  private deathYawTarget = 0
  private deathPitchTarget = -0.3
  private deathHasTarget = false
  /** How far the death cam may slump forward before it would clip into a wall. */
  private deathBack = 0.45

  private readonly move: MovementState = {
    speed: 0, maxSpeed: CONFIG.walkSpeed, sprinting: false, grounded: false, stance: 0,
    landImpulse: 0, jumped: false, onLadder: false, lookDX: 0, lookDY: 0,
  }
  /** Sanitised copy of the input handed to weapons when the player cannot act (intro / ended). */
  private readonly idleInput: InputState = {
    moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, fire: false, firePressed: false, ads: false, jumpPressed: false,
    sprint: false, crouchPressed: false, pronePressed: false, reloadPressed: false, switchPressed: false,
    slot1Pressed: false, slot2Pressed: false, fragPressed: false, fragHeld: false, meleePressed: false,
    usePressed: false, scoreboard: false, pausePressed: false, killstreakPressed: false,
  }

  constructor(private game: Game) {
    this.weapons = new WeaponSystem(game, this)
    game.events.on('actor:damaged', (info) => this.onDamaged(info))
  }

  get weaponId(): WeaponId {
    return this.weapons.current.id
  }

  setLoadout(l: Loadout) {
    this.weapons.setLoadout(l)
  }

  getEyePosition(out: Vector3) {
    return out.set(this.position.x, this.position.y + this.eyeH, this.position.z)
  }

  raycast(origin: Vector3, dir: Vector3, maxDistance: number): ActorHit | null {
    const p = this.position
    return raycastBody(p.x, p.y, p.z, this.yaw, this.stance, this.eyeH, origin, dir, maxDistance)
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  onKilled(info: DamageInfo) {
    this.lastKiller = info.attacker
    this.weapons.onDeath()
    this.velocity.set(0, 0, 0)
    this.sprinting = false
    this.ladder = null
    this.onLadder = false
    this.mantling = false
    this.dismountT = -1
    this.diveT = 0
    this.deathT = 0
    this.deathEye = this.eyeH
    this.deathRoll = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.25)
    const k = info.attacker
    this.deathHasTarget = !!k && k !== this
    if (k && k !== this) {
      const dx = k.position.x - this.position.x
      const dz = k.position.z - this.position.z
      this.deathYawTarget = yawFromDirection(dx, dz)
      const dist = Math.hypot(dx, dz)
      this.deathPitchTarget = clamp(Math.atan2(k.position.y + 1.3 - (this.position.y + 0.3), Math.max(dist, 0.5)), -0.1, 0.55)
    } else {
      this.deathPitchTarget = -0.35
    }
    this.hitFlash = 0.6
    // The camera slumps forward along the final death-cam heading: keep it out of walls there.
    const fy = this.deathHasTarget ? this.deathYawTarget : this.yaw
    _o.set(this.position.x, this.position.y + 0.3, this.position.z)
    _d.set(-Math.sin(fy), 0, -Math.cos(fy))
    const behind = this.game.collision.raycast(_o, _d, 0.8)
    this.deathBack = behind ? Math.max(0, behind.distance - 0.3) * 0.9 : 0.45
    if (this.deathBack > 0.45) this.deathBack = 0.45
  }

  spawn(position: Vector3, yaw: number) {
    this.position.copy(position)
    this.lastSafe.copy(position)
    this.velocity.set(0, 0, 0)
    this.yaw = yaw
    this.pitch = 0
    this.setStance(0)
    this.eyeH = CONFIG.eyeHeight[0]
    this.grounded = false
    this.sprinting = false
    this.onLadder = false
    this.ladder = null
    this.mantling = false
    this.dismountT = -1
    this.diveT = 0
    this.stamina = T.sprintTime
    this.exhausted = false
    this.coyote = this.jumpBuffer = 0
    this.timeSinceSpawn = 0
    this.stepOffset = 0
    this.speed = 0
    this.bobPhase = this.bobAmp = this.bobX = this.bobY = this.bobRoll = this.strafeRoll = 0
    this.stepIndex = Math.floor((0 - HALF_PI) / Math.PI)
    this.mantleTilt = 0
    this.recoilDebt = 0
    this.hitFlash = 0
    this.sprintFov = 1
    for (const s of [this.landDip, this.kickPitch, this.flinchPitch, this.flinchYaw, this.flinchRoll, this.diveKick]) {
      s.value = 0
      s.velocity = 0
    }
    this.deathT = 0
    this.camBack = 0
    this.camRoll = 0
    const fx = this.game.render.effects
    fx.dead = 0
    fx.damage = 0
    fx.ads = 0
    this.weapons.onSpawn()
    this.camEye = this.eyeH
    this.applyCamera(0.016)
  }

  // ───────────────────────────── frame ─────────────────────────────

  update(dt: number) {
    if (dt <= 0) return
    const g = this.game
    const s = g.input.state
    if (!this.alive) {
      this.updateDead(dt, s)
      return
    }
    const p = this.position
    const canAct = g.mode.phase === 'playing'
    this.timeSinceSpawn += dt
    this.landImpact = 0
    this.jumpedThisFrame = false

    this.updateLook(dt, s)

    const wishX = canAct ? s.moveX : 0
    const wishY = canAct ? s.moveY : 0
    const px = p.x
    const pz = p.z

    // Timers
    this.coyote = this.grounded ? T.coyote : Math.max(0, this.coyote - dt)
    this.ladderCooldown = Math.max(0, this.ladderCooldown - dt)
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt)

    const busy = this.mantling || this.ladder !== null || this.dismountT >= 0

    if (canAct && !busy) {
      this.handleStance(s)
      if (s.jumpPressed) this.jumpBuffer = T.jumpBuffer
      if (this.jumpBuffer > 0) this.handleJump(wishY)
      if (this.ladderCooldown <= 0 && wishY > 0.1) this.tryAttachLadder()
      // CoD: keep reaching for a ledge for a moment after jumping towards it.
      if (!this.grounded && !this.ladder && this.airMantle > 0 && wishY > 0.1 && this.velocity.y < 3.5) this.tryMantle()
    }
    this.airMantle = this.grounded ? 0 : Math.max(0, this.airMantle - dt)

    if (this.mantling) this.updateMantle(dt)
    else if (this.ladder) this.updateLadder(dt, wishY, canAct, s)
    else if (this.dismountT >= 0) this.updateDismount(dt)
    else this.locomote(dt, wishX, wishY, canAct, s)

    this.finishMovement(dt, px, pz)
    this.updateFeel(dt, wishX)

    if (canAct && s.killstreakPressed) g.mode.usePlayerStreak()

    // Weapons
    const m = this.move
    const mob = this.weapons.mobility * (this.hasPerk('lightweight') ? T.lightweight : 1)
    m.speed = this.speed
    m.sprinting = this.sprinting && this.speed > 2.5
    m.maxSpeed = (m.sprinting ? CONFIG.sprintSpeed : STANCE_SPEED[this.stance]) * mob
    m.grounded = this.grounded
    m.stance = this.stance
    m.landImpulse = this.landImpact
    m.jumped = this.jumpedThisFrame
    m.onLadder = this.ladder !== null || this.mantling || this.dismountT >= 0
    m.lookDX = s.lookDX
    m.lookDY = s.lookDY
    this.weapons.update(dt, canAct ? s : this.idleInputFrom(s), m)

    this.updateEffects(dt)
    this.camEye = this.eyeH + this.stepOffset + this.landDip.value + this.bobY - this.mantleTilt * 0.22
    this.camRoll = this.strafeRoll + this.bobRoll
    this.applyCamera(dt)
  }

  private idleInputFrom(s: InputState): InputState {
    const i = this.idleInput
    i.lookDX = s.lookDX
    i.lookDY = s.lookDY
    return i
  }

  private hasPerk(id: PerkId) {
    return this.game.loadout.perks.includes(id)
  }

  // ───────────────────────────── look ─────────────────────────────

  private updateLook(dt: number, s: InputState) {
    const sens = T.radPerPx * this.fovRatio
    this.yaw -= s.lookDX * sens
    const dPitch = -s.lookDY * sens
    this.pitch = clamp(this.pitch + dPitch, -T.maxPitch, T.maxPitch)
    // Manual pull-down compensates the recoil that would otherwise auto-recover.
    if (dPitch < 0 && this.recoilDebt > 0) this.recoilDebt = Math.max(0, this.recoilDebt + dPitch)

    const r = this.weapons.consumeRecoil()
    if (r.pitch !== 0 || r.yaw !== 0) {
      this.pitch = clamp(this.pitch + r.pitch, -T.maxPitch, T.maxPitch)
      this.yaw += r.yaw
      if (r.pitch > 0) this.recoilDebt += r.pitch
      this.kickPitch.impulse(r.pitch * 5)
    }
    if (this.recoilDebt > 1e-5) {
      // MW2 view kick: the crosshair returns part of the way on its own.
      const rate = s.fire ? 2.5 : 7
      const rec = this.recoilDebt * (1 - Math.exp(-rate * dt))
      this.recoilDebt -= rec
      this.pitch = clamp(this.pitch - rec * 0.6, -T.maxPitch, T.maxPitch)
    }
    // Ladders: keep the view roughly facing the rungs.
    if (this.ladder) {
      const n = this.ladder.normal
      const face = yawFromDirection(-n.x, -n.z)
      if (this.ladderTurn > 0) {
        // Just mounted: swing the view round onto the rungs (and down, when mounting from the top).
        this.ladderTurn = Math.max(0, this.ladderTurn - dt)
        const k = 1 - Math.exp(-12 * dt)
        this.yaw += wrapAngle(face - this.yaw) * k
        if (this.ladderDown) this.pitch = damp(this.pitch, -0.6, 10, dt)
      } else {
        this.yaw = face + clamp(wrapAngle(this.yaw - face), -1.35, 1.35)
      }
    }
  }

  // ───────────────────────────── stance / jump ─────────────────────────────

  private setStance(st: 0 | 1 | 2) {
    this.stance = st
    this.capR = capRadius(st)
    this.capH = capHeight(st)
  }

  /** Would a capsule of this stance fit at (x, y, z)? Only vertical (ceiling) obstruction counts. */
  private fits(x: number, y: number, z: number, st: 0 | 1 | 2, strict = false): boolean {
    const r = capRadius(st)
    const h = capHeight(st)
    _a.set(x, y + r + 0.05, z)
    _b.set(x, Math.max(y + h - r, y + r + 0.06), z)
    const res = this.game.collision.resolveCapsule(_a, _b, r, this.capRes)
    if (strict) return res.push.length() < 0.03
    return res.push.y > -0.01
  }

  private handleStance(s: InputState) {
    const p = this.position
    if (s.crouchPressed && this.grounded) {
      if (this.stance === 0) {
        this.setStance(1)
        this.sprinting = false
      } else if (this.fits(p.x, p.y, p.z, this.stance === 2 ? 1 : 0)) {
        this.setStance(this.stance === 2 ? 1 : 0)
      }
    }
    if (s.pronePressed && this.grounded) {
      if (this.stance === 2) {
        if (this.fits(p.x, p.y, p.z, 0)) this.setStance(0)
        else if (this.fits(p.x, p.y, p.z, 1)) this.setStance(1)
      } else {
        if (this.sprinting && this.speed > 4) {
          // Dive to prone.
          this.diveT = 1e-4
          this.diveDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
          this.diveKick.impulse(-2.2)
          this.sprinting = false
        }
        this.setStance(2)
      }
    }
  }

  private handleJump(wishY: number) {
    const p = this.position
    if (this.stance === 2) {
      // MW2: jump while prone pops you up to a crouch.
      if (this.grounded && this.diveT <= 0 && this.fits(p.x, p.y, p.z, 1)) this.setStance(1)
      this.jumpBuffer = 0
      return
    }
    if (wishY > 0.1 && this.tryMantle()) {
      this.jumpBuffer = 0
      return
    }
    if (!(this.grounded || this.coyote > 0) || this.velocity.y > 0.5) return
    if (this.stance === 1) {
      if (!this.fits(p.x, p.y, p.z, 0)) return
      this.setStance(0)
    }
    this.velocity.y = CONFIG.jumpVelocity
    this.airMantle = T.airMantleTime
    this.jumpStartY = p.y
    this.grounded = false
    this.coyote = 0
    this.jumpBuffer = 0
    this.jumpedThisFrame = true
    this.stepOffset = 0
    this.game.events.emit('actor:jump', { actor: this })
  }

  // ───────────────────────────── locomotion ─────────────────────────────

  private updateSprint(dt: number, wishY: number, canAct: boolean, s: InputState) {
    const marathon = this.hasPerk('marathon')
    let want = canAct && s.sprint && wishY > 0.1 && !s.ads && !s.fire && this.stance !== 2 && !this.exhausted && this.diveT <= 0
    if (want && this.stance === 1) {
      const p = this.position
      if (this.grounded && this.fits(p.x, p.y, p.z, 0)) this.setStance(0)
      else want = false
    }
    if (want && !this.sprinting && this.weapons.blocksSprint) want = false
    this.sprinting = want
    if (want && !marathon) {
      this.stamina -= dt
      if (this.stamina <= 0) {
        this.stamina = 0
        this.exhausted = true
        this.sprinting = false
      }
    } else if (!want) {
      this.stamina = Math.min(T.sprintTime, this.stamina + T.sprintRegen * dt)
      if (this.exhausted && this.stamina >= T.sprintResume && !s.sprint) this.exhausted = false // MW2: re-press to sprint again
    }
  }

  private locomote(dt: number, wishX: number, wishY: number, canAct: boolean, s: InputState) {
    const v = this.velocity
    this.updateSprint(dt, wishY, canAct, s)
    const mob = this.weapons.mobility * (this.hasPerk('lightweight') ? T.lightweight : 1)
    let maxSpd = STANCE_SPEED[this.stance] * mob
    let wx = wishX
    let wy = wishY
    if (this.sprinting) {
      wy = 1
      wx *= T.strafeSprint
      maxSpd = CONFIG.sprintSpeed * mob
    }
    const wl = Math.hypot(wx, wy)
    if (wl > 1) {
      wx /= wl
      wy /= wl
    }
    const sy = Math.sin(this.yaw)
    const cy = Math.cos(this.yaw)
    // forward = (-sin, -cos), right = (cos, -sin)
    const tx = (-sy * wy + cy * wx) * maxSpd
    const tz = (-cy * wy - sy * wx) * maxSpd

    if (this.diveT > 0) {
      this.diveT += dt
      const u = this.diveT / T.diveTime
      if (u >= 1 || !this.grounded) {
        this.diveT = 0
      } else {
        const sp = Math.max(CONFIG.proneSpeed, T.diveSpeed * Math.pow(1 - u, 1.6))
        v.x = this.diveDir.x * sp
        v.z = this.diveDir.z * sp
      }
    }
    if (this.diveT <= 0) {
      if (this.grounded) {
        const dvx = tx - v.x
        const dvz = tz - v.z
        const dl = Math.hypot(dvx, dvz)
        if (dl > 1e-5) {
          const now = Math.hypot(v.x, v.z)
          const tgt = Math.hypot(tx, tz)
          const opposing = v.x * tx + v.z * tz < 0
          const rate = tgt > now + 0.01 && !opposing ? T.groundAccel : T.groundDecel
          const step = rate * dt
          if (dl <= step) {
            v.x = tx
            v.z = tz
          } else {
            v.x += (dvx / dl) * step
            v.z += (dvz / dl) * step
          }
        }
      } else {
        const tgt = Math.hypot(tx, tz)
        if (tgt > 0.01) {
          const ux = tx / tgt
          const uz = tz / tgt
          const cur = v.x * ux + v.z * uz
          const add = clamp(tgt - cur, 0, T.airAccel * dt)
          v.x += ux * add
          v.z += uz * add
        }
      }
    }
    if (this.grounded && v.y < 0) v.y = 0
    this.integrate(dt)
  }

  /** Sub-stepped movement with collision. */
  private integrate(dt: number) {
    const v = this.velocity
    const dist = Math.hypot(v.x, v.y, v.z) * dt
    const n = clamp(Math.ceil(dist / T.maxSubstep), 1, 10)
    const h = dt / n
    for (let i = 0; i < n; i++) this.step(h)
  }

  private resolve(): CapsuleResult {
    const p = this.position
    const r = this.capR
    _a.set(p.x, p.y + r, p.z)
    _b.set(p.x, p.y + Math.max(this.capH - r, r + 0.02), p.z)
    const res = this.game.collision.resolveCapsule(_a, _b, r, this.capRes)
    p.set(_a.x, _a.y - r, _a.z)
    return res
  }

  private walkable(res: CapsuleResult) {
    return res.onGround && res.groundNormal.y >= T.walkableNy
  }

  /**
   * Highest walkable floor under the capsule footprint (centre + 4 points at 0.95 r), searched from
   * `up` above the feet to `down` below. Off-centre samples only count on near-flat tops (stair treads,
   * kerbs) so slopes keep the feet on the centre line. Sets `floorNy`. Returns -Infinity if none.
   */
  private probeFloor(x: number, y: number, z: number, up: number, down: number): number {
    const col = this.game.collision
    const r = this.capR * 0.95
    const top = y + up
    const len = up + down
    _d.set(0, -1, 0)
    let best = -Infinity
    for (let i = 0; i < 5; i++) {
      _o.set(x + FOOT_X[i]! * r, top, z + FOOT_Z[i]! * r)
      const hit = col.raycast(_o, _d, len)
      if (!hit) continue
      const ny = hit.normal.y
      if (ny < (i === 0 ? T.walkableNy : 0.9)) continue
      if (hit.point.y > best + 1e-4) {
        best = hit.point.y
        this.floorNy = ny
      }
    }
    return best
  }

  /** One collision sub-step: CoD/Quake style step-slide on the ground, ballistic in the air. */
  private step(h: number) {
    const p = this.position
    const v = this.velocity
    const wasGrounded = this.grounded
    if (!wasGrounded) v.y -= CONFIG.gravity * h
    const preVy = v.y
    const dx = v.x * h
    const dz = v.z * h
    const want = Math.hypot(dx, dz)
    _p0.copy(p)
    let grounded = false

    if (wasGrounded) {
      // Horizontal move, follow the floor first (up treads, along slopes, down small drops), then collide.
      p.x += dx
      p.z += dz
      const fy = v.y <= 0.001 ? this.probeFloor(p.x, p.y, p.z, T.stepHeight + 0.04, T.snapDown) : -Infinity
      if (fy > -Infinity) {
        // On a slope the bottom sphere rests above the contact point under its centre.
        const ny = this.floorNy
        const ty = fy + (ny < 0.999 ? this.capR * (1 / ny - 1) : 0)
        const dy = ty - p.y
        p.y = ty
        if (Math.abs(dy) > 0.04 && ny > 0.95) this.stepOffset = clamp(this.stepOffset - dy, -0.5, 0.5)
        grounded = true
        v.y = 0
      }
      let res = this.resolve()
      if (want > 1e-5) {
        const got = ((p.x - _p0.x) * dx + (p.z - _p0.z) * dz) / want
        if (got < want * 0.7 && this.tryStepUp(dx, dz, want)) {
          res = this.capRes
          grounded = true
        } else this.slide(res)
      }
      if (!grounded && this.walkable(res) && v.y <= 0.001) {
        // Perched on an edge / pipe crown the rays miss.
        grounded = true
        v.y = 0
      }
    } else {
      p.x += dx
      p.y += v.y * h
      p.z += dz
      const res = this.resolve()
      if (res.collided) {
        if (res.push.y < -1e-4 && v.y > 0) v.y = 0 // head bump
        this.slide(res)
      }
      if (v.y <= 0.001) {
        if (this.walkable(res)) grounded = true
        else {
          // Catch the floor just under the feet (and kerbs we fall past while moving).
          const fy = this.probeFloor(p.x, p.y, p.z, 0.12, Math.max(0.04, -v.y * h + 0.02))
          if (fy > -Infinity) {
            p.y = fy
            this.resolve()
            grounded = true
          }
        }
      }
      if (grounded) {
        if (preVy < -1) this.landImpact = Math.max(this.landImpact, -preVy)
        v.y = 0
      }
    }
    this.grounded = grounded
  }

  /** Remove the velocity component going into a wall/ceiling contact; never adds upward speed. */
  private slide(res: CapsuleResult) {
    if (!res.collided) return
    const v = this.velocity
    const push = res.push
    const pl = push.length()
    if (pl < 1e-5) return
    const nx = push.x / pl
    const ny = push.y / pl
    const nz = push.z / pl
    if (ny >= T.walkableNy) return // floor-ish: handled by grounding
    const hl = Math.hypot(nx, nz)
    if (hl > 1e-4) {
      const hx = nx / hl
      const hz = nz / hl
      const vn = v.x * hx + v.z * hz
      if (vn < 0) {
        v.x -= hx * vn
        v.z -= hz * vn
      }
    }
    if (ny < -0.3 && v.y > 0) v.y = 0
  }

  /** Blocked while grounded: look for a tread ≤ stepHeight just ahead with head room, and climb onto it. */
  private tryStepUp(dx: number, dz: number, want: number): boolean {
    const p = this.position
    const ux = dx / want
    const uz = dz / want
    const lead = this.capR + 0.06
    const base = Math.min(_p0.y, p.y)
    const top = this.probeStep(_p0.x + ux * lead, base, _p0.z + uz * lead)
    if (top <= base + 0.02 || top > base + T.stepHeight) return false
    if (!this.fits(_p0.x + dx, top + 0.01, _p0.z + dz, this.stance)) return false
    _pA.copy(p)
    p.set(_p0.x + dx, top + 0.005, _p0.z + dz)
    this.resolve()
    if (p.y < top - 0.02) {
      p.copy(_pA)
      return false
    }
    this.stepOffset = clamp(this.stepOffset + (base - p.y), -0.5, 0.5)
    this.velocity.y = 0
    return true
  }

  /** Flat tread height at a point, searched from stepHeight above the feet. */
  private probeStep(x: number, y: number, z: number): number {
    _o.set(x, y + T.stepHeight + 0.05, z)
    _d.set(0, -1, 0)
    const hit = this.game.collision.raycast(_o, _d, T.stepHeight + 0.1)
    return hit && hit.normal.y >= 0.9 ? hit.point.y : -Infinity
  }

  private finishMovement(dt: number, prevX: number, prevZ: number) {
    const p = this.position
    const b = this.game.map.bounds
    const r = this.capR
    p.x = clamp(p.x, b.minX + r, b.maxX - r)
    p.z = clamp(p.z, b.minZ + r, b.maxZ - r)
    // Real horizontal speed from displacement, lightly smoothed.
    const inst = Math.hypot(p.x - prevX, p.z - prevZ) / dt
    this.speed = inst > this.speed ? damp(this.speed, inst, 30, dt) : damp(this.speed, inst, 18, dt)
    if (this.speed < 0.05) this.speed = 0
    this.stepOffset = damp(this.stepOffset, 0, 22, dt)
    if (Math.abs(this.stepOffset) < 0.0005) this.stepOffset = 0

    // Fell out of the world / NaN: restore.
    if (p.y < -25 || !Number.isFinite(p.x + p.y + p.z)) {
      p.copy(this.lastSafe)
      this.velocity.set(0, 0, 0)
    } else if (this.grounded && !this.mantling && !this.ladder) {
      this.safeTimer += dt
      if (this.safeTimer > 0.5) {
        this.safeTimer = 0
        this.lastSafe.copy(p)
      }
    }

    if (this.landImpact > 2.5 && this.timeSinceSpawn > 0.4) {
      this.landDip.impulse(-clamp(this.landImpact, 0, 14) * 0.19)
      this.game.events.emit('actor:land', {
        actor: this,
        surface: this.game.collision.surfaceBelow(p.x, p.y, p.z),
        impact: this.landImpact,
      })
    }
  }

  // ───────────────────────────── mantle ─────────────────────────────

  private tryMantle(): boolean {
    const p = this.position
    const col = this.game.collision
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    const r = CONFIG.capsuleRadius
    const reach = r + 0.32
    // Mid-air (jumped towards it) the ledge limit is measured from where the jump started.
    const air = !this.grounded
    const base = air ? Math.min(this.jumpStartY, p.y) : p.y
    const minY = air ? Math.max(p.y + 0.15, base + T.mantleMin) : p.y + T.mantleMin
    const topY = base + T.mantleMax + 0.4
    if (topY <= minY) return false
    _o.set(p.x + fx * reach, topY, p.z + fz * reach)
    _d.set(0, -1, 0)
    const top = col.raycast(_o, _d, topY - minY)
    if (!top || top.normal.y < 0.75) return false
    if (top.point.y - base > T.mantleMax) return false
    const h = Math.max(0.2, top.point.y - p.y)
    // A vertical face must be in front of us at ledge height.
    _o.set(p.x, top.point.y - 0.15, p.z)
    _d.set(fx, 0, fz)
    const wall = col.raycast(_o, _d, reach + 0.2)
    if (!wall || wall.normal.y > 0.72 || wall.normal.x * fx + wall.normal.z * fz > -0.4) return false
    const tx = wall.point.x + fx * (r + 0.14)
    const tz = wall.point.z + fz * (r + 0.14)
    const support = col.groundHeight(tx, tz, top.point.y + 0.6, 1.0)
    if (support < top.point.y - 0.15 || support > top.point.y + 0.15) return false
    const ty = Math.max(top.point.y, support)
    if (!this.fits(tx, ty + 0.01, tz, 0, true)) return false
    if (!this.fits(p.x, ty + 0.03, p.z, 0)) return false

    this.mantling = true
    this.mantleT = 0
    this.mantleDur = 0.36 + h * 0.34
    this.mantleFrom.copy(p)
    this.mantleTo.set(tx, ty, tz)
    this.setStance(0)
    this.sprinting = false
    this.velocity.set(0, 0, 0)
    this.grounded = false
    return true
  }

  private updateMantle(dt: number) {
    const p = this.position
    this.mantleT += dt
    const u = Math.min(1, this.mantleT / this.mantleDur)
    const up = smoothstep(0, 0.6, u)
    const fw = smoothstep(0.55, 1, u)
    p.x = lerp(this.mantleFrom.x, this.mantleTo.x, fw)
    p.z = lerp(this.mantleFrom.z, this.mantleTo.z, fw)
    p.y = lerp(this.mantleFrom.y, this.mantleTo.y, up)
    this.mantleTilt = Math.sin(Math.PI * u)
    this.velocity.set(0, 0, 0)
    if (u >= 1) {
      this.mantling = false
      this.mantleTilt = 0
      this.grounded = true
      this.landDip.impulse(-0.9)
      this.velocity.set(-Math.sin(this.yaw) * 1.8, 0, -Math.cos(this.yaw) * 1.8)
      this.resolve()
    }
  }

  // ───────────────────────────── ladders ─────────────────────────────

  private tryAttachLadder() {
    const ladders = this.game.map.ladders
    if (ladders.length === 0) return
    const p = this.position
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    for (const l of ladders) {
      const n = l.normal
      const rx = p.x - l.bottom.x
      const rz = p.z - l.bottom.z
      const along = rx * n.x + rz * n.z
      const lat = rx * -n.z + rz * n.x
      if (Math.abs(lat) > l.width * 0.5 + 0.15) continue
      const facing = -(fx * n.x + fz * n.z) // 1 when looking straight at the rungs
      let fromTop = false
      if (along > -0.2 && along < 0.8 && facing > 0.4 && p.y >= l.bottom.y - 0.3 && p.y <= l.top.y - 0.4) {
        // approach from the front
      } else if (along < 0.1 && along > -1.1 && -facing > 0.45 && Math.abs(p.y - l.top.y) < 0.5 && this.grounded) {
        // standing on top, walking off the edge: climb down
        fromTop = true
      } else continue
      this.ladder = l
      this.ladderVy = fromTop ? -1.2 : 0
      this.ladderDown = fromTop
      // Turn onto the rungs if we came in at an angle (always when stepping on from the top).
      const face = yawFromDirection(-n.x, -n.z)
      this.ladderTurn = fromTop || Math.abs(wrapAngle(this.yaw - face)) > 1.35 ? 0.45 : 0
      this.ladderStepAcc = 0
      this.sprinting = false
      this.setStance(0)
      this.velocity.set(0, 0, 0)
      this.grounded = false
      return
    }
  }

  private updateLadder(dt: number, wishY: number, canAct: boolean, s: InputState) {
    const l = this.ladder!
    const p = this.position
    const n = l.normal
    const tx = -n.z
    const tz = n.x
    const rx = p.x - l.bottom.x
    const rz = p.z - l.bottom.z
    const half = Math.max(0.05, l.width * 0.5 - 0.2)
    const lat = clamp(rx * tx + rz * tz, -half, half)
    p.x = damp(p.x, l.bottom.x + n.x * T.ladderOffset + tx * lat, 14, dt)
    p.z = damp(p.z, l.bottom.z + n.z * T.ladderOffset + tz * lat, 14, dt)

    // CoD: forward climbs up when looking up, down when looking down.
    const look = this.ladderTurn > 0 && this.ladderDown ? -1 : clamp((this.pitch + 0.2) / 0.2, -1, 1)
    const target = canAct ? wishY * look * T.climbSpeed : 0
    this.ladderVy = damp(this.ladderVy, target, 12, dt)
    p.y += this.ladderVy * dt
    this.velocity.set(0, this.ladderVy, 0)
    this.ladderStepAcc += Math.abs(this.ladderVy) * dt
    if (this.ladderStepAcc > 0.7) {
      this.ladderStepAcc = 0
      this.game.events.emit('actor:footstep', { actor: this, surface: 'metal', position: p, intensity: 0.45 })
    }

    if (canAct && s.jumpPressed) {
      this.ladder = null
      this.ladderCooldown = 0.5
      this.velocity.set(n.x * 3.4, 2.6, n.z * 3.4)
      this.grounded = false
      this.jumpedThisFrame = true
    } else if (canAct && (s.crouchPressed || s.pronePressed)) {
      this.ladder = null
      this.ladderCooldown = 0.5
      this.velocity.set(n.x * 0.8, 0, n.z * 0.8)
      this.grounded = false
    } else if (p.y >= l.top.y && this.ladderVy > 0.05) {
      // Step off the top onto the platform.
      const col = this.game.collision
      const gx = l.top.x - n.x * 0.62 + tx * lat
      const gz = l.top.z - n.z * 0.62 + tz * lat
      const gy = col.groundHeight(gx, gz, l.top.y + 0.8, 2.0)
      this.dismountFrom.copy(p)
      this.dismountTo.set(gx, Number.isFinite(gy) && gy > l.top.y - 0.3 && gy < l.top.y + 0.6 ? gy : l.top.y, gz)
      this.dismountT = 0
      this.ladder = null
      this.ladderCooldown = 0.6
    } else if (p.y <= l.bottom.y + 0.02 && this.ladderVy < -0.05) {
      p.set(l.bottom.x + n.x * 0.5, l.bottom.y, l.bottom.z + n.z * 0.5)
      this.ladder = null
      this.ladderCooldown = 0.4
      this.velocity.set(0, 0, 0)
      this.grounded = false
    }
  }

  private updateDismount(dt: number) {
    const p = this.position
    this.dismountT += dt
    const u = Math.min(1, this.dismountT / this.dismountDur)
    const fw = smoothstep(0.2, 1, u)
    const up = smoothstep(0, 0.65, u)
    p.x = lerp(this.dismountFrom.x, this.dismountTo.x, fw)
    p.z = lerp(this.dismountFrom.z, this.dismountTo.z, fw)
    p.y = lerp(this.dismountFrom.y, this.dismountTo.y, up) + Math.sin(Math.PI * u) * 0.05
    this.velocity.set(0, 0, 0)
    this.mantleTilt = Math.sin(Math.PI * u) * 0.5
    if (u >= 1) {
      this.dismountT = -1
      this.mantleTilt = 0
      this.grounded = true
      this.landDip.impulse(-0.5)
      this.resolve()
    }
  }

  // ───────────────────────────── camera feel ─────────────────────────────

  private updateFeel(dt: number, wishX: number) {
    const v = this.velocity
    const moving = this.grounded && !this.ladder && !this.mantling && this.dismountT < 0
    // Eye height transitions (faster when diving).
    let eyeTarget: number = CONFIG.eyeHeight[this.stance]
    if (this.ladder) eyeTarget = CONFIG.eyeHeight[0]
    const lambda = this.diveT > 0 ? 24 : this.stance === 0 ? 11 : 13
    this.eyeH = damp(this.eyeH, eyeTarget, lambda, dt)

    // Head bob: phase advances with real speed; footsteps land on the bob's low point.
    const stanceRef = STANCE_SPEED[this.stance] * this.weapons.mobility
    const sprint = this.sprinting && this.speed > 2.5
    let stepsPerSec: number = STEP_RATE[this.stance]
    let ref = stanceRef
    if (sprint) {
      stepsPerSec = 3.3
      ref = CONFIG.sprintSpeed * this.weapons.mobility
    }
    if (moving && this.speed > 0.4) {
      const ratio = clamp(this.speed / Math.max(ref, 0.5), 0.35, 1.25)
      this.bobPhase += stepsPerSec * ratio * Math.PI * dt
    }
    const ampTarget = moving ? clamp(this.speed / Math.max(ref, 0.5), 0, 1.15) * (sprint ? 0.022 : BOB_AMP[this.stance]) : 0
    const adsDamp = 1 - this.weapons.adsAmount * 0.7
    this.bobAmp = damp(this.bobAmp, ampTarget * adsDamp, 10, dt)
    this.bobY = Math.cos(2 * this.bobPhase) * this.bobAmp
    this.bobX = Math.sin(this.bobPhase) * this.bobAmp * 0.8
    this.bobRoll = Math.sin(this.bobPhase) * this.bobAmp * (sprint ? 0.28 : 0.12)

    const stepIdx = Math.floor((this.bobPhase - HALF_PI) / Math.PI)
    if (stepIdx !== this.stepIndex) {
      this.stepIndex = stepIdx
      if (moving && this.timeSinceSpawn > 0.3) this.emitFootstep(sprint)
    }

    // Strafe roll.
    const cy = Math.cos(this.yaw)
    const sy = Math.sin(this.yaw)
    const lateral = v.x * cy - v.z * sy
    const rollTarget = moving ? -clamp(lateral / CONFIG.walkSpeed, -1, 1) * 0.016 : -wishX * 0.004
    this.strafeRoll = damp(this.strafeRoll, rollTarget, 9, dt)

    // Springs.
    this.landDip.update(0, dt)
    this.kickPitch.update(0, dt)
    this.flinchPitch.update(0, dt)
    this.flinchYaw.update(0, dt)
    this.flinchRoll.update(0, dt)
    this.diveKick.update(0, dt)
    if (!this.mantling && this.dismountT < 0) this.mantleTilt = damp(this.mantleTilt, 0, 12, dt)
    this.hitFlash = damp(this.hitFlash, 0, 3.2, dt)
  }

  private emitFootstep(sprint: boolean) {
    const p = this.position
    let intensity: number
    if (this.stance === 2) {
      if (this.speed < 0.6) return
      intensity = 0.1
    } else if (this.stance === 1) {
      if (this.speed < 1.5) return
      intensity = 0.28
    } else if (sprint) {
      intensity = 1
    } else {
      intensity = 0.55 + 0.2 * (1 - this.weapons.adsAmount)
    }
    const surface: Surface = this.game.collision.surfaceBelow(p.x, p.y, p.z)
    this.game.events.emit('actor:footstep', { actor: this, surface, position: p, intensity })
  }

  private onDamaged(info: DamageInfo) {
    if (info.victim !== this || !this.alive) return
    const mag = clamp(info.amount / 35, 0.35, 1.3)
    const d = info.direction
    const sy = Math.sin(this.yaw)
    const cy = Math.cos(this.yaw)
    const fwd = d.x * -sy + d.z * -cy // bullet travelling with our facing = came from behind
    const side = d.x * cy + d.z * -sy // positive: pushed towards our right
    const front = Math.max(0, -fwd)
    const back = Math.max(0, fwd)
    this.flinchPitch.impulse(mag * (0.75 + 0.9 * front - 0.6 * back))
    this.flinchRoll.impulse(-side * 1.3 * mag)
    this.flinchYaw.impulse(-side * 0.6 * mag)
    this.hitFlash = Math.max(this.hitFlash, 0.22 + 0.3 * mag)
  }

  private updateEffects(dt: number) {
    const fx = this.game.render.effects
    // MW2: red vignette ramps in below ~70 health, pulses when critical, clears as regen kicks in.
    const frac = clamp((70 - this.health) / 55, 0, 1)
    const pulse = this.health < 40 ? 1 + 0.12 * Math.sin(this.game.realTime * 7) : 1
    const target = clamp(frac * pulse + this.hitFlash, 0, 1)
    fx.damage = damp(fx.damage, target, target > fx.damage ? 26 : 3.5, dt)
    fx.ads = this.weapons.adsAmount
    fx.dead = damp(fx.dead, 0, 10, dt)
  }

  private applyCamera(dt: number) {
    const cam = this.game.render.camera
    const p = this.position
    const sy = Math.sin(this.yaw)
    const cy = Math.cos(this.yaw)
    cam.position.set(
      p.x + cy * this.bobX + sy * this.camBack,
      p.y + this.camEye,
      p.z - sy * this.bobX + cy * this.camBack,
    )
    const pitch = this.pitch + this.kickPitch.value + this.flinchPitch.value + this.landDip.value * 0.9 - this.mantleTilt * 0.12 + this.diveKick.value * 0.1
    cam.rotation.set(
      clamp(pitch, -1.55, 1.55),
      this.yaw + this.flinchYaw.value,
      this.camRoll + this.flinchRoll.value,
      'YXZ',
    )
    this.applyFov(dt)
  }

  /** settings.fov is horizontal; convert at the live aspect, then apply ADS zoom + sprint kick. */
  private applyFov(dt: number) {
    const cam = this.game.render.camera
    const aspect = cam.aspect > 0.1 ? cam.aspect : 16 / 9
    const baseV = 2 * Math.atan(Math.tan((this.game.settings.fov * DEG) / 2) / aspect)
    this.sprintFov = damp(this.sprintFov, this.alive && this.sprinting && this.speed > 3 ? 1.05 : 1, 7, dt || 0.016)
    const zoom = this.alive ? this.weapons.fovMultiplier : 1
    const vfov = baseV * zoom * this.sprintFov
    this.fovRatio = clamp(Math.tan((baseV * zoom) / 2) / Math.tan(baseV / 2), 0.12, 1)
    const deg = vfov / DEG
    if (Math.abs(deg - this.lastFov) > 0.001 || aspect !== this.lastAspect) {
      cam.fov = deg
      cam.updateProjectionMatrix()
      this.lastFov = deg
      this.lastAspect = aspect
    }
  }

  // ───────────────────────────── death ─────────────────────────────

  private updateDead(dt: number, s: InputState) {
    const g = this.game
    const v = this.velocity
    this.deathT += dt
    const t = this.deathT
    this.landImpact = 0
    // Body keeps falling if it died in mid-air.
    v.x = v.z = 0
    if (!this.grounded || v.y !== 0) {
      const wasY = this.position.y
      this.integrate(dt)
      if (this.position.y === wasY && this.grounded) v.y = 0
    }

    if (this.deathHasTarget) {
      const k = 1 - Math.exp(-3.2 * dt)
      this.yaw += wrapAngle(this.deathYawTarget - this.yaw) * k
    }
    this.pitch = damp(this.pitch, this.deathPitchTarget, 2.8, dt)

    // Drop to the ground: accelerating fall then a small bounce.
    const fall = clamp(t / 0.55, 0, 1)
    const groundEye = 0.2
    let eye = lerp(this.deathEye, groundEye, fall * fall)
    if (t > 0.55) eye += 0.05 * Math.exp(-9 * (t - 0.55)) * Math.abs(Math.sin(14 * (t - 0.55)))
    this.camEye = eye
    this.camRoll = this.deathRoll * smoothstep(0, 0.6, t)
    this.camBack = -this.deathBack * smoothstep(0, 0.7, t)
    this.bobX = 0
    this.landDip.update(0, dt)
    this.kickPitch.update(0, dt)
    this.flinchPitch.update(0, dt)
    this.flinchYaw.update(0, dt)
    this.flinchRoll.update(0, dt)
    this.mantleTilt = 0
    this.hitFlash = damp(this.hitFlash, 0, 2, dt)

    const fx = g.render.effects
    fx.dead += (1 - fx.dead) * (1 - Math.exp(-1.8 * dt))
    fx.damage = damp(fx.damage, 0.6, 2.5, dt)
    fx.ads = damp(fx.ads, 0, 10, dt)

    if (t > 0.4 && (s.fire || s.firePressed)) g.mode.requestRespawn(this)
    this.applyCamera(dt)
  }
}
