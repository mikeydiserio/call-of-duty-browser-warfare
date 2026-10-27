import { Vector3, type Material, type Mesh } from 'three'
import { BotManager } from '../ai/bots'
import { AudioEngine } from '../audio/audio'
import { Combat } from '../game/combat'
import { GameMode } from '../game/mode'
import { Player } from '../player/player'
import { Effects } from '../render/fx/effects'
import { GameRenderer } from '../render/renderer'
import { UI } from '../ui/ui'
import { CollisionWorld } from '../world/collision'
import { buildMap, getMapOption } from '../world/maps'
import { createLobby, type NetHooks } from '../net'
import type { LobbyService } from '../net/lobby'
import { CONFIG } from './config'
import { EventBus } from './events'
import { Input } from './input'
import { damp } from './math'
import type { Actor, Loadout, MapData, MatchSettings, NetRole, Team } from './types'
import { otherTeam } from './types'

export interface Settings {
  sensitivity: number
  fov: number
  invertY: boolean
  masterVolume: number
  musicVolume: number
  quality: 'low' | 'medium' | 'high'
  /** Fullscreen + keyboard lock during play, so Ctrl+W (crouch-walk) can't close the tab. */
  fullscreen: boolean
}

const SETTINGS_KEY = 'mw-rust-settings'
const LOADOUT_KEY = 'mw-rust-loadout'

/**
 * Top-level orchestrator. Owns every subsystem and the frame loop. Subsystems
 * receive the Game and talk to each other through `events` or the public fields.
 */
export class Game {
  readonly events = new EventBus()
  readonly input: Input
  readonly render: GameRenderer
  readonly collision = new CollisionWorld()
  map: MapData
  readonly combat: Combat
  readonly mode: GameMode
  readonly player: Player
  readonly bots: BotManager
  readonly fx: Effects
  readonly audio: AudioEngine
  readonly ui: UI
  /** Lobby / matchmaking (offline until the net layer swaps in the online implementation). */
  lobby: LobbyService
  actors: Actor[] = []
  settings: Settings
  loadout: Loadout
  /** Lobby settings for the current/next match (mode, bots, limits). */
  match: MatchSettings = defaultMatch('tdm')
  /** Network role; 'offline' for solo vs bots. Set by the net layer (src/net). */
  netRole: NetRole = 'offline'
  /** NET: online match hooks (src/net), null when offline. */
  net: NetHooks | null = null
  /** Gameplay clock (seconds), frozen while paused. */
  time = 0
  paused = false
  /** Real-time clock for menus/UI animation. */
  realTime = 0
  private last = performance.now()
  private menuCamT = 0
  private endTimer = 0
  private fpsAccum = 0
  private fpsFrames = 0
  fps = 60
  /** Dev aid: stop the menu fly-through so a camera can be posed from devtools (window.game). */
  freezeMenuCamera = false

  constructor(container: HTMLElement, uiRoot: HTMLElement) {
    this.settings = loadJSON<Settings>(SETTINGS_KEY, {
      sensitivity: CONFIG.sensitivity,
      fov: CONFIG.defaultFov,
      invertY: false,
      masterVolume: 0.8,
      musicVolume: 0.5,
      quality: 'high',
      fullscreen: true,
    })
    this.loadout = loadJSON<Loadout>(LOADOUT_KEY, { primary: 'acr', secondary: 'usp45', perks: ['sleightOfHand', 'stoppingPower', 'commando'] })

    this.render = new GameRenderer(container)
    this.input = new Input(this.render.renderer.domElement)
    this.map = buildMap('rust', this.render.scene, this.collision)
    if (!this.collision.bvh) this.collision.build()
    this.render.setEnvironment(this.map.environment)

    this.combat = new Combat(this)
    this.mode = new GameMode(this)
    this.player = new Player(this)
    this.bots = new BotManager(this)
    this.fx = new Effects(this)
    this.audio = new AudioEngine(this)
    this.lobby = createLobby(this) // NET: OnlineLobby when configured, else OfflineLobby
    this.ui = new UI(this, uiRoot)

    this.applySettings()
    this.input.setUnlockHandler(() => {
      if (this.mode.phase === 'playing' || this.mode.phase === 'intro') this.pause()
    })
    this.events.on('match:phase', ({ phase }) => {
      if (phase === 'ended') this.endTimer = 0
    })
    window.addEventListener('resize', () => this.render.resize())
    // Fallback for browsers without Keyboard Lock (and windowed play): confirm before a
    // stray Ctrl+W closes the tab mid-match.
    window.addEventListener('beforeunload', (e) => {
      if (this.mode.phase === 'menu') return
      e.preventDefault()
      e.returnValue = ''
    })
    this.mode.setPhase('menu')
  }

  start() {
    requestAnimationFrame(this.frame)
  }

  /** Called by the UI when the player hits "Start match". Must be inside a user gesture. */
  startMatch(loadout: Loadout, match: MatchSettings = this.match) {
    const mapId = getMapOption(match.mapId).id
    if (mapId !== match.mapId) match = { ...match, mapId }
    this.loadout = loadout
    this.match = match
    saveJSON(LOADOUT_KEY, loadout)
    this.audio.unlock()
    this.combat.clearGrenades()
    this.bots.clear()
    this.setMap(match.mapId)
    this.player.setLoadout(loadout)
    this.mode.id = match.mode
    this.bots.difficulty = match.botDifficulty
    // NET: clients mirror the host's actors instead of simulating bots
    const bots = this.netRole === 'client' ? [] : this.createBots(match)
    this.actors = this.net ? this.net.matchActors(bots) : [this.player, ...bots]
    this.time = 0
    this.paused = false
    this.mode.begin()
    this.input.enabled = true
    this.input.lock()
  }

  /** Replace the current map and its collision world. Safe to call while in a menu. */
  setMap(mapId: string): MapData {
    const selected = getMapOption(mapId)
    if (this.map.id === selected.id) return this.map

    const oldRoot = this.map.root
    this.render.scene.remove(oldRoot)
    const materials = new Set<Material>()
    oldRoot.traverse((object) => {
      const drawable = object as Mesh
      if (!drawable.isMesh) return
      drawable.geometry.dispose()
      for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) materials.add(material)
    })
    for (const material of materials) material.dispose()

    this.collision.clear()
    this.map = buildMap(selected.id, this.render.scene, this.collision)
    this.render.setEnvironment(this.map.environment)
    this.menuCamT = 0
    return this.map
  }

  /**
   * Bot fill from match.botCount. Team modes: split across teams, the player's team
   * gets one fewer when uneven. FFA: everyone is an enemy (team only picks the model).
   */
  private createBots(match: MatchSettings): Actor[] {
    const mgr = this.bots as BotManager & { createForMatch?: (m: MatchSettings, playerTeam: Team) => Actor[] }
    if (typeof mgr.createForMatch === 'function') return mgr.createForMatch(match, this.player.team)
    // Fallback until the AI's createForMatch lands: trim the stock 5v6 squads.
    this.bots.createTeams(this.player.team)
    const count = Math.max(0, Math.round(match.botCount))
    const want: Record<Team, number> =
      match.mode === 'ffa'
        ? { tf141: Math.floor(count / 2), opfor: Math.ceil(count / 2) }
        : { [this.player.team]: Math.floor(count / 2), [otherTeam(this.player.team)]: Math.ceil(count / 2) } as Record<Team, number>
    const keep: Record<Team, number> = { tf141: 0, opfor: 0 }
    const list = this.bots.bots
    for (let i = 0; i < list.length; ) {
      const b = list[i]!
      if (keep[b.team] < want[b.team]) {
        keep[b.team]++
        i++
      } else {
        ;(b as Actor & { dispose?: () => void }).dispose?.()
        list.splice(i, 1)
      }
    }
    if (keep.tf141 < want.tf141 || keep.opfor < want.opfor) console.warn('[mode] bot fill capped by createTeams (needs bots.createForMatch)', want, keep)
    return list.slice()
  }

  pause() {
    if (this.paused) return
    this.paused = true
    this.input.enabled = false
    this.events.emit('ui:menu', { open: true })
  }

  /** Must be called from a user gesture (pointer lock). */
  resume() {
    if (!this.paused) return
    this.paused = false
    this.input.enabled = true
    this.input.lock()
    this.events.emit('ui:menu', { open: false })
  }

  quitToMenu() {
    this.paused = false
    this.input.enabled = false
    this.input.unlock()
    this.combat.clearGrenades()
    this.bots.clear()
    this.actors = []
    this.mode.setPhase('menu')
  }

  applySettings() {
    this.input.sensitivity = this.settings.sensitivity
    this.input.invertY = this.settings.invertY
    this.input.fullscreen = this.settings.fullscreen
    if (!this.settings.fullscreen) this.input.exitFullscreen()
    this.audio.setVolume(this.settings.masterVolume, this.settings.musicVolume)
    this.render.setQuality(this.settings.quality)
    saveJSON(SETTINGS_KEY, this.settings)
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame)
    const rawDt = Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.realTime += rawDt
    this.fpsAccum += rawDt
    this.fpsFrames++
    if (this.fpsAccum > 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum
      this.fpsAccum = 0
      this.fpsFrames = 0
    }

    this.input.beginFrame()
    const phase = this.mode.phase
    const inMatch = phase === 'intro' || phase === 'playing' || phase === 'ended'
    // NET: online matches keep simulating behind the pause menu
    const dt = this.paused && this.netRole === 'offline' ? 0 : rawDt

    if (this.input.state.pausePressed && inMatch && !this.paused && phase !== 'ended') {
      this.input.unlock()
      this.pause()
    }

    if (inMatch) {
      if (dt > 0) {
        this.time += dt
        if (this.netRole !== 'client') this.mode.update(dt) // NET: clients mirror the host's mode
        this.player.update(dt)
        if (this.netRole !== 'client') this.bots.update(dt)
        this.combat.update(dt)
      }
      if (phase === 'ended') {
        this.endTimer += rawDt
        if (this.endTimer > 2.5 && this.input.enabled) {
          this.input.enabled = false
          this.input.unlock()
        }
      }
    } else {
      this.updateMenuCamera(rawDt)
    }

    this.net?.update(rawDt) // NET: replication
    this.fx.update(dt)
    this.audio.update(rawDt)
    this.ui.update(rawDt)
    this.render.render(rawDt)
    this.input.endFrame()
  }

  private updateMenuCamera(dt: number) {
    const path = this.map.menuCameraPath
    if (path.length < 2 || this.freezeMenuCamera) return
    this.menuCamT += dt * 0.035
    const n = path.length
    const t = (this.menuCamT % 1) * n
    const i = Math.floor(t)
    const f = t - i
    const s = f * f * (3 - 2 * f)
    const a = path[i % n]!
    const b = path[(i + 1) % n]!
    const cam = this.render.camera
    cam.position.lerpVectors(a.position, b.position, s)
    const target = _target.lerpVectors(a.target, b.target, s)
    cam.lookAt(target)
    cam.fov = damp(cam.fov, 60, 2, dt)
    cam.updateProjectionMatrix()
  }
}

const _target = new Vector3()

/** Default lobby settings per mode (MW2-ish limits). */
export function defaultMatch(mode: MatchSettings['mode']): MatchSettings {
  const base = { mode, mapId: 'rust', botDifficulty: 0.55 }
  switch (mode) {
    case 'ffa':
      return { ...base, botCount: 7, scoreLimit: 30, timeLimit: 600 }
    case 'dom':
      return { ...base, botCount: 11, scoreLimit: 200, timeLimit: 900 }
    case 'sd':
      return { ...base, botCount: 9, scoreLimit: 4, timeLimit: 150 }
    default:
      return { ...base, botCount: 11, scoreLimit: CONFIG.scoreLimit, timeLimit: CONFIG.timeLimit }
  }
}

function loadJSON<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    return fallback
  }
}

function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable (private mode) — settings just won't persist */
  }
}
