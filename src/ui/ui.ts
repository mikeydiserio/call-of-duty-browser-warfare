import type { UiSound } from '../audio/audio'
import type { Game } from '../core/game'
import './ui.css'
import { ClassScreen } from './class-screen'
import { damp, el, setClass } from './dom'
import { Hud } from './hud'
import { MainScreen } from './main-screen'
import { ControlsScreen, OptionsScreen } from './options-screen'
import { IntroOverlay, LoadingScreen, ResultsOverlay, TitleCard } from './overlays'
import { PauseScreen } from './pause-screen'
import { Scoreboard } from './scoreboard'
import type { Screen, ScreenId, UiCtx } from './screen'

const DESIGN_H = 1080
/** Pre-match countdown length; long enough to sit behind the loading screen and still show 3-2-1. */
const INTRO_SECONDS = 6.5

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space', 'Escape', 'Backspace'])

/**
 * Front-end + HUD coordinator. Everything is DOM (plus two canvases) laid out in
 * a 1080-tall design space that is uniformly scaled to the viewport height.
 */
export class UI implements UiCtx {
  private stage: HTMLElement
  private hud: Hud
  private screens = new Map<ScreenId, Screen>()
  private stack: ScreenId[] = []
  private menuBg: HTMLElement
  private title: TitleCard
  private loading: LoadingScreen
  private intro: IntroOverlay
  private results: ResultsOverlay
  private tabBoard: Scoreboard
  private tabEl: HTMLElement
  private scale = 1
  private titleDone = false
  private audioUnlocked = false

  constructor(
    public readonly game: Game,
    private root: HTMLElement,
  ) {
    this.stage = el('div', 'mw-stage', root)
    this.hud = new Hud(game)
    this.stage.appendChild(this.hud.el)

    this.tabEl = el('div', 'tab-overlay', this.stage)
    this.tabBoard = new Scoreboard(game, 'full')
    this.tabEl.appendChild(this.tabBoard.el)

    this.menuBg = el('div', 'menu-bg', this.stage)
    el('div', 'menu-noise', this.menuBg)

    for (const s of [
      new MainScreen(this),
      new ClassScreen(this),
      new OptionsScreen(this),
      new ControlsScreen(this),
      new PauseScreen(this),
    ] as Screen[]) {
      this.screens.set(s.id, s)
      this.stage.appendChild(s.el)
    }

    this.intro = new IntroOverlay(this)
    this.stage.appendChild(this.intro.el)
    this.results = new ResultsOverlay(this)
    this.stage.appendChild(this.results.el)
    this.loading = new LoadingScreen(game)
    this.stage.appendChild(this.loading.el)
    el('div', 'fx-scan', this.stage)
    this.title = new TitleCard()
    this.stage.appendChild(this.title.el)

    this.resize()
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('pointerdown', this.unlockAudio, { capture: true })
    this.bind()

    game.render.effects.menu = 1
  }

  // ─────────────────────────────── UiCtx ─────────────────────────────────

  sfx(kind: UiSound) {
    this.game.audio.playUi(kind)
  }

  push(id: ScreenId) {
    this.stack.push(id)
    this.showTop()
  }

  pop() {
    if (this.stack.length > 1) this.stack.pop()
    this.showTop()
  }

  inMatch() {
    return this.game.mode.phase !== 'menu'
  }

  play() {
    const g = this.game
    this.results.hide()
    this.stack = []
    this.showTop()
    this.loading.show()
    this.hud.reset()
    this.hud.setHoldAnnouncements(true)
    g.render.effects.menu = 0
    try {
      g.startMatch(g.loadout)
    } catch (err) {
      this.loading.hideNow()
      throw err
    }
    g.mode.introLeft = Math.max(g.mode.introLeft, INTRO_SECONDS)
  }

  resume() {
    this.sfx('back')
    this.game.resume()
    // Esc was also latched as a "pause pressed" edge by the input layer; drop it so we do not re-pause.
    this.game.input.state.pausePressed = false
    this.stack = []
    this.showTop()
  }

  quit() {
    this.results.hide()
    this.game.quitToMenu()
  }

  // ─────────────────────────────── internals ─────────────────────────────

  private get current(): Screen | null {
    const id = this.stack[this.stack.length - 1]
    return id ? (this.screens.get(id) ?? null) : null
  }

  private showTop() {
    const top = this.stack[this.stack.length - 1]
    for (const [id, s] of this.screens) {
      const on = id === top
      if (on !== s.el.classList.contains('on')) {
        s.el.classList.toggle('on', on)
        if (on) s.enter()
        else s.leave()
      }
    }
    setClass(this.menuBg, 'on', !!top)
    setClass(this.menuBg, 'pause', top === 'pause' || (this.inMatch() && !!top))
    setClass(this.stage, 'menus', !!top)
  }

  private bind() {
    const ev = this.game.events
    ev.on('match:phase', ({ phase, winner }) => {
      const g = this.game
      switch (phase) {
        case 'menu':
          this.loading.hideNow()
          this.intro.hide()
          this.results.hide()
          this.hud.setVisible(false)
          g.render.effects.menu = Math.max(g.render.effects.menu, 0.6)
          if (this.titleDone) {
            this.stack = ['main']
            this.showTop()
          }
          break
        case 'loading':
        case 'intro':
          // A match can start without play() (e.g. game.startMatch from devtools); drop any open menus.
          if (this.stack.length) {
            this.stack = []
            this.showTop()
          }
          this.hud.setVisible(true)
          if (!this.loading.visible && phase === 'loading') this.loading.show()
          this.intro.show()
          break
        case 'playing':
          this.intro.hide()
          this.sfx('countdownFinal')
          break
        case 'ended':
          this.results.show(winner)
          break
      }
    })
    ev.on('ui:menu', ({ open }) => {
      if (open) {
        if (this.game.mode.phase === 'menu') return
        this.stack = ['pause']
        this.showTop()
      } else {
        this.stack = []
        this.showTop()
      }
    })
  }

  private unlockAudio = () => {
    if (this.audioUnlocked) return
    this.audioUnlocked = true
    this.game.audio.unlock()
  }

  private finishTitle() {
    if (this.titleDone) return
    this.titleDone = true
    this.title.finish()
    window.setTimeout(() => this.title.el.classList.add('gone'), 900)
    if (this.game.mode.phase === 'menu') {
      this.stack = ['main']
      this.showTop()
    }
  }

  private onKey = (e: KeyboardEvent) => {
    this.unlockAudio()
    if (!this.titleDone) {
      e.preventDefault()
      this.finishTitle()
      return
    }
    if (e.repeat && (e.code === 'Enter' || e.code === 'Escape' || e.code === 'Space')) return
    if (this.results.active) {
      if (NAV_KEYS.has(e.code)) e.preventDefault()
      this.results.key(e)
      return
    }
    const s = this.current
    if (!s) return
    if (NAV_KEYS.has(e.code)) e.preventDefault()
    if (e.code === 'Escape' && this.stack.length === 1 && this.stack[0] === 'main') return
    s.key(e)
  }

  private resize() {
    const k = window.innerHeight / DESIGN_H
    this.scale = k
    const w = window.innerWidth / k
    const st = this.stage.style
    st.width = `${w}px`
    st.height = `${DESIGN_H}px`
    st.transform = `scale(${k})`
    this.hud.resize(k)
  }

  update(dt: number) {
    const g = this.game
    const mode = g.mode
    const phase = mode.phase

    if (!this.titleDone) {
      if (this.title.update(dt)) this.finishTitle()
    }

    this.loading.update(dt)
    this.hud.setHoldAnnouncements(this.loading.visible)

    if (phase === 'intro') this.intro.update()
    this.results.update(dt)

    const inGame = phase !== 'menu'
    if (inGame && !this.results.active) {
      this.hud.update(dt)
    } else if (inGame) {
      // keep minimap/score warm but skip heavy work behind the results screen
    }

    const cur = this.current
    cur?.update?.(dt)

    // Hold-Tab scoreboard
    const showTab = g.input.state.scoreboard && (phase === 'playing' || phase === 'intro') && !g.paused
    setClass(this.tabEl, 'on', showTab)
    if (showTab) this.tabBoard.render()

    // World blur/dim behind menus.
    let target = 0
    if (phase === 'menu' || this.titleDone === false) target = 1
    else if (g.paused || cur) target = 0.65
    g.render.effects.menu = damp(g.render.effects.menu, target, 7, dt)
  }
}
