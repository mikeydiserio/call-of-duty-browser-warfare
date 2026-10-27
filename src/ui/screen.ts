import type { UiSound } from '../audio/audio'
import type { Game } from '../core/game'
import { el, setClass } from './dom'

export type ScreenId = 'main' | 'class' | 'options' | 'controls' | 'pause' | 'browser' | 'lobby'

/** Services the coordinator offers to every screen. */
export interface UiCtx {
  game: Game
  sfx(kind: UiSound): void
  push(id: ScreenId): void
  pop(): void
  /**
   * Start a match (called inside a click/keydown handler: pointer lock needs the gesture).
   * `start` overrides how the match is kicked off (e.g. `lobby.startMatch()`); default is a quick TDM.
   */
  play(start?: () => void): void
  /** MW2-style modal message box. */
  popup(title: string, message: string): void
  resume(): void
  quit(): void
  /** True when the screen is reached from the in-game pause menu. */
  inMatch(): boolean
}

export interface Screen {
  readonly id: ScreenId
  readonly el: HTMLElement
  enter(): void
  leave(): void
  key(e: KeyboardEvent): void
  update?(dt: number): void
}

export interface MenuItem {
  label: string
  sub?: string
  action: () => void
  /** Greyed out and skipped by keyboard navigation while true. */
  disabled?: () => boolean
  /** Hover tooltip (shown for disabled items to explain why). */
  tip?: string
}

/**
 * Vertical stack of big menu entries with a single highlight bar that slides
 * between rows (MW2 lobby style). Mouse hover selects, click/Enter activates.
 */
export class MenuList {
  readonly el: HTMLElement
  private hl: HTMLElement
  private rows: HTMLButtonElement[] = []
  idx = 0

  constructor(
    private ctx: UiCtx,
    private items: MenuItem[],
    private rowH = 72,
  ) {
    this.el = el('div', 'menulist')
    this.el.style.setProperty('--rowh', `${rowH}px`)
    this.el.style.height = `${rowH * items.length}px`
    this.hl = el('div', 'hl', this.el)
    items.forEach((it, i) => {
      const b = el('button', 'mi', this.el)
      b.type = 'button'
      b.style.top = `${i * rowH}px`
      const label = el('span', 'mi-label', b, it.label)
      const sub = el('span', 'mi-sub', b, it.sub ?? '')
      if (it.tip) b.dataset.tip = it.tip
      b.addEventListener('mouseenter', () => {
        if (!this.isDisabled(i)) this.setIndex(i)
      })
      b.addEventListener('click', () => this.activate(i))
      this.rows.push(b)
      this.labels.push(label)
      this.subs.push(sub)
    })
    this.setIndex(0, false)
  }

  private labels: HTMLElement[] = []
  private subs: HTMLElement[] = []

  isDisabled(i: number): boolean {
    return !!this.items[i]?.disabled?.()
  }

  setLabel(i: number, label: string, sub?: string) {
    const l = this.labels[i]
    if (l && l.textContent !== label) l.textContent = label
    const s = this.subs[i]
    if (s && sub !== undefined && s.textContent !== sub) s.textContent = sub
  }

  /** Re-evaluate disabled states (call when whatever they depend on changes). */
  refresh() {
    this.rows.forEach((r, i) => setClass(r, 'off', this.isDisabled(i)))
    if (this.isDisabled(this.idx)) this.step(1, false)
  }

  private step(dir: number, sound = true) {
    const n = this.items.length
    for (let k = 1; k <= n; k++) {
      const j = (((this.idx + dir * k) % n) + n) % n
      if (!this.isDisabled(j)) {
        this.setIndex(j, sound)
        return
      }
    }
  }

  setIndex(i: number, sound = true) {
    const n = this.items.length
    const next = ((i % n) + n) % n
    if (next === this.idx && !sound) {
      this.paint()
      return
    }
    if (next !== this.idx && sound) this.ctx.sfx('hover')
    this.idx = next
    this.paint()
  }

  private paint() {
    this.hl.style.transform = `translateY(${this.idx * this.rowH}px)`
    this.rows.forEach((r, i) => {
      setClass(r, 'sel', i === this.idx)
      setClass(r, 'off', this.isDisabled(i))
    })
  }

  activate(i = this.idx) {
    if (this.isDisabled(i)) {
      this.ctx.sfx('back')
      return
    }
    this.ctx.sfx('select')
    this.items[i]?.action()
  }

  /** Returns true when the key was consumed. */
  key(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.step(1)
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.step(-1)
    else if (e.code === 'Enter' || e.code === 'Space') this.activate()
    else return false
    return true
  }
}

export function keyHints(parent: HTMLElement, hints: [string, string][]): HTMLElement {
  const f = el('div', 'hints', parent)
  for (const [k, label] of hints) {
    const s = el('span', 'hint', f)
    el('b', '', s, k)
    s.append(` ${label}`)
  }
  return f
}
