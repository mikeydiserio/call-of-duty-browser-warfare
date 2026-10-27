/** Tiny DOM helpers shared by every UI module. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  parent?: Element | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  parent?.appendChild(e)
  return e
}

/** Text node wrapper that only touches the DOM when the value actually changes. */
export class Txt {
  private last = '\u0000'
  constructor(readonly el: HTMLElement) {}
  set(v: string) {
    if (v !== this.last) {
      this.last = v
      this.el.textContent = v
    }
  }
}

export function setClass(e: Element, cls: string, on: boolean) {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on)
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt))

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Stable pseudo-random 0..1 from an integer id. */
export function hash01(n: number): number {
  let x = (n + 1) * 2654435761
  x ^= x >>> 15
  x = Math.imul(x, 2246822519)
  x ^= x >>> 13
  return ((x >>> 0) % 10000) / 10000
}

/** Restart a one-shot CSS animation class on an element. */
export function retrigger(e: HTMLElement, cls: string) {
  e.classList.remove(cls)
  void e.offsetWidth
  e.classList.add(cls)
}
