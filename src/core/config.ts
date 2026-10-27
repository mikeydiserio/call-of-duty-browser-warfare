/** Match & feel tunables. MW2 TDM: 6v6, 7500 points (75 kills), 10 minutes. */
export const CONFIG = {
  teamSize: 6,
  scoreLimit: 75,
  timeLimit: 600,
  respawnDelay: 4.5,
  /** MW2: health 100, regen starts after 5s, full in ~1.5s afterwards. */
  maxHealth: 100,
  regenDelay: 5,
  regenRate: 60,
  killPoints: 100,
  headshotBonus: 50,
  assistPoints: 20,
  uavStreak: 3,
  airstrikeStreak: 7,
  uavDuration: 30,
  /** Player movement (m/s). */
  walkSpeed: 5.2,
  sprintSpeed: 7.8,
  crouchSpeed: 2.6,
  proneSpeed: 1.1,
  adsSpeedMul: 0.55,
  jumpVelocity: 4.6,
  gravity: 19,
  eyeHeight: [1.62, 1.05, 0.35] as const,
  capsuleRadius: 0.32,
  capsuleHeight: [1.8, 1.2, 0.5] as const,
  defaultFov: 80,
  sensitivity: 1,
}

export type Config = typeof CONFIG
