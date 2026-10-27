import type { Settings } from '../core/game'
import { KEYBINDS } from './data'
import { clamp, el, setClass } from './dom'
import { keyHints, type Screen, type UiCtx } from './screen'

interface Row {
  label: string
  kind: 'slider' | 'toggle' | 'choice'
  min?: number
  max?: number
  step?: number
  choices?: string[]
  get(): number
  set(v: number): void
  fmt(v: number): string
}

interface RowEl {
  row: Row
  el: HTMLElement
  fill?: HTMLElement
  thumb?: HTMLElement
  track?: HTMLElement
  val: HTMLElement
}

const QUALITY: Settings['quality'][] = ['low', 'medium', 'high']

export class OptionsScreen implements Screen {
  readonly id = 'options' as const
  readonly el = el('section', 'screen s-options')
  private rows: RowEl[] = []
  private idx = 0
  private backEl: HTMLElement

  constructor(private ctx: UiCtx) {
    const g = ctx.game
    const head = el('div', 'screen-head', this.el)
    el('div', 'menu-header', head, 'OPTIONS')
    el('div', 'menu-sub', head, 'GAME SETTINGS')
    el('div', 'menu-header-line', head)

    const panel = el('div', 'opt-panel panel', this.el)
    const apply = () => g.applySettings()
    const defs: Row[] = [
      {
        label: 'MOUSE SENSITIVITY', kind: 'slider', min: 0.2, max: 3, step: 0.05,
        get: () => g.settings.sensitivity,
        set: (v) => { g.settings.sensitivity = v; apply() },
        fmt: (v) => v.toFixed(2),
      },
      {
        label: 'FIELD OF VIEW', kind: 'slider', min: 65, max: 100, step: 1,
        get: () => g.settings.fov,
        set: (v) => { g.settings.fov = v; apply() },
        fmt: (v) => String(Math.round(v)),
      },
      {
        label: 'INVERT Y AXIS', kind: 'toggle',
        get: () => (g.settings.invertY ? 1 : 0),
        set: (v) => { g.settings.invertY = v > 0; apply() },
        fmt: (v) => (v > 0 ? 'ON' : 'OFF'),
      },
      {
        label: 'FULLSCREEN (BLOCKS CTRL+W)', kind: 'toggle',
        get: () => (g.settings.fullscreen ? 1 : 0),
        set: (v) => { g.settings.fullscreen = v > 0; apply() },
        fmt: (v) => (v > 0 ? 'ON' : 'OFF'),
      },
      {
        label: 'MASTER VOLUME', kind: 'slider', min: 0, max: 1, step: 0.05,
        get: () => g.settings.masterVolume,
        set: (v) => { g.settings.masterVolume = v; apply() },
        fmt: (v) => String(Math.round(v * 100)),
      },
      {
        label: 'MUSIC VOLUME', kind: 'slider', min: 0, max: 1, step: 0.05,
        get: () => g.settings.musicVolume,
        set: (v) => { g.settings.musicVolume = v; apply() },
        fmt: (v) => String(Math.round(v * 100)),
      },
      {
        label: 'GRAPHICS QUALITY', kind: 'choice', choices: ['LOW', 'MEDIUM', 'HIGH'],
        get: () => Math.max(0, QUALITY.indexOf(g.settings.quality)),
        set: (v) => { g.settings.quality = QUALITY[clamp(Math.round(v), 0, 2)]!; apply() },
        fmt: (v) => ['LOW', 'MEDIUM', 'HIGH'][clamp(Math.round(v), 0, 2)]!,
      },
    ]
    defs.forEach((row, i) => {
      const e = el('div', `orow ${row.kind}`, panel)
      el('span', 'orow-label', e, row.label)
      const ctl = el('div', 'orow-ctl', e)
      const re: RowEl = { row, el: e, val: el('span', 'orow-val', e) }
      if (row.kind === 'slider') {
        const track = el('div', 'slider', ctl)
        re.track = track
        re.fill = el('i', 'slider-fill', track)
        re.thumb = el('b', 'slider-thumb', track)
        const setFromPointer = (ev: PointerEvent) => {
          const r = track.getBoundingClientRect()
          const t = clamp((ev.clientX - r.left) / r.width, 0, 1)
          const raw = row.min! + t * (row.max! - row.min!)
          const v = clamp(Math.round(raw / row.step!) * row.step!, row.min!, row.max!)
          row.set(v)
          this.paintRow(re)
        }
        track.addEventListener('pointerdown', (ev) => {
          track.setPointerCapture(ev.pointerId)
          this.select(i)
          setFromPointer(ev)
        })
        track.addEventListener('pointermove', (ev) => {
          if (track.hasPointerCapture(ev.pointerId)) setFromPointer(ev)
        })
      } else {
        const arrows = el('div', 'arrows', ctl)
        const l = el('button', 'arr', arrows, '◀')
        const r = el('button', 'arr', arrows, '▶')
        l.type = r.type = 'button'
        l.addEventListener('click', () => { this.select(i); this.adjust(-1) })
        r.addEventListener('click', () => { this.select(i); this.adjust(1) })
      }
      e.addEventListener('mouseenter', () => this.select(i))
      this.rows.push(re)
    })

    this.backEl = el('button', 'btn-back', this.el, 'BACK')
    ;(this.backEl as HTMLButtonElement).type = 'button'
    this.backEl.addEventListener('mouseenter', () => this.select(this.rows.length))
    this.backEl.addEventListener('click', () => this.goBack())

    keyHints(this.el, [
      ['↑ ↓', 'SELECT'],
      ['← →', 'ADJUST'],
      ['ESC', 'BACK'],
    ])
  }

  private goBack() {
    this.ctx.sfx('back')
    this.ctx.pop()
  }

  private select(i: number) {
    if (i !== this.idx) this.ctx.sfx('hover')
    this.idx = i
    this.rows.forEach((r, k) => setClass(r.el, 'sel', k === i))
    setClass(this.backEl, 'sel', i === this.rows.length)
  }

  private paintRow(r: RowEl) {
    const v = r.row.get()
    r.val.textContent = r.row.fmt(v)
    if (r.row.kind === 'slider') {
      const t = (v - r.row.min!) / (r.row.max! - r.row.min!)
      r.fill!.style.transform = `scaleX(${t})`
      r.thumb!.style.left = `${t * 100}%`
    }
  }

  private adjust(dir: number) {
    const r = this.rows[this.idx]
    if (!r) return
    const row = r.row
    const v = row.get()
    if (row.kind === 'slider') row.set(clamp(+(v + dir * row.step!).toFixed(3), row.min!, row.max!))
    else if (row.kind === 'toggle') row.set(v > 0 ? 0 : 1)
    else row.set(clamp(v + dir, 0, row.choices!.length - 1))
    this.ctx.sfx('hover')
    this.paintRow(r)
  }

  enter() {
    this.rows.forEach((r) => this.paintRow(r))
    this.select(0)
  }

  leave() {}

  key(e: KeyboardEvent) {
    const n = this.rows.length + 1
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.select((this.idx + 1) % n)
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.select((this.idx + n - 1) % n)
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.adjust(-1)
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.adjust(1)
    else if (e.code === 'Enter' || e.code === 'Space') {
      if (this.idx === this.rows.length) this.goBack()
      else if (this.rows[this.idx]!.row.kind !== 'slider') this.adjust(1)
    } else if (e.code === 'Escape' || e.code === 'Backspace') this.goBack()
  }
}

export class ControlsScreen implements Screen {
  readonly id = 'controls' as const
  readonly el = el('section', 'screen s-controls')

  constructor(private ctx: UiCtx) {
    const head = el('div', 'screen-head', this.el)
    el('div', 'menu-header', head, 'CONTROLS')
    el('div', 'menu-sub', head, 'KEYBOARD & MOUSE')
    el('div', 'menu-header-line', head)
    const grid = el('div', 'ctl-grid', this.el)
    for (const sec of KEYBINDS) {
      const p = el('div', 'ctl-sec panel', grid)
      el('div', 'panel-title', p, sec.section)
      for (const [k, label] of sec.rows) {
        const r = el('div', 'ctl-row', p)
        const keys = el('span', 'ctl-keys', r)
        k.split(' / ').forEach((alt, ai) => {
          if (ai) el('i', '', keys, '/')
          for (const part of alt === 'W A S D' ? alt.split(' ') : [alt]) el('kbd', '', keys, part)
        })
        el('span', 'ctl-act', r, label)
      }
    }
    const back = el('button', 'btn-back sel', this.el, 'BACK')
    back.type = 'button'
    back.addEventListener('click', () => {
      ctx.sfx('back')
      ctx.pop()
    })
    keyHints(this.el, [['ESC', 'BACK']])
  }

  enter() {}
  leave() {}
  key(e: KeyboardEvent) {
    if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Backspace') {
      this.ctx.sfx('back')
      this.ctx.pop()
    }
  }
}
