import { Vector3 } from 'three'
import { BotManager } from '../ai/bots'
import { AudioEngine } from '../audio/audio'
import { Combat } from '../game/combat'
import { TeamDeathmatch } from '../game/mode'
import { Player } from '../player/player'
import { Effects } from '../render/fx/effects'
import { GameRenderer } from '../render/renderer'
import { UI } from '../ui/ui'
import { CollisionWorld } from '../world/collision'
import { buildRustMap } from '../world/rust/map'
import { CONFIG } from './config'
import { EventBus } from './events'
import { Input } from './input'
import { damp } from './math'
import type { Actor, Loadout, MapData } from './types'

export interface Settings {
  sensitivity: number
  fov: number
  invertY: boolean
  masterVolume: number
  musicVolume: number
  quality: 'low' | 'medium' | 'high'
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
  readonly map: MapData
  readonly combat: Combat
  readonly mode: TeamDeathmatch
  readonly player: Player
  readonly bots: BotManager
  readonly fx: Effects
  readonly audio: AudioEngine
  readonly ui: UI
  actors: Actor[] = []
  settings: Settings
  loadout: Loadout
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
    })
    this.loadout = loadJSON<Loadout>(LOADOUT_KEY, { primary: 'acr', secondary: 'usp45', perks: ['sleightOfHand', 'stoppingPower', 'commando'] })

    this.render = new GameRenderer(container)
    this.input = new Input(this.render.renderer.domElement)
    this.map = buildRustMap(this.render.scene, this.collision)
    if (!this.collision.bvh) this.collision.build()
    this.render.setEnvironment(this.map.environment)

    this.combat = new Combat(this)
    this.mode = new TeamDeathmatch(this)
    this.player = new Player(this)
    this.bots = new BotManager(this)
    this.fx = new Effects(this)
    this.audio = new AudioEngine(this)
    this.ui = new UI(this, uiRoot)

    this.applySettings()
    this.input.setUnlockHandler(() => {
      if (this.mode.phase === 'playing' || this.mode.phase === 'intro') this.pause()
    })
    this.events.on('match:phase', ({ phase }) => {
      if (phase === 'ended') this.endTimer = 0
    })
    window.addEventListener('resize', () => this.render.resize())
    this.mode.setPhase('menu')
  }

  start() {
    requestAnimationFrame(this.frame)
  }

  /** Called by the UI when the player hits "Start match". Must be inside a user gesture. */
  startMatch(loadout: Loadout) {
    this.loadout = loadout
    saveJSON(LOADOUT_KEY, loadout)
    this.audio.unlock()
    this.combat.clearGrenades()
    this.bots.clear()
    this.player.setLoadout(loadout)
    const bots = this.bots.createTeams(this.player.team)
    this.actors = [this.player, ...bots]
    this.time = 0
    this.paused = false
    this.mode.begin()
    this.input.enabled = true
    this.input.lock()
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
    const dt = this.paused ? 0 : rawDt

    if (this.input.state.pausePressed && inMatch && !this.paused && phase !== 'ended') {
      this.input.unlock()
      this.pause()
    }

    if (inMatch) {
      if (dt > 0) {
        this.time += dt
        this.mode.update(dt)
        this.player.update(dt)
        this.bots.update(dt)
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
