import type { InputState } from './types'

const PRESS_KEYS = {
  Space: 'jumpPressed',
  KeyC: 'crouchPressed',
  ControlLeft: 'pronePressed',
  KeyZ: 'pronePressed',
  KeyR: 'reloadPressed',
  KeyY: 'switchPressed',
  Digit1: 'slot1Pressed',
  Digit2: 'slot2Pressed',
  KeyG: 'fragPressed',
  KeyV: 'meleePressed',
  KeyE: 'meleePressed',
  KeyF: 'usePressed',
  Escape: 'pausePressed',
  KeyP: 'pausePressed',
  Digit4: 'killstreakPressed',
} as const satisfies Record<string, keyof InputState>

type PressFlag = (typeof PRESS_KEYS)[keyof typeof PRESS_KEYS] | 'firePressed'

/**
 * Keyboard + mouse with pointer lock. Edge-triggered "*Pressed" flags stay true
 * for exactly one game frame (cleared by endFrame()).
 */
export class Input {
  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    lookDX: 0,
    lookDY: 0,
    fire: false,
    firePressed: false,
    ads: false,
    jumpPressed: false,
    sprint: false,
    crouchPressed: false,
    pronePressed: false,
    reloadPressed: false,
    switchPressed: false,
    slot1Pressed: false,
    slot2Pressed: false,
    fragPressed: false,
    fragHeld: false,
    meleePressed: false,
    usePressed: false,
    scoreboard: false,
    pausePressed: false,
    killstreakPressed: false,
  }
  sensitivity = 1
  invertY = false
  /** When false (menus) gameplay input is zeroed but pause/escape still reported. */
  enabled = false
  /** Dev aid (?debug): accept mouse input without pointer lock (automation can't always lock). */
  debugBypassLock = new URLSearchParams(location.search).has('debug')
  private keys = new Set<string>()
  private locked = false
  private onUnlock: (() => void) | null = null

  constructor(private element: HTMLElement) {
    window.addEventListener('keydown', this.keyDown)
    window.addEventListener('keyup', this.keyUp)
    window.addEventListener('blur', () => this.keys.clear())
    element.addEventListener('mousedown', this.mouseDown)
    window.addEventListener('mouseup', this.mouseUp)
    window.addEventListener('mousemove', this.mouseMove)
    window.addEventListener('wheel', this.wheel, { passive: true })
    window.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault()
    })
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked
      this.locked = document.pointerLockElement === this.element
      if (was && !this.locked) {
        this.state.fire = false
        this.state.ads = false
        this.onUnlock?.()
      }
    })
  }

  get isLocked() {
    return this.locked
  }

  /** Request pointer lock; must be called from a user gesture. */
  lock() {
    if (this.locked) return
    const req = this.element.requestPointerLock as (o?: { unadjustedMovement?: boolean }) => Promise<void> | void
    try {
      const p = req.call(this.element, { unadjustedMovement: true })
      if (p && typeof (p as Promise<void>).catch === 'function') {
        ;(p as Promise<void>).catch(() => this.fallbackLock())
      }
    } catch {
      this.fallbackLock()
    }
  }

  /** Retry without options; without a user gesture this rejects, which is fine (we lock on the next click). */
  private fallbackLock() {
    try {
      const p = (this.element.requestPointerLock as () => Promise<void> | void).call(this.element)
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {})
    } catch {
      /* no gesture yet */
    }
  }

  unlock() {
    if (this.locked) document.exitPointerLock()
  }

  setUnlockHandler(fn: () => void) {
    this.onUnlock = fn
  }

  /** Recompute held axes; call once per frame before systems read state. */
  beginFrame() {
    const k = this.keys
    const s = this.state
    if (!this.enabled) {
      s.moveX = s.moveY = 0
      s.sprint = s.fragHeld = s.scoreboard = s.useHeld = false
      return
    }
    s.moveX = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0)
    s.moveY = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0)
    s.sprint = k.has('ShiftLeft') || k.has('ShiftRight')
    s.fragHeld = k.has('KeyG')
    s.scoreboard = k.has('Tab')
    s.useHeld = k.has('KeyF')
  }

  /** Clear one-frame flags and mouse deltas; call at end of frame. */
  endFrame() {
    const s = this.state
    s.lookDX = s.lookDY = 0
    s.firePressed = false
    for (const flag of Object.values(PRESS_KEYS)) s[flag] = false
  }

  private keyDown = (e: KeyboardEvent) => {
    if (e.code === 'Tab' || (this.locked && (e.code === 'Space' || e.ctrlKey))) e.preventDefault()
    if (e.repeat) return
    this.keys.add(e.code)
    const flag = (PRESS_KEYS as Record<string, PressFlag>)[e.code]
    if (flag && (this.enabled || flag === 'pausePressed')) this.state[flag] = true
  }

  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private mouseDown = (e: MouseEvent) => {
    if (!this.enabled || !(this.locked || this.debugBypassLock)) return
    if (e.button === 0) {
      this.state.fire = true
      this.state.firePressed = true
    } else if (e.button === 2) this.state.ads = true
  }

  private mouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.state.fire = false
    else if (e.button === 2) this.state.ads = false
  }

  private mouseMove = (e: MouseEvent) => {
    if (!(this.locked || this.debugBypassLock) || !this.enabled) return
    // Guard against the occasional huge spike some browsers emit on lock.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return
    this.state.lookDX += e.movementX * this.sensitivity
    this.state.lookDY += e.movementY * this.sensitivity * (this.invertY ? -1 : 1)
  }

  private wheel = () => {
    if (this.enabled && (this.locked || this.debugBypassLock)) this.state.switchPressed = true
  }
}
