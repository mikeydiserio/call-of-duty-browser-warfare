import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import { CONFIG } from '../core/config'
import type { Game } from '../core/game'
import type { Actor, ActorHit, AttachmentId, DamageInfo, HitZone, WeaponDef, WeaponId, WorldHit } from '../core/types'
import { attachmentFor, damageAt, weaponWithAttachment, WEAPONS, ZONE_MULTIPLIER } from '../weapons/defs'

const MAX_RANGE = 400
const _end = new Vector3()
const _eye = new Vector3()
const _toEye = new Vector3()
const _closest = new Vector3()

interface Grenade {
  owner: Actor | null
  position: Vector3
  velocity: Vector3
  fuse: number
  mesh: Mesh
  rest: boolean
  warned: boolean
}

/**
 * Authoritative combat: hitscan bullets (with thin-cover penetration),
 * damage/kill resolution, explosions, frag grenade physics, knife, health regen.
 */
export class Combat {
  private grenades: Grenade[] = []
  private grenadeGeo = new SphereGeometry(0.055, 10, 8)
  private grenadeMat = new MeshStandardMaterial({ color: 0x3b4230, roughness: 0.6, metalness: 0.3 })
  /** Recent damage dealt to each victim, for assists. */
  private damageLog = new Map<number, Map<number, number>>()

  constructor(private game: Game) {}

  /**
   * Fire one bullet (call once per pellet). `dir` must already include spread.
   * `tracerFrom` (e.g. the world-space muzzle) is where the tracer starts; defaults to `origin`.
   * Returns what was hit and where the bullet stopped, for weapon feedback.
   */
  fireBullet(
    shooter: Actor,
    weaponId: WeaponId,
    origin: Vector3,
    dir: Vector3,
    tracer = true,
    tracerFrom?: Vector3,
    attachment?: AttachmentId | null,
  ): { actor: Actor | null; world: WorldHit | null; point: Vector3 } {
    const equipped = attachment === undefined
      ? shooter.isPlayer ? attachmentFor(this.game.loadout, weaponId) : null
      : attachment
    this.game.net?.onShot(shooter, weaponId, origin, dir, equipped) // NET: clients forward fire requests to the host
    const def = weaponWithAttachment(weaponId, equipped)
    const explosive = def.class === 'launcher' || equipped === 'grenadeLauncher'
    const world = this.game.collision
    let remaining = explosive ? 90 : MAX_RANGE
    let start = origin.clone()
    let damageScale = 1
    let travelled = 0
    let worldHit: WorldHit | null = null
    let actorHit: { actor: Actor; hit: ActorHit } | null = null

    for (let layer = 0; layer < 2; layer++) {
      worldHit = world.raycast(start, dir, remaining)
      const maxD = worldHit ? worldHit.distance : remaining
      actorHit = this.raycastActors(shooter, start, dir, maxD)
      // Enemy air support / sentries in the way take the round instead.
      const ks = this.game.streaks.raycastEnts(shooter, start, dir, actorHit ? actorHit.hit.distance : maxD)
      if (ks) {
        const point = start.clone().addScaledVector(dir, ks.distance)
        if (tracer) this.game.events.emit('bullet:tracer', { from: tracerFrom ?? origin, to: point, shooter })
        this.game.events.emit('bullet:impact', { point, normal: dir.clone().negate(), surface: 'metal', shooter })
        this.game.streaks.damageEnt(ks.ent, damageAt(def, travelled + ks.distance) * damageScale * this.stoppingPower(shooter), shooter)
        shooter.stats.shotsHit++
        if (explosive && this.game.netRole !== 'client') {
          this.launcherExplosion(point, shooter, weaponId, weaponId === 'rpg7' ? 5 : 4.5, weaponId === 'rpg7' ? 115 : 95)
        }
        return { actor: null, world: null, point }
      }
      if (actorHit) break
      if (!worldHit) break
      this.game.events.emit('bullet:impact', { point: worldHit.point, normal: worldHit.normal, surface: worldHit.surface, shooter })
      // Thin-cover penetration: find the exit face within a short distance.
      const thickness = this.exitThickness(worldHit.point, dir, def.penetration * 0.45)
      const penetrable = worldHit.surface === 'wood' || worldHit.surface === 'metal' || worldHit.surface === 'glass'
      if (thickness === null || !penetrable || def.penetration < 0.3) break
      travelled += worldHit.distance + thickness
      remaining -= worldHit.distance + thickness
      start = worldHit.point.clone().addScaledVector(dir, thickness + 0.01)
      this.game.events.emit('bullet:impact', { point: start.clone(), normal: dir.clone(), surface: worldHit.surface, shooter })
      damageScale *= 0.55 * def.penetration + 0.2
      worldHit = null
    }

    const endPoint = actorHit
      ? actorHit.hit.point
      : worldHit
        ? worldHit.point
        : _end.copy(start).addScaledVector(dir, remaining).clone()
    if (tracer) this.game.events.emit('bullet:tracer', { from: tracerFrom ?? origin, to: endPoint, shooter })
    this.emitWhizz(shooter, origin, endPoint)

    if (actorHit && !explosive) {
      const dist = travelled + actorHit.hit.distance
      const base = damageAt(def, dist) * damageScale
      const zone = actorHit.hit.zone
      const mult = zone === 'head' ? def.headMultiplier : ZONE_MULTIPLIER[zone]
      this.applyDamage({
        victim: actorHit.actor,
        attacker: shooter,
        weaponId,
        amount: base * mult * this.stoppingPower(shooter),
        zone,
        direction: dir.clone(),
        point: actorHit.hit.point.clone(),
        explosive: false,
      })
      shooter.stats.shotsHit++
      this.game.events.emit('bullet:impact', { point: actorHit.hit.point, normal: dir.clone().negate(), surface: 'flesh', shooter })
    }
    if (actorHit && explosive) shooter.stats.shotsHit++
    if (explosive && this.game.netRole !== 'client') {
      this.launcherExplosion(endPoint, shooter, weaponId, weaponId === 'rpg7' ? 5 : 4.5, weaponId === 'rpg7' ? 115 : 95)
    }
    if (actorHit) return { actor: actorHit.actor, world: null, point: endPoint }
    return { actor: null, world: worldHit, point: endPoint }
  }

  /** Knife: short cone in front of attacker. Returns true if it connected. */
  melee(attacker: Actor, attachment: AttachmentId | null = null): boolean {
    this.game.net?.onMelee(attacker, attachment) // NET
    attacker.getEyePosition(_eye)
    const fwd = new Vector3(-Math.sin(attacker.yaw), 0, -Math.cos(attacker.yaw))
    let best: Actor | null = null
    let bestD = WEAPONS.knife.rangeClose + (attachment === 'tacticalKnife' ? 0.95 : 0.4)
    for (const a of this.game.actors) {
      if (!a.alive || !this.game.mode.isEnemy(attacker, a)) continue
      _toEye.subVectors(a.position, attacker.position)
      _toEye.y = 0
      const d = _toEye.length()
      if (d > bestD) continue
      if (d > 0.3 && _toEye.normalize().dot(fwd) < 0.55) continue
      a.getEyePosition(_closest)
      if (!this.game.collision.lineOfSight(_eye, _closest)) continue
      best = a
      bestD = d
    }
    if (best) {
      this.applyDamage({
        victim: best, attacker, weaponId: 'knife', amount: 200, zone: 'torso',
        direction: fwd, point: best.position.clone().setY(best.position.y + 1.2), explosive: false,
      })
    }
    this.game.events.emit('weapon:melee', { actor: attacker, hit: !!best })
    return !!best
  }

  /** Throw a frag. fuseRemaining lets players cook. */
  throwGrenade(owner: Actor, origin: Vector3, velocity: Vector3, fuseRemaining = 3.5) {
    const mesh = new Mesh(this.grenadeGeo, this.grenadeMat)
    mesh.castShadow = true
    mesh.position.copy(origin)
    this.game.render.scene.add(mesh)
    this.grenades.push({ owner, position: origin.clone(), velocity: velocity.clone(), fuse: fuseRemaining, mesh, rest: false, warned: false })
    this.game.events.emit('grenade:throw', { actor: owner })
    this.game.net?.onGrenade(owner, origin, velocity, fuseRemaining) // NET: replicate / request
  }

  /** Radial damage with line-of-sight occlusion. */
  explosion(position: Vector3, owner: Actor | null, weaponId: WeaponId = 'frag') {
    if (this.game.netRole === 'client') return // NET: the host resolves explosions
    const def = WEAPONS[weaponId]
    this.game.events.emit('grenade:explode', { position: position.clone(), owner })
    for (const a of this.game.actors) {
      if (!a.alive) continue
      // No team damage from explosions (self-damage still applies).
      if (owner && a !== owner && !this.game.mode.isEnemy(owner, a)) continue
      a.getEyePosition(_eye)
      const mid = _closest.copy(a.position).setY(a.position.y + 0.9)
      const d = Math.min(position.distanceTo(mid), position.distanceTo(_eye))
      if (d > def.rangeFar) continue
      const lifted = position.clone().setY(position.y + 0.15)
      if (!this.game.collision.lineOfSight(lifted, mid) && !this.game.collision.lineOfSight(lifted, _eye)) continue
      const dmg = d <= def.rangeClose ? def.damageClose : def.damageClose + (def.damageFar - def.damageClose) * ((d - def.rangeClose) / (def.rangeFar - def.rangeClose))
      this.applyDamage({
        victim: a, attacker: owner, weaponId, amount: dmg, zone: 'torso',
        direction: mid.clone().sub(position).normalize(), point: mid.clone(), explosive: true,
      })
    }
  }

  private launcherExplosion(position: Vector3, owner: Actor, weaponId: WeaponId, radius: number, damage: number) {
    this.game.events.emit('grenade:explode', { position: position.clone(), owner })
    for (const actor of this.game.actors) {
      if (!actor.alive || (actor !== owner && !this.game.mode.isEnemy(owner, actor))) continue
      actor.getEyePosition(_eye)
      const target = _closest.copy(actor.position).setY(actor.position.y + 0.9)
      const distance = Math.min(position.distanceTo(target), position.distanceTo(_eye))
      if (distance > radius) continue
      const blast = position.clone().setY(position.y + 0.15)
      if (!this.game.collision.lineOfSight(blast, target) && !this.game.collision.lineOfSight(blast, _eye)) continue
      this.applyDamage({
        victim: actor,
        attacker: owner,
        weaponId,
        amount: damage * (1 - 0.82 * distance / radius),
        zone: 'torso',
        direction: target.clone().sub(position).normalize(),
        point: target.clone(),
        explosive: true,
      })
    }
  }

  applyDamage(info: DamageInfo) {
    const v = info.victim
    if (!v.alive || info.amount <= 0) return
    if (this.game.netRole === 'client') return // NET: damage is host-authoritative
    if (this.game.mode.phase !== 'playing') return
    v.health -= info.amount
    v.timeSinceDamage = 0
    if (info.attacker && info.attacker !== v) {
      let log = this.damageLog.get(v.id)
      if (!log) this.damageLog.set(v.id, (log = new Map()))
      log.set(info.attacker.id, (log.get(info.attacker.id) ?? 0) + info.amount)
    }
    this.game.events.emit('actor:damaged', info)
    const killed = v.health <= 0
    if (info.attacker?.isPlayer && info.attacker !== v) {
      this.game.events.emit('player:hitmarker', { headshot: info.zone === 'head', kill: killed })
    }
    if (killed) this.kill(info)
  }

  private kill(info: DamageInfo) {
    const v = info.victim
    v.health = 0
    v.alive = false
    v.stats.deaths++
    v.stats.streak = 0
    const k = info.attacker
    const suicide = !k || k === v
    const headshot = info.zone === 'head' && !info.explosive
    if (!suicide && k && this.game.mode.isEnemy(k, v)) {
      k.stats.kills++
      k.stats.streak++
      if (headshot) k.stats.headshots++
      const pts = CONFIG.killPoints + (headshot ? CONFIG.headshotBonus : 0)
      k.stats.score += pts
      if (k.isPlayer) this.game.events.emit('player:points', { amount: pts, reason: headshot ? 'HEADSHOT' : '' })
    }
    // Assists: anyone else who dealt 30+ damage.
    const log = this.damageLog.get(v.id)
    if (log) {
      for (const [id, dmg] of log) {
        if (id === k?.id || dmg < 30) continue
        const a = this.game.actors.find((x) => x.id === id)
        if (a && this.game.mode.isEnemy(a, v)) {
          a.stats.assists++
          a.stats.score += CONFIG.assistPoints
          if (a.isPlayer) this.game.events.emit('player:points', { amount: CONFIG.assistPoints, reason: 'ASSIST' })
        }
      }
      this.damageLog.delete(v.id)
    }
    v.onKilled(info)
    this.game.events.emit('actor:killed', { ...info, headshot, streak: k?.stats.streak ?? 0 })
    this.game.mode.onKill(info, suicide)
  }

  update(dt: number) {
    // Health regeneration (MW2: none while recently hit, then fast refill).
    for (const a of this.game.actors) {
      if (!a.alive) continue
      a.timeSinceDamage += dt
      if (a.health < a.maxHealth && a.timeSinceDamage > CONFIG.regenDelay) {
        a.health = Math.min(a.maxHealth, a.health + CONFIG.regenRate * dt)
      }
    }
    this.updateGrenades(dt)
  }

  clearGrenades() {
    for (const g of this.grenades) g.mesh.removeFromParent()
    this.grenades = []
  }

  private updateGrenades(dt: number) {
    const world = this.game.collision
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]!
      g.fuse -= dt
      if (!g.warned && g.fuse < 2.5) {
        g.warned = true
        this.game.events.emit('grenade:warning', { position: g.position })
      }
      if (g.fuse <= 0) {
        g.mesh.removeFromParent()
        this.grenades.splice(i, 1)
        this.explosion(g.position.clone().setY(g.position.y + 0.1), g.owner)
        continue
      }
      if (g.rest) continue
      // Sub-stepped ballistic motion with bounces.
      const steps = 3
      const h = dt / steps
      for (let s = 0; s < steps; s++) {
        g.velocity.y -= CONFIG.gravity * h
        const speed = g.velocity.length()
        if (speed < 1e-4) continue
        const dir = _toEye.copy(g.velocity).divideScalar(speed)
        const travel = speed * h
        const hit = world.raycast(g.position, dir, travel + 0.06)
        if (hit) {
          g.position.copy(hit.point).addScaledVector(hit.normal, 0.06)
          const vn = hit.normal.clone().multiplyScalar(g.velocity.dot(hit.normal))
          const vt = g.velocity.clone().sub(vn)
          g.velocity.copy(vt.multiplyScalar(0.62)).sub(vn.multiplyScalar(0.38))
          if (speed > 2) this.game.events.emit('grenade:bounce', { position: g.position.clone(), surface: hit.surface })
          if (hit.normal.y > 0.7 && g.velocity.length() < 0.8) {
            g.rest = true
            g.velocity.set(0, 0, 0)
            break
          }
        } else {
          g.position.addScaledVector(dir, travel)
        }
      }
      g.mesh.position.copy(g.position)
      g.mesh.rotation.x += g.velocity.length() * dt * 2
      g.mesh.rotation.z += g.velocity.length() * dt * 1.3
    }
  }

  private stoppingPower(shooter: Actor): number {
    // NET: remote humans carry their own perks
    const perks = shooter.isPlayer ? this.game.loadout.perks : this.game.net?.perksOf(shooter)
    return perks?.includes('stoppingPower') ? 1.4 : 1
  }

  private raycastActors(shooter: Actor, origin: Vector3, dir: Vector3, maxD: number): { actor: Actor; hit: ActorHit } | null {
    let best: { actor: Actor; hit: ActorHit } | null = null
    let bestD = maxD
    for (const a of this.game.actors) {
      if (!a.alive || !this.game.mode.isEnemy(shooter, a)) continue
      const hit = a.raycast(origin, dir, bestD)
      if (hit && hit.distance < bestD) {
        bestD = hit.distance
        best = { actor: a, hit }
      }
    }
    return best
  }

  /** Distance to the exit face of the surface just hit, or null if thicker than maxThickness. */
  private exitThickness(point: Vector3, dir: Vector3, maxThickness: number): number | null {
    if (maxThickness <= 0.01) return null
    const inside = point.clone().addScaledVector(dir, 0.004)
    const hit = this.game.collision.raycast(inside, dir, maxThickness)
    return hit ? hit.distance : null
  }

  private emitWhizz(shooter: Actor, from: Vector3, to: Vector3) {
    for (const a of this.game.actors) {
      if (!a.isPlayer || !a.alive || !this.game.mode.isEnemy(shooter, a)) continue
      a.getEyePosition(_eye)
      // Closest point on the bullet segment to the listener's head.
      const seg = _toEye.subVectors(to, from)
      const len = seg.length()
      if (len < 0.5) continue
      seg.divideScalar(len)
      const t = Math.max(0, Math.min(len, _closest.subVectors(_eye, from).dot(seg)))
      const p = _closest.copy(from).addScaledVector(seg, t)
      const d = p.distanceTo(_eye)
      if (d < 2.2 && d > 0.25 && t > 3) this.game.events.emit('bullet:whizz', { actor: a, point: p.clone(), shooter })
    }
  }
}

export type { HitZone }
