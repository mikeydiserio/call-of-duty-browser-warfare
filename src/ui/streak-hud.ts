/**
 * Killstreak HUD (MW2): the reward column (right edge), call-in prompts, crate capture
 * bar, nuke countdown, and a full-screen canvas for the laptop map picker and the
 * remote-control reticles (Predator / Chopper Gunner / AC-130).
 */
import { Vector3 } from 'three'
import type { Game } from '../core/game'
import { KILLSTREAKS, killstreakSvg, type KillstreakId } from '../game/killstreaks/defs'
import { AC130_WEAPONS, Gunship, type Interact, Missile } from '../game/killstreaks/manager'
import { el, setClass, Txt } from './dom'

const _p = new Vector3()

export class StreakHud {
  readonly el = el('div', 'ks-hud')
  private col = el('div', 'ks-col', this.el)
  private colKey = ''
  private rows: HTMLElement[] = []
  private streakTxt: Txt
  private prompt = el('div', 'ks-prompt', this.el)
  private promptKey = ''
  private hint = el('div', 'ks-hint', this.el)
  private hintTxt: Txt
  private hintSub: Txt
  private cap = el('div', 'ks-capture', this.el)
  private capTxt: Txt
  private capFill: HTMLElement
  private nukeEl = el('div', 'ks-nuke', this.el)
  private nukeTxt: Txt
  private canvas = el('canvas', 'ks-canvas', this.el) as HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private drawn = false

  constructor(
    private game: Game,
    private hudRoot: HTMLElement,
  ) {
    this.streakTxt = new Txt(el('div', 'ks-count', this.col))
    this.hintTxt = new Txt(el('div', 'ks-hint-t', this.hint))
    this.hintSub = new Txt(el('div', 'ks-hint-s', this.hint))
    this.capTxt = new Txt(el('div', 'ks-cap-t', this.cap))
    this.capFill = el('i', 'ks-cap-fill', el('div', 'ks-cap-bar', this.cap))
    el('div', 'ks-nuke-t', this.nukeEl, 'TACTICAL NUKE INBOUND')
    this.nukeTxt = new Txt(el('div', 'ks-nuke-n', this.nukeEl))
    this.ctx = this.canvas.getContext('2d')!
  }

  update() {
    const g = this.game
    const ks = g.streaks
    const p = g.player
    const live = g.mode.phase === 'playing' || g.mode.phase === 'intro'
    this.updateColumn(live)

    const it = ks.interact
    setClass(this.hudRoot, 'ks-ctl', it.k === 'control' || it.k === 'map')
    this.updateHint(it)

    // Crate capture.
    const crate = ks.captureCrate
    setClass(this.cap, 'on', !!crate && p.alive && it.k === 'none')
    if (crate) {
      this.capTxt.set(`HOLD [F] FOR ${crate.label.toUpperCase()}`)
      this.capFill.style.transform = `scaleX(${Math.min(1, ks.capture)})`
    }

    // Nuke.
    const n = ks.nukeState()
    setClass(this.nukeEl, 'on', !!n && live)
    setClass(this.nukeEl, 'enemy', !!n && !n.friendly)
    if (n) this.nukeTxt.set(n.left.toFixed(1))

    this.draw(it)
  }

  private updateColumn(live: boolean) {
    const g = this.game
    const p = g.player
    const h = g.streaks.holder(p)
    const key = h.choices.join(',')
    if (key !== this.colKey) {
      this.colKey = key
      for (const r of this.rows) r.remove()
      // Highest reward on top, like MW2.
      this.rows = h.choices
        .slice()
        .reverse()
        .map((id) => {
          const r = el('div', 'ks-row')
          r.dataset.id = id
          r.innerHTML = `<span class="ks-n">${KILLSTREAKS[id].kills}</span><span class="ks-i">${killstreakSvg(id)}</span><span class="ks-x"></span>`
          this.col.insertBefore(r, this.streakTxt.el)
          return r
        })
    }
    setClass(this.col, 'on', live)
    const streak = p.stats.streak
    const sel = h.inv[Math.min(h.sel, h.inv.length - 1)]
    for (const r of this.rows) {
      const id = r.dataset.id as KillstreakId
      const held = h.inv.filter((x) => x === id).length
      setClass(r, 'held', held > 0)
      setClass(r, 'sel', held > 0 && id === sel)
      setClass(r, 'reached', streak >= KILLSTREAKS[id].kills)
      const x = r.querySelector('.ks-x')!
      x.textContent = held > 1 ? `x${held}` : ''
    }
    this.streakTxt.set(streak > 0 ? `STREAK ${streak}` : '')

    // Prompt for the selected held reward.
    const promptKey = sel && live && g.streaks.interact.k === 'none' ? `${sel}:${h.inv.length}` : ''
    if (promptKey !== this.promptKey) {
      this.promptKey = promptKey
      this.prompt.innerHTML = sel
        ? `<kbd>4</kbd> ${KILLSTREAKS[sel].name.toUpperCase()}${h.inv.length > 1 ? ` <span class="ks-cyc"><kbd>3</kbd> NEXT</span>` : ''}`
        : ''
      setClass(this.prompt, 'on', !!sel)
    }
  }

  private updateHint(it: Interact) {
    let t = ''
    let s = ''
    if (it.k === 'place') {
      t = it.valid ? 'PLACE SENTRY GUN' : 'CANNOT PLACE HERE'
      s = '[FIRE] PLACE   [4] CANCEL'
    } else if (it.k === 'map') {
      const def = KILLSTREAKS[it.id]
      t = it.stage === 0 ? `${def.name.toUpperCase()}: SELECT LOCATION` : 'SELECT APPROACH DIRECTION'
      s = '[FIRE] CONFIRM   [RMB] / [4] CANCEL'
    } else if (it.k === 'control') {
      const e = it.ent
      if (e instanceof Missile) {
        t = 'PREDATOR MISSILE'
        s = e.boosted ? 'BOOSTING' : '[FIRE] BOOST'
      } else {
        t = e.streak === 'ac130' ? 'AC-130' : 'CHOPPER GUNNER'
        s = e.streak === 'ac130' ? '[1] 105MM  [2] 40MM  [3] 25MM   [Y] CYCLE' : '[FIRE] 20MM CANNON'
      }
    }
    this.hintTxt.set(t)
    this.hintSub.set(s)
    setClass(this.hint, 'on', t !== '')
    setClass(this.hint, 'top', it.k === 'control' || it.k === 'map')
  }

  // ─── Canvas ──────────────────────────────────────────────────────────────

  private size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(window.innerWidth * dpr)
    const h = Math.round(window.innerHeight * dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    return { w, h, k: h / 1080 }
  }

  private draw(it: Interact) {
    const need = it.k === 'map' || it.k === 'control'
    if (!need) {
      if (this.drawn) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        this.drawn = false
      }
      return
    }
    this.drawn = true
    const { w, h, k } = this.size()
    const c = this.ctx
    c.clearRect(0, 0, w, h)
    c.lineCap = 'butt'
    if (it.k === 'map') this.drawMap(it, w, h, k)
    else if (it.ent instanceof Missile) this.drawPredator(it.ent, w, h, k)
    else this.drawGunship(it.ent, w, h, k)
  }

  /** Laptop: overhead map, cursor, friendly positions, approach arrow. */
  private drawMap(it: Extract<Interact, { k: 'map' }>, w: number, h: number, k: number) {
    const g = this.game
    const c = this.ctx
    const b = g.map.bounds
    c.fillStyle = 'rgba(4,8,6,0.82)'
    c.fillRect(0, 0, w, h)
    const size = Math.min(w, h) * 0.74
    const x0 = (w - size) / 2
    const y0 = (h - size) / 2 + 20 * k
    const sx = size / (b.maxX - b.minX)
    const sz = size / (b.maxZ - b.minZ)
    const px = (x: number) => x0 + (x - b.minX) * sx
    const pz = (z: number) => y0 + (z - b.minZ) * sz
    c.globalAlpha = 0.95
    c.drawImage(g.map.minimap, x0, y0, size, size)
    c.globalAlpha = 1
    c.strokeStyle = 'rgba(170,230,150,0.55)'
    c.lineWidth = 2 * k
    c.strokeRect(x0, y0, size, size)
    // Friendlies (and you).
    const me = g.player
    for (const a of g.actors) {
      if (!a.alive || g.mode.isEnemy(me, a)) continue
      c.fillStyle = a === me ? '#ffe866' : '#7cff8a'
      c.beginPath()
      c.arc(px(a.position.x), pz(a.position.z), (a === me ? 6 : 4.5) * k, 0, Math.PI * 2)
      c.fill()
    }
    // Target reticle + strike zone.
    const tx = px(it.x)
    const tz = pz(it.z)
    c.strokeStyle = '#ff4a3a'
    c.lineWidth = 2.5 * k
    c.beginPath()
    c.arc(tx, tz, 14 * sx, 0, Math.PI * 2)
    c.stroke()
    c.beginPath()
    c.moveTo(tx - 22 * k, tz)
    c.lineTo(tx + 22 * k, tz)
    c.moveTo(tx, tz - 22 * k)
    c.lineTo(tx, tz + 22 * k)
    c.stroke()
    if (KILLSTREAKS[it.id].directional) {
      const len = 40 * sx
      const dx = Math.sin(it.heading)
      const dz = -Math.cos(it.heading)
      c.strokeStyle = it.stage === 1 ? '#ffe866' : 'rgba(255,232,102,0.45)'
      c.lineWidth = 4 * k
      c.beginPath()
      c.moveTo(tx - dx * len, tz - dz * len)
      c.lineTo(tx + dx * len, tz + dz * len)
      c.stroke()
      const ax = tx + dx * len
      const az = tz + dz * len
      c.beginPath()
      c.moveTo(ax, az)
      c.lineTo(ax - dx * 18 * k + dz * 12 * k, az - dz * 18 * k - dx * 12 * k)
      c.lineTo(ax - dx * 18 * k - dz * 12 * k, az - dz * 18 * k + dx * 12 * k)
      c.closePath()
      c.fillStyle = c.strokeStyle
      c.fill()
    }
    this.text(KILLSTREAKS[it.id].name.toUpperCase(), x0, y0 - 14 * k, 26 * k, '#cfe8c0', 'left')
  }

  /** Friendly / enemy markers projected into the remote view (thermal IFF). */
  private drawMarkers(w: number, h: number, k: number, box: number) {
    const g = this.game
    const c = this.ctx
    const cam = g.render.camera
    const me = g.player
    for (const a of g.actors) {
      if (!a.alive || a === me) continue
      _p.copy(a.position).setY(a.position.y + 0.9).project(cam)
      if (_p.z > 1 || Math.abs(_p.x) > 1.1 || Math.abs(_p.y) > 1.1) continue
      const x = (_p.x * 0.5 + 0.5) * w
      const y = (-_p.y * 0.5 + 0.5) * h
      const enemy = g.mode.isEnemy(me, a)
      c.strokeStyle = enemy ? '#ff3b2e' : '#64ff6e'
      c.lineWidth = 2 * k
      const s = box * k
      if (enemy) c.strokeRect(x - s, y - s, s * 2, s * 2)
      else {
        c.beginPath()
        c.moveTo(x, y - s)
        c.lineTo(x + s, y)
        c.lineTo(x, y + s)
        c.lineTo(x - s, y)
        c.closePath()
        c.stroke()
      }
    }
  }

  private drawPredator(m: Missile, w: number, h: number, k: number) {
    const c = this.ctx
    this.drawMarkers(w, h, k, 9)
    const cx = w / 2
    const cy = h / 2
    c.strokeStyle = 'rgba(255,255,255,0.85)'
    c.lineWidth = 2 * k
    // corner frame
    const fx = w * 0.3
    const fy = h * 0.3
    const L = 40 * k
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      c.beginPath()
      c.moveTo(cx + sx * fx, cy + sy * fy - sy * L)
      c.lineTo(cx + sx * fx, cy + sy * fy)
      c.lineTo(cx + sx * fx - sx * L, cy + sy * fy)
      c.stroke()
    }
    c.strokeRect(cx - 24 * k, cy - 24 * k, 48 * k, 48 * k)
    c.beginPath()
    c.moveTo(cx - 70 * k, cy)
    c.lineTo(cx - 30 * k, cy)
    c.moveTo(cx + 30 * k, cy)
    c.lineTo(cx + 70 * k, cy)
    c.moveTo(cx, cy - 70 * k)
    c.lineTo(cx, cy - 30 * k)
    c.moveTo(cx, cy + 30 * k)
    c.lineTo(cx, cy + 70 * k)
    c.stroke()
    const alt = Math.max(0, m.pos.y - this.game.streaks.groundAt(m.pos).y)
    this.text(`ALT ${alt.toFixed(0)} M`, cx + fx - 10 * k, cy - fy + 30 * k, 22 * k, '#fff', 'right')
    this.text(`${m.timeLeft.toFixed(1)}`, cx - fx + 10 * k, cy - fy + 30 * k, 22 * k, '#fff', 'left')
  }

  private drawGunship(gs: Gunship, w: number, h: number, k: number) {
    const c = this.ctx
    this.drawMarkers(w, h, k, gs.streak === 'ac130' ? 6 : 8)
    const cx = w / 2
    const cy = h / 2
    c.strokeStyle = 'rgba(255,255,255,0.9)'
    c.fillStyle = 'rgba(255,255,255,0.9)'
    c.lineWidth = 2 * k
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      c.beginPath()
      c.moveTo(cx + x1 * k, cy + y1 * k)
      c.lineTo(cx + x2 * k, cy + y2 * k)
      c.stroke()
    }
    if (gs.streak === 'chopperGunner') {
      c.beginPath()
      c.arc(cx, cy, 60 * k, 0, Math.PI * 2)
      c.stroke()
      line(-140, 0, -20, 0)
      line(20, 0, 140, 0)
      line(0, -140, 0, -20)
      line(0, 20, 0, 140)
    } else if (gs.weapon === 0) {
      // 105 mm: big brackets
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        line(sx * 150, sy * 110, sx * 150, sy * 60)
        line(sx * 150, sy * 110, sx * 100, sy * 110)
      }
      line(-60, 0, -12, 0)
      line(12, 0, 60, 0)
      line(0, -60, 0, -12)
      line(0, 12, 0, 60)
    } else if (gs.weapon === 1) {
      // 40 mm: cross with end ticks
      line(-110, 0, -10, 0)
      line(10, 0, 110, 0)
      line(0, -110, 0, -10)
      line(0, 10, 0, 110)
      for (const s of [-1, 1]) {
        line(s * 110, -14, s * 110, 14)
        line(-14, s * 110, 14, s * 110)
        line(s * 55, -7, s * 55, 7)
        line(-7, s * 55, 7, s * 55)
      }
    } else {
      // 25 mm: tight cross + circle
      c.beginPath()
      c.arc(cx, cy, 26 * k, 0, Math.PI * 2)
      c.stroke()
      line(-70, 0, -6, 0)
      line(6, 0, 70, 0)
      line(0, -70, 0, -6)
      line(0, 6, 0, 70)
    }
    // Weapon list + reload (AC-130), time left.
    const x = 60 * k
    let y = 90 * k
    this.text(`${gs.streak === 'ac130' ? 'AC-130' : 'CHOPPER GUNNER'}   ${Math.ceil(gs.timeLeft)}`, x, y, 26 * k, '#fff', 'left')
    if (gs.streak === 'ac130') {
      AC130_WEAPONS.forEach((wp, i) => {
        y += 34 * k
        const on = i === gs.weapon
        this.text(`${i + 1}  ${wp.name}`, x, y, (on ? 24 : 20) * k, on ? '#fff' : 'rgba(255,255,255,0.55)', 'left')
        const cool = gs.cool[i]! / wp.reload
        if (cool > 0.02) {
          c.fillStyle = 'rgba(255,255,255,0.75)'
          c.fillRect(x + 150 * k, y - 14 * k, 90 * k * (1 - cool), 6 * k)
        }
      })
    }
  }

  private text(s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign) {
    const c = this.ctx
    c.font = `600 ${size}px "Saira Condensed", "Arial Narrow", sans-serif`
    c.textAlign = align
    c.fillStyle = 'rgba(0,0,0,0.6)'
    c.fillText(s, x + 1.5, y + 1.5)
    c.fillStyle = color
    c.fillText(s, x, y)
  }
}
