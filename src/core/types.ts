/**
 * Shared contracts between every subsystem. Owned by core — subsystem modules
 * import from here but never edit it. If a subsystem needs a new shared field,
 * keep it local and report it to the integrator.
 */
import type { Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'

// ─── Teams & actors ─────────────────────────────────────────────────────────

/** MW2 Rust: Task Force 141 vs OpFor militia. */
export type Team = 'tf141' | 'opfor'

export const TEAM_NAMES: Record<Team, string> = { tf141: 'Task Force 141', opfor: 'OpFor' }
export const otherTeam = (t: Team): Team => (t === 'tf141' ? 'opfor' : 'tf141')

export type HitZone = 'head' | 'torso' | 'arms' | 'legs'

export interface ActorHit {
  distance: number
  point: Vector3
  zone: HitZone
}

export interface ActorStats {
  kills: number
  deaths: number
  assists: number
  score: number
  streak: number
  shotsFired: number
  shotsHit: number
  headshots: number
}

/** Anything that can move, shoot and be shot: the local player and every bot. */
export interface Actor {
  readonly id: number
  readonly name: string
  readonly team: Team
  readonly isPlayer: boolean
  alive: boolean
  health: number
  readonly maxHealth: number
  /** Feet position (world). */
  readonly position: Vector3
  readonly velocity: Vector3
  /** Radians. yaw 0 looks down -Z, positive yaw turns left (three.js YXZ camera convention). */
  yaw: number
  pitch: number
  /** 0 standing, 1 crouched, 2 prone — affects eye height and hitboxes. */
  stance: 0 | 1 | 2
  stats: ActorStats
  /** Seconds since last damage taken (health regen, MW2 style). */
  timeSinceDamage: number
  /** World-space eye position. */
  getEyePosition(out: Vector3): Vector3
  /** Ray vs this actor's hitboxes. Return null if missed. dir must be normalised. */
  raycast(origin: Vector3, dir: Vector3, maxDistance: number): ActorHit | null
  /** Called by combat when the actor dies (start ragdoll / death anim, hide viewmodel...). */
  onKilled(info: DamageInfo): void
  /** Called by the game mode to (re)spawn. */
  spawn(position: Vector3, yaw: number): void
  /** Currently equipped weapon id (for killfeed icons etc.). */
  readonly weaponId: WeaponId
}

// ─── Weapons & damage ───────────────────────────────────────────────────────

export type WeaponId =
  | 'acr'
  | 'm4a1'
  | 'ak47'
  | 'ump45'
  | 'intervention'
  | 'spas12'
  | 'usp45'
  | 'deagle'
  | 'frag'
  | 'knife'

export type WeaponClass = 'assault' | 'smg' | 'sniper' | 'shotgun' | 'pistol' | 'grenade' | 'melee'

export interface WeaponDef {
  id: WeaponId
  name: string
  class: WeaponClass
  /** 'primary' | 'secondary' slot. */
  slot: 'primary' | 'secondary' | 'equipment' | 'melee'
  auto: boolean
  /** Rounds per minute. */
  rpm: number
  magSize: number
  reserve: number
  /** Seconds. Tactical (mag not empty) and empty reloads. */
  reloadTime: number
  reloadEmptyTime: number
  /** Damage at close range and at/after maxRange (linear falloff between). */
  damageClose: number
  damageFar: number
  rangeClose: number
  rangeFar: number
  headMultiplier: number
  /** Pellets per shot (shotguns). */
  pellets: number
  /** Spread in degrees: hipfire base / max, ADS. */
  hipSpread: number
  hipSpreadMax: number
  adsSpread: number
  /** Recoil kick per shot in degrees (vertical, horizontal random range). */
  recoilV: number
  recoilH: number
  /** Seconds to aim down sights. */
  adsTime: number
  /** Camera FOV multiplier while ADS (e.g. 0.75; sniper ~0.25). */
  adsZoom: number
  /** Movement speed multiplier while holding. */
  mobility: number
  /** Penetration power 0..1 (thin cover). */
  penetration: number
}

export interface DamageInfo {
  victim: Actor
  attacker: Actor | null
  weaponId: WeaponId
  amount: number
  zone: HitZone
  /** Direction the damage travelled (from attacker to victim). */
  direction: Vector3
  point: Vector3
  explosive: boolean
}

// ─── World ──────────────────────────────────────────────────────────────────

export type Surface = 'sand' | 'dirt' | 'concrete' | 'metal' | 'wood' | 'glass' | 'flesh' | 'water'

export interface WorldHit {
  point: Vector3
  normal: Vector3
  distance: number
  surface: Surface
}

export interface Ladder {
  /** Bottom centre at ground, top centre at top of the climb (where the player steps off). */
  bottom: Vector3
  top: Vector3
  /** Horizontal unit vector pointing from the ladder towards the climber (out of the wall). */
  normal: Vector3
  width: number
}

export type NavLinkType = 'walk' | 'jump' | 'ladder' | 'drop'

export interface NavNode {
  id: number
  position: Vector3
  /** Cover / interest weighting for bots (0 open, 1 good cover). */
  cover: number
  links: { to: number; type: NavLinkType }[]
}

export interface Callout {
  name: string
  center: Vector3
  radius: number
}

export interface SpawnPoint {
  /**
   * Team base / 'any'. In Search & Destroy the labels mean sides, not teams:
   * 'tf141' spawns are the ATTACKING side (near bombSpawn), 'opfor' the DEFENDING side (near bombSites).
   */
  team: Team | 'any'
  position: Vector3
  yaw: number
  /** Restrict this spawn to these game modes (omit = every mode). */
  modes?: GameModeId[]
}

export interface Environment {
  sunDirection: Vector3 // normalised, pointing FROM the sun towards the scene
  sunColor: number
  sunIntensity: number
  skyZenith: number
  skyHorizon: number
  groundColor: number
  fogColor: number
  fogDensity: number
  exposure: number
  /** Dust / haze amount 0..1 for post FX. */
  haze: number
}

export interface MapData {
  id: string
  displayName: string
  location: string
  /** Root visual object (already added to scene by the map builder). */
  root: Object3D
  /** Playable XZ bounds; actors are clamped inside. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  spawns: SpawnPoint[]
  ladders: Ladder[]
  nav: NavNode[]
  callouts: Callout[]
  environment: Environment
  /** Top-down minimap image covering [bounds]. */
  minimap: HTMLCanvasElement
  /** Cinematic menu camera path (positions + look targets), looped. */
  menuCameraPath: { position: Vector3; target: Vector3 }[]
  /** Domination flags A/B/C (empty if the map has none yet). */
  domFlags: ObjectivePoint[]
  /** Search & Destroy bomb sites A/B, defended by `sdDefenders` (empty if none yet). */
  bombSites: ObjectivePoint[]
  /** Where the attackers' bomb starts in S&D (near the attackers' base spawns). */
  bombSpawn: Vector3 | null
}

// ─── Game modes / lobby ─────────────────────────────────────────────────────

export type GameModeId = 'tdm' | 'ffa' | 'dom' | 'sd'

export const GAME_MODE_NAMES: Record<GameModeId, string> = {
  tdm: 'Team Deathmatch',
  ffa: 'Free-for-All',
  dom: 'Domination',
  sd: 'Search & Destroy',
}

export type ObjectiveId = 'A' | 'B' | 'C'

/** A capture point (Domination flag) or bomb site placed by the map. */
export interface ObjectivePoint {
  id: ObjectiveId
  position: Vector3
  radius: number
}

/** Live Domination flag state, owned by the game mode. */
export interface ObjectiveState extends ObjectivePoint {
  owner: Team | null
  /** Team currently capturing (null if nobody or contested). */
  capturingTeam: Team | null
  /** Capture progress 0..1 towards capturingTeam. */
  progress: number
  contested: boolean
  /** Team the current `progress` belongs to (kept while contested/decaying; capturingTeam is null then). */
  progressTeam: Team | null
}

/** Live Search & Destroy bomb state, owned by the game mode. */
export interface BombState {
  attackers: Team
  carrier: Actor | null
  /** World position when dropped/planted (feet of the carrier otherwise). */
  position: Vector3
  planted: boolean
  site: ObjectiveId | null
  /** Seconds until detonation once planted. */
  fuseLeft: number
  /** 0..1 progress of an in-progress plant or defuse (0 when idle). */
  plantProgress: number
  defuseProgress: number
  /** Net-friendly mirrors of the actors involved (actor ids, null when none). */
  carrierId: number | null
  plantingId: number | null
  defusingId: number | null
}

/** Lobby / custom-game settings for one match. */
export interface MatchSettings {
  mode: GameModeId
  mapId: string
  /** Total bots added to fill the lobby (split across teams in team modes). */
  botCount: number
  /** 0..1 bot skill. */
  botDifficulty: number
  /** Kills (tdm/ffa), points (dom) or round wins (sd) to win. */
  scoreLimit: number
  /** Seconds per match (tdm/ffa/dom) or per round (sd). */
  timeLimit: number
}

export type NetRole = 'offline' | 'host' | 'client'

// ─── Input ──────────────────────────────────────────────────────────────────

export interface InputState {
  moveX: number // -1..1 strafe (right positive)
  moveY: number // -1..1 forward positive
  lookDX: number // mouse pixels this frame (already * sensitivity)
  lookDY: number
  fire: boolean
  firePressed: boolean
  ads: boolean
  jumpPressed: boolean
  sprint: boolean
  crouchPressed: boolean
  pronePressed: boolean
  reloadPressed: boolean
  switchPressed: boolean // Y / mouse wheel
  slot1Pressed: boolean
  slot2Pressed: boolean
  fragPressed: boolean // G
  fragHeld: boolean
  meleePressed: boolean // V / E
  usePressed: boolean // F
  /** F held this frame (plant/defuse). Optional so synthetic input states need not set it. */
  useHeld?: boolean
  scoreboard: boolean // Tab held
  pausePressed: boolean // Esc / P
  killstreakPressed: boolean // 4
}

// ─── Renderer contract (render/) ────────────────────────────────────────────

export interface RenderContext {
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  /** Main world camera (player eyes / menu cam). */
  readonly camera: PerspectiveCamera
  /** First-person weapon scene, rendered on top with cleared depth. */
  readonly viewmodelScene: Scene
  readonly viewmodelCamera: PerspectiveCamera
}

// ─── Loadout ────────────────────────────────────────────────────────────────

export type PerkId = 'marathon' | 'sleightOfHand' | 'stoppingPower' | 'lightweight' | 'commando' | 'steadyAim'

export interface Loadout {
  primary: WeaponId
  secondary: WeaponId
  perks: PerkId[]
}
