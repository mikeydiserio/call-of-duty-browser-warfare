import { type Object3D, Quaternion, Vector3 } from 'three'
import { CONFIG } from '../core/config'
import type { GameEvents } from '../core/events'
import type { Game } from '../core/game'
import type { Actor, DamageInfo, WeaponId } from '../core/types'
import { RemotePlayer } from '../net/remote-player'
import { WEAPONS } from '../weapons/defs'
import { createWorldWeaponModel } from '../weapons/world-models'

/** Seconds a dropped gun stays on the ground before sinking away. */
const LIFETIME = 75
const SINK_TIME = 1.2
/** Oldest drops are removed past this count. */
const MAX_DROPS = 24
/** Walk-over pickup radius (horizontal) and height tolerance, metres. */
const PICKUP_R = 1.25
const PICKUP_DY = 1.6
/** Host-side slack on a client's claim (its position lags the host's copy). */
const CLAIM_SLACK = 1.5
/** Client: seconds between repeat claims on the same drop while waiting for the host. */
const CLAIM_RETRY = 0.6

interface Drop {
  id: number
  model: Object3D
  weaponId: WeaponId
  /** Rounds left to scavenge (magazine + reserve the soldier died with). */
  rounds: number
  vel: Vector3
  spin: Vector3
  rest: boolean
  t: number
  /** Client: game time of the last claim sent to the host. */
  askedAt: number
}

const _dir = new Vector3()
const _still = new Vector3()
const _pos = new Vector3()
const _vel = new Vector3()
const _quat = new Quaternion()
const _up = new Vector3(0, 1, 0)

/**
 * Guns dropped by dead soldiers. They tumble to the ground and stay there;
 * players walk over one to take ammo for any carried weapon of the same class.
 *
 * Host-authoritative online: the host creates drops and owns their round
 * counts. Clients mirror them from `drop:spawn` / `drop:rounds` (relayed by
 * the net layer) and ask the host for ammo; the host's grant arrives as a
 * `player:scavenge` event.
 */
export class WeaponDrops {
  private list: Drop[] = []
  private nextId = 1

  constructor(private game: Game) {
    // S&D: a fresh round starts with a clean map.
    game.events.on('round:phase', ({ phase }) => {
      if (phase === 'start') this.clear()
    })
    // NET: clients mirror the host's drops (the host ignores its own events).
    game.events.on('drop:spawn', (d) => {
      if (game.netRole === 'client') this.mirror(d)
    })
    game.events.on('drop:rounds', ({ id, rounds }) => {
      if (game.netRole !== 'client') return
      const d = this.find(id)
      if (d) d.rounds = rounds
    })
    // Humans drop the gun in hand too (bots drop their own in Bot.onKilled).
    game.events.on('actor:killed', (info) => {
      if (game.netRole !== 'client') this.dropHuman(info)
    })
  }

  /** Host/offline: the local player or a remote human died — drop their held gun. */
  private dropHuman(info: DamageInfo) {
    const v = info.victim
    let weaponId: WeaponId
    let rounds: number
    if (v === this.game.player) {
      ;({ weaponId, rounds } = this.game.player.weapons.heldRounds())
      // First person has no body: start from just below and in front of the eyes.
      v.getEyePosition(_pos)
      _pos.y -= 0.4
      _pos.x -= Math.sin(v.yaw) * 0.3
      _pos.z -= Math.cos(v.yaw) * 0.3
      _quat.setFromAxisAngle(_up, v.yaw)
    } else if (v instanceof RemotePlayer) {
      weaponId = v.weaponId
      // Owner's last report; full ammo if it never reported (died right after spawning).
      const def = WEAPONS[weaponId]
      rounds = v.heldWeapon === weaponId && v.heldRounds >= 0 ? v.heldRounds : def.magSize + def.reserve
      if (!v.heldGunTransform(_pos, _quat)) return
    } else return
    const cls = WEAPONS[weaponId].class
    if (cls === 'grenade' || cls === 'melee') return
    const model = createWorldWeaponModel(weaponId)
    model.traverse((o) => {
      o.castShadow = true
    })
    model.position.copy(_pos)
    model.quaternion.copy(_quat)
    _vel.copy(v.velocity).multiplyScalar(0.6).addScaledVector(info.direction, 1.2)
    _vel.y += 1.2
    this.drop(model, weaponId, rounds, _vel)
  }

  /** Host/offline: take ownership of `model` (already at its world transform) and let it fall. */
  drop(model: Object3D, weaponId: WeaponId, rounds: number, velocity: Vector3) {
    const d = this.add(this.nextId++, model, weaponId, rounds, velocity, 0)
    this.game.events.emit('drop:spawn', { id: d.id, weaponId, position: model.position, velocity: d.vel, rounds, age: 0 })
  }

  /** Host: replay the current drops to a client that joined mid-match. */
  forEachLive(fn: (e: GameEvents['drop:spawn']) => void) {
    for (const d of this.list) {
      if (d.t <= LIFETIME) fn({ id: d.id, weaponId: d.weaponId, position: d.model.position, velocity: d.rest ? _still : d.vel, rounds: d.rounds, age: d.t })
    }
  }

  /**
   * Host: a client asks for up to `want` rounds from drop `id`. Validates reach
   * against the host's copy of the actor; returns the rounds granted.
   */
  claim(id: number, actor: Actor, want: number): { weaponId: WeaponId; rounds: number } | null {
    const d = this.find(id)
    if (!d || d.rounds <= 0 || d.t > LIFETIME || !actor.alive) return null
    if (!this.inReach(d, actor.position, CLAIM_SLACK)) return null
    const rounds = Math.min(d.rounds, Math.max(0, Math.floor(want)))
    if (rounds <= 0) return null
    this.take(d, rounds)
    return { weaponId: d.weaponId, rounds }
  }

  update(dt: number) {
    const g = this.game
    const player = g.player
    const client = g.netRole === 'client'
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i]!
      d.t += dt
      if (!d.rest) this.fall(d, dt)
      if (d.t > LIFETIME) {
        d.model.position.y -= dt * 0.08
        if (d.t > LIFETIME + SINK_TIME) {
          d.model.removeFromParent()
          this.list.splice(i, 1)
        }
        continue
      }
      if (d.rounds <= 0 || !player.alive || !this.inReach(d, player.position, 0)) continue
      if (client) {
        // NET: ask the host; the grant comes back as player:scavenge.
        const want = player.weapons.scavengeRoom(d.weaponId)
        if (want > 0 && g.time - d.askedAt > CLAIM_RETRY) {
          d.askedAt = g.time
          g.net?.onScavenge?.(d.id, want)
        }
        continue
      }
      const taken = player.weapons.scavenge(d.weaponId, d.rounds)
      if (taken > 0) {
        this.take(d, taken)
        g.events.emit('player:scavenge', { weaponId: d.weaponId, rounds: taken })
      }
    }
  }

  clear() {
    for (const d of this.list) d.model.removeFromParent()
    this.list = []
  }

  private add(id: number, model: Object3D, weaponId: WeaponId, rounds: number, velocity: Vector3, age: number): Drop {
    this.game.render.scene.attach(model)
    model.visible = true
    const d: Drop = {
      id,
      model,
      weaponId,
      rounds,
      vel: velocity.clone(),
      spin: new Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6),
      rest: false,
      t: age,
      askedAt: -99,
    }
    this.list.push(d)
    while (this.list.length > MAX_DROPS) this.list.shift()!.model.removeFromParent()
    return d
  }

  /** Client: build a local copy of a host drop and simulate its fall. */
  private mirror(e: GameEvents['drop:spawn']) {
    if (this.find(e.id)) return
    const model = createWorldWeaponModel(e.weaponId)
    model.traverse((o) => {
      o.castShadow = true
    })
    model.position.copy(e.position)
    this.add(e.id, model, e.weaponId, e.rounds, e.velocity, e.age)
  }

  private take(d: Drop, rounds: number) {
    d.rounds -= rounds
    this.game.events.emit('drop:rounds', { id: d.id, rounds: d.rounds })
  }

  private find(id: number): Drop | undefined {
    return this.list.find((d) => d.id === id)
  }

  private inReach(d: Drop, p: Vector3, slack: number): boolean {
    const m = d.model.position
    const dx = m.x - p.x
    const dz = m.z - p.z
    const r = PICKUP_R + slack
    return dx * dx + dz * dz < r * r && Math.abs(m.y - p.y) < PICKUP_DY + slack
  }

  private fall(d: Drop, dt: number) {
    const g = d.model
    d.vel.y -= CONFIG.gravity * dt
    const sp = d.vel.length()
    if (sp < 1e-4) return
    _dir.copy(d.vel).divideScalar(sp)
    const hit = this.game.collision.raycast(g.position, _dir, sp * dt + 0.05)
    if (hit) {
      g.position.copy(hit.point).addScaledVector(hit.normal, 0.04)
      if (sp < 2.5 || hit.normal.y > 0.7) {
        d.rest = true
        // Lie flat on its side.
        g.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2, 'YXZ')
      } else {
        d.vel.reflect(hit.normal).multiplyScalar(0.3)
      }
    } else if (g.position.y < -50) {
      d.rest = true // fell out of the world
    } else {
      g.position.addScaledVector(d.vel, dt)
      g.rotation.x += d.spin.x * dt
      g.rotation.y += d.spin.y * dt
      g.rotation.z += d.spin.z * dt
    }
  }
}
