// STUB — owned by the weapons/viewmodel agent. Keep the exported API exactly;
// the player controller and HUD code against it.
import type { Game } from '../core/game'
import type { Actor, InputState, Loadout, WeaponDef, WeaponId } from '../core/types'
import { WEAPONS } from './defs'

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
  private recoil = { pitch: 0, yaw: 0 }

  constructor(
    protected game: Game,
    protected owner: Actor,
  ) {}

  /** Reset weapons and ammo for a new life. */
  setLoadout(loadout: Loadout) {
    this.current = WEAPONS[loadout.primary]
  }

  /** Called every frame while the owner is alive. */
  update(dt: number, input: InputState, move: MovementState) {}

  /** Camera recoil (radians) accumulated since last call; the player adds it to pitch/yaw. Positive pitch = up. */
  consumeRecoil(): { pitch: number; yaw: number } {
    const r = { ...this.recoil }
    this.recoil.pitch = this.recoil.yaw = 0
    return r
  }

  getHudState(): HudWeaponState {
    return {
      weaponId: this.current.id, weaponName: this.current.name, ammo: this.current.magSize, reserve: this.current.reserve,
      magSize: this.current.magSize, frags: 1, reloading: false, otherWeaponName: '', fireMode: this.current.auto ? 'AUTO' : 'SEMI',
    }
  }

  /** Owner died — hide viewmodel, cancel actions, drop cooked grenade. */
  onDeath() {}

  /** Owner spawned — refill ammo, raise weapon animation. */
  onSpawn() {}
}
