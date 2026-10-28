/**
 * World FX driven by game events: bullet impacts per surface, decals, tracers, third-person
 * muzzle flashes, grenade explosions, ambient dust/sand, plus the per-frame viewmodel sun
 * visibility probe. Everything is pooled — two instanced particle batches, one decal
 * InstancedMesh and a fixed set of point lights — so firing never allocates GPU resources.
 */
import { Color, PointLight, Vector3 } from 'three'
import type { Game } from '../../core/game'
import type { Actor, Surface, WorldHit } from '../../core/types'
import { bakePuffAtlas } from './atlas'
import { DECAL, DecalPool } from './decals'
import { BillboardBatch, type CollideFn, KIND_DOT, KIND_FIRE, KIND_GLOW, KIND_PUFF, KIND_STAR, Spec, StreakBatch } from './particles'

const STREAK_GLOW = 0
const STREAK_SHARD = 1
const STREAK_CONE = 2

/** Pooled flash lights (constant count so materials never recompile). */
const LIGHTS = 3
const _o = new Vector3()
const _d = new Vector3()
const _n = new Vector3()
const _t = new Vector3()
const _u = new Vector3()
const _w = new Vector3()
const _g = new Vector3()

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0]!

interface FlashLight {
  light: PointLight
  t: number
  dur: number
  peak: number
}

export class Effects {
  readonly billboards: BillboardBatch
  readonly streaks: StreakBatch
  readonly decals: DecalPool
  private readonly lights: FlashLight[] = []
  private readonly s = new Spec()
  private readonly collideFn: CollideFn
  /** Sunlit-ish multiplier for unlit particle colours (derived from the environment). */
  private lit = 1
  private sunLit = 1
  private shadeLit = 0.5
  private readonly sunCol = new Color()
  private readonly wind = new Vector3(0.9, 0, 0.35)
  private moteAcc = 0
  private wispAcc = 0
  private tracerCount = 0
  private sunProbeT = 0
  /** Scratch hit for allocation-free raycasts (valid until the next `ray` call). */
  private readonly hit: WorldHit = { point: new Vector3(), normal: new Vector3(), distance: 0, surface: 'concrete' }

  constructor(private game: Game) {
    const r = game.render
    const atlas = bakePuffAtlas(r.renderer)
    this.billboards = new BillboardBatch(2400, atlas, 20)
    this.streaks = new StreakBatch(1200, 21)
    this.decals = new DecalPool(220, r.renderer)
    r.scene.add(this.decals.mesh, this.billboards.mesh, this.streaks.mesh)
    for (let i = 0; i < LIGHTS; i++) {
      const light = new PointLight(0xffa860, 0, 10, 2)
      light.castShadow = false
      r.scene.add(light)
      this.lights.push({ light, t: 1, dur: 1, peak: 0 })
    }

    const env = r.environment
    this.sunCol.set(env.sunColor)
    const elev = Math.max(0.15, -env.sunDirection.y)
    this.sunLit = (env.sunIntensity * elev) / Math.PI * 0.75 + 0.3
    this.shadeLit = 0.3
    this.lit = this.sunLit
    this.wind.set(-env.sunDirection.x, 0, -env.sunDirection.z).normalize().multiplyScalar(-0.9)

    this.collideFn = (x, y, z, dx, dy, dz, dist, out) => {
      _o.set(x, y, z)
      _d.set(dx, dy, dz)
      const hit = this.ray(_o, _d, dist)
      if (!hit) return false
      out[0] = hit.point.x
      out[1] = hit.point.y
      out[2] = hit.point.z
      out[3] = hit.normal.x
      out[4] = hit.normal.y
      out[5] = hit.normal.z
      return true
    }

    const ev = game.events
    ev.on('bullet:impact', (e) => this.impact(e.point, e.normal, e.surface, e.shooter))
    ev.on('bullet:tracer', (e) => this.tracer(e.from, e.to, e.shooter))
    ev.on('weapon:fire', (e) => {
      if (e.shooter.isPlayer) this.playerFlash(e.origin, e.direction, e.suppressed)
      else this.muzzleFlash(e.origin, e.direction, e.suppressed)
    })
    ev.on('grenade:explode', (e) => this.explode(e.position))
    ev.on('grenade:bounce', (e) => this.bouncePuff(e.position, e.surface))
    ev.on('match:phase', ({ phase }) => {
      if (phase === 'intro' || phase === 'menu') this.clear()
    })
  }

  private ray(o: Vector3, d: Vector3, max: number): WorldHit | null {
    return this.game.collision.raycastInto(o, d, max, this.hit) ? this.hit : null
  }

  clear() {
    this.billboards.clear()
    this.streaks.clear()
    this.decals.clear()
    for (const l of this.lights) {
      l.t = l.dur
      l.light.intensity = 0
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Frame
  // ═══════════════════════════════════════════════════════════════════════════

  update(dt: number) {
    const r = this.game.render
    const cam = r.camera
    cam.updateMatrixWorld()

    if (dt > 0) {
      this.ambient(dt, cam.position)
      this.billboards.step(dt, this.collideFn)
      this.streaks.step(dt, this.collideFn)
      this.decals.update(dt)
      for (const l of this.lights) {
        if (l.t >= l.dur) continue
        l.t += dt
        const k = Math.max(0, 1 - l.t / l.dur)
        l.light.intensity = l.peak * k * k
      }
      this.sunProbe(dt)
    }
    this.billboards.write(cam)
    this.streaks.write(cam, r.renderer.domElement.height)
  }

  /** Is the camera in the sun? Dims the viewmodel's sun light when standing in shadow. */
  private sunProbe(dt: number) {
    this.sunProbeT -= dt
    if (this.sunProbeT > 0) return
    this.sunProbeT = 1 / 30
    const r = this.game.render
    // Two rays (eye + a hand-height offset) give a softer transition at shadow edges.
    let vis = 0
    _o.copy(r.camera.position)
    if (!this.ray(_o, r.sunToward, 160)) vis += 0.5
    _o.y -= 0.25
    _w.set(0, 0, -0.35).applyQuaternion(r.camera.quaternion)
    _o.add(_w)
    if (!this.ray(_o, r.sunToward, 160)) vis += 0.5
    r.setViewmodelSunVisibility(vis)
  }

  private ambient(dt: number, camPos: Vector3) {
    const s = this.s
    const L = (this.lit = this.sunLit)
    // Floating dust motes around the camera (sun-lit specks).
    this.moteAcc += dt * 14
    while (this.moteAcc >= 1) {
      this.moteAcc--
      const a = Math.random() * Math.PI * 2
      const d = rand(0.6, 7)
      s.reset()
      s.x = camPos.x + Math.cos(a) * d
      s.y = camPos.y + rand(-1.4, 2.2)
      s.z = camPos.z + Math.sin(a) * d
      s.vx = this.wind.x * 0.25 + rand(-0.06, 0.06)
      s.vy = rand(-0.03, 0.05)
      s.vz = this.wind.z * 0.25 + rand(-0.06, 0.06)
      s.life = rand(4, 8)
      s.s0 = s.s1 = rand(0.004, 0.009)
      s.kind = KIND_DOT
      const c = L * rand(0.8, 1.2)
      s.r0 = s.r1 = 0.95 * c
      s.g0 = s.g1 = 0.82 * c
      s.b0 = s.b1 = 0.62 * c
      s.a0 = rand(0.12, 0.3)
      s.a1 = 0
      s.fadeIn = 0.25
      s.add = 0.6
      this.billboards.emit(s)
    }
    // Wind-blown sand wisps skimming the ground.
    this.wispAcc += dt * 0.9
    while (this.wispAcc >= 1) {
      this.wispAcc--
      const a = Math.random() * Math.PI * 2
      const d = rand(4, 26)
      const x = camPos.x + Math.cos(a) * d
      const z = camPos.z + Math.sin(a) * d
      const gy = this.game.collision.groundHeight(x, z, camPos.y + 6, 30)
      if (!Number.isFinite(gy)) continue
      const n = 4 + ((Math.random() * 3) | 0)
      for (let i = 0; i < n; i++) {
        s.reset()
        s.x = x - this.wind.x * i * 0.9 + rand(-0.3, 0.3)
        s.y = gy + rand(0.15, 0.5)
        s.z = z - this.wind.z * i * 0.9 + rand(-0.3, 0.3)
        s.vx = this.wind.x * rand(2.2, 3.4)
        s.vy = rand(0.02, 0.12)
        s.vz = this.wind.z * rand(2.2, 3.4)
        s.delay = i * 0.12
        s.life = rand(3, 5)
        s.s0 = rand(0.5, 0.9)
        s.s1 = rand(1.8, 3)
        s.rot = Math.random() * 6.28
        s.rv = rand(-0.2, 0.2)
        s.kind = KIND_PUFF
        s.frame = (Math.random() * 4) | 0
        this.sandColor(s, 0.95)
        s.a0 = rand(0.07, 0.13)
        s.a1 = 0
        s.fadeIn = 0.3
        this.billboards.emit(s)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Colours
  // ═══════════════════════════════════════════════════════════════════════════

  private sandColor(s: Spec, k = 1) {
    const L = this.lit * k
    s.r0 = s.r1 = 0.6 * L
    s.g0 = s.g1 = 0.48 * L
    s.b0 = s.b1 = 0.33 * L
  }

  private rgb(s: Spec, r: number, g: number, b: number, end = 1) {
    const L = this.lit
    s.r0 = r * L
    s.g0 = g * L
    s.b0 = b * L
    s.r1 = r * L * end
    s.g1 = g * L * end
    s.b1 = b * L * end
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Bullet impacts
  // ═══════════════════════════════════════════════════════════════════════════

  /** Pick the particle light level for an effect at p: sunlit or in shadow (one BVH ray). */
  private lightAt(p: Vector3) {
    _o.copy(p).addScaledVector(this.game.render.sunToward, 0.3)
    this.lit = this.ray(_o, this.game.render.sunToward, 120) ? this.shadeLit : this.sunLit
  }

  private impact(point: Vector3, normal: Vector3, surface: Surface, shooter: Actor | null) {
    const camD = point.distanceTo(this.game.render.camera.position)
    _w.copy(point).addScaledVector(normal, 0.1)
    this.lightAt(_w)
    // Far-away impacts: keep the decal, skip most particles (they'd be sub-pixel anyway).
    const detail = camD > 60 ? 0.35 : camD > 30 ? 0.65 : 1
    void shooter
    switch (surface) {
      case 'sand':
      case 'dirt':
        this.sandHit(point, normal, detail, surface === 'dirt' ? 0.72 : 1)
        this.decals.add(point, normal, pick(DECAL.sand), rand(0.14, 0.2))
        break
      case 'concrete':
        this.concreteHit(point, normal, detail)
        this.decals.add(point, normal, Math.random() < 0.85 ? pick(DECAL.concrete) : DECAL.chip[0], rand(0.1, 0.15))
        break
      case 'metal':
        this.metalHit(point, normal, detail)
        this.decals.add(point, normal, pick(DECAL.metal), rand(0.07, 0.1), 1)
        break
      case 'wood':
        this.woodHit(point, normal, detail)
        this.decals.add(point, normal, pick(DECAL.wood), rand(0.1, 0.14), 0, rand(-0.15, 0.15) + (Math.random() < 0.5 ? 0 : Math.PI / 2))
        break
      case 'glass':
        this.glassHit(point, normal, detail)
        this.decals.add(point, normal, DECAL.glass[0], rand(0.25, 0.4))
        break
      case 'water':
        this.waterHit(point, normal, detail)
        break
      case 'flesh':
        this.fleshHit(point, normal, detail)
        break
    }
  }

  /** Random direction in the hemisphere around n with `spread` (0 = along n). */
  private sprayDir(out: Vector3, n: Vector3, spread: number) {
    out.set(rand(-1, 1), rand(-1, 1), rand(-1, 1))
    out.multiplyScalar(spread).add(n).normalize()
    return out
  }

  private sandHit(p: Vector3, n: Vector3, detail: number, darken: number) {
    const s = this.s
    // Soft dust puff
    const puffs = Math.ceil(3 * detail)
    for (let i = 0; i < puffs; i++) {
      this.sprayDir(_t, n, 0.6)
      s.reset().pos(p)
      s.x += n.x * 0.08
      s.y += n.y * 0.08
      s.z += n.z * 0.08
      const sp = rand(0.6, 1.8)
      s.vx = _t.x * sp + this.wind.x * 0.4
      s.vy = _t.y * sp + 0.3
      s.vz = _t.z * sp + this.wind.z * 0.4
      s.drag = 2.4
      s.grav = -0.15
      s.life = rand(1.2, 2.2)
      s.s0 = rand(0.12, 0.2)
      s.s1 = rand(0.6, 1)
      s.rot = Math.random() * 6.28
      s.rv = rand(-0.6, 0.6)
      s.frame = (Math.random() * 4) | 0
      this.sandColor(s, darken)
      s.a0 = rand(0.35, 0.5)
      s.a1 = 0
      s.fadeIn = 0.04
      this.billboards.emit(s)
    }
    // Sand spout (shards thrown up along the normal, falling back)
    const spouts = Math.ceil(6 * detail)
    for (let i = 0; i < spouts; i++) {
      this.sprayDir(_t, n, 0.35)
      const sp = rand(2.5, 6)
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp + 1.2
      s.vz = _t.z * sp
      s.grav = 9.8
      s.drag = 0.6
      s.life = rand(0.35, 0.7)
      s.trail = 0.05
      s.width = rand(0.012, 0.022)
      s.kind = STREAK_SHARD
      this.sandColor(s, 0.8 * darken)
      s.a0 = 0.85
      s.a1 = 0.0
      s.fadeIn = 0.01
      this.streaks.emit(s)
    }
    // Grains
    const grains = Math.ceil(10 * detail)
    for (let i = 0; i < grains; i++) {
      this.sprayDir(_t, n, 0.8)
      const sp = rand(1.5, 4.5)
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp + 1.5
      s.vz = _t.z * sp
      s.grav = 9.8
      s.drag = 0.4
      s.life = rand(0.5, 0.9)
      s.s0 = s.s1 = rand(0.015, 0.03)
      s.kind = KIND_DOT
      this.sandColor(s, 0.7 * darken)
      s.a0 = s.a1 = 1
      s.a1 = 0.6
      s.fadeIn = 0.01
      this.billboards.emit(s)
    }
  }

  private concreteHit(p: Vector3, n: Vector3, detail: number) {
    const s = this.s
    const puffs = Math.ceil(3 * detail)
    for (let i = 0; i < puffs; i++) {
      this.sprayDir(_t, n, 0.5)
      const sp = rand(0.8, 2.2)
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp + 0.2
      s.vz = _t.z * sp
      s.drag = 2.8
      s.grav = 0.05
      s.life = rand(1, 1.8)
      s.s0 = rand(0.08, 0.14)
      s.s1 = rand(0.45, 0.75)
      s.rot = Math.random() * 6.28
      s.rv = rand(-0.8, 0.8)
      s.frame = (Math.random() * 4) | 0
      this.rgb(s, 0.5, 0.48, 0.45)
      s.a0 = rand(0.4, 0.55)
      s.a1 = 0
      s.fadeIn = 0.03
      this.billboards.emit(s)
    }
    const chips = Math.ceil(9 * detail)
    for (let i = 0; i < chips; i++) {
      this.sprayDir(_t, n, 0.9)
      const sp = rand(2, 6)
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp + 1
      s.vz = _t.z * sp
      s.grav = 9.8
      s.life = rand(0.5, 1.1)
      s.s0 = s.s1 = rand(0.012, 0.03)
      s.kind = KIND_DOT
      const g = rand(0.35, 0.6)
      this.rgb(s, g, g * 0.97, g * 0.93)
      s.a0 = 1
      s.a1 = 0.8
      s.fadeIn = 0.01
      s.collide = i < 3 ? 1 : 0
      s.bounce = 0.3
      this.billboards.emit(s)
    }
    // the odd spark off aggregate
    if (Math.random() < 0.35) this.sparks(p, n, 2, 0.6)
  }

  private sparks(p: Vector3, n: Vector3, count: number, scale: number) {
    const s = this.s
    for (let i = 0; i < count; i++) {
      this.sprayDir(_t, n, 1.1)
      const sp = rand(4, 12) * scale
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp + rand(0, 2)
      s.vz = _t.z * sp
      s.grav = 9.8
      s.drag = 0.8
      s.life = rand(0.18, 0.55)
      s.trail = rand(0.02, 0.035)
      s.width = rand(0.007, 0.012)
      s.kind = STREAK_GLOW
      s.add = 1
      s.r0 = 9
      s.g0 = 5.2
      s.b0 = 2
      s.r1 = 4
      s.g1 = 1.2
      s.b1 = 0.25
      s.a0 = 1
      s.a1 = 0.3
      s.fadeIn = 0.01
      s.collide = i < 4 ? 1 : 0
      s.bounce = 0.35
      this.streaks.emit(s)
    }
  }

  private metalHit(p: Vector3, n: Vector3, detail: number) {
    const s = this.s
    this.sparks(p, n, Math.ceil(14 * detail), 1)
    // hot flash
    s.reset().pos(p)
    s.x += n.x * 0.12
    s.y += n.y * 0.12
    s.z += n.z * 0.12
    s.life = 0.06
    s.s0 = 0.22
    s.s1 = 0.12
    s.kind = KIND_STAR
    s.seed = Math.random()
    s.r0 = s.r1 = 6
    s.g0 = s.g1 = 3.6
    s.b0 = s.b1 = 1.6
    s.a0 = 1
    s.a1 = 0
    s.fadeIn = 0.01
    this.billboards.emit(s)
    s.reset().pos(p)
    s.x += n.x * 0.15
    s.y += n.y * 0.15
    s.z += n.z * 0.15
    s.life = 0.12
    s.s0 = 0.35
    s.s1 = 0.2
    s.kind = KIND_GLOW
    s.add = 1
    s.r0 = s.r1 = 3
    s.g0 = s.g1 = 1.4
    s.b0 = s.b1 = 0.4
    s.a0 = 1
    s.a1 = 0
    s.fadeIn = 0.01
    this.billboards.emit(s)
    // faint grey-rust dust
    this.sprayDir(_t, n, 0.4)
    s.reset().pos(p)
    s.vx = _t.x * 1.2
    s.vy = _t.y * 1.2 + 0.2
    s.vz = _t.z * 1.2
    s.drag = 2.5
    s.life = rand(0.8, 1.2)
    s.s0 = 0.08
    s.s1 = 0.5
    s.rot = Math.random() * 6.28
    s.frame = (Math.random() * 4) | 0
    this.rgb(s, 0.42, 0.34, 0.27)
    s.a0 = 0.4
    s.a1 = 0
    this.billboards.emit(s)
  }

  private woodHit(p: Vector3, n: Vector3, detail: number) {
    const s = this.s
    const splinters = Math.ceil(9 * detail)
    for (let i = 0; i < splinters; i++) {
      this.sprayDir(_t, n, 0.8)
      const sp = rand(2.5, 7)
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp + 1
      s.vz = _t.z * sp
      s.grav = 9.8
      s.drag = 0.8
      s.life = rand(0.5, 1)
      s.trail = rand(0.012, 0.025)
      s.width = rand(0.008, 0.014)
      s.kind = STREAK_SHARD
      const k = rand(0.8, 1.1)
      this.rgb(s, 0.62 * k, 0.45 * k, 0.26 * k)
      s.a0 = 1
      s.a1 = 0.8
      s.fadeIn = 0.01
      s.collide = i < 3 ? 1 : 0
      s.bounce = 0.25
      this.streaks.emit(s)
    }
    const puffs = Math.ceil(2 * detail)
    for (let i = 0; i < puffs; i++) {
      this.sprayDir(_t, n, 0.5)
      const sp = rand(0.6, 1.6)
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp + 0.2
      s.vz = _t.z * sp
      s.drag = 2.6
      s.life = rand(0.8, 1.4)
      s.s0 = 0.08
      s.s1 = rand(0.45, 0.7)
      s.rot = Math.random() * 6.28
      s.frame = (Math.random() * 4) | 0
      this.rgb(s, 0.55, 0.43, 0.3)
      s.a0 = 0.45
      s.a1 = 0
      this.billboards.emit(s)
    }
  }

  private glassHit(p: Vector3, n: Vector3, detail: number) {
    const s = this.s
    const shards = Math.ceil(14 * detail)
    for (let i = 0; i < shards; i++) {
      this.sprayDir(_t, n, 1)
      const sp = rand(1.5, 5)
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp + 0.5
      s.vz = _t.z * sp
      s.grav = 9.8
      s.life = rand(0.6, 1.2)
      s.trail = rand(0.008, 0.02)
      s.width = rand(0.01, 0.025)
      s.kind = STREAK_SHARD
      s.add = 0.5
      this.rgb(s, 0.85, 0.9, 0.95)
      s.a0 = 0.7
      s.a1 = 0.4
      s.fadeIn = 0.01
      s.collide = i < 4 ? 1 : 0
      s.bounce = 0.3
      this.streaks.emit(s)
    }
    for (let i = 0; i < 6 * detail; i++) {
      this.sprayDir(_t, n, 1)
      const sp = rand(1, 4)
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp
      s.vz = _t.z * sp
      s.grav = 9.8
      s.life = rand(0.3, 0.7)
      s.s0 = s.s1 = 0.012
      s.kind = KIND_DOT
      s.add = 1
      s.r0 = s.g0 = s.b0 = 3
      s.r1 = s.g1 = s.b1 = 1
      s.a0 = 1
      s.a1 = 0
      this.billboards.emit(s)
    }
  }

  private waterHit(p: Vector3, n: Vector3, detail: number) {
    const s = this.s
    for (let i = 0; i < 10 * detail; i++) {
      this.sprayDir(_t, n, 0.25)
      const sp = rand(2, 5)
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp + 1
      s.vz = _t.z * sp
      s.grav = 9.8
      s.life = rand(0.4, 0.7)
      s.trail = 0.04
      s.width = 0.015
      s.kind = STREAK_SHARD
      this.rgb(s, 0.8, 0.82, 0.8)
      s.a0 = 0.6
      s.a1 = 0
      this.streaks.emit(s)
    }
  }

  private fleshHit(p: Vector3, n: Vector3, detail: number) {
    const s = this.s
    // n points back toward the shooter; the bullet travelled along -n.
    _u.copy(n).negate()
    // Blood mist: exit spray (along the shot) + smaller entry puff
    const mist = Math.ceil(8 * detail)
    for (let i = 0; i < mist; i++) {
      const exit = i < mist - 2
      this.sprayDir(_t, exit ? _u : n, 0.6)
      const sp = exit ? rand(0.8, 3.2) : rand(0.4, 1.2)
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp + 0.15
      s.vz = _t.z * sp
      s.drag = 4.5
      s.grav = 0.5
      s.life = rand(0.4, 0.8)
      s.s0 = rand(0.18, 0.32)
      s.s1 = rand(0.55, 1)
      s.rot = Math.random() * 6.28
      s.rv = rand(-1, 1)
      s.frame = (Math.random() * 4) | 0
      const L = this.lit
      s.r0 = 0.2 * L
      s.g0 = 0.012 * L
      s.b0 = 0.01 * L
      s.r1 = 0.16 * L
      s.g1 = 0.035 * L
      s.b1 = 0.03 * L
      s.a0 = rand(0.55, 0.8)
      s.a1 = 0
      s.fadeIn = 0.02
      this.billboards.emit(s)
    }
    // Droplets
    for (let i = 0; i < 10 * detail; i++) {
      this.sprayDir(_t, _u, 0.7)
      const sp = rand(1.5, 4)
      s.reset().pos(p)
      s.vx = _t.x * sp
      s.vy = _t.y * sp + 0.8
      s.vz = _t.z * sp
      s.grav = 9.8
      s.life = rand(0.4, 0.8)
      s.s0 = s.s1 = rand(0.012, 0.025)
      s.kind = KIND_DOT
      this.rgb(s, 0.25, 0.01, 0.01)
      s.a0 = 1
      s.a1 = 0.7
      this.billboards.emit(s)
    }
    // Blood decal on the wall behind / floor below.
    const wall = this.ray(p, _u, 2.5)
    if (wall) this.decals.add(wall.point, wall.normal, pick(DECAL.blood), rand(0.4, 0.8) * (1 - wall.distance / 4))
    if (Math.random() < 0.5) {
      _t.set(rand(-0.3, 0.3), -1, rand(-0.3, 0.3)).normalize()
      const floor = this.ray(p, _t, 2.2)
      if (floor && floor.normal.y > 0.6) this.decals.add(floor.point, floor.normal, DECAL.bloodPool[0], rand(0.25, 0.45))
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tracers & muzzle flashes
  // ═══════════════════════════════════════════════════════════════════════════

  private tracer(from: Vector3, to: Vector3, shooter: Actor) {
    const cam = this.game.render.camera.position
    _d.subVectors(to, from)
    const len = _d.length()
    if (len < 2) return
    _d.divideScalar(len)
    // closest approach of the bullet path to the camera
    const tc = Math.min(len, Math.max(0, _t.subVectors(cam, from).dot(_d)))
    const miss = _w.copy(from).addScaledVector(_d, tc).distanceTo(cam)
    const atMe = !shooter.isPlayer && miss < 3.5 && tc > 2
    this.tracerCount++
    // CoD only shows the odd tracer — always show the ones whizzing past the player's head.
    if (!atMe && this.tracerCount % (shooter.isPlayer ? 4 : 3) !== 0) return
    const start = shooter.isPlayer ? Math.min(3, len * 0.5) : 0.6
    const s = this.s
    s.reset()
    s.x = from.x + _d.x * start
    s.y = from.y + _d.y * start
    s.z = from.z + _d.z * start
    const speed = atMe ? 220 : 320
    s.vx = _d.x * speed
    s.vy = _d.y * speed
    s.vz = _d.z * speed
    s.maxDist = len - start
    s.life = (len - start) / speed + 0.03
    s.trail = atMe ? 0.016 : 0.014
    s.width = atMe ? 0.012 : 0.014
    s.kind = STREAK_GLOW
    s.add = 1
    const k = atMe ? 1.5 : 1
    s.r0 = s.r1 = 7 * k
    s.g0 = s.g1 = 4.6 * k
    s.b0 = s.b1 = 2.2 * k
    s.a0 = 1
    s.a1 = 0.8
    s.fadeIn = 0.01
    this.streaks.emit(s)
  }

  private flashLight(pos: Vector3, peak: number, dur: number, dist: number, color: number) {
    // reuse the light closest to finishing
    let best = this.lights[0]!
    let bestLeft = Infinity
    for (const l of this.lights) {
      const left = (l.dur - l.t) * l.peak
      if (left < bestLeft) {
        bestLeft = left
        best = l
      }
    }
    best.light.position.copy(pos)
    best.light.color.set(color)
    best.light.distance = dist
    best.peak = peak
    best.dur = dur
    best.t = 0
    best.light.intensity = peak
  }

  private playerFlash(origin: Vector3, dir: Vector3, suppressed: boolean) {
    if (suppressed) return
    const cam = this.game.render.camera
    _w.set(0, -0.1, -0.9).applyQuaternion(cam.quaternion).add(cam.position)
    // pull the light back if a wall is right in front, so it lights the wall not the far side
    const hit = this.ray(cam.position, _t.subVectors(_w, cam.position).normalize(), 0.95)
    if (hit) _w.copy(hit.point).addScaledVector(_t, -0.15)
    void origin
    void dir
    this.flashLight(_w, rand(16, 24), 0.06, 9, 0xffb070)
  }

  private muzzleFlash(origin: Vector3, dir: Vector3, suppressed: boolean) {
    const s = this.s
    const camD = origin.distanceTo(this.game.render.camera.position)
    const sc = suppressed ? 0.35 : 1
    // star
    s.reset()
    s.x = origin.x + dir.x * 0.08
    s.y = origin.y + dir.y * 0.08
    s.z = origin.z + dir.z * 0.08
    s.life = 0.05
    s.s0 = rand(0.3, 0.42) * sc
    s.s1 = s.s0 * 0.7
    s.kind = KIND_STAR
    s.seed = Math.random()
    s.rot = Math.random() * 6.28
    s.r0 = s.r1 = 6
    s.g0 = s.g1 = 3.4
    s.b0 = s.b1 = 1.3
    s.a0 = 1
    s.a1 = 0.2
    s.fadeIn = 0.01
    this.billboards.emit(s)
    // glow (keeps far flashes readable)
    s.reset()
    s.x = origin.x + dir.x * 0.15
    s.y = origin.y + dir.y * 0.15
    s.z = origin.z + dir.z * 0.15
    s.life = 0.06
    s.s0 = (0.5 + Math.min(1, camD / 60) * 0.6) * sc
    s.s1 = s.s0 * 0.8
    s.kind = KIND_GLOW
    s.add = 1
    s.r0 = s.r1 = 3.2
    s.g0 = s.g1 = 1.5
    s.b0 = s.b1 = 0.45
    s.a0 = 1
    s.a1 = 0
    s.fadeIn = 0.01
    this.billboards.emit(s)
    // forward cone + side prongs
    if (!suppressed) {
      for (let i = 0; i < 3; i++) {
        if (i === 0) _t.copy(dir)
        else this.sprayDir(_t, dir, 0.45)
        const len = i === 0 ? rand(0.35, 0.5) : rand(0.12, 0.22)
        s.reset()
        s.x = origin.x + _t.x * len
        s.y = origin.y + _t.y * len
        s.z = origin.z + _t.z * len
        s.vx = _t.x
        s.vy = _t.y
        s.vz = _t.z
        s.trail = len
        s.width = i === 0 ? 0.14 : 0.06
        s.life = 0.045
        s.kind = STREAK_CONE
        s.add = 1
        s.r0 = s.r1 = 5
        s.g0 = s.g1 = 2.6
        s.b0 = s.b1 = 0.9
        s.a0 = 1
        s.a1 = 0.3
        s.fadeIn = 0.01
        this.streaks.emit(s)
      }
    }
    // a breath of gun smoke
    if (camD < 40) {
      this.lightAt(origin)
      s.reset()
      s.x = origin.x + dir.x * 0.2
      s.y = origin.y + dir.y * 0.2
      s.z = origin.z + dir.z * 0.2
      s.vx = dir.x * 1.2 + this.wind.x * 0.3
      s.vy = 0.25
      s.vz = dir.z * 1.2 + this.wind.z * 0.3
      s.drag = 3
      s.life = rand(0.6, 1)
      s.s0 = 0.08
      s.s1 = 0.45
      s.rot = Math.random() * 6.28
      s.frame = (Math.random() * 4) | 0
      this.rgb(s, 0.55, 0.53, 0.5)
      s.a0 = 0.18
      s.a1 = 0
      this.billboards.emit(s)
    }
    if (!suppressed && camD < 55) this.flashLight(_w.copy(origin).addScaledVector(dir, 0.3), 18, 0.06, 8, 0xffa860)
  }

  /** One rising smoke puff (killstreak markers, burning wrecks, missile trails). */
  smoke(p: Vector3, r: number, g: number, b: number, size = 1, alpha = 0.6, life = 2.4) {
    const s = this.s
    s.reset().pos(p)
    s.vx = rand(-0.3, 0.3) + this.wind.x * 0.5
    s.vy = rand(0.8, 1.6) * size
    s.vz = rand(-0.3, 0.3) + this.wind.z * 0.5
    s.drag = 0.8
    s.grav = -0.15
    s.life = rand(life * 0.7, life)
    s.s0 = 0.25 * size
    s.s1 = rand(1.2, 1.8) * size
    s.rot = Math.random() * 6.28
    s.rv = rand(-0.4, 0.4)
    s.frame = (Math.random() * 4) | 0
    this.rgb(s, r, g, b)
    s.a0 = alpha
    s.a1 = 0
    s.fadeIn = 0.08
    this.billboards.emit(s)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Grenades
  // ═══════════════════════════════════════════════════════════════════════════

  private bouncePuff(p: Vector3, surface: Surface) {
    const s = this.s
    this.lightAt(p)
    for (let i = 0; i < 2; i++) {
      s.reset().pos(p)
      s.vx = rand(-0.5, 0.5)
      s.vy = rand(0.2, 0.6)
      s.vz = rand(-0.5, 0.5)
      s.drag = 2.5
      s.life = rand(0.8, 1.3)
      s.s0 = 0.08
      s.s1 = rand(0.35, 0.55)
      s.rot = Math.random() * 6.28
      s.frame = (Math.random() * 4) | 0
      if (surface === 'sand' || surface === 'dirt') this.sandColor(s)
      else this.rgb(s, 0.5, 0.47, 0.43)
      s.a0 = 0.4
      s.a1 = 0
      this.billboards.emit(s)
    }
  }

  private explode(pos: Vector3) {
    const s = this.s
    const g = this.game
    const r = g.render
    this.lit = this.sunLit
    const L = this.lit
    // ground under the blast
    _n.set(0, 1, 0)
    const ground = this.ray(_o.copy(pos).setY(pos.y + 0.4), _d.set(0, -1, 0), 2)
    const gy = ground ? ground.point.y : pos.y - 0.1
    if (ground) {
      _n.copy(ground.normal)
      _g.copy(ground.point)
    }
    const onSand = !ground || ground.surface === 'sand' || ground.surface === 'dirt'

    // 1. very short white-orange flash (~0.1 s) — the punch, not the body of the blast
    s.reset().pos(pos)
    s.y += 0.5
    s.life = 0.07
    s.s0 = 3.2
    s.s1 = 2.2
    s.kind = KIND_STAR
    s.seed = Math.random()
    s.r0 = s.r1 = 2.2
    s.g0 = s.g1 = 1.5
    s.b0 = s.b1 = 0.8
    s.a0 = 1
    s.a1 = 0
    s.fadeIn = 0.01
    this.billboards.emit(s)
    s.reset().pos(pos)
    s.y += 0.6
    s.life = 0.12
    s.s0 = 2.2
    s.s1 = 3.2
    s.kind = KIND_GLOW
    s.add = 1
    s.r0 = 1.4
    s.g0 = 0.6
    s.b0 = 0.15
    s.r1 = 0.6
    s.g1 = 0.15
    s.b1 = 0.03
    s.a0 = 1
    s.a1 = 0
    s.fadeIn = 0.01
    this.billboards.emit(s)

    // 2. fireball — short-lived turbulent flame puffs that cool to soot
    for (let i = 0; i < 12; i++) {
      this.sprayDir(_t, _n, 1.3)
      const sp = rand(2, 6)
      s.reset().pos(pos)
      s.x += _t.x * 0.25
      s.y += 0.3 + _t.y * 0.25
      s.z += _t.z * 0.25
      s.vx = _t.x * sp
      s.vy = _t.y * sp * 0.7 + rand(0.8, 2.2)
      s.vz = _t.z * sp
      s.drag = 5
      s.grav = -1
      s.life = rand(0.28, 0.5)
      s.delay = rand(0, 0.03)
      s.s0 = rand(0.6, 1)
      s.s1 = rand(1.6, 2.4)
      s.rot = Math.random() * 6.28
      s.rv = rand(-1.5, 1.5)
      s.kind = KIND_FIRE
      s.frame = (Math.random() * 4) | 0
      s.heat0 = rand(1, 1.1)
      s.heat1 = 0
      s.r0 = s.g0 = s.b0 = 1
      s.r1 = s.g1 = s.b1 = 0.8
      s.a0 = 1
      s.a1 = 0.7
      s.fadeIn = 0.02
      this.billboards.emit(s)
    }

    // 3. dark smoke column, rising and drifting with the wind
    for (let i = 0; i < 14; i++) {
      this.sprayDir(_t, _n, 0.9)
      const sp = rand(1, 4)
      s.reset().pos(pos)
      s.y += rand(0.3, 1.2)
      s.vx = _t.x * sp + this.wind.x * 0.6
      s.vy = rand(1.2, 3.5)
      s.vz = _t.z * sp + this.wind.z * 0.6
      s.drag = 0.9
      s.grav = -0.25
      s.delay = rand(0.02, 0.2)
      s.life = rand(3.5, 6.5)
      s.s0 = rand(0.7, 1.1)
      s.s1 = rand(2.4, 3.8)
      s.rot = Math.random() * 6.28
      s.rv = rand(-0.25, 0.25)
      s.frame = (Math.random() * 4) | 0
      const k = rand(0.85, 1.15)
      s.r0 = 0.09 * L * k
      s.g0 = 0.075 * L * k
      s.b0 = 0.06 * L * k
      s.r1 = 0.24 * L
      s.g1 = 0.21 * L
      s.b1 = 0.18 * L
      s.a0 = rand(0.85, 0.95)
      s.a1 = 0
      s.fadeIn = 0.04
      this.billboards.emit(s)
    }

    // 4. dust ring shockwave hugging the ground
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rand(-0.1, 0.1)
      const sp = rand(7, 11)
      s.reset()
      s.x = pos.x + Math.cos(a) * 0.5
      s.y = gy + 0.35
      s.z = pos.z + Math.sin(a) * 0.5
      s.vx = Math.cos(a) * sp
      s.vy = rand(0.2, 0.8)
      s.vz = Math.sin(a) * sp
      s.drag = 3.2
      s.life = rand(1.6, 2.6)
      s.s0 = rand(0.6, 0.9)
      s.s1 = rand(2.6, 3.8)
      s.rot = Math.random() * 6.28
      s.rv = rand(-0.4, 0.4)
      s.frame = (Math.random() * 4) | 0
      if (onSand) this.sandColor(s, 0.9)
      else this.rgb(s, 0.5, 0.47, 0.42)
      s.a0 = 0.7
      s.a1 = 0
      s.fadeIn = 0.03
      this.billboards.emit(s)
    }
    // kicked-up sand/dirt plume
    for (let i = 0; i < 10; i++) {
      this.sprayDir(_t, _n, 0.5)
      const sp = rand(5, 12)
      s.reset().pos(pos)
      s.vx = _t.x * sp
      s.vy = _t.y * sp
      s.vz = _t.z * sp
      s.drag = 2.6
      s.grav = 2.5
      s.life = rand(1.4, 2.4)
      s.delay = rand(0, 0.08)
      s.s0 = rand(0.5, 0.8)
      s.s1 = rand(2, 3)
      s.rot = Math.random() * 6.28
      s.frame = (Math.random() * 4) | 0
      if (onSand) this.sandColor(s, 0.75)
      else this.rgb(s, 0.4, 0.37, 0.33)
      s.a0 = 0.85
      s.a1 = 0
      this.billboards.emit(s)
    }

    // 5. debris chunks (bounce) + clods
    for (let i = 0; i < 30; i++) {
      this.sprayDir(_t, _n, 1.1)
      const sp = rand(5, 15)
      s.reset().pos(pos)
      s.y += 0.2
      s.vx = _t.x * sp
      s.vy = Math.abs(_t.y) * sp + rand(1, 4)
      s.vz = _t.z * sp
      s.grav = 9.8
      s.drag = 0.3
      s.life = rand(1.2, 2.4)
      s.s0 = s.s1 = rand(0.025, 0.07)
      s.kind = KIND_DOT
      const k = rand(0.12, 0.3)
      this.rgb(s, k * 1.1, k, k * 0.85)
      s.a0 = 1
      s.a1 = 1
      s.fadeIn = 0.01
      s.collide = i < 12 ? 1 : 0
      s.bounce = 0.3
      this.billboards.emit(s)
    }
    // 6. sparks / burning fragments
    for (let i = 0; i < 36; i++) {
      this.sprayDir(_t, _n, 1.3)
      const sp = rand(8, 24)
      s.reset().pos(pos)
      s.y += 0.3
      s.vx = _t.x * sp
      s.vy = Math.abs(_t.y) * sp + rand(0, 3)
      s.vz = _t.z * sp
      s.grav = 9.8
      s.drag = 0.7
      s.life = rand(0.4, 1.2)
      s.trail = rand(0.025, 0.045)
      s.width = rand(0.012, 0.022)
      s.kind = STREAK_GLOW
      s.add = 1
      s.r0 = 10
      s.g0 = 5
      s.b0 = 1.6
      s.r1 = 3
      s.g1 = 0.8
      s.b1 = 0.15
      s.a0 = 1
      s.a1 = 0.2
      s.fadeIn = 0.01
      s.collide = i < 10 ? 1 : 0
      s.bounce = 0.35
      this.streaks.emit(s)
    }

    // 7. scorch decal
    if (ground) this.decals.add(_g, _n, pick(DECAL.scorch), rand(3.2, 4.2))

    // 8. light + camera response
    this.flashLight(_w.copy(pos).setY(pos.y + 1.2), 140, 0.25, 22, 0xff9040)
    const camPos = r.camera.position
    const d = camPos.distanceTo(pos)
    r.effects.shake = Math.min(1.5, r.effects.shake + Math.max(0, 1.25 - d / 22))
    // whiteout only up close and only with line of sight to the blast; falls off quadratically
    if (d < 6 && g.collision.lineOfSight(camPos, _w.copy(pos).setY(pos.y + 0.5))) {
      const k = 1 - d / 6
      r.effects.flash = Math.max(r.effects.flash, k * k * 0.45)
    }
  }
}
