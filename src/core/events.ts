import type { Vector3 } from 'three'
import type { Actor, DamageInfo, GameModeId, ObjectiveId, Surface, Team, WeaponId } from './types'

/** Every cross-system notification. Payload vectors are owned by the emitter — clone if you keep them. */
export interface GameEvents {
  /** A weapon discharged (player or bot). origin = muzzle in world space. */
  'weapon:fire': { shooter: Actor; weaponId: WeaponId; origin: Vector3; direction: Vector3; suppressed: boolean }
  'weapon:dryfire': { shooter: Actor; weaponId: WeaponId }
  'weapon:reload': { actor: Actor; weaponId: WeaponId; stage: 'start' | 'magout' | 'magin' | 'boltback' | 'boltforward' | 'end' }
  'weapon:switch': { actor: Actor; weaponId: WeaponId }
  'weapon:ads': { actor: Actor; on: boolean }
  'weapon:melee': { actor: Actor; hit: boolean }
  'bullet:tracer': { from: Vector3; to: Vector3; shooter: Actor }
  'bullet:impact': { point: Vector3; normal: Vector3; surface: Surface; shooter: Actor | null }
  /** A bullet passed close to an actor without hitting (supersonic crack / suppression). */
  'bullet:whizz': { actor: Actor; point: Vector3; shooter: Actor }
  'actor:damaged': DamageInfo
  'actor:killed': DamageInfo & { headshot: boolean; streak: number }
  'actor:spawned': { actor: Actor }
  'actor:footstep': { actor: Actor; surface: Surface; position: Vector3; intensity: number }
  'actor:jump': { actor: Actor }
  'actor:land': { actor: Actor; surface: Surface; impact: number }
  /** Local player landed a hit — hitmarker. */
  'player:hitmarker': { headshot: boolean; kill: boolean }
  'grenade:throw': { actor: Actor }
  'grenade:bounce': { position: Vector3; surface: Surface }
  'grenade:explode': { position: Vector3; owner: Actor | null }
  'grenade:warning': { position: Vector3 }
  'score:changed': { tf141: number; opfor: number }
  /** Points popup ("+100") for the local player. */
  'player:points': { amount: number; reason: string }
  'killstreak:earned': { actor: Actor; streak: 'uav' | 'airstrike' }
  'killstreak:used': { actor: Actor; streak: 'uav' | 'airstrike'; team: Team }
  'uav:changed': { team: Team; active: boolean; until: number }
  'match:phase': { phase: MatchPhase; winner?: Team | 'draw' }
  'match:announce': { text: string; sub?: string; voice?: string }
  'ui:menu': { open: boolean }
  // ── Objective modes ──
  /** Domination flag state changed (owner, capture progress, contested). Read live state from game.mode.objectives. */
  'objective:state': { id: ObjectiveId }
  'objective:captured': { id: ObjectiveId; team: Team; by: Actor[] }
  'bomb:pickup': { actor: Actor }
  'bomb:dropped': { position: Vector3 }
  'bomb:planted': { actor: Actor; site: ObjectiveId; position: Vector3 }
  'bomb:defused': { actor: Actor; site: ObjectiveId }
  'bomb:exploded': { site: ObjectiveId; position: Vector3 }
  /** Round-based modes (S&D). */
  'round:phase': { round: number; phase: 'start' | 'end'; winner?: Team | 'draw'; attackers: Team }
  // ── Lobby / network ──
  'lobby:changed': { mode: GameModeId }
  'net:status': { role: 'offline' | 'host' | 'client'; connected: boolean; message?: string }
}

export type MatchPhase = 'menu' | 'loading' | 'intro' | 'playing' | 'ended'

type Handler<T> = (payload: T) => void

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>()

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(fn as Handler<never>)
    return () => set.delete(fn as Handler<never>)
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type)
    if (!set) return
    for (const fn of set) (fn as Handler<GameEvents[K]>)(payload)
  }
}
