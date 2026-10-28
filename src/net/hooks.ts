import type { Vector3 } from 'three'
import type { Actor, AttachmentId, PerkId, WeaponId } from '../core/types'
import type { KillstreakId } from '../game/killstreaks/defs'

/**
 * What core/combat call into while an online match is running (`game.net`, null offline).
 * Every call site is marked with a `// NET:` comment.
 */
export interface NetHooks {
  /** startMatch: the actor list for this peer (host adds remote humans, clients mirror the host). */
  matchActors(bots: Actor[]): Actor[]
  /** Every frame, after the simulation step (real dt; also runs in menus). */
  update(dt: number): void
  /** Combat is about to resolve a bullet (client: forwarded to the host as a fire request). */
  onShot(shooter: Actor, weaponId: WeaponId, origin: Vector3, dir: Vector3, attachment: AttachmentId | null): void
  /** A frag was thrown (host: replicated to clients; client: own throws become requests). */
  onGrenade(owner: Actor, origin: Vector3, velocity: Vector3, fuse: number): void
  /** Knife swing (client: forwarded to the host). */
  onMelee(attacker: Actor, attachment: AttachmentId | null): void
  /** Perks of a non-local actor (remote humans), or null. */
  perksOf(actor: Actor): PerkId[] | null
  /** Killstreak set of a non-local actor (remote humans), or null. */
  killstreaksOf?(actor: Actor): KillstreakId[] | null
  /** Client: ask the host to call in a held reward (target / heading from the map picker or sentry placement). */
  onKillstreak?(id: KillstreakId, target?: [number, number, number], heading?: number): void
  /** Client: ask the host for up to `want` rounds from dropped gun `id`. */
  onScavenge?(id: number, want: number): void
}
