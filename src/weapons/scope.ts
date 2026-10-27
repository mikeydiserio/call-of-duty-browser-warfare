/**
 * Intervention scope overlay: full-screen DOM layer with a black surround,
 * lens tint/vignette and an MW2-style thin crosshair reticle with a centre
 * gap. Created once and toggled; sway is applied as a CSS transform.
 */
export class ScopeOverlay {
  private el: HTMLDivElement
  private inner: HTMLDivElement
  private shown = false
  private lastX = 1e9
  private lastY = 1e9

  constructor() {
    const el = document.createElement('div')
    el.id = 'wpn-scope'
    el.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:5;display:none;overflow:hidden;'
    const inner = document.createElement('div')
    // Oversized so swaying never reveals an edge.
    inner.style.cssText = 'position:absolute;left:-25vw;top:-25vh;width:150vw;height:150vh;will-change:transform;'
    inner.innerHTML = `
<svg width="100%" height="100%" viewBox="-1000 -1000 2000 2000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="wpnLens" cx="0" cy="0" r="440" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.72" stop-color="#000" stop-opacity="0.05"/>
      <stop offset="0.93" stop-color="#05080a" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#000" stop-opacity="1"/>
    </radialGradient>
    <mask id="wpnHole"><rect x="-3000" y="-3000" width="6000" height="6000" fill="#fff"/><circle cx="0" cy="0" r="440" fill="#000"/></mask>
  </defs>
  <rect x="-3000" y="-3000" width="6000" height="6000" fill="#000" mask="url(#wpnHole)"/>
  <circle cx="0" cy="0" r="441" fill="url(#wpnLens)"/>
  <circle cx="0" cy="0" r="441" fill="none" stroke="#000" stroke-width="6"/>
  <g stroke="#000" stroke-linecap="butt">
    <line x1="-440" y1="0" x2="-150" y2="0" stroke-width="7"/>
    <line x1="150" y1="0" x2="440" y2="0" stroke-width="7"/>
    <line x1="0" y1="150" x2="0" y2="440" stroke-width="7"/>
    <line x1="0" y1="-440" x2="0" y2="-150" stroke-width="2.4"/>
    <line x1="-150" y1="0" x2="-6" y2="0" stroke-width="1.6"/>
    <line x1="6" y1="0" x2="150" y2="0" stroke-width="1.6"/>
    <line x1="0" y1="6" x2="0" y2="150" stroke-width="1.6"/>
    <line x1="0" y1="-150" x2="0" y2="-6" stroke-width="1.6"/>
  </g>
  <g fill="#000">
    ${[-120, -90, -60, -30, 30, 60, 90, 120].map((v) => `<circle cx="${v}" cy="0" r="3.2"/><circle cx="0" cy="${v}" r="3.2"/>`).join('')}
  </g>
</svg>`
    el.appendChild(inner)
    document.body.appendChild(el)
    this.el = el
    this.inner = inner
  }

  set(visible: boolean, swayX = 0, swayY = 0) {
    if (visible !== this.shown) {
      this.shown = visible
      this.el.style.display = visible ? 'block' : 'none'
    }
    if (!visible) return
    const x = Math.round(swayX * 10) / 10
    const y = Math.round(swayY * 10) / 10
    if (x !== this.lastX || y !== this.lastY) {
      this.lastX = x
      this.lastY = y
      this.inner.style.transform = `translate(${x}px,${y}px)`
    }
  }
}
