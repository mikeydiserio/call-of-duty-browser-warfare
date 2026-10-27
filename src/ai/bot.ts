import { type Material, type MeshStandardMaterial, type Object3D, type SkinnedMesh, Vector3 } from 'three'
import { CONFIG } from '../core/config'
import type { Game } from '../core/game'
import { clamp, DEG, damp, directionFromYawPitch, lerp, wrapAngle, yawFromDirection } from '../core/math'
import type { Actor, ActorHit, ActorStats, DamageInfo, Ladder, ObjectiveId, ObjectivePoint, Team, WeaponDef, WeaponId } from '../core/types'
import { WEAPONS } from '../weapons/defs'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { createWorldWeaponModel } from '../weapons/world-models'
import type { CapsuleResult } from '../world/collision'
import { type AnimAction, type AnimInput, SoldierAnimator } from './animator'
import { SoldierHitboxes } from './hitbox'
import { DIRS8, LINK_DROP, LINK_JUMP, LINK_LADDER, LINK_WALK, type NavGraph } from './nav'
import { Ragdoll } from './ragdoll'
import { buildSoldier, type SoldierRig } from './soldier-model'

// ─── Tunables ───────────────────────────────────────────────────────────────

const STEP_HEIGHT = 0.45
const SNAP_DOWN = 0.32
const WALKABLE_NY = 0.7
const MAX_SUBSTEP = 0.14
const CLIMB_SPEED = 2.5
const LADDER_OFFSET = 0.42
const CORPSE_TIME = 10
const SINK_TIME = 1.6
const VIEW_RANGE = 95
const FOV_COS = Math.cos(62 * DEG)
const FOCUS_COS = Math.cos(28 * DEG)
const HEAR_RANGE = 60
const STEP_HEAR = 15

type Mode = 'hunt' | 'engage' | 'pursue' | 'investigate' | 'retreat' | 'camp' | 'objective'



interface Memory {
  actor: Actor
  visible: boolean
  /** Game time when the bot will "register" the visible enemy (reaction time). */
  spotT: number
  lastSeen: number
  lastHeard: number
  lastKnown: Vector3
  /** Head/chest alternation for LOS checks. */
  probe: number
}

export interface BotProfile {
  primary: WeaponId
  secondary: WeaponId
  skill: number
  aggression: number
  sniper: boolean
}

interface AmmoState {
  mag: number
  reserve: number
}

// Scratch (module-level: bots update sequentially).
const _a = new Vector3()
const _b = new Vector3()
const _v = new Vector3()
const _v2 = new Vector3()
const _eye = new Vector3()
const _tp = new Vector3()
const _dir = new Vector3()
const _p0 = new Vector3()
const _p1 = new Vector3()
const _pA = new Vector3()
const _o = new Vector3()
const _down = new Vector3(0, -1, 0)
const _muzzle = new Vector3()
const _right = new Vector3()
const _up = new Vector3()

let nextId = 1

/** What a bot needs from its manager for team coordination. */
export interface BotSquad {
  /** Teammates (excluding `self`) currently assigned to objective `id`. */
  objectiveLoad(team: Team, id: ObjectiveId, self: Bot): number
  /** Site the attackers go for this round. */
  attackSite(sites: ObjectivePoint[]): ObjectiveId
  /** Closest living bot of `team` to a point. */
  closestOfTeam(team: Team, p: Vector3): Bot | null
}

export class Bot implements Actor {
  readonly id: number
  readonly isPlayer = false
  alive = false
  health: number = CONFIG.maxHealth
  readonly maxHealth = CONFIG.maxHealth
  readonly position = new Vector3()
  readonly velocity = new Vector3()
  yaw = 0
  pitch = 0
  stance: 0 | 1 | 2 = 0
  stats: ActorStats = { kills: 0, deaths: 0, assists: 0, score: 0, streak: 0, shotsFired: 0, shotsHit: 0, headshots: 0 }
  timeSinceDamage = 99

  readonly rig: SoldierRig
  readonly anim: SoldierAnimator
  readonly hitboxes: SoldierHitboxes
  readonly ragdoll: Ragdoll
  private models: Record<'primary' | 'secondary', Object3D>
  private slot: 'primary' | 'secondary' = 'primary'
  private ammo: Record<'primary' | 'secondary', AmmoState> = { primary: { mag: 0, reserve: 0 }, secondary: { mag: 0, reserve: 0 } }
  private dropped: Object3D | null = null
  private dropVel = new Vector3()
  private dropSpin = new Vector3()
  private dropRest = false

  // Movement
  private grounded = false
  private bodyYaw = 0
  private stanceF = 0
  private wantStance: 0 | 1 | 2 = 0
  private sprinting = false
  private sprintOut = 0
  private readonly wish = new Vector3()
  private wishSpeed = 0
  private readonly cap: CapsuleResult = { onGround: false, groundNormal: new Vector3(), push: new Vector3(), collided: false }
  private landImpact = 0
  private stepAcc = 0
  private ladder: Ladder | null = null
  private ladderDir = 1
  private ladderExit = new Vector3()
  private mantleT = -1
  private readonly mantleFrom = new Vector3()
  private readonly mantleTo = new Vector3()
  private readonly lastSafe = new Vector3()

  // Navigation
  private path = new Int32Array(768)
  private pathLen = 0
  private pathI = 0
  private readonly goal = new Vector3()
  private goalNode = -1
  private hasGoal = false
  private smoothT = 0
  private stuckT = 0
  private stuckCount = 0
  private readonly stuckPos = new Vector3()
  private repathT = 0
  private flankNode = -1
  private campNode = -1
  private scanT = 0
  private scanYaw = 0
  private lingerT = 0
  private fleeUntil = 0
  /** Objective modes: assigned flag/site id, re-evaluation timer, hold state. */
  objId: ObjectiveId | null = null
  private objT = 0
  private objHold = false
  private objAction: 'plant' | 'defuse' | null = null
  private holdNodeT = 0

  // Brain
  private mode: Mode = 'hunt'
  private thinkT = Math.random() * 0.3
  private goalT = 0
  target: Actor | null = null
  private targetMem: Memory | null = null
  private memories: Memory[] = []
  private allMemories: Memory[] = []
  private memModeId = ''
  private memIndex = new Map<number, Memory>()
  private percIdx = 0
  private aimTime = 0
  private aimZone: 'head' | 'chest' = 'chest'
  private aimSeed = Math.random() * 100
  private flinch = 0
  private strafeDir = 0
  private strafeT = 0
  private advance = 0
  private crouchT = 0
  private campYaw = 0
  private lookT = 0
  private lookYaw = 0
  private readonly alertPos = new Vector3()
  private alertT = -99
  private retreatUntil = 0
  private readonly threatPos = new Vector3()

  // Weapon state
  private fireCd = 0
  private burstLeft = 0
  private burstPause = 0
  private action: AnimAction = 'none'
  private actionT = 0
  private actionDur = 1
  private reloadStage = 0
  private reloadEmpty = false
  private grenades = 1
  private grenadeCd = 6
  private grenadeFired = false
  private meleeDone = false
  private meleeCd = 0
  private readonly grenadeAt = new Vector3()

  private turning = false
  private corpses: { mesh: SkinnedMesh; mat: MeshStandardMaterial; t: number; gun: Object3D | null }[] = []
  private airStuckT = 0
  private readonly baseMat: Material
  private readonly fadeMat: MeshStandardMaterial
  private corpseT = 0
  private animAcc = 0
  private animFrame = 0
  private readonly animIn: AnimInput

  constructor(
    private game: Game,
    readonly name: string,
    readonly team: Team,
    readonly profile: BotProfile,
    private nav: NavGraph,
    seed: number,
    private mgr: BotSquad,
  ) {
    this.id = nextId++
    let s = seed >>> 0
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    this.rig = buildSoldier(team, rnd)
    this.models = {
      primary: createWorldWeaponModel(profile.primary),
      secondary: createWorldWeaponModel(profile.secondary),
    }
    for (const m of [this.models.primary, this.models.secondary]) {
      m.traverse((o) => {
        o.castShadow = true
      })
      this.rig.root.add(m)
    }
    this.models.secondary.visible = false
    this.anim = new SoldierAnimator(this.rig, this.models.primary)
    this.hitboxes = new SoldierHitboxes(this.rig)
    this.ragdoll = new Ragdoll(this.rig, game.collision)
    this.baseMat = this.rig.mesh.material as Material
    this.fadeMat = (this.baseMat as MeshStandardMaterial).clone()
    this.fadeMat.transparent = true
    this.rig.root.visible = false
    this.animIn = {
      dt: 0, position: this.position, bodyYaw: 0, aimYaw: 0, aimPitch: 0, velocity: this.velocity, grounded: true,
      stance: 0, sprint: false, aim: 0, action: 'none', actionT: 0, emptyReload: false, pistol: false, ladder: null, lod: false,
    }
  }

  get weaponId(): WeaponId {
    return this.slot === 'primary' ? this.profile.primary : this.profile.secondary
  }

  private get def(): WeaponDef {
    return WEAPONS[this.weaponId]
  }

  /** Cautious when there are no respawns (S&D). */
  private get aggression() {
    return this.profile.aggression * (this.game.mode.id === 'sd' ? 0.45 : 1)
  }

  private get skill() {
    return clamp(this.profile.skill, 0, 1)
  }

  // ─── Actor contract ───────────────────────────────────────────────────────

  getEyePosition(out: Vector3): Vector3 {
    if (this.alive) {
      const h = lerp(CONFIG.eyeHeight[0], CONFIG.eyeHeight[1], clamp(this.stanceF, 0, 1))
      return out.set(this.position.x, this.position.y + (this.stanceF > 1 ? lerp(h, CONFIG.eyeHeight[2], this.stanceF - 1) : h), this.position.z)
    }
    return out.copy(this.position).setY(this.position.y + 0.3)
  }

  raycast(origin: Vector3, dir: Vector3, maxDistance: number): ActorHit | null {
    if (!this.alive) return null
    return this.hitboxes.raycast(origin, dir, maxDistance)
  }

  onKilled(info: DamageInfo) {
    this.alive = false
    this.action = 'none'
    this.ladder = null
    this.mantleT = -1
    this.rig.knife.visible = false
    // Drop the gun where it is.
    const w = this.models[this.slot]
    this.game.render.scene.attach(w)
    this.dropped = w
    this.dropVel.copy(this.velocity).multiplyScalar(0.6).addScaledVector(info.direction, 1.2)
    this.dropVel.y += 1.2
    this.dropSpin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6)
    this.dropRest = false
    this.ragdoll.start(this.velocity, info)
    this.hitboxes.invalidate()
    this.corpseT = 0
  }

  spawn(position: Vector3, yaw: number) {
    const col = this.game.collision
    this.position.copy(position)
    // Don't stack inside a squadmate who spawned on the same point.
    if (this.crowded(position) && this.nav.count) {
      for (let t = 0; t < 8; t++) {
        const k = this.nav.randomNear(position.x, position.z, 1.5 + t * 0.4)
        if (k < 0 || Math.abs(this.nav.py[k]! - position.y) > 0.5) continue
        _v.set(this.nav.px[k]!, this.nav.py[k]!, this.nav.pz[k]!)
        if (!this.crowded(_v)) {
          this.position.copy(_v)
          break
        }
      }
    }
    const gy = col.groundHeight(position.x, position.z, position.y + 1.5, 4)
    if (Number.isFinite(gy)) this.position.y = gy
    this.lastSafe.copy(this.position)
    this.velocity.set(0, 0, 0)
    this.yaw = this.bodyYaw = yaw
    this.pitch = 0
    this.stance = 0
    this.stanceF = 0
    this.wantStance = 0
    this.grounded = true
    this.ladder = null
    this.mantleT = -1
    this.sprinting = false
    this.timeSinceDamage = 99
    // A body still lying around becomes a detached corpse (static snapshot that
    // keeps its own fade timer); the rig is reused for the respawned soldier.
    if (this.rig.root.visible && this.corpseT > 0 && this.corpseT < CORPSE_TIME + SINK_TIME) this.leaveCorpse()
    this.ragdoll.stop()
    this.rig.mesh.material = this.baseMat
    this.rig.mesh.castShadow = true
    // Weapons back in hand, full ammo.
    if (this.dropped) {
      this.rig.root.add(this.dropped)
      this.dropped.visible = true
      this.dropped = null
    }
    this.slot = 'primary'
    this.models.primary.visible = true
    this.models.secondary.visible = false
    this.anim.setWeapon(this.models.primary)
    for (const k of ['primary', 'secondary'] as const) {
      const d = WEAPONS[k === 'primary' ? this.profile.primary : this.profile.secondary]
      this.ammo[k].mag = d.magSize
      this.ammo[k].reserve = d.reserve
    }
    this.action = 'none'
    this.grenades = 1
    this.grenadeCd = 5 + Math.random() * 8
    this.fireCd = 0
    this.burstLeft = 0
    this.flinch = 0
    for (const m of this.memories) {
      m.visible = false
      m.lastSeen = -99
      m.lastHeard = -99
    }
    this.target = null
    this.targetMem = null
    this.mode = this.profile.sniper ? 'camp' : 'hunt'
    this.hasGoal = false
    this.campNode = -1
    this.lingerT = 0
    this.fleeUntil = 0
    this.objId = null
    this.objT = 0
    this.objHold = false
    this.objAction = null
    this.pathLen = 0
    this.goalT = 0
    this.thinkT = 0.1 + Math.random() * 0.3
    this.retreatUntil = 0
    this.anim.reset(0)
    this.rig.root.visible = true
    this.animAcc = 1
    this.animate(0.016, 0)
  }

  private crowded(p: Vector3): boolean {
    for (const a of this.game.actors) {
      if (a === this || !a.alive) continue
      const dx = a.position.x - p.x
      const dz = a.position.z - p.z
      if (dx * dx + dz * dz < 0.8 * 0.8 && Math.abs(a.position.y - p.y) < 1.5) return true
    }
    return false
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  /** Allocate a memory slot per opposing actor (called once teams exist). */
  initMemories(actors: Actor[]) {
    this.allMemories = []
    this.memories = []
    this.memModeId = ''
    this.memIndex.clear()
    for (const a of actors) {
      if (a === this) continue
      const m: Memory = { actor: a, visible: false, spotT: 0, lastSeen: -99, lastHeard: -99, lastKnown: new Vector3(), probe: 0 }
      this.allMemories.push(m)
      this.memIndex.set(a.id, m)
    }
    this.refreshEnemies()
  }

  /** Enemy test for the current mode (FFA: everyone else). */
  isEnemy(a: Actor): boolean {
    return this.game.mode.isEnemy(this, a)
  }

  /** Rebuild the enemy memory list when the mode (team/FFA) changes. */
  private refreshEnemies() {
    this.memModeId = this.game.mode.id
    this.memories = this.allMemories.filter((m) => this.isEnemy(m.actor))
    this.percIdx = 0
  }

  dispose() {
    for (const c of this.corpses) {
      c.mesh.removeFromParent()
      c.mesh.skeleton.dispose()
      c.mat.dispose()
      c.gun?.removeFromParent()
    }
    this.corpses = []
    this.fadeMat.dispose()
    this.rig.root.removeFromParent()
    this.dropped?.removeFromParent()
    this.rig.dispose()
  }

  // ─── Per-frame ────────────────────────────────────────────────────────────

  /** lod: 0 full, 1 far (half rate), 2 off-screen (third rate). */
  update(dt: number, lod: number) {
    if (this.corpses.length) this.updateCorpses(dt)
    if (!this.alive) {
      this.updateCorpse(dt)
      return
    }
    const phase = this.game.mode.phase
    const live = phase === 'playing'
    this.timers(dt)
    if (live) {
      if (this.objAction) this.checkObjAction()
      this.perceive()
      this.thinkT -= dt
      if (this.thinkT <= 0) {
        this.thinkT = 0.22 + Math.random() * 0.12
        this.think()
      }
      this.combat(dt)
      this.navigate(dt)
    } else {
      this.wish.set(0, 0, 0)
      this.wishSpeed = 0
      this.sprinting = false
    }
    this.move(dt)
    this.animate(dt, lod)
  }

  private timers(dt: number) {
    this.fireCd -= dt
    this.burstPause -= dt
    this.grenadeCd -= dt
    this.meleeCd -= dt
    this.sprintOut -= dt
    this.flinch = Math.max(0, this.flinch - dt * 1.5)
    if (this.target) this.aimTime += dt
    if (this.action !== 'none') {
      this.actionT += dt / this.actionDur
      this.updateAction()
      if (this.actionT >= 1) this.finishAction()
    }
  }

  // ─── Perception ───────────────────────────────────────────────────────────

  private perceive() {
    if (this.memModeId !== this.game.mode.id) this.refreshEnemies()
    const n = this.memories.length
    if (n === 0) return
    const now = this.game.time
    // One enemy per frame round-robin, plus the current target every frame.
    this.percIdx = (this.percIdx + 1) % n
    this.check(this.memories[this.percIdx]!, now)
    if (this.targetMem && this.targetMem !== this.memories[this.percIdx]) this.check(this.targetMem, now)
  }

  private check(m: Memory, now: number) {
    const e = m.actor
    if (!e.alive) {
      m.visible = false
      return
    }
    this.getEyePosition(_eye)
    // Probe alternates head / chest.
    m.probe ^= 1
    if (e instanceof Bot) e.hitboxes.zoneCenter(m.probe ? 'head' : 'chest', _tp)
    else {
      e.getEyePosition(_tp)
      if (!m.probe) _tp.y -= (_tp.y - e.position.y) * 0.4
    }
    _dir.subVectors(_tp, _eye)
    const d = _dir.length()
    let seen = false
    if (d < VIEW_RANGE) {
      _dir.divideScalar(d)
      directionFromYawPitch(this.yaw, this.pitch * 0.5, _v)
      const cos = _dir.dot(_v)
      if (cos > FOV_COS || d < 3.5) seen = this.game.collision.lineOfSight(_eye, _tp)
      if (seen && !m.visible) {
        // Reaction time: skill, peripheral vision, distance, target stance.
        let r = lerp(0.72, 0.24, this.skill) * (0.8 + Math.random() * 0.45)
        if (cos < FOCUS_COS) r *= 1.6
        r *= 1 + d / 70
        if (e.stance === 1) r *= 1.15
        else if (e.stance === 2) r *= 1.4
        // Already alerted toward that spot? faster.
        if (now - m.lastHeard < 3 || now - m.lastSeen < 2) r *= 0.55
        m.spotT = now + r
        // Re-acquiring after a break of LOS: aim has to settle again.
        if (m === this.targetMem) this.aimTime *= 0.4
      }
    }
    if (seen) {
      m.visible = true
      m.lastSeen = now
      m.lastKnown.copy(e.position)
    } else if (now - m.lastSeen > 0.25) {
      m.visible = false
    }
  }

  /** External stimulus: heard a shot/footstep or got hit. */
  hear(actor: Actor, pos: Vector3, strength: number) {
    const m = this.memIndex.get(actor.id)
    if (!m || !this.isEnemy(actor)) return
    const now = this.game.time
    m.lastHeard = now
    if (!m.visible) m.lastKnown.copy(pos)
    if (strength > 0.5 || now - this.alertT > 2) {
      this.alertPos.copy(pos)
      this.alertT = now
    }
  }

  onDamaged(info: DamageInfo) {
    this.flinch = Math.min(1.2, this.flinch + 0.6)
    this.anim.flinch(info.direction.x, info.direction.z, info.zone === 'head' ? 1.2 : 0.6)
    if (info.attacker && info.attacker !== this) {
      this.hear(info.attacker, info.attacker.position, 1)
      const m = this.memIndex.get(info.attacker.id)
      if (m) m.spotT = Math.min(m.spotT, this.game.time + 0.25)
      // Snap attention toward the shooter.
      this.lookYaw = yawFromDirection(info.attacker.position.x - this.position.x, info.attacker.position.z - this.position.z)
      this.lookT = 1.2
    }
    if (this.action === 'reload' && this.actionT < 0.3 && this.slot === 'primary' && this.ammo.primary.mag === 0 && this.ammo.secondary.mag > 0) {
      this.startSwitch()
    }
  }

  /** A cooking frag landed nearby: run (perceived only within ~8 m, with a short delay). */
  fleeGrenade(pos: Vector3) {
    if (this.ladder || this.mantleT >= 0) return
    const dx = this.position.x - pos.x
    const dz = this.position.z - pos.z
    const d = Math.hypot(dx, dz)
    if (d > 8 || Math.abs(this.position.y - pos.y) > 3 || Math.random() > 0.35 + this.skill * 0.6) return
    // Best node 7-11 m away from the grenade.
    let best = -1
    let bestS = -Infinity
    for (let i = 0; i < 16; i++) {
      const k = this.nav.randomNear(this.position.x + (dx / (d || 1)) * 5, this.position.z + (dz / (d || 1)) * 5, 6)
      if (k < 0) continue
      const away = Math.hypot(this.nav.px[k]! - pos.x, this.nav.pz[k]! - pos.z)
      const s = away - Math.hypot(this.nav.px[k]! - this.position.x, this.nav.pz[k]! - this.position.z) * 0.3 - Math.abs(this.nav.py[k]! - this.position.y) * 2
      if (s > bestS) {
        bestS = s
        best = k
      }
    }
    if (best < 0) return
    this.mode = 'retreat'
    this.retreatUntil = this.game.time + 2.5
    this.fleeUntil = this.retreatUntil
    this.wantStance = 0
    this.setGoalNode(best)
  }

  uavPing() {
    const now = this.game.time
    for (const m of this.memories) {
      if (!m.actor.alive || m.visible) continue
      m.lastKnown.copy(m.actor.position)
      m.lastHeard = Math.max(m.lastHeard, now - 1.5)
    }
  }

  // ─── Brain ────────────────────────────────────────────────────────────────

  private think() {
    const now = this.game.time
    // Best confirmed visible enemy.
    let best: Memory | null = null
    let bestScore = -Infinity
    for (const m of this.memories) {
      if (!m.visible || !m.actor.alive || now < m.spotT) continue
      const d = m.actor.position.distanceTo(this.position)
      let s = -d
      if (m === this.targetMem) s += 12 // stickiness
      // Enemy looking at me: more dangerous.
      _v.subVectors(this.position, m.actor.position).normalize()
      directionFromYawPitch(m.actor.yaw, 0, _v2)
      if (_v.dot(_v2) > 0.9) s += 8
      if (m.actor.health < 60) s += 4
      if (s > bestScore) {
        bestScore = s
        best = m
      }
    }
    if (best !== this.targetMem) {
      this.targetMem = best
      this.target = best?.actor ?? null
      this.aimTime = 0
      this.aimZone = Math.random() < lerp(0.1, 0.32, this.skill) ? 'head' : 'chest'
      this.burstLeft = 0
    }
    if (this.target && !this.target.alive) {
      this.target = null
      this.targetMem = null
    }

    const hurt = this.health < 48
    if (now < this.fleeUntil) return
    if (this.target) {
      if (this.objAction) this.cancelObjAction()
      this.threatPos.copy(this.target.position)
      // Hurt and outgunned: break contact toward cover.
      if (hurt && this.mode !== 'retreat' && Math.random() < 0.35 * (1.2 - this.aggression) && this.aimTime > 0.8) {
        this.beginRetreat()
        return
      }
      if (this.mode === 'retreat' && now < this.retreatUntil && hurt) return
      this.mode = 'engage'
      this.thinkEngage()
      return
    }

    // Planting/defusing: keep at it unless someone is in our face.
    if (this.objAction) {
      if (this.target) this.cancelObjAction()
      else return
    }
    if (this.thinkObjective(now)) return

    // Lost contact: chase the freshest memory.
    let fresh: Memory | null = null
    let freshT = -99
    for (const m of this.memories) {
      if (!m.actor.alive) continue
      const t = Math.max(m.lastSeen, m.lastHeard)
      if (t > freshT) {
        freshT = t
        fresh = m
      }
    }
    if (this.mode === 'retreat') {
      if (now < this.retreatUntil && (hurt || this.timeSinceDamage < CONFIG.regenDelay)) return
      this.mode = 'hunt'
      this.hasGoal = false
    }
    if (hurt && this.timeSinceDamage < 3 && freshT > now - 4) {
      this.beginRetreat()
      return
    }
    const holdAngle = this.profile.sniper && this.slot === 'primary' && fresh !== null && fresh.lastKnown.distanceTo(this.position) > 15
    if (fresh && freshT > now - 7 && !holdAngle) {
      const seenRecently = fresh.lastSeen > now - 7
      const want: Mode = seenRecently ? 'pursue' : 'investigate'
      if (this.mode !== want || !this.hasGoal || fresh.lastKnown.distanceToSquared(this.goal) > 16) {
        this.threatPos.copy(fresh.lastKnown)
        this.mode = want
        const flank = want === 'pursue' && Math.random() < 0.35 * (0.5 + this.aggression) && fresh.lastKnown.distanceTo(this.position) > 12
        this.setGoal(fresh.lastKnown, flank)
      }
      this.considerGrenade(fresh, now)
      return
    }
    if (this.alertT > now - 5 && this.mode !== 'investigate') {
      this.mode = 'investigate'
      this.setGoal(this.alertPos, false)
      return
    }
    if (this.mode === 'pursue' || this.mode === 'investigate' || this.mode === 'engage') {
      this.mode = this.profile.sniper ? 'camp' : 'hunt'
      this.hasGoal = false
      // Snipers return to their perch.
      if (this.profile.sniper && this.campNode >= 0 && this.goalT > 0) this.setGoalNode(this.campNode)
    }
    if (holdAngle && fresh) {
      // Watch the lane where the enemy was.
      this.campYaw = yawFromDirection(fresh.lastKnown.x - this.position.x, fresh.lastKnown.z - this.position.z)
    }
    // Patrol / camp. Hunters pause briefly at each goal to check angles.
    this.goalT -= 0.3
    const arrived = this.pathLen > 0 && this.pathI >= this.pathLen
    if (arrived && this.mode === 'camp' && this.stance === 0 && this.wantStance === 0) {
      // Settle on the perch: prone if there is room, else crouch.
      const n = this.nav.nearest(this.position.x, this.position.y, this.position.z, 1.5)
      this.wantStance = n >= 0 && this.nav.cover[n]! < 0.5 && Math.random() < 0.55 ? 2 : 1
    }
    if (arrived && this.mode === 'hunt' && this.lingerT <= 0) this.lingerT = 1.5 + Math.random() * 3.5
    if (this.lingerT > 0) {
      this.lingerT -= 0.3
      if (this.lingerT <= 0) this.hasGoal = false
    }
    if (!this.hasGoal || this.goalT <= 0) {
      this.lingerT = 0
      this.pickPatrolGoal()
    }
  }

  private thinkEngage() {
    const t = this.target!
    const d = t.position.distanceTo(this.position)
    const def = this.def
    // Preferred engagement band per weapon class.
    let near = 8
    let far = 26
    if (def.class === 'smg') (near = 4), (far = 15)
    else if (def.class === 'shotgun') (near = 1.5), (far = 7)
    else if (def.class === 'sniper') (near = 14), (far = 90)
    else if (def.class === 'pistol') (near = 3), (far = 14)
    const aggro = this.aggression
    if (d > far) this.advance = 1
    else if (d < near) this.advance = -1
    else this.advance = Math.random() < aggro * 0.45 ? 1 : Math.random() < 0.3 ? -0.5 : 0
    if (this.profile.sniper && this.slot === 'primary') this.advance = d < near ? -1 : 0
    // Strafe rhythm (ADAD).
    this.strafeT -= 0.3
    if (this.strafeT <= 0) {
      this.strafeT = 0.35 + Math.random() * 0.9
      const r = Math.random()
      this.strafeDir = r < 0.42 ? -1 : r < 0.84 ? 1 : 0
      if (this.profile.sniper && this.slot === 'primary') this.strafeDir = 0
    }
    // Crouch-peek: sometimes crouch while firing, more when at a cover node.
    this.crouchT -= 0.3
    if (this.crouchT <= 0) {
      this.crouchT = 0.8 + Math.random() * 1.6
      const n = this.nav.nearest(this.position.x, this.position.y, this.position.z, 1.5)
      const covered = n >= 0 && this.coverToward(n, t.position)
      const p = covered ? 0.65 : this.profile.sniper ? 0.5 : 0.18
      // A sniper already prone on a perch stays down.
      if (!(this.stance === 2 && this.profile.sniper)) this.wantStance = Math.random() < p && d > 6 ? 1 : 0
    }
    // Close to target and no ammo / fast: knife handled in combat().
    // Pistol swap when primary dry at close range.
    if (this.slot === 'primary' && d < 10 && (this.ammo.primary.mag === 0 || (this.profile.sniper && d < 9)) && this.action === 'none' && this.ammo.secondary.mag > 0) {
      this.startSwitch()
    }
    // Swap back when safe-ish/far.
    if (this.slot === 'secondary' && d > 18 && this.action === 'none' && this.ammo.primary.mag + this.ammo.primary.reserve > 0) this.startSwitch()
    // Advance toward the target along the nav graph when far.
    if (this.advance > 0 && (!this.hasGoal || this.goal.distanceToSquared(t.position) > 25)) this.setGoal(t.position, false)
  }

  private beginRetreat() {
    const now = this.game.time
    this.mode = 'retreat'
    this.retreatUntil = now + 4 + Math.random() * 3
    this.wantStance = 0
    // Best cover node nearby, away from the threat.
    let best = -1
    let bestS = -Infinity
    for (let i = 0; i < 28; i++) {
      const k = this.nav.randomNear(this.position.x, this.position.z, 14)
      if (k < 0) continue
      const nx = this.nav.px[k]!, ny = this.nav.py[k]!, nz = this.nav.pz[k]!
      const dMe = Math.hypot(nx - this.position.x, nz - this.position.z)
      const dThreat = Math.hypot(nx - this.threatPos.x, nz - this.threatPos.z)
      const dThreatMe = Math.hypot(this.position.x - this.threatPos.x, this.position.z - this.threatPos.z)
      let s = this.nav.cover[k]! * 6 + (this.coverToward(k, this.threatPos) ? 10 : 0) + (dThreat - dThreatMe) * 0.6 - dMe * 0.35 - Math.abs(ny - this.position.y)
      if (this.friendNear(nx, nz, 3)) s -= 5
      if (s > bestS) {
        bestS = s
        best = k
      }
    }
    if (best >= 0) this.setGoalNode(best)
  }

  private pickPatrolGoal() {
    const nav = this.nav
    this.goalT = 14 + Math.random() * 14
    if (nav.count === 0) return
    const now = this.game.time
    if (this.profile.sniper && this.mode === 'camp' && nav.sniperSpots.length) {
      // Sniper: move between long-sightline perches.
      // Biased toward the best-scored (usually elevated) perches.
      const spot = () => nav.sniperSpots[Math.floor(Math.random() * Math.random() * nav.sniperSpots.length)]!
      let k = spot()
      for (let t = 0; t < 4 && this.friendNear(nav.px[k]!, nav.pz[k]!, 6); t++) k = spot()
      this.goalT = 30 + Math.random() * 30
      this.campNode = k
      this.setGoalNode(k)
      return
    }
    const r = Math.random()
    let k = -1
    const callouts = this.game.map.callouts
    if (r < 0.4 && callouts.length) {
      // Hotspots: tower is weighted heavily.
      let total = 0
      for (const c of callouts) total += /tower/i.test(c.name) ? 3 : 1
      let pick = Math.random() * total
      for (const c of callouts) {
        pick -= /tower/i.test(c.name) ? 3 : 1
        if (pick <= 0) {
          k = nav.randomNear(c.center.x, c.center.z, Math.max(3, c.radius))
          break
        }
      }
    } else if (r < 0.72) {
      // Toward where enemies were last known (or the enemy half of the map).
      let sx = 0, sz = 0, n = 0
      for (const m of this.memories) {
        if (m.lastSeen < now - 40 && m.lastHeard < now - 40) continue
        sx += m.lastKnown.x
        sz += m.lastKnown.z
        n++
      }
      if (n === 0 && this.game.mode.isTeamMode) {
        for (const s of this.game.map.spawns) {
          if (s.team === this.team) continue
          sx += s.position.x
          sz += s.position.z
          n++
        }
      }
      if (n) k = nav.randomNear(sx / n, sz / n, 12)
    }
    if (k < 0) {
      // Random spot away from teammates.
      for (let t = 0; t < 6; t++) {
        k = nav.randomNode()
        if (!this.friendNear(nav.px[k]!, nav.pz[k]!, 8)) break
      }
    }
    if (k >= 0) this.setGoalNode(k)
  }

  // ─── Objectives ───────────────────────────────────────────────────────────

  private cancelObjAction() {
    this.game.mode.cancel(this)
    this.objAction = null
  }

  /** Domination / S&D goal selection. Returns true when it set the bot's goal. */
  private thinkObjective(now: number): boolean {
    const mode = this.game.mode
    if (mode.id === 'dom') return this.thinkDom(now)
    if (mode.id === 'sd') return this.thinkSD(now)
    return false
  }

  private flags(): ({ owner: Team | null; capturingTeam: Team | null; contested: boolean } & ObjectivePoint)[] {
    const live = this.game.mode.objectives
    if (live.length) return live
    return this.game.map.domFlags.map((f) => ({ ...f, owner: null, capturingTeam: null, contested: false }))
  }

  private enemiesNear(p: Vector3, r: number, now: number): number {
    let n = 0
    for (const m of this.memories) {
      if (!m.actor.alive || now - Math.max(m.lastSeen, m.lastHeard) > 6) continue
      if (m.lastKnown.distanceToSquared(p) < r * r) n++
    }
    return n
  }

  private thinkDom(now: number): boolean {
    const flags = this.flags()
    if (flags.length === 0) return false
    // A fresh, close enemy still gets chased (contest by fighting).
    if (this.freshThreatWithin(now, 14)) return false
    this.objT -= 0.3
    let cur = flags.find((f) => f.id === this.objId)
    if (!cur || this.objT <= 0 || (cur.owner === this.team && !cur.contested && Math.random() < 0.08)) {
      let best: (typeof flags)[number] | null = null
      let bestS = -Infinity
      for (const f of flags) {
        const d = Math.hypot(f.position.x - this.position.x, f.position.z - this.position.z)
        const mine = f.owner === this.team
        let s = -d * 0.09 + Math.random() * 1.5
        if (!mine) s += f.owner === null ? 6.5 : 5
        else {
          s += 1
          if (f.contested || (f.capturingTeam && f.capturingTeam !== this.team)) s += 9
          s += this.enemiesNear(f.position, f.radius + 10, now) * 2.5
        }
        s -= this.mgr.objectiveLoad(this.team, f.id, this) * 2.4
        if (s > bestS) {
          bestS = s
          best = f
        }
      }
      if (best && best.id !== this.objId) {
        this.objId = best.id
        this.objHold = false
      }
      this.objT = 4 + Math.random() * 4
      cur = best ?? undefined
    }
    if (!cur) return false
    this.mode = 'objective'
    this.holdInside(cur.position, cur.radius, now)
    return true
  }

  private thinkSD(now: number): boolean {
    const bomb = this.game.mode.bomb
    const mode = this.game.mode
    const sites = mode.bombSites.length ? mode.bombSites : this.game.map.bombSites
    if (!bomb || sites.length === 0) return false
    const attacker = this.team === bomb.attackers
    if (attacker) {
      if (bomb.planted) {
        // Guard the planted bomb from cover.
        if (this.freshThreatWithin(now, 25)) return false
        this.mode = 'objective'
        this.holdInside(bomb.position, 9, now)
        return true
      }
      if (bomb.carrier === this) {
        const site = sites.find((s2) => s2.id === this.mgr.attackSite(sites)) ?? sites[0]!
        const d = Math.hypot(site.position.x - this.position.x, site.position.z - this.position.z)
        this.mode = 'objective'
        if (d < site.radius * 0.7 || (mode.wantsPlant(this) && d < site.radius * 0.9)) {
          if (!this.objAction && mode.wantsPlant(this) && Math.hypot(this.velocity.x, this.velocity.z) < 0.3) {
            if (mode.beginPlant(this)) this.objAction = 'plant'
          }
          this.hasGoal = false
          this.pathLen = 0
          return true
        }
        if (!this.hasGoal || this.goal.distanceToSquared(site.position) > 4) this.setGoal(site.position, false)
        return true
      }
      if (!bomb.carrier) {
        // Nearest attacker fetches a dropped bomb.
        if (this.mgr.closestOfTeam(this.team, bomb.position) === this) {
          this.mode = 'objective'
          if (!this.hasGoal || this.goal.distanceToSquared(bomb.position) > 1) this.setGoal(bomb.position, false)
          return true
        }
      }
      if (this.freshThreatWithin(now, 16)) return false
      // Escort: move with the carrier toward the chosen site.
      const c = bomb.carrier ?? null
      const site = sites.find((s2) => s2.id === this.mgr.attackSite(sites)) ?? sites[0]!
      const anchor = c ? _v.lerpVectors(c.position, site.position, 0.35) : site.position
      this.mode = 'objective'
      this.objT -= 0.3
      if (!this.hasGoal || this.objT <= 0) {
        this.objT = 3 + Math.random() * 3
        const k = this.nav.randomNear(anchor.x, anchor.z, 7)
        if (k >= 0) this.setGoalNode(k)
      }
      return true
    }
    // Defenders.
    if (bomb.planted) {
      const d = bomb.position.distanceTo(this.position)
      this.mode = 'objective'
      if (mode.canDefuse(this) || d < 1.0) {
        if (this.freshThreatWithin(now, 10)) return false
        this.hasGoal = false
        this.pathLen = 0
        if (!this.objAction && mode.canDefuse(this) && Math.hypot(this.velocity.x, this.velocity.z) < 0.3) {
          if (mode.beginDefuse(this)) this.objAction = 'defuse'
        }
        return true
      }
      if (!this.hasGoal || this.goal.distanceToSquared(bomb.position) > 1) this.setGoal(bomb.position, false)
      return true
    }
    if (this.freshThreatWithin(now, 18)) return false
    this.objT -= 0.3
    let site = sites.find((s2) => s2.id === this.objId)
    if (!site || this.objT <= 0) {
      // Balance defenders across sites; rotate toward gunfire.
      let best = sites[0]!
      let bestS = -Infinity
      for (const s2 of sites) {
        let sc = -this.mgr.objectiveLoad(this.team, s2.id, this) * 3 + Math.random()
        if (now - this.alertT < 6 && this.alertPos.distanceTo(s2.position) < 22) sc += 4
        if (s2.id === this.objId) sc += 1.5
        if (sc > bestS) {
          bestS = sc
          best = s2
        }
      }
      if (best.id !== this.objId) this.objHold = false
      this.objId = best.id
      this.objT = 12 + Math.random() * 10
      site = best
    }
    this.mode = 'objective'
    this.holdInside(site.position, site.radius + 4, now)
    return true
  }

  private freshThreatWithin(now: number, r: number): boolean {
    for (const m of this.memories) {
      if (!m.actor.alive || now - Math.max(m.lastSeen, m.lastHeard) > 3) continue
      if (m.lastKnown.distanceToSquared(this.position) < r * r) return true
    }
    return false
  }

  /** Go to (and hold at) a covered node inside a radius around p. */
  private holdInside(p: Vector3, radius: number, now: number) {
    const inside = Math.hypot(p.x - this.position.x, p.z - this.position.z) < radius * 0.85
    this.holdNodeT -= 0.3
    if (!this.objHold || this.holdNodeT <= 0 || (!this.hasGoal && !inside)) {
      let best = -1
      let bestS = -Infinity
      for (let i = 0; i < 12; i++) {
        const k = this.nav.randomNear(p.x, p.z, radius * 0.75)
        if (k < 0) continue
        const s = this.nav.cover[k]! * 4 - (this.friendNear(this.nav.px[k]!, this.nav.pz[k]!, 2.5) ? 4 : 0) + Math.random()
        if (s > bestS) {
          bestS = s
          best = k
        }
      }
      if (best >= 0) this.setGoalNode(best)
      this.objHold = true
      this.holdNodeT = 6 + Math.random() * 8
    }
    if (inside && this.pathI >= this.pathLen && Math.random() < 0.3) this.wantStance = 1
    void now
  }

  private considerGrenade(m: Memory, now: number) {
    if (this.grenades <= 0 || this.grenadeCd > 0 || this.action !== 'none' || m.visible) return
    // Fresh intel: an enemy that ducked out of sight, or one heard firing nearby (camper).
    const seen = now - m.lastSeen
    const heard = now - m.lastHeard
    if (!((seen > 0.6 && seen < 4) || heard < 1.5)) return
    const d = m.lastKnown.distanceTo(this.position)
    if (d < 9 || d > 32) return
    if (Math.random() > 0.4 + this.aggression * 0.35) {
      this.grenadeCd = 2
      return
    }
    // Need an open arc out of here (no wall/ceiling right in front).
    this.getEyePosition(_eye)
    const dx = m.lastKnown.x - this.position.x
    const dz = m.lastKnown.z - this.position.z
    const h = Math.hypot(dx, dz) || 1
    _dir.set((dx / h) * 0.79, 0.62, (dz / h) * 0.79)
    if (this.game.collision.raycast(_eye, _dir, 3.5)) {
      this.grenadeCd = 1.5
      return
    }
    this.startThrow(m.lastKnown)
  }

  // ─── Combat ───────────────────────────────────────────────────────────────

  private combat(dt: number) {
    const t = this.target
    const m = this.targetMem
    const now = this.game.time
    const def = this.def
    this.getEyePosition(_eye)
    // Look target.
    let wantYaw = this.yaw
    let wantPitch = 0
    let rate = 3.2
    let engaged = false
    if (t && m && m.visible && now >= m.spotT) {
      engaged = true
      const dist = t.position.distanceTo(this.position)
      // Aim point: chosen zone + converging error offset.
      if (t instanceof Bot) t.hitboxes.zoneCenter(this.aimZone, _tp)
      else {
        t.getEyePosition(_tp)
        _tp.y -= this.aimZone === 'head' ? 0.06 : (_tp.y - t.position.y) * 0.36
      }
      // Lead slightly for moving targets (imperfectly).
      _tp.addScaledVector(t.velocity, 0.04 + Math.random() * 0.02)
      const err = this.aimError(t, dist)
      _dir.subVectors(_tp, _eye).normalize()
      _right.set(-_dir.z, 0, _dir.x).normalize()
      _up.crossVectors(_right, _dir)
      const tt = now * 1.0 + this.aimSeed
      const ex = Math.sin(tt * 1.37) * 0.75 + Math.sin(tt * 3.11 + 1.3) * 0.25
      const ey = Math.cos(tt * 1.13 + 0.7) * 0.6 + Math.sin(tt * 2.73) * 0.2
      const off = Math.tan(err) * dist
      _tp.addScaledVector(_right, ex * off).addScaledVector(_up, ey * off)
      _dir.subVectors(_tp, _eye)
      wantYaw = yawFromDirection(_dir.x, _dir.z)
      wantPitch = Math.atan2(_dir.y, Math.hypot(_dir.x, _dir.z))
      rate = lerp(5, 9, this.skill)
      // Knife range.
      if (dist < 1.9 && this.meleeCd <= 0 && this.action !== 'throw' && Math.abs(t.position.y - this.position.y) < 1) {
        this.startMelee()
      }
    } else if (this.lookT > 0) {
      this.lookT -= dt
      wantYaw = this.lookYaw
      rate = 5.5
    } else if (this.mode === 'camp' && this.pathI >= this.pathLen) {
      wantYaw = this.campYaw + Math.sin(now * 0.4 + this.aimSeed) * 0.5
      wantPitch = -0.04
      rate = 1.5
    } else if (m && !m.visible && now - m.lastSeen < 3) {
      // Pre-aim where the target vanished.
      _dir.subVectors(m.lastKnown, this.position)
      wantYaw = yawFromDirection(_dir.x, _dir.z)
      wantPitch = Math.atan2(m.lastKnown.y + 1.3 - _eye.y, Math.hypot(_dir.x, _dir.z))
      rate = 4
    } else if (this.wishSpeed > 0.5) {
      // Look where we're heading, with an occasional glance at an open direction.
      wantYaw = yawFromDirection(this.wish.x, this.wish.z)
      if (!this.sprinting && (this.mode === 'investigate' || this.mode === 'pursue')) {
        _dir.subVectors(this.threatPos, this.position)
        if (_dir.lengthSq() < 30 * 30) wantYaw = yawFromDirection(_dir.x, _dir.z)
      }
      wantYaw += Math.sin(now * 0.7 + this.aimSeed) * (this.sprinting ? 0.1 : 0.35)
      wantPitch = 0
      rate = 3.5
    } else {
      // Idle: scan open directions (never stare into a wall).
      this.scanT -= dt
      if (this.scanT <= 0) {
        this.scanT = 1.2 + Math.random() * 2
        const n = this.nav.nearest(this.position.x, this.position.y, this.position.z, 2)
        const mask = n >= 0 ? this.nav.highMask[n]! : 0
        for (let t = 0; t < 8; t++) {
          const d = Math.floor(Math.random() * 8)
          if (mask & (1 << d)) continue
          const [dx, dz] = DIRS8[d]!
          this.scanYaw = yawFromDirection(dx, dz) + (Math.random() - 0.5) * 0.6
          break
        }
      }
      wantYaw = this.scanYaw
      rate = 2.2
    }
    this.turn(wantYaw, wantPitch, rate, dt)

    if (!engaged || this.action === 'switch' || this.action === 'throw' || this.action === 'melee') return
    // Reloading: keep tracking, no shooting.
    if (this.action === 'reload') return
    const ammo = this.ammo[this.slot]
    if (ammo.mag <= 0) {
      if (ammo.reserve > 0) this.startReload()
      else if (this.slot === 'primary' && this.ammo.secondary.mag > 0) this.startSwitch()
      return
    }
    if (this.sprintOut > 0 || this.ladder || this.mantleT >= 0) return
    // On target?
    directionFromYawPitch(this.yaw, this.pitch, _v)
    _dir.subVectors(_tp, _eye)
    const dist = _dir.length()
    _dir.divideScalar(dist)
    const off = Math.acos(clamp(_v.dot(_dir), -1, 1))
    const tol = Math.max(1.6 * DEG, Math.atan(0.35 / dist))
    if (off > tol) return
    if (this.fireCd > 0 || this.burstPause > 0) return
    // Sniper waits for a settled aim.
    if (def.class === 'sniper' && this.aimTime < lerp(1.0, 0.45, this.skill) + dist / 120) return
    if (this.teammateInLine(_eye, _v, dist)) {
      this.strafeT = 0
      return
    }
    this.fire()
  }

  /** Angular aim error (radians). */
  private aimError(t: Actor, dist: number): number {
    const s = this.skill
    const base = lerp(7.5, 3.2, s) * DEG
    const floor = lerp(1.35, 0.42, s) * DEG
    const tau = lerp(1.15, 0.45, s)
    let e = base * Math.exp(-this.aimTime / tau) + floor
    const mySpeed = Math.hypot(this.velocity.x, this.velocity.z)
    e *= 1 + mySpeed * 0.08
    // Lateral target motion and stance make tracking harder.
    _v.subVectors(t.position, this.position).setY(0).normalize()
    const lateral = Math.abs(t.velocity.x * _v.z - t.velocity.z * _v.x)
    e *= 1 + lateral * 0.07
    if (t.stance === 1) e *= 1.15
    else if (t.stance === 2) e *= 1.35
    if (!this.grounded) e *= 2
    e *= 1 + this.flinch * 0.8
    // Scoped rifles settle much tighter once held still.
    if (this.def.class === 'sniper') e *= mySpeed < 0.5 ? 0.45 : 1.6
    void dist
    return e
  }

  private turn(wantYaw: number, wantPitch: number, rate: number, dt: number) {
    const dy = wrapAngle(wantYaw - this.yaw)
    const step = clamp(dy * 10 * dt, -rate * dt, rate * dt)
    this.yaw = wrapAngle(this.yaw + (Math.abs(dy) < 0.002 ? dy : step))
    const dp = wantPitch - this.pitch
    this.pitch = clamp(this.pitch + clamp(dp * 10 * dt, -rate * dt, rate * dt), -1.3, 1.3)
  }

  private teammateInLine(eye: Vector3, dir: Vector3, dist: number): boolean {
    for (const a of this.game.actors) {
      if (a === this || !a.alive || this.isEnemy(a)) continue
      _v2.subVectors(a.position, eye)
      _v2.y += 1.0
      const along = _v2.dot(dir)
      if (along < 0.5 || along > dist) continue
      const lat2 = _v2.lengthSq() - along * along
      if (lat2 < 0.5 * 0.5) return true
    }
    return false
  }

  private fire() {
    const def = this.def
    const ammo = this.ammo[this.slot]
    ammo.mag--
    this.stats.shotsFired++
    this.getEyePosition(_eye)
    directionFromYawPitch(this.yaw, this.pitch, _v)
    // Spread: bots shoot aimed ("ADS") unless moving fast.
    const mySpeed = Math.hypot(this.velocity.x, this.velocity.z)
    let spreadDeg = def.class === 'shotgun' ? def.hipSpread * 0.85 : def.adsSpread + Math.min(1, mySpeed / 5) * def.hipSpread * 0.3 + 0.15
    if (!this.grounded) spreadDeg += def.hipSpread
    const spread = spreadDeg * DEG
    _right.set(-_v.z, 0, _v.x).normalize()
    _up.crossVectors(_right, _v)
    this.anim.muzzle(_muzzle)
    for (let i = 0; i < def.pellets; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * Math.tan(spread)
      _dir.copy(_v).addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize()
      this.game.combat.fireBullet(this, this.weaponId, _eye, _dir, true, _muzzle)
    }
    this.game.events.emit('weapon:fire', { shooter: this, weaponId: this.weaponId, origin: _muzzle, direction: _v, suppressed: false })
    this.anim.fireKick(def.class === 'sniper' || def.class === 'shotgun' ? 1.6 : def.class === 'pistol' ? 0.8 : 0.6)
    // Recoil the view; the aim controller pulls it back down.
    this.pitch += def.recoilV * DEG * (0.4 + Math.random() * 0.4)
    this.yaw += (Math.random() * 2 - 1) * def.recoilH * DEG * 0.6
    // Cadence.
    const interval = 60 / def.rpm
    if (def.auto) {
      this.fireCd = interval
      if (this.burstLeft <= 0) {
        const d = this.target ? this.target.position.distanceTo(this.position) : 20
        this.burstLeft = d < 10 ? 5 + Math.floor(Math.random() * 7) : d < 25 ? 3 + Math.floor(Math.random() * 4) : 2 + Math.floor(Math.random() * 3)
      }
      this.burstLeft--
      if (this.burstLeft <= 0) this.burstPause = 0.12 + Math.random() * 0.25 + (this.target ? this.target.position.distanceTo(this.position) / 120 : 0)
    } else {
      this.fireCd = def.class === 'pistol' ? Math.max(interval, 0.17 + Math.random() * 0.16) : interval + Math.random() * 0.12
      if (def.class === 'sniper') this.aimTime *= 0.35
    }
    if (ammo.mag <= 0 && ammo.reserve > 0 && !(this.slot === 'primary' && this.target && this.target.position.distanceTo(this.position) < 9 && this.ammo.secondary.mag > 0)) {
      this.startReload()
    }
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  private startReload() {
    const def = this.def
    const ammo = this.ammo[this.slot]
    if (ammo.reserve <= 0 || ammo.mag >= def.magSize || this.action !== 'none') return
    this.reloadEmpty = ammo.mag === 0
    this.action = 'reload'
    this.actionT = 0
    this.actionDur = (this.reloadEmpty ? def.reloadEmptyTime : def.reloadTime) * (0.95 + Math.random() * 0.15)
    this.reloadStage = 0
    this.game.events.emit('weapon:reload', { actor: this, weaponId: this.weaponId, stage: 'start' })
  }

  private startSwitch() {
    if (this.action !== 'none' && this.action !== 'reload') return
    this.action = 'switch'
    this.actionT = 0
    this.actionDur = 0.75
    this.reloadStage = 0
  }

  private startThrow(at: Vector3) {
    this.action = 'throw'
    this.actionT = 0
    this.actionDur = 1.0
    this.grenadeFired = false
    this.grenadeAt.copy(at)
    this.grenadeCd = 14 + Math.random() * 10
    this.lookYaw = yawFromDirection(at.x - this.position.x, at.z - this.position.z)
    this.lookT = 1
  }

  private startMelee() {
    this.action = 'melee'
    this.actionT = 0
    this.actionDur = 0.62
    this.meleeDone = false
    this.meleeCd = 1.1
  }

  /** Reset plant/defuse intent once the bomb state moved on. */
  private checkObjAction() {
    const bomb = this.game.mode.bomb
    if (!this.objAction || !bomb) {
      this.objAction = null
      return
    }
    if (this.objAction === 'plant' && bomb.plantingId !== this.id) this.objAction = null
    if (this.objAction === 'defuse' && bomb.defusingId !== this.id) this.objAction = null
  }

  private updateAction() {
    const t = this.actionT
    if (this.action === 'reload') {
      const stages: [number, 'magout' | 'magin' | 'boltback' | 'boltforward'][] = this.reloadEmpty
        ? [[0.22, 'magout'], [0.58, 'magin'], [0.74, 'boltback'], [0.84, 'boltforward']]
        : [[0.22, 'magout'], [0.58, 'magin']]
      while (this.reloadStage < stages.length && t >= stages[this.reloadStage]![0]) {
        this.game.events.emit('weapon:reload', { actor: this, weaponId: this.weaponId, stage: stages[this.reloadStage]![1] })
        this.reloadStage++
      }
    } else if (this.action === 'switch') {
      if (t >= 0.5 && this.reloadStage === 0) {
        this.reloadStage = 1
        this.models[this.slot].visible = false
        this.slot = this.slot === 'primary' ? 'secondary' : 'primary'
        this.models[this.slot].visible = true
        this.anim.setWeapon(this.models[this.slot])
        this.game.events.emit('weapon:switch', { actor: this, weaponId: this.weaponId })
      }
    } else if (this.action === 'throw') {
      if (t >= 0.55 && !this.grenadeFired) {
        this.grenadeFired = true
        this.releaseGrenade()
      }
    } else if (this.action === 'melee') {
      if (t >= 0.42 && !this.meleeDone) {
        this.meleeDone = true
        this.game.combat.melee(this)
      }
    }
  }

  private finishAction() {
    if (this.action === 'reload') {
      const def = this.def
      const ammo = this.ammo[this.slot]
      const need = def.magSize - ammo.mag
      const take = Math.min(need, ammo.reserve)
      ammo.mag += take
      ammo.reserve -= take
      this.game.events.emit('weapon:reload', { actor: this, weaponId: this.weaponId, stage: 'end' })
    }
    this.action = 'none'
    this.actionT = 0
    // Reload the newly drawn weapon if it is empty.
    const a = this.ammo[this.slot]
    if (a.mag === 0 && a.reserve > 0) this.startReload()
  }

  private releaseGrenade() {
    this.grenades--
    this.rig.bones.handR.getWorldPosition(_o)
    _o.y = Math.max(_o.y, this.position.y + 1.5)
    // Ballistic solve for a ~38° lob onto the target (with some error).
    const tgt = _v.copy(this.grenadeAt)
    const miss = lerp(3.2, 1.0, this.skill)
    tgt.x += (Math.random() - 0.5) * miss * 2
    tgt.z += (Math.random() - 0.5) * miss * 2
    const dx = tgt.x - _o.x
    const dz = tgt.z - _o.z
    const dh = Math.hypot(dx, dz)
    const h = tgt.y + 0.2 - _o.y
    const g = CONFIG.gravity
    let ang = 38 * DEG
    let v2 = (g * dh * dh) / (2 * Math.cos(ang) ** 2 * (dh * Math.tan(ang) - h))
    if (!(v2 > 0)) {
      ang = 55 * DEG
      v2 = (g * dh * dh) / (2 * Math.cos(ang) ** 2 * (dh * Math.tan(ang) - h))
    }
    const v = Math.min(Math.sqrt(Math.max(v2, 1)), 22)
    _v2.set((dx / dh) * Math.cos(ang) * v, Math.sin(ang) * v, (dz / dh) * Math.cos(ang) * v)
    // Cook a little so it does not get thrown back.
    this.game.combat.throwGrenade(this, _o.clone(), _v2.clone(), 3.5 - Math.random() * 0.8)
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  private setGoal(p: Vector3, flank: boolean) {
    const k = this.nav.nearest(p.x, p.y, p.z, 6, true)
    this.goal.copy(p)
    this.hasGoal = true
    this.flankNode = -1
    if (flank && k >= 0) {
      // Flank waypoint: offset perpendicular to the line toward the target.
      const dx = p.x - this.position.x
      const dz = p.z - this.position.z
      const len = Math.hypot(dx, dz) || 1
      const side = Math.random() < 0.5 ? -1 : 1
      const off = 8 + Math.random() * 6
      const fx = this.position.x + dx * 0.6 - (dz / len) * off * side
      const fz = this.position.z + dz * 0.6 + (dx / len) * off * side
      const f = this.nav.nearest(fx, this.position.y, fz, 5, true)
      if (f >= 0) this.flankNode = f
    }
    this.goalNode = k
    this.repath()
  }

  private setGoalNode(k: number) {
    this.goal.set(this.nav.px[k]!, this.nav.py[k]!, this.nav.pz[k]!)
    this.goalNode = k
    this.hasGoal = true
    this.flankNode = -1
    if (this.mode === 'camp') {
      // Face the longest open direction from the perch.
      this.campYaw = this.bestOpenYaw(k)
    }
    this.repath()
  }

  private repath() {
    this.repathT = 3 + Math.random()
    const nav = this.nav
    let start = nav.nearest(this.position.x, this.position.y, this.position.z, 3)
    if (start < 0) start = nav.nearest(this.position.x, this.position.y, this.position.z, 8)
    if (start < 0 || this.goalNode < 0) {
      this.pathLen = 0
      return
    }
    if (this.flankNode >= 0) {
      const n1 = nav.findPath(start, this.flankNode, this.path)
      if (n1 > 0) {
        // Append the second leg.
        const tmp = _pathTmp
        const n2 = nav.findPath(this.flankNode, this.goalNode, tmp)
        if (n2 > 0 && n1 + n2 <= this.path.length) {
          this.path.set(tmp.subarray(0, n2), n1)
          this.pathLen = n1 + n2
          this.pathI = 0
          this.flankNode = -1
          return
        }
      }
    }
    this.pathLen = Math.max(0, nav.findPath(start, this.goalNode, this.path))
    this.pathI = 0
    this.stuckT = 0
    this.stuckPos.copy(this.position)
    if (this.pathLen === 0 && this.mode === 'hunt') this.hasGoal = false
  }

  private navigate(dt: number) {
    const nav = this.nav
    this.wish.set(0, 0, 0)
    this.wishSpeed = 0
    this.sprinting = false
    if (this.ladder || this.mantleT >= 0) return
    const engaged = this.mode === 'engage' && !!this.target
    const def = this.def
    const mob = def.mobility
    let follow = this.hasGoal && this.pathI < this.pathLen
    if (engaged && this.advance <= 0) follow = false
    if (this.mode === 'retreat' && this.pathI >= this.pathLen) {
      // Hunker down in cover.
      this.wantStance = 1
    }
    if (this.objAction) {
      // Planting / defusing: kneel and stay put.
      this.wantStance = 1
      return
    }

    if (follow) {
      // Waypoint reached?
      let k = this.path[this.pathI]!
      const px = nav.px[k]!, py = nav.py[k]!, pz = nav.pz[k]!
      let dx = px - this.position.x
      let dz = pz - this.position.z
      let dh = Math.hypot(dx, dz)
      const dy = py - this.position.y
      if (dh < 0.55 && Math.abs(dy) < 0.9) {
        this.pathI++
        if (this.pathI >= this.pathLen) return
        k = this.path[this.pathI]!
      }
      // Lookahead smoothing (string-pull), staggered.
      this.smoothT -= dt
      if (this.smoothT <= 0) {
        this.smoothT = 0.25 + Math.random() * 0.1
        this.smoothAhead()
        k = this.path[this.pathI]!
      }
      // Special link into the current waypoint?
      const prev = this.pathI > 0 ? this.path[this.pathI - 1]! : nav.nearest(this.position.x, this.position.y, this.position.z, 2)
      const link = prev >= 0 ? nav.linkBetween(prev, k) : -1
      const type = link >= 0 ? nav.linkType[link]! : LINK_WALK
      const tx = nav.px[k]!, ty = nav.py[k]!, tz = nav.pz[k]!
      dx = tx - this.position.x
      dz = tz - this.position.z
      dh = Math.hypot(dx, dz)
      if (type === LINK_LADDER && link >= 0) {
        const li = nav.linkLadder[link]!
        const l = this.game.map.ladders[li]
        if (l && this.tryLadder(l, ty > this.position.y)) return
      } else if (type === LINK_JUMP && this.grounded && dh < 1.5 && ty - this.position.y > 0.3) {
        this.startMantle(tx, ty, tz)
        return
      }
      if (dh > 1e-3) this.wish.set(dx / dh, 0, dz / dh)
      // Speed: sprint when travelling with nothing around, run otherwise.
      const now = this.game.time
      const calm = !engaged && now - this.alertT > 3 && (!this.targetMem || now - this.targetMem.lastSeen > 3)
      const remaining = (this.pathLen - this.pathI) * 1.0
      // Sprint only when looking roughly where we run (else the carry pose reads as port-arms sideways).
      const lookAligned = dh > 1e-3 && Math.abs(wrapAngle(yawFromDirection(dx, dz) - this.yaw)) < 1.0
      const wantSprint = calm && lookAligned && remaining > 6 && this.action !== 'reload' && this.wantStance === 0 && (this.mode === 'hunt' || this.mode === 'pursue' || this.mode === 'retreat' || this.mode === 'camp' || this.mode === 'objective')
      this.sprinting = wantSprint
      this.wishSpeed = (wantSprint ? CONFIG.sprintSpeed : engaged ? CONFIG.walkSpeed * 0.7 : CONFIG.walkSpeed) * mob
      if (!wantSprint && this.wantStance !== 0 && !engaged) this.wantStance = 0
      // Stuck detection.
      this.stuckT += dt
      if (this.stuckT > 1.1) {
        const moved = this.stuckPos.distanceTo(this.position)
        this.stuckT = 0
        this.stuckPos.copy(this.position)
        if (moved < 0.4 && this.wishSpeed > 0.5) {
          this.stuckCount++
          // Repeatedly stuck on the same waypoint: make A* route around it.
          if (this.stuckCount >= 2 && this.pathI < this.pathLen) this.nav.penalize(this.path[this.pathI]!, 30)
          if (this.grounded && this.stuckCount === 1) this.jump()
          else if (this.stuckCount < 4) this.repath()
          else if (this.recoverOffNav()) this.repath()
          else {
            this.stuckCount = 0
            this.hasGoal = false
            this.pathLen = 0
          }
        } else this.stuckCount = 0
      }
      this.repathT -= dt
      if (this.repathT <= 0) this.repath()
    }

    if (engaged) {
      // Combat footwork: strafe around the target plus advance/retreat.
      const t = this.target!
      _v.subVectors(t.position, this.position).setY(0)
      const d = _v.length() || 1
      _v.divideScalar(d)
      const sx = -_v.z * this.strafeDir
      const sz = _v.x * this.strafeDir
      let wx = sx
      let wz = sz
      if (!follow) {
        wx += _v.x * this.advance * 0.8
        wz += _v.z * this.advance * 0.8
      } else {
        wx = this.wish.x * 0.8 + sx * 0.6
        wz = this.wish.z * 0.8 + sz * 0.6
      }
      const wl = Math.hypot(wx, wz)
      if (wl > 0.05) {
        wx /= wl
        wz /= wl
        // Never strafe off a ledge.
        if (this.ledgeAhead(wx, wz)) {
          this.strafeDir = -this.strafeDir
          this.strafeT = 0.6
          wx = wz = 0
        }
      }
      this.wish.set(wx, 0, wz)
      const crouched = this.wantStance === 1
      const speed = crouched ? CONFIG.crouchSpeed : CONFIG.walkSpeed * (this.def.class === 'smg' || this.def.class === 'shotgun' ? 0.8 : 0.62)
      this.wishSpeed = wl > 0.05 ? speed * mob : 0
      if (this.profile.sniper && this.slot === 'primary') this.wishSpeed *= 0.4
      this.sprinting = false
    }
    if (this.action === 'melee' && this.target) {
      _v.subVectors(this.target.position, this.position).setY(0).normalize()
      this.wish.copy(_v)
      this.wishSpeed = this.actionT < 0.45 ? 6 : 1
    }
    // Local avoidance: separate from nearby actors.
    let ax = 0
    let az = 0
    for (const a of this.game.actors) {
      if (a === this || !a.alive) continue
      const ox = this.position.x - a.position.x
      const oz = this.position.z - a.position.z
      const d2 = ox * ox + oz * oz
      if (d2 > 1.44 || d2 < 1e-6 || Math.abs(a.position.y - this.position.y) > 1.5) continue
      const d = Math.sqrt(d2)
      const w = (1.2 - d) / 1.2
      ax += (ox / d) * w * 1.6
      az += (oz / d) * w * 1.6
    }
    if (ax !== 0 || az !== 0) {
      if (this.wishSpeed < 0.1) this.wishSpeed = 1.5
      this.wish.x += ax
      this.wish.z += az
      const l = Math.hypot(this.wish.x, this.wish.z)
      if (l > 1) this.wish.divideScalar(l)
    }
  }

  /** Skip ahead along the path when the straight line is walkable. */
  private smoothAhead() {
    const nav = this.nav
    const maxK = Math.min(this.pathLen - 1, this.pathI + 5)
    for (let k = maxK; k > this.pathI; k--) {
      // All links up to k must be plain walks at similar height.
      let ok = true
      for (let q = this.pathI; q <= k && ok; q++) {
        const a = q === 0 ? -1 : this.path[q - 1]!
        if (a >= 0) {
          const l = nav.linkBetween(a, this.path[q]!)
          if (l < 0 || nav.linkType[l] !== LINK_WALK) ok = false
        }
      }
      if (!ok) continue
      const n = this.path[k]!
      if (this.walkableLine(this.position.x, this.position.y, this.position.z, nav.px[n]!, nav.py[n]!, nav.pz[n]!)) {
        this.pathI = k
        return
      }
    }
  }

  private walkableLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const col = this.game.collision
    const r = CONFIG.capsuleRadius * 0.9
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    if (len < 0.3) return true
    if (Math.abs(by - ay) > 1.2) return false
    const nx = dx / len
    const nz = dz / len
    // Knee-height rays left and right of the centre line.
    for (const s of [-1, 1]) {
      _a.set(ax - nz * r * s, Math.max(ay, by) + 0.5, az + nx * r * s)
      _b.set(bx - nz * r * s, Math.max(ay, by) + 0.5, bz + nx * r * s)
      if (!col.lineOfSight(_a, _b)) return false
    }
    _a.set(ax, ay + 1.3, az)
    _b.set(bx, by + 1.3, bz)
    if (!col.lineOfSight(_a, _b)) return false
    // Ground continuity every ~1.2 m.
    const steps = Math.floor(len / 1.2)
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1)
      const y = lerp(ay, by, t)
      _o.set(ax + dx * t, y + 0.6, az + dz * t)
      const h = col.raycast(_o, _down, 1.2)
      if (!h || h.normal.y < WALKABLE_NY) return false
    }
    return true
  }

  /**
   * Last resort when hopelessly stuck: if we are off the nav graph (fell under
   * the terrain, wedged on an unmapped prop), snap to the nearest node.
   */
  private recoverOffNav(): boolean {
    const nav = this.nav
    const p = this.position
    const k = nav.nearest(p.x, p.y, p.z, 8)
    if (k < 0) return false
    const dx = nav.px[k]! - p.x
    const dy = nav.py[k]! - p.y
    const dz = nav.pz[k]! - p.z
    if (Math.hypot(dx, dz) < 1.2 && Math.abs(dy) < 0.6) return false
    p.set(nav.px[k]!, nav.py[k]!, nav.pz[k]!)
    this.velocity.set(0, 0, 0)
    this.grounded = true
    this.stuckCount = 0
    return true
  }

  private ledgeAhead(dx: number, dz: number): boolean {
    _o.set(this.position.x + dx * 0.9, this.position.y + 0.4, this.position.z + dz * 0.9)
    const h = this.game.collision.raycast(_o, _down, 1.3)
    return !h
  }

  private coverToward(node: number, threat: Vector3): boolean {
    const nav = this.nav
    const a = Math.atan2(threat.z - nav.pz[node]!, threat.x - nav.px[node]!)
    let di = Math.round(a / (Math.PI / 4))
    di = ((di % 8) + 8) % 8
    return (nav.coverMask[node]! & (1 << di)) !== 0
  }

  private friendNear(x: number, z: number, r: number): boolean {
    for (const a of this.game.actors) {
      if (a === this || !a.alive || this.isEnemy(a)) continue
      const dx = a.position.x - x
      const dz = a.position.z - z
      if (dx * dx + dz * dz < r * r) return true
    }
    return false
  }

  private bestOpenYaw(node: number): number {
    const col = this.game.collision
    _o.set(this.nav.px[node]!, this.nav.py[node]! + 1.5, this.nav.pz[node]!)
    let best = 0
    let bestD = -1
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      _dir.set(Math.cos(a), 0, Math.sin(a))
      const h = col.raycast(_o, _dir, 70)
      const d = h ? h.distance : 70
      if (d > bestD) {
        bestD = d
        best = yawFromDirection(_dir.x, _dir.z)
      }
    }
    return best
  }

  // ─── Movement physics ─────────────────────────────────────────────────────

  private jump() {
    if (!this.grounded || this.stance !== 0) return
    this.velocity.y = CONFIG.jumpVelocity
    this.grounded = false
    this.game.events.emit('actor:jump', { actor: this })
  }

  private startMantle(x: number, y: number, z: number) {
    this.mantleFrom.copy(this.position)
    this.mantleTo.set(x, y, z)
    this.mantleT = 0
    this.velocity.set(0, 0, 0)
    this.game.events.emit('actor:jump', { actor: this })
  }

  private tryLadder(l: Ladder, up: boolean): boolean {
    // Walk to the entry point first.
    const n = l.normal
    const ex = up ? l.bottom.x + n.x * LADDER_OFFSET : l.top.x - n.x * 0.35
    const ez = up ? l.bottom.z + n.z * LADDER_OFFSET : l.top.z - n.z * 0.35
    const dx = ex - this.position.x
    const dz = ez - this.position.z
    const d = Math.hypot(dx, dz)
    if (d > 0.45) {
      this.wish.set(dx / d, 0, dz / d)
      this.wishSpeed = Math.min(CONFIG.walkSpeed, 1.5 + d * 2)
      return true
    }
    this.ladder = l
    this.ladderDir = up ? 1 : -1
    this.position.x = l.bottom.x + n.x * LADDER_OFFSET
    this.position.z = l.bottom.z + n.z * LADDER_OFFSET
    if (!up) this.position.y = l.top.y - 0.1
    this.ladderExit.copy(up ? l.top : l.bottom)
    if (up) this.ladderExit.addScaledVector(n, -0.65)
    else this.ladderExit.addScaledVector(n, 0.55)
    this.velocity.set(0, 0, 0)
    this.wantStance = 0
    this.sprinting = false
    return true
  }

  private move(dt: number) {
    const v = this.velocity
    const p = this.position
    // Stance (with headroom check before standing).
    if (this.wantStance !== this.stance) {
      if (this.wantStance < this.stance && !this.fits(this.wantStance === 2 ? 1 : this.wantStance)) {
        /* blocked, stay low */
      } else this.stance = this.wantStance
    }
    this.stanceF = damp(this.stanceF, this.stance, 9, dt)
    if (this.sprinting) {
      if (this.stance !== 0 && this.fits(0)) this.stance = 0
      this.sprintOut = 0.25
    }

    if (this.ladder) {
      const l = this.ladder
      v.set(0, CLIMB_SPEED * this.ladderDir, 0)
      p.y += v.y * dt
      this.stepAcc += CLIMB_SPEED * dt
      if (this.stepAcc > 0.7) {
        this.stepAcc = 0
        this.game.events.emit('actor:footstep', { actor: this, surface: 'metal', position: p, intensity: 0.45 })
      }
      if ((this.ladderDir > 0 && p.y >= l.top.y) || (this.ladderDir < 0 && p.y <= l.bottom.y + 0.02)) {
        p.copy(this.ladderExit)
        const gy = this.game.collision.groundHeight(p.x, p.z, p.y + 0.8, 2)
        if (Number.isFinite(gy)) p.y = gy
        this.ladder = null
        this.grounded = true
        v.set(0, 0, 0)
        this.pathI = Math.min(this.pathI + 1, this.pathLen)
      }
      this.hitboxes.invalidate()
      return
    }
    if (this.mantleT >= 0) {
      this.mantleT += dt / 0.55
      const t = Math.min(1, this.mantleT)
      // Up first, then over.
      const ty = Math.min(1, t * 1.6)
      const th = Math.max(0, (t - 0.35) / 0.65)
      p.x = lerp(this.mantleFrom.x, this.mantleTo.x, th * th * (3 - 2 * th))
      p.z = lerp(this.mantleFrom.z, this.mantleTo.z, th * th * (3 - 2 * th))
      p.y = lerp(this.mantleFrom.y, this.mantleTo.y + 0.05, Math.sin(ty * Math.PI * 0.5))
      v.set(0, 0, 0)
      if (t >= 1) {
        this.mantleT = -1
        this.grounded = true
        this.pathI = Math.min(this.pathI + 1, this.pathLen)
        this.resolve()
      }
      this.hitboxes.invalidate()
      return
    }

    // Horizontal acceleration toward the wish velocity.
    const low = this.stance === 2 ? CONFIG.proneSpeed : CONFIG.crouchSpeed
    const speedMul = this.stance !== 0 && !this.sprinting ? Math.min(1, low / Math.max(0.1, this.wishSpeed)) : 1
    const tx = this.wish.x * this.wishSpeed * speedMul
    const tz = this.wish.z * this.wishSpeed * speedMul
    const accel = this.grounded ? (this.wishSpeed > 0.1 ? 38 : 30) : 4
    const dvx = tx - v.x
    const dvz = tz - v.z
    const dl = Math.hypot(dvx, dvz)
    const maxDv = accel * dt
    if (dl > maxDv) {
      v.x += (dvx / dl) * maxDv
      v.z += (dvz / dl) * maxDv
    } else {
      v.x = tx
      v.z = tz
    }
    if (this.grounded && v.y < 0) v.y = 0

    // Standing still on the ground: nothing can move us (static world), skip collision.
    if (this.grounded && this.wishSpeed < 0.05 && Math.abs(v.x) + Math.abs(v.z) < 0.05 && v.y === 0) {
      v.x = v.z = 0
      return
    }
    const prevX = p.x
    const prevZ = p.z
    const wasGrounded = this.grounded
    const dist = Math.hypot(v.x, v.y, v.z) * dt
    const n = clamp(Math.ceil(dist / MAX_SUBSTEP), 1, 6)
    const h = dt / n
    for (let i = 0; i < n; i++) this.step(h)

    const b = this.game.map.bounds
    p.x = clamp(p.x, b.minX + 0.35, b.maxX - 0.35)
    p.z = clamp(p.z, b.minZ + 0.35, b.maxZ - 0.35)
    if (p.y < -25 || !Number.isFinite(p.x + p.y + p.z)) {
      p.copy(this.lastSafe)
      v.set(0, 0, 0)
    } else if (!this.grounded && this.velocity.y > -0.5 && this.velocity.y < 0.5) {
      // Hovering without ground (wedged in/under geometry): recover after a moment.
      this.airStuckT += dt
      if (this.airStuckT > 1.5) {
        this.airStuckT = 0
        if (!this.recoverOffNav()) p.copy(this.lastSafe)
      }
    } else if (this.grounded && Math.random() < 0.05) this.lastSafe.copy(p)
    if (this.grounded || Math.abs(v.y) >= 0.5) this.airStuckT = 0

    if (this.grounded && !wasGrounded && this.landImpact > 2.5) {
      this.game.events.emit('actor:land', { actor: this, surface: this.game.collision.surfaceBelow(p.x, p.y, p.z), impact: this.landImpact })
    }
    this.landImpact = 0
    // Real velocity from displacement (feeds animation & enemy aim).
    if (dt > 0) {
      v.x = (p.x - prevX) / dt
      v.z = (p.z - prevZ) / dt
    }
    this.hitboxes.invalidate()
  }

  private resolve(): CapsuleResult {
    const p = this.position
    const r = CONFIG.capsuleRadius
    const hgt = CONFIG.capsuleHeight[this.stance]
    _a.set(p.x, p.y + r, p.z)
    _b.set(p.x, p.y + Math.max(hgt - r, r + 0.02), p.z)
    const res = this.game.collision.resolveCapsule(_a, _b, r, this.cap)
    p.set(_a.x, _a.y - r, _a.z)
    return res
  }

  private fits(st: 0 | 1): boolean {
    const p = this.position
    const r = CONFIG.capsuleRadius
    _a.set(p.x, p.y + r + 0.05, p.z)
    _b.set(p.x, p.y + CONFIG.capsuleHeight[st] - r, p.z)
    const res = this.game.collision.resolveCapsule(_a, _b, r, this.cap)
    return res.push.y > -0.01
  }

  private step(h: number) {
    const p = this.position
    const v = this.velocity
    const wasGrounded = this.grounded
    _p0.copy(p)
    if (!wasGrounded) v.y -= CONFIG.gravity * h
    const preVy = v.y
    p.x += v.x * h
    p.y += v.y * h
    p.z += v.z * h
    let res = this.resolve()
    let grounded = res.onGround && res.groundNormal.y >= WALKABLE_NY
    if (res.collided && !grounded) {
      const pl = res.push.length()
      if (pl > 1e-5) {
        const vn = (v.x * res.push.x + v.y * res.push.y + v.z * res.push.z) / pl
        if (vn < 0) v.addScaledVector(res.push, -vn / pl)
      }
    }
    if (!grounded && wasGrounded && v.y <= 0.001) {
      _p1.copy(p)
      p.y -= SNAP_DOWN
      res = this.resolve()
      if (res.onGround && res.groundNormal.y >= WALKABLE_NY) {
        p.x = _p1.x
        p.z = _p1.z
        grounded = true
      } else p.copy(_p1)
    }
    if (grounded) {
      if (!wasGrounded && preVy < -1) this.landImpact = Math.max(this.landImpact, -preVy)
      v.y = 0
      const dx = v.x * h
      const dz = v.z * h
      const want = Math.hypot(dx, dz)
      if (wasGrounded && want > 1e-5) {
        const got = ((p.x - _p0.x) * dx + (p.z - _p0.z) * dz) / want
        if (got < want * 0.6) this.stepUp(dx, dz, want, got)
      }
    }
    this.grounded = grounded
  }

  private stepUp(dx: number, dz: number, want: number, got: number) {
    const p = this.position
    _pA.copy(p)
    p.copy(_p0)
    p.y += STEP_HEIGHT
    this.resolve()
    if (p.y < _p0.y + STEP_HEIGHT - 0.03) {
      p.copy(_pA)
      return
    }
    p.x += dx
    p.z += dz
    this.resolve()
    p.y -= STEP_HEIGHT + 0.06
    const res = this.resolve()
    const prog = ((p.x - _p0.x) * dx + (p.z - _p0.z) * dz) / want
    if (res.onGround && res.groundNormal.y >= WALKABLE_NY && prog > got + 0.15 * want && p.y <= _p0.y + STEP_HEIGHT + 0.02 && p.y >= _p0.y - 0.02) {
      this.velocity.y = 0
    } else p.copy(_pA)
  }

  // ─── Animation ────────────────────────────────────────────────────────────

  private animate(dt: number, lod: number) {
    // LOD: far bots animate at half rate, off-screen ones at a third.
    this.animAcc += dt
    this.animFrame++
    const full = lod === 0
    if (lod > 0 && this.animFrame % (lod + 1) !== 0 && this.animAcc < 0.1) return
    const a = this.animIn
    a.dt = this.animAcc
    this.animAcc = 0
    // Body yaw: follows the view when moving, lags (turn-in-place) when idle.
    const diff = wrapAngle(this.yaw - this.bodyYaw)
    const moving = Math.hypot(this.velocity.x, this.velocity.z) > 0.5
    // Turn the lower body in place once the aim is ~60° off the hips, all the way round.
    if (Math.abs(diff) > 1.05) this.turning = true
    else if (Math.abs(diff) < 0.12) this.turning = false
    if (moving || this.turning) this.bodyYaw = wrapAngle(this.bodyYaw + diff * Math.min(1, a.dt * (moving ? 8 : 6)))
    a.bodyYaw = this.bodyYaw
    a.aimYaw = this.yaw
    a.aimPitch = this.pitch
    a.grounded = this.grounded || this.mantleT < 0 ? this.grounded : false
    if (this.mantleT >= 0) a.grounded = false
    a.stance = this.stanceF
    a.sprint = this.sprinting && moving
    a.aim = this.target && this.mode === 'engage' ? 1 : this.mode === 'pursue' || this.mode === 'investigate' ? 0.35 : 0
    a.action = this.action
    a.actionT = clamp(this.actionT, 0, 1)
    a.emptyReload = this.reloadEmpty
    a.pistol = WEAPONS[this.weaponId].class === 'pistol'
    a.ladder = this.ladder ? yawFromDirection(-this.ladder.normal.x, -this.ladder.normal.z) : null
    a.lod = !full
    this.anim.update(a)
    // Footsteps on foot plants.
    if (this.anim.footDown && this.grounded) {
      const sp = Math.hypot(this.velocity.x, this.velocity.z)
      if (sp > 1.2) {
        const surface = this.game.collision.surfaceBelow(this.position.x, this.position.y, this.position.z)
        const intensity = clamp(sp / CONFIG.sprintSpeed, 0.2, 1) * (this.stance === 1 ? 0.45 : 1)
        this.game.events.emit('actor:footstep', { actor: this, surface, position: this.position, intensity })
      }
    }
    this.hitboxes.invalidate()
  }

  private leaveCorpse() {
    this.rig.root.updateMatrixWorld(true)
    const mesh = cloneSkinned(this.rig.mesh) as SkinnedMesh
    const mat = this.fadeMat.clone()
    mat.opacity = 1
    mesh.material = mat
    mesh.matrixAutoUpdate = false
    mesh.matrix.copy(this.rig.mesh.matrixWorld)
    this.game.render.scene.add(mesh)
    mesh.updateMatrixWorld(true)
    // The dropped gun stays with the body; the soldier gets a fresh one.
    const gun = this.dropped
    if (gun) {
      const slot = this.models.primary === gun ? 'primary' : 'secondary'
      const fresh = createWorldWeaponModel(slot === 'primary' ? this.profile.primary : this.profile.secondary)
      fresh.traverse((o) => {
        o.castShadow = true
      })
      this.rig.root.add(fresh)
      this.models[slot] = fresh
      this.dropped = null
    }
    this.corpses.push({ mesh, mat, t: this.corpseT, gun })
  }

  private updateCorpses(dt: number) {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i]!
      c.t += dt
      if (c.t <= CORPSE_TIME) continue
      const s = Math.min(1, (c.t - CORPSE_TIME) / SINK_TIME)
      c.mat.opacity = 1 - s * s * (3 - 2 * s)
      c.mesh.castShadow = c.mat.opacity > 0.55
      if (c.gun && s > 0.6) c.gun.visible = false
      if (s >= 1) {
        c.mesh.removeFromParent()
        c.mesh.skeleton.dispose()
        c.mat.dispose()
        c.gun?.removeFromParent()
        this.corpses.splice(i, 1)
      }
    }
  }

  private updateCorpse(dt: number) {
    this.corpseT += dt
    this.ragdoll.update(dt)
    if (this.corpseT > CORPSE_TIME) {
      // Fade out (per-bot transparent copy of the shared material) while settling slightly.
      const s = Math.min(1, (this.corpseT - CORPSE_TIME) / SINK_TIME)
      const mesh = this.rig.mesh
      if (mesh.material !== this.fadeMat) {
        mesh.material = this.fadeMat
      }
      this.fadeMat.opacity = 1 - s * s * (3 - 2 * s)
      mesh.castShadow = this.fadeMat.opacity > 0.55
      this.ragdoll.sink(s * 0.2)
      if (this.dropped) {
        this.dropped.position.y -= dt * 0.05
        if (s > 0.6) this.dropped.visible = false
      }
      if (s >= 1) {
        this.rig.root.visible = false
        if (this.dropped) this.dropped.visible = false
      }
    }
    // Dropped gun physics.
    const g = this.dropped
    if (g && !this.dropRest) {
      this.dropVel.y -= CONFIG.gravity * dt
      const sp = this.dropVel.length()
      if (sp > 1e-4) {
        _dir.copy(this.dropVel).divideScalar(sp)
        const hit = this.game.collision.raycast(g.position, _dir, sp * dt + 0.05)
        if (hit) {
          g.position.copy(hit.point).addScaledVector(hit.normal, 0.04)
          if (sp < 2.5 || hit.normal.y > 0.7) {
            this.dropRest = true
            // Lie flat on its side.
            const yaw = Math.random() * Math.PI * 2
            g.rotation.set(0, yaw, Math.PI / 2, 'YXZ')
          } else {
            this.dropVel.reflect(hit.normal).multiplyScalar(0.3)
          }
        } else {
          g.position.addScaledVector(this.dropVel, dt)
          g.rotation.x += this.dropSpin.x * dt
          g.rotation.y += this.dropSpin.y * dt
          g.rotation.z += this.dropSpin.z * dt
        }
      }
    }
  }
}

const _pathTmp = new Int32Array(768)

export { LINK_DROP, LINK_JUMP }
