/**
 * MW2 killstreak rewards: earning (consecutive kills, streak kills chain), the held
 * inventory, calling each reward in, and simulating everything it puts into the world.
 *
 * Authority: the host (or offline game) simulates every entity and resolves damage.
 * Clients keep their own inventory from the relayed earned/used events, run the map
 * picker / sentry placement locally, send a use request, and mirror the host's entities
 * from the ~10 Hz `killstreak:state` event. Remote-control rewards (Predator, Chopper
 * Gunner, AC-130) are flown by the AI when called in by an online client.
 */
import { type Group, MathUtils, Quaternion, Vector3 } from 'three'
import type { Game } from '../../core/game'
import type { Actor, Team } from '../../core/types'
import { otherTeam } from '../../core/types'
import { botKillstreaks, KILLSTREAKS, type KillstreakId, normalizeKillstreaks, rollCrate } from './defs'
import { animateModel, buildModel, type ModelKind } from './models'

const _v = new Vector3()
const _w = new Vector3()
const _d = new Vector3()
const _e = new Vector3()
const _q = new Quaternion()
const UP = new Vector3(0, 1, 0)

type V3 = [number, number, number]

export interface KsEntNet {
  id: number
  k: ModelKind
  t: Team
  o: number
  p: V3
  q: [number, number, number, number]
}

interface TimedNet {
  owner: number
  team: Team
  left: number
}

export interface KillstreakNetState {
  ents: KsEntNet[]
  emp: TimedNet | null
  cuav: TimedNet[]
  nuke: TimedNet | null
}

interface Holder {
  choices: KillstreakId[]
  /** Earned rewards, oldest first (kept through death until used). */
  inv: KillstreakId[]
  sel: number
}

interface Timed {
  owner: Actor
  team: Team
  until: number
}

export interface AcWeapon {
  name: string
  reload: number
  radius: number
  damage: number
  fov: number
  /** Shell flight speed (m/s); 0 = hitscan. */
  speed: number
}

export const AC130_WEAPONS: AcWeapon[] = [
  { name: '105 mm', reload: 4.2, radius: 7.5, damage: 420, fov: 40, speed: 260 },
  { name: '40 mm', reload: 0.55, radius: 3.4, damage: 190, fov: 26, speed: 300 },
  { name: '25 mm', reload: 0.07, radius: 1.2, damage: 70, fov: 15, speed: 0 },
]
const CHOPPER_GUN: AcWeapon = { name: '20 mm', reload: 0.085, radius: 1.6, damage: 55, fov: 52, speed: 0 }

export type Interact =
  | { k: 'none' }
  | { k: 'map'; id: KillstreakId; x: number; z: number; heading: number; stage: 0 | 1 }
  | { k: 'place'; id: KillstreakId; ghost: Group; valid: boolean }
  | { k: 'control'; ent: Gunship | Missile }

// ═══════════════════════════════════════════════════════════════════════════
// Entities
// ═══════════════════════════════════════════════════════════════════════════

let nextEntId = 1

export abstract class Ent {
  readonly id = nextEntId++
  readonly root: Group
  readonly team: Team
  t = 0
  dead = false
  /** Remaining health (0 = indestructible). */
  hp = 0
  /** Bullet hit sphere radius (0 = can't be shot). */
  radius = 0
  /** Air support: shown on the minimap, destroyed by EMP. */
  air = false
  /** Hidden from radar (Stealth Bomber). */
  stealth = false

  constructor(
    readonly ks: KillstreakManager,
    readonly kind: ModelKind,
    readonly owner: Actor,
    readonly streak: KillstreakId,
  ) {
    this.team = owner.team
    this.root = buildModel(kind, owner.team === ks.game.player.team)
    ks.game.render.scene.add(this.root)
  }

  get pos() {
    return this.root.position
  }

  hitCenter(out: Vector3): Vector3 {
    return out.copy(this.root.position)
  }

  abstract step(dt: number): void

  /** Called once when shot down / destroyed by EMP. */
  destroyed(_by: Actor | null) {
    this.ks.boom(this.root.position, 2)
    this.dead = true
  }

  dispose() {
    this.root.removeFromParent()
  }

  /** Yaw so the -Z nose faces `dir` (horizontal). */
  protected face(dir: Vector3, dt: number, rate = 2.5, bank = 0) {
    const want = Math.atan2(-dir.x, -dir.z)
    const cur = this.root.rotation.y
    let d = want - cur
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    const step = MathUtils.clamp(d, -rate * dt, rate * dt)
    this.root.rotation.set(0, cur + step, 0, 'YXZ')
    if (bank) this.root.rotation.z = MathUtils.clamp(-d * bank, -0.5, 0.5)
  }
}

/** UAV / Counter-UAV drone circling high above the map (visual + can be shot down). */
class Drone extends Ent {
  private a = Math.random() * 6.28
  constructor(ks: KillstreakManager, owner: Actor, streak: KillstreakId, private life: number) {
    super(ks, 'uav', owner, streak)
    this.air = true
    this.hp = 260
    this.radius = 3.5
    this.root.scale.setScalar(1.6)
  }
  step(dt: number) {
    this.t += dt
    if (this.t > this.life) this.dead = true
    this.a += dt * 0.09
    const c = this.ks.center
    this.root.position.set(c.x + Math.cos(this.a) * 46, 64, c.z + Math.sin(this.a) * 46)
    this.root.rotation.set(0, -this.a, 0.32, 'YXZ')
  }
  destroyed(by: Actor | null) {
    super.destroyed(by)
    if (this.streak === 'uav') this.ks.game.mode.cancelUav(this.owner)
    else this.ks.endCounterUav(this.owner)
  }
}

/** Bomb falling to an exact impact point (keeps the airstrike line where it was aimed). */
class Bomb extends Ent {
  private from = new Vector3()
  private to = new Vector3()
  constructor(ks: KillstreakManager, owner: Actor, streak: KillstreakId, from: Vector3, to: Vector3, private dur: number, private radius2: number, private dmg: number) {
    super(ks, 'missile', owner, streak)
    this.root.scale.setScalar(0.55)
    this.from.copy(from)
    this.to.copy(to)
  }
  step(dt: number) {
    this.t += dt
    const u = Math.min(1, this.t / this.dur)
    const p = this.root.position.lerpVectors(this.from, this.to, u * u)
    _d.subVectors(this.to, this.from).normalize()
    _q.setFromUnitVectors(_w.set(0, 0, -1), _d)
    this.root.quaternion.copy(_q)
    if (u >= 1) {
      this.ks.blast(p, this.owner, this.radius2, this.dmg, this.streak)
      this.dead = true
    }
  }
}

/** Fast jet pass that lays bombs on a line (Precision Airstrike / Harrier strike). */
class JetRun extends Ent {
  private start = new Vector3()
  private dir = new Vector3()
  private drops: number[]
  private dropped = 0
  constructor(ks: KillstreakManager, owner: Actor, streak: KillstreakId, kind: ModelKind, private target: Vector3, heading: number, offset: number, private delay: number, private alt: number, private lineLen: number) {
    super(ks, kind, owner, streak)
    this.air = true
    this.dir.set(Math.sin(heading), 0, -Math.cos(heading))
    const side = _w.set(-this.dir.z, 0, this.dir.x).multiplyScalar(offset)
    this.target = target.clone().add(side)
    this.start.copy(this.target).addScaledVector(this.dir, -260).setY(alt)
    this.root.position.copy(this.start)
    this.root.rotation.set(0, Math.atan2(-this.dir.x, -this.dir.z), 0, 'YXZ')
    this.root.visible = false
    const n = streak === 'harrier' ? 4 : 6
    this.drops = Array.from({ length: n }, (_, i) => -lineLen / 2 + (lineLen * i) / (n - 1))
  }
  step(dt: number) {
    this.t += dt
    if (this.t < this.delay) return
    this.root.visible = true
    const speed = 105
    const travelled = (this.t - this.delay) * speed
    this.root.position.copy(this.start).addScaledVector(this.dir, travelled)
    animateModel(this.root, this.t)
    if (this.t - this.delay < dt * 1.5) this.ks.sound('ks.jet', this.target.clone().setY(this.alt), 1.3)
    // Release each bomb ~45 m before the jet's ground track crosses its impact point.
    const along = travelled - 260
    while (this.dropped < this.drops.length && along >= this.drops[this.dropped]! - 45) {
      const at = this.drops[this.dropped++]!
      const hit = this.ks.groundAt(_e.copy(this.target).addScaledVector(this.dir, at))
      this.ks.add(new Bomb(this.ks, this.owner, this.streak, this.root.position, hit, 1.1, 7, 360))
    }
    if (travelled > 560) this.dead = true
  }
}

/** B-2 carpet bombing: invisible on radar, long dense line. */
class Bomber extends Ent {
  private start = new Vector3()
  private dir = new Vector3()
  private dropped = 0
  constructor(ks: KillstreakManager, owner: Actor, private target: Vector3, heading: number) {
    super(ks, 'bomber', owner, 'stealthBomber')
    this.air = true
    this.stealth = true
    this.dir.set(Math.sin(heading), 0, -Math.cos(heading))
    this.start.copy(target).addScaledVector(this.dir, -300).setY(72)
    this.root.position.copy(this.start)
    this.root.rotation.set(0, Math.atan2(-this.dir.x, -this.dir.z), 0, 'YXZ')
  }
  step(dt: number) {
    this.t += dt
    const travelled = this.t * 80
    this.root.position.copy(this.start).addScaledVector(this.dir, travelled)
    if (this.t < dt * 1.5) this.ks.sound('ks.jet', this.target.clone().setY(60), 1.0)
    const along = travelled - 300
    const n = 22
    while (this.dropped < n && along >= -36 + (72 * this.dropped) / (n - 1) - 40) {
      const at = -36 + (72 * this.dropped++) / (n - 1)
      const hit = this.ks.groundAt(_e.copy(this.target).addScaledVector(this.dir, at))
      this.ks.add(new Bomb(this.ks, this.owner, 'stealthBomber', this.root.position, hit, 1.4, 6.5, 320))
    }
    if (travelled > 620) this.dead = true
  }
}

/** Attack Helicopter, Pave Low and the hovering Harrier: patrol, hunt, strafe. */
class Heli extends Ent {
  private wp = new Vector3()
  private vel = new Vector3()
  private target: Actor | null = null
  private scanT = 0
  private fireT = 0
  private burst = 0
  private leaving = false
  private rotorT = 0
  private readonly alt: number
  private readonly speed: number
  constructor(ks: KillstreakManager, owner: Actor, streak: KillstreakId, private life: number, private anchor: Vector3 | null = null) {
    super(ks, streak === 'paveLow' ? 'paveLow' : streak === 'harrier' ? 'harrier' : 'attackHeli', owner, streak)
    this.air = true
    this.hp = streak === 'paveLow' ? 3200 : streak === 'harrier' ? 1100 : 1400
    this.radius = streak === 'paveLow' ? 5.5 : 3.6
    this.alt = streak === 'paveLow' ? 19 : streak === 'harrier' ? 23 : 24
    this.speed = streak === 'harrier' ? 9 : streak === 'paveLow' ? 12 : 15
    const b = ks.game.map.bounds
    const side = Math.random() < 0.5 ? b.minX - 60 : b.maxX + 60
    this.root.position.set(side, this.alt + 10, (b.minZ + b.maxZ) / 2 + (Math.random() - 0.5) * 40)
    this.pickWaypoint()
  }
  private pickWaypoint() {
    const b = this.ks.game.map.bounds
    if (this.anchor) {
      const a = Math.random() * 6.28
      this.wp.set(this.anchor.x + Math.cos(a) * 9, this.alt, this.anchor.z + Math.sin(a) * 9)
      return
    }
    this.wp.set(MathUtils.lerp(b.minX + 8, b.maxX - 8, Math.random()), this.alt + (Math.random() - 0.5) * 4, MathUtils.lerp(b.minZ + 8, b.maxZ - 8, Math.random()))
  }
  hitCenter(out: Vector3) {
    return out.copy(this.root.position)
  }
  step(dt: number) {
    this.t += dt
    this.rotorT += dt
    animateModel(this.root, this.rotorT)
    const p = this.root.position
    if (!this.leaving && (this.t > this.life || this.ks.empAffects(this.owner))) {
      this.leaving = true
      const b = this.ks.game.map.bounds
      this.wp.set(p.x > 0 ? b.maxX + 140 : b.minX - 140, this.alt + 25, p.z)
    }
    if (this.leaving && Math.abs(p.x) > Math.max(Math.abs(this.ks.game.map.bounds.minX), this.ks.game.map.bounds.maxX) + 120) {
      this.dead = true
      return
    }
    // Move: accelerate towards the waypoint, slow down near it.
    _d.subVectors(this.wp, p)
    const dist = _d.length()
    if (!this.leaving && dist < 4) this.pickWaypoint()
    const want = _d.normalize().multiplyScalar(Math.min(this.leaving ? 30 : this.speed, dist * 0.8))
    this.vel.lerp(want, 1 - Math.exp(-1.4 * dt))
    p.addScaledVector(this.vel, dt)
    if (Math.floor(this.t / 1.6) !== Math.floor((this.t - dt) / 1.6)) this.ks.sound(this.streak === 'harrier' ? 'ks.jet.hover' : 'ks.rotor', p, 0.9)

    // Target: closest visible enemy (re-evaluated a few times a second).
    this.scanT -= dt
    if (this.scanT <= 0 && !this.leaving) {
      this.scanT = 0.35
      this.target = this.ks.visibleEnemy(this.owner, p, this.streak === 'paveLow' ? 70 : 60)
    }
    const tg = this.target && this.target.alive ? this.target : null
    if (tg) {
      _e.subVectors(tg.position, p)
      _e.y = 0
      this.face(_e, dt, 2.2)
      this.root.rotation.x = -0.12
    } else if (this.vel.lengthSq() > 1) {
      this.face(this.vel, dt, 1.4, 0.35)
      this.root.rotation.x = -Math.min(0.2, this.vel.length() * 0.012)
    }
    // Strafe in bursts (MW2 attack helicopter rhythm).
    this.fireT -= dt
    if (tg && this.fireT <= 0) {
      if (this.burst <= 0) this.burst = this.streak === 'paveLow' ? 16 : 10
      this.burst--
      this.fireT = this.burst > 0 ? 0.09 : 1.4 + Math.random()
      tg.getEyePosition(_e)
      _e.y -= 0.5
      const gun = _v.copy(p).add(_w.set(0, -1.2, 0))
      this.ks.gun(this.owner, gun, _e, this.streak === 'paveLow' ? 34 : 30, this.streak, 0.035, 0.8)
      if (this.burst % 3 === 0) this.ks.sound('ks.chain', gun, 0.9)
    }
  }
  destroyed(by: Actor | null) {
    this.ks.boom(this.root.position, 3)
    this.dead = true
    this.ks.crashWreck(this.root.position)
    if (by?.isPlayer) this.ks.game.mode.addPoints(by, 200, this.streak === 'paveLow' ? 'PAVE LOW DOWN' : 'HELICOPTER DOWN')
  }
}

/** Chopper Gunner / AC-130 orbiting the map; flown by the owner or the AI gunner. */
export class Gunship extends Ent {
  angle = Math.random() * 6.28
  readonly orbitR: number
  readonly alt: number
  readonly gunPos = new Vector3()
  /** Player's aim (world yaw / pitch). */
  aimYaw = 0
  aimPitch = -0.8
  weapon = 0
  cool = [0, 0, 0]
  controlled = false
  private aiT = 0
  private aiTarget: Actor | null = null
  private rotorT = 0
  constructor(ks: KillstreakManager, owner: Actor, streak: 'chopperGunner' | 'ac130', private life: number) {
    super(ks, streak === 'ac130' ? 'ac130' : 'chopper', owner, streak)
    this.air = true
    this.orbitR = streak === 'ac130' ? 82 : 24
    this.alt = streak === 'ac130' ? 92 : 27
    if (streak === 'chopperGunner') {
      this.hp = 1500
      this.radius = 3.6
    }
    this.place()
    const c = ks.center
    _d.set(c.x, 0, c.z).sub(this.gunPos)
    this.aimYaw = Math.atan2(-_d.x, -_d.z)
    this.aimPitch = -Math.atan2(this.alt, Math.hypot(_d.x, _d.z))
  }
  get weapons(): AcWeapon[] {
    return this.streak === 'ac130' ? AC130_WEAPONS : [CHOPPER_GUN]
  }
  get timeLeft() {
    return Math.max(0, this.life - this.t)
  }
  private place() {
    const c = this.ks.center
    const p = this.root.position.set(c.x + Math.cos(this.angle) * this.orbitR, this.alt, c.z + Math.sin(this.angle) * this.orbitR)
    // Nose along the orbit tangent, banked into the turn.
    this.root.rotation.set(0, -this.angle + Math.PI, this.streak === 'ac130' ? -0.22 : -0.15, 'YXZ')
    this.gunPos.copy(p).add(_w.set(0, this.streak === 'ac130' ? -2.5 : -1.6, 0))
  }
  step(dt: number) {
    this.t += dt
    this.rotorT += dt
    animateModel(this.root, this.rotorT)
    this.angle += dt * (this.streak === 'ac130' ? 0.075 : 0.2)
    this.place()
    for (let i = 0; i < this.cool.length; i++) this.cool[i] = Math.max(0, this.cool[i]! - dt)
    if (Math.floor(this.t / 2) !== Math.floor((this.t - dt) / 2)) this.ks.sound(this.streak === 'ac130' ? 'ks.drone' : 'ks.rotor', this.root.position, this.controlled ? 0.5 : 0.9)
    if (this.t > this.life || this.ks.empAffects(this.owner)) {
      this.dead = true
      return
    }
    if (!this.controlled) this.ai(dt)
  }
  /** AI gunner: walks fire onto visible enemies. */
  private ai(dt: number) {
    this.aiT -= dt
    if (this.aiT <= 0) {
      this.aiT = 0.6
      this.aiTarget = this.ks.visibleEnemy(this.owner, this.gunPos, this.streak === 'ac130' ? 220 : 90)
      this.weapon = this.streak === 'ac130' ? (Math.random() < 0.25 ? 0 : Math.random() < 0.5 ? 1 : 2) : 0
    }
    const tg = this.aiTarget
    if (!tg || !tg.alive) return
    _e.copy(tg.position)
    _e.x += (Math.random() - 0.5) * 3
    _e.z += (Math.random() - 0.5) * 3
    _d.subVectors(_e, this.gunPos).normalize()
    this.fire(_d)
  }
  /** Fire the selected weapon along `dir` (respects reload). */
  fire(dir: Vector3) {
    const w = this.weapons[this.weapon]!
    if (this.cool[this.weapon]! > 0) return
    this.cool[this.weapon] = w.reload
    this.ks.shell(this.owner, this.gunPos, dir, w, this.streak)
    if (this.controlled) {
      this.ks.game.render.effects.shake = Math.max(this.ks.game.render.effects.shake, this.streak === 'ac130' ? [0.5, 0.18, 0.05][this.weapon]! : 0.06)
    }
  }
  destroyed(by: Actor | null) {
    this.ks.boom(this.root.position, 3)
    this.ks.crashWreck(this.root.position)
    this.dead = true
    if (by?.isPlayer) this.ks.game.mode.addPoints(by, 300, 'CHOPPER GUNNER DOWN')
  }
}

/** Predator missile: player-steered (thermal view) or AI-guided. */
export class Missile extends Ent {
  readonly dir = new Vector3()
  speed = 38
  boosted = false
  controlled = false
  private aimAt = new Vector3()
  private trailT = 0
  constructor(ks: KillstreakManager, owner: Actor, aim: Vector3) {
    super(ks, 'missile', owner, 'predator')
    const c = ks.center
    _d.set(owner.position.x - c.x, 0, owner.position.z - c.z)
    if (_d.lengthSq() < 1) _d.set(0, 0, 1)
    _d.normalize()
    this.root.position.set(c.x + _d.x * 70, 150, c.z + _d.z * 70)
    this.aimAt.copy(aim)
    this.dir.subVectors(aim, this.root.position).normalize()
    this.root.scale.setScalar(1.4)
    ks.sound('ks.missile', this.root.position, 1)
  }
  get timeLeft() {
    return Math.max(0, KILLSTREAKS.predator.duration - this.t)
  }
  boost() {
    if (this.boosted) return
    this.boosted = true
    this.ks.sound('ks.missile', this.root.position, 1.2)
  }
  step(dt: number) {
    this.t += dt
    if (!this.controlled) {
      // AI: home on the aim point (re-aimed at the live target by the manager).
      _d.subVectors(this.aimAt, this.root.position).normalize()
      this.dir.lerp(_d, 1 - Math.exp(-2.2 * dt)).normalize()
      if (this.t > 2.5) this.boost()
    }
    this.speed = MathUtils.lerp(this.speed, this.boosted ? 115 : 38, 1 - Math.exp(-3 * dt))
    const p = this.root.position
    const travel = this.speed * dt
    const hit = this.ks.game.collision.raycast(p, this.dir, travel + 0.5)
    const near = this.ks.actorNear(p, 1.6, this.owner)
    if (hit || near || p.y < -2 || this.t > KILLSTREAKS.predator.duration) {
      const at = hit ? hit.point : p
      this.ks.blast(at, this.owner, 9, 520, 'predator', 2)
      this.dead = true
      return
    }
    p.addScaledVector(this.dir, travel)
    _q.setFromUnitVectors(_w.set(0, 0, -1), this.dir)
    this.root.quaternion.copy(_q)
    animateModel(this.root, this.t)
    this.trailT -= dt
    if (this.trailT <= 0) {
      this.trailT = 0.05
      this.ks.game.fx.smoke(_e.copy(p).addScaledVector(this.dir, -2), 0.75, 0.73, 0.7, 0.8, 0.45, 1.6)
    }
  }
  retarget(p: Vector3) {
    this.aimAt.copy(p)
  }
}

/** Sentry gun: rotates to and fires at enemies in range. */
class Sentry extends Ent {
  private head: Group
  private target: Actor | null = null
  private scanT = 0
  private fireT = 0
  private yaw = 0
  constructor(ks: KillstreakManager, owner: Actor, at: Vector3, yaw: number) {
    super(ks, 'sentry', owner, 'sentry')
    this.root.position.copy(at)
    this.hp = 700
    this.radius = 0.75
    this.yaw = yaw
    this.head = this.root.getObjectByName('head') as Group
    this.head.rotation.y = yaw
    ks.sound('ks.place', at, 0.9)
  }
  hitCenter(out: Vector3) {
    return out.copy(this.root.position).setY(this.root.position.y + 0.8)
  }
  step(dt: number) {
    this.t += dt
    if (this.t > KILLSTREAKS.sentry.duration) {
      this.dead = true
      return
    }
    if (this.ks.empAffects(this.owner)) return
    const muzzle = _v.copy(this.root.position).setY(this.root.position.y + 1.0)
    this.scanT -= dt
    if (this.scanT <= 0) {
      this.scanT = 0.25
      this.target = this.ks.visibleEnemy(this.owner, muzzle, 42)
    }
    const tg = this.target && this.target.alive ? this.target : null
    if (!tg) {
      this.yaw += dt * 0.6 * Math.sin(this.t * 0.4)
      this.head.rotation.y = this.yaw
      return
    }
    tg.getEyePosition(_e)
    _e.y -= 0.4
    _d.subVectors(_e, muzzle)
    const want = Math.atan2(-_d.x, -_d.z)
    let dy = want - this.yaw
    while (dy > Math.PI) dy -= Math.PI * 2
    while (dy < -Math.PI) dy += Math.PI * 2
    this.yaw += MathUtils.clamp(dy, -4 * dt, 4 * dt)
    this.head.rotation.y = this.yaw
    this.head.rotation.x = Math.atan2(_d.y, Math.hypot(_d.x, _d.z))
    this.fireT -= dt
    if (Math.abs(dy) < 0.15 && this.fireT <= 0) {
      this.fireT = 0.1
      this.ks.gun(this.owner, muzzle, _e, 20, 'sentry', 0.03, 0)
      if (Math.random() < 0.5) this.ks.sound('ks.turret', muzzle, 0.85)
    }
  }
}

/** Care package crate: drops under its helicopter, then waits to be captured. */
export class Crate extends Ent {
  readonly contents: KillstreakId | null
  landed = false
  private vy = 0
  private landT = 0
  constructor(ks: KillstreakManager, owner: Actor, at: Vector3, private floor: number) {
    super(ks, 'crate', owner, 'carePackage')
    this.root.position.copy(at)
    this.contents = rollCrate()
  }
  get label() {
    return this.contents ? KILLSTREAKS[this.contents].name : 'Ammo'
  }
  step(dt: number) {
    this.t += dt
    const p = this.root.position
    if (!this.landed) {
      this.vy = Math.min(this.vy + 9.8 * dt, 11)
      p.y -= this.vy * dt
      this.root.rotation.y += dt * 0.6
      if (p.y <= this.floor) {
        p.y = this.floor
        this.landed = true
        this.ks.sound('ks.crate', p, 1)
        this.ks.game.events.emit('bullet:impact', { point: p.clone(), normal: UP.clone(), surface: 'wood', shooter: this.owner })
      }
      return
    }
    this.landT += dt
    // Bots and online clients have their own crates picked up for them.
    if (!this.owner.isPlayer && this.landT > 2.5 && this.owner.alive) {
      this.ks.collect(this, this.owner)
      return
    }
    if (this.landT > 90) this.dead = true
  }
}

const CRATE_OFFSETS: [number, number][] = [[0, 0], [2.4, 0.4], [-2.4, -0.4], [0.4, 2.4]]

/** Heavy helicopter that drops crates on a marker and leaves. */
class Delivery extends Ent {
  private phase: 'in' | 'hover' | 'out' = 'in'
  private hoverT = 0
  private dropped = 0
  private dir = new Vector3()
  private rotorT = 0
  constructor(ks: KillstreakManager, owner: Actor, private target: Vector3, private crates: number) {
    super(ks, 'deliveryHeli', owner, crates > 1 ? 'airdrop' : 'carePackage')
    const a = Math.random() * 6.28
    this.dir.set(Math.cos(a), 0, Math.sin(a))
    this.root.position.copy(target).addScaledVector(this.dir, -160).setY(target.y + 30)
  }
  step(dt: number) {
    this.t += dt
    this.rotorT += dt
    animateModel(this.root, this.rotorT)
    const p = this.root.position
    if (Math.floor(this.t / 1.6) !== Math.floor((this.t - dt) / 1.6)) this.ks.sound('ks.rotor', p, 1)
    const hoverAt = _e.copy(this.target).setY(this.target.y + 16)
    if (this.phase === 'in') {
      _d.subVectors(hoverAt, p)
      const dist = _d.length()
      p.addScaledVector(_d.normalize(), Math.min(dist, dt * Math.max(6, Math.min(40, dist * 0.6))))
      this.face(_d, dt, 1.5)
      if (dist < 0.6) this.phase = 'hover'
    } else if (this.phase === 'hover') {
      this.hoverT += dt
      if (this.hoverT > 1.2 && this.dropped < this.crates) {
        const off = CRATE_OFFSETS[this.dropped++]!
        const drop = _v.copy(p).add(_w.set(off[0], -3, off[1]))
        const floor = this.ks.groundAt(drop).y
        this.ks.add(new Crate(this.ks, this.owner, drop, floor))
        this.hoverT = 0.7
      }
      if (this.dropped >= this.crates && this.hoverT > 1.8) this.phase = 'out'
    } else {
      p.addScaledVector(this.dir, dt * 35)
      p.y += dt * 4
      this.face(this.dir, dt, 1)
      if (this.t > 30 || p.distanceTo(this.target) > 220) this.dead = true
    }
  }
}

/** Thrown smoke marker for Care Package / Emergency Airdrop. */
class Marker extends Ent {
  private vel: Vector3
  private rest = false
  private called = false
  private smokeT = 0
  constructor(ks: KillstreakManager, owner: Actor, from: Vector3, vel: Vector3, private crates: number) {
    super(ks, 'marker', owner, crates > 1 ? 'airdrop' : 'carePackage')
    this.root.position.copy(from)
    this.vel = vel.clone()
  }
  step(dt: number) {
    this.t += dt
    const p = this.root.position
    if (!this.rest) {
      this.vel.y -= 9.8 * dt
      const sp = this.vel.length()
      _d.copy(this.vel).divideScalar(Math.max(sp, 1e-4))
      const hit = this.ks.game.collision.raycast(p, _d, sp * dt + 0.05)
      if (hit) {
        p.copy(hit.point).addScaledVector(hit.normal, 0.05)
        if (hit.normal.y > 0.6) {
          this.rest = true
          this.vel.set(0, 0, 0)
        } else this.vel.reflect(hit.normal).multiplyScalar(0.35)
      } else p.addScaledVector(this.vel, dt)
      if (this.t > 6) this.rest = true
    } else if (!this.called) {
      this.called = true
      this.ks.add(new Delivery(this.ks, this.owner, p.clone(), this.crates))
    }
    this.smokeT -= dt
    if (this.rest && this.smokeT <= 0) {
      this.smokeT = 0.12
      this.ks.game.fx.smoke(p, 0.85, 0.12, 0.08, 1.2, 0.7, 3.2)
    }
    if (this.t > 26) this.dead = true
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Manager
// ═══════════════════════════════════════════════════════════════════════════

interface Ghost {
  root: Group
  kind: ModelKind
  p: Vector3
  q: Quaternion
  t: number
}

export class KillstreakManager {
  readonly ents: Ent[] = []
  readonly center = new Vector3()
  private holders = new Map<number, Holder>()
  private botNext = new Map<number, number>()
  private emp: Timed | null = null
  private cuav: Timed[] = []
  private nuke: Timed | null = null
  private sirenT = 0
  private groundFireT = 0
  private netT = 0
  private ghosts = new Map<number, Ghost>()
  /** Mirrored timers on clients. */
  private netEmp: TimedNet | null = null
  private netCuav: TimedNet[] = []
  private netNuke: TimedNet | null = null
  interact: Interact = { k: 'none' }
  /** Local player's crate capture (0..1) and the crate being captured. */
  capture = 0
  captureCrate: Crate | null = null
  private prevAds = false

  constructor(readonly game: Game) {
    const ev = game.events
    ev.on('match:phase', ({ phase }) => {
      if (phase === 'intro' || phase === 'menu') this.reset()
      if (phase === 'ended') this.endInteract()
    })
    ev.on('round:phase', ({ phase }) => {
      if (phase === 'start') this.clearEntities()
    })
    // Clients track their own inventory from the host's events.
    ev.on('killstreak:earned', ({ actor, streak }) => {
      if (this.isHost || actor !== game.player) return
      const h = this.holder(actor)
      h.inv.push(streak)
      h.sel = h.inv.length - 1
    })
    ev.on('killstreak:state', (s) => {
      if (!this.isHost) this.applyNetState(s)
    })
  }

  get isHost() {
    return this.game.netRole !== 'client'
  }

  // ─── Inventory ────────────────────────────────────────────────────────────

  choicesFor(actor: Actor): KillstreakId[] {
    if (actor === this.game.player) return normalizeKillstreaks(this.game.loadout.killstreaks)
    const net = this.game.net?.killstreaksOf?.(actor)
    if (net) return normalizeKillstreaks(net)
    return botKillstreaks(actor.id, this.game.bots.difficulty)
  }

  holder(actor: Actor): Holder {
    let h = this.holders.get(actor.id)
    if (!h) this.holders.set(actor.id, (h = { choices: this.choicesFor(actor), inv: [], sel: 0 }))
    return h
  }

  /** Kills still needed for the next reward in `actor`'s set (null when all are earned this life). */
  nextReward(actor: Actor): { id: KillstreakId; left: number } | null {
    const n = actor.stats.streak
    for (const id of this.holder(actor).choices) if (KILLSTREAKS[id].kills > n) return { id, left: KILLSTREAKS[id].kills - n }
    return null
  }

  /** Host: a kill was scored; award any reward that streak count unlocks. */
  onKill(killer: Actor | null, victim: Actor) {
    if (!killer || killer === victim || !this.game.mode.isEnemy(killer, victim) || !this.isHost) return
    const n = killer.stats.streak
    const h = this.holder(killer)
    for (const id of h.choices) if (KILLSTREAKS[id].kills === n) this.award(killer, id)
  }

  award(actor: Actor, id: KillstreakId) {
    const h = this.holder(actor)
    h.inv.push(id)
    h.sel = h.inv.length - 1
    this.game.events.emit('killstreak:earned', { actor, streak: id })
    if (!actor.isPlayer && this.game.net?.killstreaksOf?.(actor) == null) this.botNext.set(actor.id, this.game.time + 2 + Math.random() * 4)
  }

  // ─── Local player input ──────────────────────────────────────────────────

  /** Player can't move or look normally (laptop map / remote control). */
  get freezesPlayer() {
    return this.interact.k === 'map' || this.interact.k === 'control'
  }

  /** Player's weapon is put away (any killstreak interaction). */
  get blocksWeapons() {
    return this.interact.k !== 'none'
  }

  get controlling(): Gunship | Missile | null {
    return this.interact.k === 'control' ? this.interact.ent : null
  }

  private playerInput(dt: number) {
    const g = this.game
    const p = g.player
    const s = g.input.state
    const playing = g.mode.phase === 'playing'
    const it = this.interact
    if (!p.alive || !playing) {
      if (it.k !== 'none') this.endInteract()
      return
    }
    const h = this.holder(p)
    if (it.k === 'none') {
      if (s.streakCyclePressed && h.inv.length > 1) {
        h.sel = (h.sel + 1) % h.inv.length
        this.sound('ui.hover')
      }
      if (s.killstreakPressed && h.inv.length) this.beginUse(h.inv[Math.min(h.sel, h.inv.length - 1)]!)
      this.updateCapture(dt)
    } else if (it.k === 'map') this.updateMap(it)
    else if (it.k === 'place') this.updatePlace(it)
    else this.updateControl(it.ent)
    this.prevAds = s.ads
  }

  /** Player pressed 4 on a held reward. */
  private beginUse(id: KillstreakId) {
    const def = KILLSTREAKS[id]
    const p = this.game.player
    if (def.kind === 'location') {
      this.interact = { k: 'map', id, x: p.position.x, z: p.position.z, heading: p.yaw + Math.PI, stage: 0 }
      this.sound('ks.laptop')
      return
    }
    if (def.kind === 'place') {
      const ghost = buildModel('sentry')
      this.game.render.scene.add(ghost)
      this.interact = { k: 'place', id, ghost, valid: false }
      return
    }
    this.consume(p, id)
    if (this.isHost) this.activate(p, id)
    else this.game.net?.onKillstreak?.(id)
  }

  private consume(actor: Actor, id: KillstreakId): boolean {
    const h = this.holder(actor)
    const i = h.inv.indexOf(id)
    if (i < 0) return false
    h.inv.splice(i, 1)
    h.sel = Math.max(0, Math.min(h.sel, h.inv.length - 1))
    return true
  }

  private updateMap(it: Extract<Interact, { k: 'map' }>) {
    const s = this.game.input.state
    const b = this.game.map.bounds
    const scale = (b.maxX - b.minX) / 560
    if (it.stage === 0) {
      it.x = MathUtils.clamp(it.x + s.lookDX * scale, b.minX, b.maxX)
      it.z = MathUtils.clamp(it.z + s.lookDY * scale, b.minZ, b.maxZ)
    } else it.heading += s.lookDX * 0.012
    if (s.killstreakPressed || (s.ads && !this.prevAds)) {
      this.endInteract()
      return
    }
    if (!s.firePressed) return
    if (it.stage === 0 && KILLSTREAKS[it.id].directional) {
      it.stage = 1
      this.sound('ui.select')
      return
    }
    const p = this.game.player
    if (!this.consume(p, it.id)) return this.endInteract()
    this.interact = { k: 'none' }
    if (this.isHost) this.activate(p, it.id, new Vector3(it.x, 0, it.z), it.heading)
    else this.game.net?.onKillstreak?.(it.id, [it.x, 0, it.z], it.heading)
  }

  private updatePlace(it: Extract<Interact, { k: 'place' }>) {
    const g = this.game
    const s = g.input.state
    const p = g.player
    p.getEyePosition(_v)
    _d.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw))
    _e.copy(_v).addScaledVector(_d, 1.7)
    const hit = g.collision.raycast(_e, _w.set(0, -1, 0), 3)
    it.valid = !!hit && hit.normal.y > 0.8 && g.collision.lineOfSight(_v, _e)
    if (hit) it.ghost.position.copy(hit.point)
    else it.ghost.position.copy(_e).setY(p.position.y)
    it.ghost.rotation.y = p.yaw
    it.ghost.visible = (g.realTime * 4) % 1 < 0.75 || it.valid
    if (s.killstreakPressed) return this.endInteract()
    if (!s.firePressed || !it.valid) return
    const at = it.ghost.position.clone()
    if (!this.consume(p, it.id)) return this.endInteract()
    this.endInteract()
    if (this.isHost) {
      this.game.events.emit('killstreak:used', { actor: p, streak: 'sentry', team: p.team })
      this.add(new Sentry(this, p, at, p.yaw))
    } else this.game.net?.onKillstreak?.('sentry', [at.x, at.y, at.z], p.yaw)
  }

  private updateControl(ent: Gunship | Missile) {
    const g = this.game
    const s = g.input.state
    if (ent.dead) return this.endInteract()
    const sens = 0.0016 * (ent instanceof Gunship ? Math.tan(MathUtils.degToRad(ent.weapons[ent.weapon]!.fov) / 2) * 2.2 : 1)
    if (ent instanceof Missile) {
      // Steer: yaw/pitch of the flight direction, nose kept pointing down.
      let yaw = Math.atan2(-ent.dir.x, -ent.dir.z)
      let pitch = Math.asin(MathUtils.clamp(ent.dir.y, -1, 1))
      yaw -= s.lookDX * 0.0022
      pitch = MathUtils.clamp(pitch - s.lookDY * 0.0022, -1.45, -0.35)
      ent.dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
      if (s.firePressed) ent.boost()
      return
    }
    ent.aimYaw -= s.lookDX * sens
    ent.aimPitch = MathUtils.clamp(ent.aimPitch - s.lookDY * sens, -1.52, -0.12)
    if (ent.streak === 'ac130') {
      const before = ent.weapon
      if (s.slot1Pressed) ent.weapon = 0
      if (s.slot2Pressed) ent.weapon = 1
      if (s.streakCyclePressed) ent.weapon = 2
      if (s.switchPressed) ent.weapon = (ent.weapon + 1) % 3
      if (ent.weapon !== before) this.sound('ks.ac.switch')
    }
    const w = ent.weapons[ent.weapon]!
    if (w.reload < 0.2 ? s.fire : s.firePressed) ent.fire(this.aimDir(ent, _d))
  }

  aimDir(ent: Gunship, out: Vector3) {
    const cp = Math.cos(ent.aimPitch)
    return out.set(-Math.sin(ent.aimYaw) * cp, Math.sin(ent.aimPitch), -Math.cos(ent.aimYaw) * cp)
  }

  endInteract() {
    const it = this.interact
    if (it.k === 'place') it.ghost.removeFromParent()
    if (it.k === 'control') {
      it.ent.controlled = false
      this.game.player.invalidateFov()
      this.game.render.effects.static = 0.9
    }
    this.interact = { k: 'none' }
    this.game.render.effects.thermal = 0
    this.game.render.viewmodelScene.visible = true
  }

  /** Hold F next to a landed crate (owner fast, teammates slower, enemies steal slowest). */
  private updateCapture(dt: number) {
    const g = this.game
    const p = g.player
    let best: Crate | null = null
    let bd = 1.9
    for (const e of this.ents) {
      if (!(e instanceof Crate) || !e.landed || e.dead) continue
      const d = e.pos.distanceTo(p.position)
      if (d < bd) {
        bd = d
        best = e
      }
    }
    if (best !== this.captureCrate) this.capture = 0
    this.captureCrate = best
    if (!best || !g.input.state.useHeld || !this.isHost) {
      this.capture = Math.max(0, this.capture - dt * 3)
      return
    }
    const time = best.owner === p ? 0.6 : g.mode.isEnemy(best.owner, p) ? 3.6 : 2.5
    this.capture += dt / time
    if (this.capture >= 1) {
      this.capture = 0
      this.collect(best, p)
      this.captureCrate = null
    }
  }

  collect(crate: Crate, by: Actor) {
    crate.dead = true
    this.sound('ks.capture', crate.pos)
    if (crate.contents) this.award(by, crate.contents)
    else if (by === this.game.player) this.game.player.weapons.resupply()
    if (by.isPlayer && crate.owner !== by && this.game.mode.isEnemy(crate.owner, by)) this.game.mode.addPoints(by, 100, 'HIJACKER')
  }

  // ─── Activation (host) ────────────────────────────────────────────────────

  /** Call in a reward. `target` / `heading` come from the map picker or placement (players only). */
  activate(actor: Actor, id: KillstreakId, target?: Vector3, heading?: number) {
    const g = this.game
    const mode = g.mode
    if (mode.phase !== 'playing') return
    g.events.emit('killstreak:used', { actor, streak: id, team: actor.team })
    const local = actor === g.player
    switch (id) {
      case 'uav':
        mode.activateUav(actor)
        this.add(new Drone(this, actor, 'uav', KILLSTREAKS.uav.duration))
        return
      case 'counterUav': {
        const until = g.time + KILLSTREAKS.counterUav.duration
        this.cuav.push({ owner: actor, team: actor.team, until })
        this.add(new Drone(this, actor, 'counterUav', KILLSTREAKS.counterUav.duration))
        return
      }
      case 'carePackage':
      case 'airdrop': {
        const from = actor.getEyePosition(new Vector3())
        const vel = new Vector3(-Math.sin(actor.yaw) * Math.cos(actor.pitch), Math.sin(actor.pitch) + 0.35, -Math.cos(actor.yaw) * Math.cos(actor.pitch)).multiplyScalar(local ? 13 : 6)
        this.add(new Marker(this, actor, from, vel, id === 'airdrop' ? 4 : 1))
        return
      }
      case 'predator': {
        const aim = target ?? this.bestTarget(actor) ?? this.center.clone()
        const m = new Missile(this, actor, aim)
        this.add(m)
        if (local) this.takeControl(m)
        return
      }
      case 'sentry': {
        const at = target ?? this.groundAt(_v.set(actor.position.x - Math.sin(actor.yaw) * 1.6, actor.position.y + 1, actor.position.z - Math.cos(actor.yaw) * 1.6), actor.position.y + 1.5)
        this.add(new Sentry(this, actor, at, heading ?? actor.yaw))
        return
      }
      case 'airstrike':
      case 'harrier': {
        const tg = this.groundAt(target ?? this.bestTarget(actor) ?? this.center)
        const h = heading ?? Math.random() * Math.PI * 2
        const kind: ModelKind = id === 'harrier' ? 'harrier' : 'jet'
        const offsets = id === 'harrier' ? [-5, 5] : [-6, 0, 6]
        offsets.forEach((o, i) => this.add(new JetRun(this, actor, id, kind, tg, h, o, i * 0.55, 46 + i * 3, 34)))
        if (id === 'harrier') this.add(new Heli(this, actor, 'harrier', KILLSTREAKS.harrier.duration, tg.clone()))
        return
      }
      case 'stealthBomber': {
        const tg = this.groundAt(target ?? this.bestTarget(actor) ?? this.center)
        this.add(new Bomber(this, actor, tg, heading ?? Math.random() * Math.PI * 2))
        return
      }
      case 'attackHeli':
      case 'paveLow':
        this.add(new Heli(this, actor, id, KILLSTREAKS[id].duration))
        return
      case 'chopperGunner':
      case 'ac130': {
        const gs = new Gunship(this, actor, id, KILLSTREAKS[id].duration)
        this.add(gs)
        if (local) this.takeControl(gs)
        return
      }
      case 'emp':
        this.emp = { owner: actor, team: actor.team, until: g.time + KILLSTREAKS.emp.duration }
        for (const e of this.ents) if (e.air && this.empAffects(e.owner) && !e.dead) e.destroyed(actor)
        for (const t of ['tf141', 'opfor'] as Team[]) if (mode.isTeamMode ? t !== actor.team : true) mode.cancelUavTeam(t, actor)
        this.cuav = this.cuav.filter((c) => !this.empAffects(c.owner))
        this.sound('ks.emp')
        g.render.effects.flash = Math.max(g.render.effects.flash, this.empAffects(g.player) ? 0.7 : 0.25)
        if (this.empAffects(g.player)) g.render.effects.static = 1.2
        return
      case 'nuke':
        if (this.nuke) return
        this.nuke = { owner: actor, team: actor.team, until: g.time + KILLSTREAKS.nuke.duration }
        this.sirenT = 0
    }
  }

  private takeControl(ent: Gunship | Missile) {
    if (this.interact.k !== 'none') this.endInteract()
    ent.controlled = true
    this.interact = { k: 'control', ent }
    this.game.render.effects.static = 1
    this.game.render.viewmodelScene.visible = false
  }

  /** Request from an online client (host side). */
  remoteUse(actor: Actor, id: KillstreakId, target?: V3, heading?: number) {
    if (!this.consume(actor, id)) return
    this.activate(actor, id, target ? new Vector3(...target) : undefined, heading)
  }

  endCounterUav(owner: Actor) {
    this.cuav = this.cuav.filter((c) => c.owner !== owner)
  }

  // ─── Status queries (HUD / minimap / UAV) ────────────────────────────────

  private affects(owner: { id: number } | Actor, team: Team, actor: Actor) {
    return this.game.mode.isTeamMode ? actor.team !== team : actor.id !== owner.id
  }

  /** `actor` is on the receiving end of an active EMP. */
  empAffects(actor: Actor): boolean {
    if (!this.isHost) {
      const e = this.netEmp
      return !!e && e.left > 0 && this.affects({ id: e.owner }, e.team, actor)
    }
    const e = this.emp
    return !!e && e.until > this.game.time && this.affects(e.owner, e.team, actor)
  }

  /** Minimap scrambled for `actor` (enemy Counter-UAV or EMP). */
  jammed(actor: Actor): boolean {
    if (this.empAffects(actor)) return true
    if (!this.isHost) return this.netCuav.some((c) => c.left > 0 && this.affects({ id: c.owner }, c.team, actor))
    return this.cuav.some((c) => c.until > this.game.time && this.affects(c.owner, c.team, actor))
  }

  /** Seconds left on the countdown and who launched it (null when no nuke is inbound). */
  nukeState(): { left: number; friendly: boolean } | null {
    const p = this.game.player
    if (!this.isHost) {
      const n = this.netNuke
      return n ? { left: n.left, friendly: !this.affects({ id: n.owner }, n.team, p) } : null
    }
    const n = this.nuke
    return n ? { left: Math.max(0, n.until - this.game.time), friendly: !this.affects(n.owner, n.team, p) } : null
  }

  /** Air support on the radar (stealth bomber excluded). */
  radarContacts(out: { x: number; z: number; yaw: number; friendly: boolean; heli: boolean }[]) {
    out.length = 0
    const p = this.game.player
    if (this.isHost) {
      for (const e of this.ents) {
        if (!e.air || e.stealth || !e.root.visible || e.dead) continue
        out.push({ x: e.pos.x, z: e.pos.z, yaw: e.root.rotation.y, friendly: !this.affects(e.owner, e.team, p), heli: e.kind !== 'jet' && e.kind !== 'harrier' })
      }
    } else {
      for (const [, gh] of this.ghosts) {
        if (gh.kind === 'bomber' || gh.kind === 'missile' || gh.kind === 'crate' || gh.kind === 'marker' || gh.kind === 'sentry') continue
        out.push({ x: gh.p.x, z: gh.p.z, yaw: gh.root.rotation.y, friendly: (gh.root.userData.team as Team) === p.team, heli: gh.kind !== 'jet' })
      }
    }
    return out
  }

  // ─── World helpers used by entities ──────────────────────────────────────

  add(e: Ent) {
    this.ents.push(e)
  }

  /** Point on the ground below `p` (topmost walkable surface). */
  groundAt(p: Vector3, fromY = 140): Vector3 {
    const o = _w.set(p.x, fromY, p.z)
    const hit = this.game.collision.raycast(o, _d.set(0, -1, 0), fromY + 20)
    return new Vector3(p.x, hit ? hit.point.y : 0, p.z)
  }

  actorNear(p: Vector3, r: number, owner: Actor): Actor | null {
    for (const a of this.game.actors) {
      if (!a.alive || !this.game.mode.isEnemy(owner, a)) continue
      if (_e.copy(a.position).setY(a.position.y + 1).distanceTo(p) < r) return a
    }
    return null
  }

  /** Nearest enemy of `owner` with a clear line from `from`. */
  visibleEnemy(owner: Actor, from: Vector3, range: number): Actor | null {
    let best: Actor | null = null
    let bd = range
    for (const a of this.game.actors) {
      if (!a.alive || !this.game.mode.isEnemy(owner, a)) continue
      a.getEyePosition(_e)
      const d = _e.distanceTo(from)
      if (d > bd) continue
      if (!this.game.collision.lineOfSight(from, _e) && !this.game.collision.lineOfSight(from, _e.setY(a.position.y + 0.6))) continue
      best = a
      bd = d
    }
    return best
  }

  /** Where an AI caller aims: the enemy with the most enemies around them. */
  bestTarget(owner: Actor): Vector3 | null {
    let best: Actor | null = null
    let score = -1
    for (const a of this.game.actors) {
      if (!a.alive || !this.game.mode.isEnemy(owner, a)) continue
      let s = 0
      for (const b of this.game.actors) if (b.alive && this.game.mode.isEnemy(owner, b) && b.position.distanceTo(a.position) < 10) s++
      if (s > score) {
        score = s
        best = a
      }
    }
    return best ? best.position.clone() : null
  }

  /** Hitscan round from a killstreak gun with a small chance of splash. */
  gun(owner: Actor, from: Vector3, at: Vector3, dmg: number, streak: KillstreakId, spread: number, splash: number) {
    const g = this.game
    _d.subVectors(at, from).normalize()
    _d.x += (Math.random() - 0.5) * spread * 2
    _d.y += (Math.random() - 0.5) * spread * 2
    _d.z += (Math.random() - 0.5) * spread * 2
    _d.normalize()
    const max = 160
    const world = g.collision.raycast(from, _d, max)
    let bestD = world ? world.distance : max
    let victim: Actor | null = null
    let point: Vector3 | null = null
    for (const a of g.actors) {
      if (!a.alive || !g.mode.isEnemy(owner, a)) continue
      const h = a.raycast(from, _d, bestD)
      if (h && h.distance < bestD) {
        bestD = h.distance
        victim = a
        point = h.point.clone()
      }
    }
    const end = point ?? (world ? world.point.clone() : from.clone().addScaledVector(_d, max))
    g.events.emit('bullet:tracer', { from: from.clone(), to: end, shooter: owner })
    if (victim) {
      g.combat.applyDamage({ victim, attacker: owner, weaponId: 'm4a1', amount: dmg, zone: 'torso', direction: _d.clone(), point: end, explosive: false, killstreak: streak })
      g.events.emit('bullet:impact', { point: end, normal: _d.clone().negate(), surface: 'flesh', shooter: owner })
    } else if (world) {
      g.events.emit('bullet:impact', { point: world.point.clone(), normal: world.normal.clone(), surface: world.surface, shooter: owner })
      if (splash > 0) this.splash(world.point, owner, splash, dmg * 0.6, streak)
    }
  }

  /** Gunship round along `dir`: hitscan for the light guns, delayed shell for the heavy ones. */
  shell(owner: Actor, from: Vector3, dir: Vector3, w: AcWeapon, streak: KillstreakId) {
    const g = this.game
    const max = 400
    const world = g.collision.raycast(from, dir, max)
    let bestD = world ? world.distance : max
    let point = world ? world.point.clone() : from.clone().addScaledVector(dir, max)
    for (const a of g.actors) {
      if (!a.alive || !g.mode.isEnemy(owner, a)) continue
      const h = a.raycast(from, dir, bestD)
      if (h && h.distance < bestD) {
        bestD = h.distance
        point = h.point.clone()
      }
    }
    g.events.emit('bullet:tracer', { from: from.clone(), to: point, shooter: owner })
    this.sound(w.radius > 5 ? 'ks.ac.105' : w.radius > 2 ? 'ks.ac.40' : 'ks.chain', from, w.radius > 5 ? 1.2 : 0.8)
    const hitAt = point
    const fly = w.speed > 0 ? bestD / w.speed : 0
    const go = () => {
      if (w.radius > 2) this.blast(hitAt, owner, w.radius, w.damage, streak, w.radius > 5 ? 2 : 1)
      else {
        this.splash(hitAt, owner, w.radius, w.damage, streak)
        if (world && bestD === world.distance) g.events.emit('bullet:impact', { point: hitAt, normal: world.normal.clone(), surface: world.surface, shooter: owner })
      }
    }
    if (fly > 0.02) this.add(new Delay(this, owner, fly, go))
    else go()
  }

  /** Small radial damage (cannon rounds), no FX. */
  private splash(p: Vector3, owner: Actor, r: number, dmg: number, streak: KillstreakId) {
    for (const a of this.game.actors) {
      if (!a.alive || (a !== owner && !this.game.mode.isEnemy(owner, a))) continue
      const d = _e.copy(a.position).setY(a.position.y + 0.9).distanceTo(p)
      if (d > r) continue
      this.game.combat.applyDamage({ victim: a, attacker: owner, weaponId: 'm4a1', amount: dmg * (1 - (d / r) * 0.5), zone: 'torso', direction: _e.sub(p).normalize().clone(), point: p.clone(), explosive: true, killstreak: streak })
    }
  }

  /** Big explosion: FX + sound (via grenade:explode) + falloff damage with LOS, also hits sentries. */
  blast(p: Vector3, owner: Actor | null, r: number, dmg: number, streak: KillstreakId, fx = 1) {
    const g = this.game
    this.boom(p, fx)
    for (const a of g.actors) {
      if (!a.alive) continue
      if (owner && a !== owner && !g.mode.isEnemy(owner, a)) continue
      const mid = _e.copy(a.position).setY(a.position.y + 0.9)
      const d = mid.distanceTo(p)
      if (d > r) continue
      const lifted = _w.copy(p).setY(p.y + 0.4)
      if (!g.collision.lineOfSight(lifted, mid)) continue
      const amount = dmg * (1 - (d / r) * 0.7)
      g.combat.applyDamage({ victim: a, attacker: owner, weaponId: 'frag', amount, zone: 'torso', direction: mid.clone().sub(p).normalize(), point: mid.clone(), explosive: true, killstreak: streak })
    }
    for (const e of this.ents) {
      if (!(e instanceof Sentry) || e.dead || (owner && !this.affects(owner, owner.team, e.owner))) continue
      if (e.pos.distanceTo(p) < r) this.damageEnt(e, dmg, owner)
    }
  }

  /** Explosion visuals/sound only (several overlapping blasts for big ordnance). */
  boom(p: Vector3, size: number) {
    const g = this.game
    g.events.emit('grenade:explode', { position: p.clone(), owner: null })
    for (let i = 1; i < size; i++) {
      const o = _v.set((Math.random() - 0.5) * 3 * i, Math.random() * 1.2, (Math.random() - 0.5) * 3 * i).add(p)
      g.events.emit('grenade:explode', { position: o.clone(), owner: null })
    }
    const cam = g.render.camera.position
    const d = cam.distanceTo(p)
    g.render.effects.shake = Math.max(g.render.effects.shake, MathUtils.clamp((size * 14) / (d + 6), 0, 1.2))
  }

  /** Burning wreck smoke where an aircraft went down. */
  crashWreck(p: Vector3) {
    const at = this.groundAt(p)
    this.add(new Delay(this, this.game.player, 1.2, () => this.blast(at, null, 5, 0, 'attackHeli', 2)))
    this.add(new Smoke(this, this.game.player, at, 14))
  }

  sound(key: string, pos?: Vector3, gain = 1) {
    this.game.events.emit('killstreak:sound', { key, pos: pos?.clone(), gain })
  }

  // ─── Shooting killstreaks down ────────────────────────────────────────────

  /** Closest shootable killstreak hit by a bullet ray (enemy-owned only). */
  raycastEnts(shooter: Actor, o: Vector3, d: Vector3, maxD: number): { ent: Ent; distance: number } | null {
    let best: Ent | null = null
    let bd = maxD
    for (const e of this.ents) {
      if (e.dead || e.radius <= 0 || !this.game.mode.isEnemy(shooter, e.owner)) continue
      const c = e.hitCenter(_e)
      const t = _v.subVectors(c, o).dot(d)
      if (t < 0 || t > bd) continue
      const distSq = _v.lengthSq() - t * t
      if (distSq > e.radius * e.radius) continue
      bd = t
      best = e
    }
    return best ? { ent: best, distance: bd } : null
  }

  damageEnt(e: Ent, amount: number, by: Actor | null) {
    if (e.dead || e.hp <= 0) return
    e.hp -= amount
    if (by?.isPlayer) this.game.events.emit('player:hitmarker', { headshot: false, kill: e.hp <= 0 })
    if (e.hp <= 0) e.destroyed(by)
  }

  /** Bots fire at enemy air support they can see (cheap stand-in for per-bot targeting). */
  private groundFire(dt: number) {
    this.groundFireT -= dt
    if (this.groundFireT > 0) return
    this.groundFireT = 0.3
    const g = this.game
    for (const e of this.ents) {
      if (e.dead || e.radius <= 0 || e.hp <= 0) continue
      const c = e.hitCenter(_v).clone()
      let shooters = 0
      for (const a of g.actors) {
        if (a.isPlayer || !a.alive || !g.mode.isEnemy(a, e.owner) || shooters >= 3) continue
        a.getEyePosition(_e)
        if (_e.distanceTo(c) > (e.kind === 'sentry' ? 30 : 75) || !g.collision.lineOfSight(_e, c)) continue
        shooters++
        if (Math.random() < 0.6) g.events.emit('bullet:tracer', { from: _e.clone(), to: c.clone().add(_w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)), shooter: a })
        this.damageEnt(e, 26 * (0.6 + g.bots.difficulty), a)
        if (e.dead) break
      }
    }
  }

  // ─── Frame ────────────────────────────────────────────────────────────────

  update(dt: number) {
    const g = this.game
    const b = g.map.bounds
    this.center.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2)
    if (g.mode.phase === 'menu') return
    if (dt > 0) this.playerInput(dt)
    if (this.isHost && dt > 0) {
      for (let i = this.ents.length - 1; i >= 0; i--) {
        const e = this.ents[i]!
        if (!e.dead) e.step(dt)
        if (e.dead) {
          if (this.captureCrate === e) this.captureCrate = null
          e.dispose()
          this.ents.splice(i, 1)
        }
      }
      if (g.mode.phase === 'playing') {
        this.groundFire(dt)
        this.bots()
        this.updateNuke(dt)
      }
      this.cuav = this.cuav.filter((c) => c.until > g.time)
      if (this.emp && this.emp.until <= g.time) this.emp = null
      this.netT -= dt
      if (g.netRole === 'host' && this.netT <= 0) {
        this.netT = 0.1
        g.events.emit('killstreak:state', this.getNetState())
      }
    } else if (dt > 0) this.updateGhosts(dt)
    this.updateView(dt)
  }

  private updateNuke(dt: number) {
    const n = this.nuke
    if (!n) return
    const g = this.game
    this.sirenT -= dt
    if (this.sirenT <= 0) {
      this.sirenT = 2.5
      this.sound('ks.siren')
    }
    if (g.time < n.until) return
    this.nuke = null
    g.render.effects.flash = 1
    this.sound('ks.nuke')
    for (const a of g.actors) {
      if (!a.alive) continue
      g.combat.applyDamage({ victim: a, attacker: n.owner, weaponId: 'frag', amount: 10000, zone: 'torso', direction: UP.clone(), point: a.position.clone(), explosive: true, killstreak: 'nuke' })
    }
    const mode = g.mode
    if (mode.phase !== 'playing') return
    if (mode.isTeamMode) mode.endMatch(n.team)
    else mode.endMatch(n.owner === g.player ? g.player.team : otherTeam(g.player.team), n.owner)
  }

  /** Bots call in their rewards a few seconds after earning them. */
  private bots() {
    const g = this.game
    for (const [id, at] of this.botNext) {
      if (g.time < at) continue
      const a = g.mode.actorById(id)
      const h = a && this.holders.get(id)
      if (!a || !h || !h.inv.length) {
        this.botNext.delete(id)
        continue
      }
      if (!a.alive) {
        this.botNext.set(id, g.time + 2)
        continue
      }
      const ks = h.inv.shift()!
      this.activate(a, ks)
      if (h.inv.length) this.botNext.set(id, g.time + 4 + Math.random() * 5)
      else this.botNext.delete(id)
    }
    // AI-flown predators home on the best cluster.
    for (const e of this.ents) if (e instanceof Missile && !e.controlled && e.t < 4) {
      const t = this.bestTarget(e.owner)
      if (t) e.retarget(t)
    }
  }

  /** Remote-control camera, FOV and thermal grade (after the player set the normal view). */
  private updateView(dt: number) {
    const g = this.game
    const ctl = this.controlling
    if (!ctl) return
    if (!g.player.alive) {
      this.endInteract()
      return
    }
    const cam = g.render.camera
    g.render.effects.thermal = 1
    g.render.viewmodelScene.visible = false
    if (ctl instanceof Missile) {
      cam.position.copy(ctl.pos).addScaledVector(ctl.dir, 1.5)
      _e.copy(cam.position).add(ctl.dir)
      cam.up.set(0, 1, 0)
      cam.lookAt(_e)
      this.setFov(ctl.boosted ? 72 : 60, dt)
      return
    }
    cam.position.copy(ctl.gunPos)
    cam.rotation.set(ctl.aimPitch, ctl.aimYaw, 0, 'YXZ')
    this.setFov(ctl.weapons[ctl.weapon]!.fov, dt)
  }

  private setFov(fov: number, dt: number) {
    const cam = this.game.render.camera
    const f = MathUtils.lerp(cam.fov, fov, 1 - Math.exp(-12 * dt))
    if (Math.abs(f - cam.fov) > 0.01) {
      cam.fov = f
      cam.updateProjectionMatrix()
    }
  }

  // ─── Reset / net ──────────────────────────────────────────────────────────

  private clearEntities() {
    this.endInteract()
    for (const e of this.ents) e.dispose()
    this.ents.length = 0
    for (const gh of this.ghosts.values()) gh.root.removeFromParent()
    this.ghosts.clear()
    this.captureCrate = null
    this.capture = 0
  }

  reset() {
    this.clearEntities()
    this.holders.clear()
    this.botNext.clear()
    this.emp = null
    this.cuav = []
    this.nuke = null
    this.netEmp = null
    this.netCuav = []
    this.netNuke = null
  }

  getNetState(): KillstreakNetState {
    const now = this.game.time
    const timed = (t: Timed): TimedNet => ({ owner: t.owner.id, team: t.team, left: Math.max(0, t.until - now) })
    return {
      ents: this.ents
        .filter((e) => !(e instanceof Delay) && !(e instanceof Smoke))
        .map((e) => {
          const p = e.root.position
          const q = e.root.quaternion
          return { id: e.id, k: e.kind, t: e.team, o: e.owner.id, p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] }
        }),
      emp: this.emp ? timed(this.emp) : null,
      cuav: this.cuav.map(timed),
      nuke: this.nuke ? timed(this.nuke) : null,
    }
  }

  private applyNetState(s: KillstreakNetState) {
    this.netEmp = s.emp
    this.netCuav = s.cuav
    this.netNuke = s.nuke
    const seen = new Set<number>()
    for (const e of s.ents) {
      seen.add(e.id)
      let gh = this.ghosts.get(e.id)
      if (!gh) {
        const root = buildModel(e.k, e.t === this.game.player.team)
        root.userData.team = e.t
        root.position.set(...e.p)
        root.quaternion.set(...e.q)
        this.game.render.scene.add(root)
        gh = { root, kind: e.k, p: new Vector3(), q: new Quaternion(), t: 0 }
        this.ghosts.set(e.id, gh)
      }
      gh.p.set(...e.p)
      gh.q.set(...e.q)
    }
    for (const [id, gh] of this.ghosts) {
      if (seen.has(id)) continue
      gh.root.removeFromParent()
      this.ghosts.delete(id)
    }
  }

  private updateGhosts(dt: number) {
    const k = 1 - Math.exp(-12 * dt)
    for (const gh of this.ghosts.values()) {
      gh.t += dt
      gh.root.position.lerp(gh.p, k)
      gh.root.quaternion.slerp(gh.q, k)
      animateModel(gh.root, gh.t)
    }
    if (this.netNuke) this.netNuke.left = Math.max(0, this.netNuke.left - dt)
    if (this.netEmp) this.netEmp.left = Math.max(0, this.netEmp.left - dt)
    for (const c of this.netCuav) c.left = Math.max(0, c.left - dt)
  }
}

/** Runs a callback after a delay (shell flight time, crash). */
class Delay extends Ent {
  constructor(ks: KillstreakManager, owner: Actor, private after: number, private fn: () => void) {
    super(ks, 'marker', owner, 'uav')
    this.root.visible = false
  }
  step(dt: number) {
    this.t += dt
    if (this.t >= this.after) {
      this.dead = true
      this.fn()
    }
  }
}

/** Smoke column from a wreck. */
class Smoke extends Ent {
  private puffT = 0
  private at: Vector3
  constructor(ks: KillstreakManager, owner: Actor, at: Vector3, private life: number) {
    super(ks, 'marker', owner, 'attackHeli')
    this.root.visible = false
    this.at = at.clone()
  }
  step(dt: number) {
    this.t += dt
    this.puffT -= dt
    if (this.puffT <= 0) {
      this.puffT = 0.16
      this.ks.game.fx.smoke(this.at, 0.12, 0.11, 0.1, 2.2, 0.75, 4.5)
    }
    if (this.t > this.life) this.dead = true
  }
}
