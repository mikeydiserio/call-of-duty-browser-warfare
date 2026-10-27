import { Vector3 } from 'three'
import type { Game } from '../core/game'
import type { ObjectiveId, Team } from '../core/types'
import { el, setClass, Txt } from './dom'
import { emblemSvg, ICON, objectiveSvg } from './icons'

const MARKER_POOL = 4
const RING_C = 2 * Math.PI * 25

type Side = 'friend' | 'enemy' | 'none'
type Announce = (text: string, sub: string, cls: 'friend' | 'enemy') => void

interface FlagSlot {
  id: ObjectiveId
  root: HTMLElement
  ring: SVGCircleElement
  sig: string
}

interface Marker {
  root: HTMLElement
  icon: HTMLElement
  label: Txt
  dist: Txt
  sig: string
  on: boolean
}

/**
 * Objective-mode HUD layered on top of the core HUD: Domination flags and
 * capture bar, Search & Destroy round/alive/bomb widgets, plant/defuse prompt,
 * world-space objective markers and objective splashes.
 */
export class ModeHud {
  readonly el = el('div', 'mode-hud')
  private game: Game
  private announce: Announce
  private designW = 1920

  // Domination
  private domBar = el('div', 'mh-dom', this.el)
  private flags: FlagSlot[] = []
  private flagSig = ''
  private lastOwner = new Map<ObjectiveId, Team | null>()

  // S&D
  private sdBar = el('div', 'mh-sd', this.el)
  private sdRound: Txt
  private sdRole: Txt
  private aliveF: Txt
  private aliveE: Txt
  private sdTimer: HTMLElement
  private sdTimerTxt: Txt
  private carry: HTMLElement

  // shared centre widgets
  private cap = el('div', 'mh-cap', this.el)
  private capLabel: Txt
  private capKey: HTMLElement
  private capFill: HTMLElement
  private lastCapP = -1

  // world markers
  private markersEl = el('div', 'mh-markers', this.el)
  private markers: Marker[] = []

  private v = new Vector3()

  constructor(game: Game, announce: Announce) {
    this.game = game
    this.announce = announce

    // S&D header
    this.sdRound = new Txt(el('div', 'sd-round', this.sdBar))
    this.sdRole = new Txt(el('div', 'sd-role', this.sdBar))
    const alive = el('div', 'sd-alive', this.sdBar)
    const f = el('div', 'sd-team friend', alive)
    el('span', 'sd-em', f).dataset.team = 'friend'
    this.aliveF = new Txt(el('span', 'sd-n', f))
    const e = el('div', 'sd-team enemy', alive)
    this.aliveE = new Txt(el('span', 'sd-n', e))
    el('span', 'sd-em', e).dataset.team = 'enemy'
    this.sdTimer = el('div', 'sd-timer', this.sdBar)
    el('span', 'sd-bomb', this.sdTimer).innerHTML = ICON.bomb
    this.sdTimerTxt = new Txt(el('span', 'sd-t', this.sdTimer))
    this.carry = el('div', 'mh-carry', this.el)
    this.carry.innerHTML = `${ICON.bomb}<span>BOMB</span>`

    // capture / plant / defuse bar
    const capHead = el('div', 'cap-head', this.cap)
    this.capKey = el('span', 'cap-key', capHead)
    this.capLabel = new Txt(el('span', 'cap-l', capHead))
    const track = el('div', 'cap-track', this.cap)
    this.capFill = el('i', '', track)

    for (let i = 0; i < MARKER_POOL; i++) {
      const root = el('div', 'wm', this.markersEl)
      const icon = el('div', 'wm-ico', root)
      const label = new Txt(el('div', 'wm-l', root))
      const dist = new Txt(el('div', 'wm-d', root))
      this.markers.push({ root, icon, label, dist, sig: '', on: false })
    }

    this.bind()
  }

  resize(designW: number) {
    this.designW = designW
  }

  reset() {
    for (const em of this.sdBar.querySelectorAll<HTMLElement>('.sd-em')) em.textContent = ''
    this.flagSig = ''
    this.lastOwner.clear()
    this.lastCapP = -1
  }

  private side(team: Team | null): Side {
    if (team === null) return 'none'
    return team === this.game.player.team ? 'friend' : 'enemy'
  }

  // ─────────────────────────────── events ────────────────────────────────

  private bind() {
    const g = this.game
    const ev = g.events
    ev.on('objective:captured', ({ id, team }) => {
      const prev = this.lastOwner.get(id) ?? null
      this.lastOwner.set(id, team)
      if (team === g.player.team) this.announce(`${id} CAPTURED!`, 'Hold it to earn points', 'friend')
      else if (prev === g.player.team) this.announce(`WE LOST ${id}`, 'Take it back', 'enemy')
      else this.announce(`ENEMY CAPTURED ${id}`, '', 'enemy')
    })
    ev.on('bomb:pickup', ({ actor }) => {
      if (actor.isPlayer) this.announce('YOU HAVE THE BOMB', 'Plant it at site A or B', 'friend')
    })
    ev.on('bomb:dropped', () => {
      const b = g.mode.bomb
      if (b && b.attackers === g.player.team) this.announce('BOMB DROPPED', 'Recover the bomb', 'enemy')
    })
    ev.on('bomb:planted', ({ site }) => {
      const b = g.mode.bomb
      const ours = !!b && b.attackers === g.player.team
      this.announce('BOMB PLANTED', ours ? `Defend site ${site}` : `Defuse the bomb at ${site}`, ours ? 'friend' : 'enemy')
    })
    ev.on('bomb:defused', () => {
      const b = g.mode.bomb
      const ours = !!b && b.attackers !== g.player.team
      this.announce('BOMB DEFUSED', '', ours ? 'friend' : 'enemy')
    })
    ev.on('round:phase', ({ round, phase, winner, attackers }) => {
      const mine = g.player.team
      if (phase === 'start') {
        const attack = attackers === mine
        this.announce(`ROUND ${round}`, attack ? 'ATTACK: Destroy one of the targets' : 'DEFEND: Protect both targets', 'friend')
      } else {
        const res = winner === 'draw' || !winner ? 'ROUND DRAW' : winner === mine ? 'ROUND WIN' : 'ROUND LOSS'
        this.announce(res, this.roundReason(winner ?? 'draw', attackers), winner === mine ? 'friend' : 'enemy')
      }
    })
    ev.on('bomb:exploded', () => (this.lastBomb = 'exploded'))
    ev.on('bomb:defused', () => (this.lastBomb = 'defused'))
    ev.on('round:phase', ({ phase }) => {
      if (phase === 'start') this.lastBomb = null
    })
  }

  private lastBomb: 'exploded' | 'defused' | null = null

  private roundReason(winner: Team | 'draw', attackers: Team): string {
    if (this.lastBomb === 'exploded') return 'Target destroyed'
    if (this.lastBomb === 'defused') return 'Bomb defused'
    if (winner === 'draw') return 'Time expired'
    const g = this.game
    const loser: Team = winner === 'tf141' ? 'opfor' : 'tf141'
    const anyAlive = g.actors.some((a) => a.alive && a.team === loser)
    if (!anyAlive) return winner === g.player.team ? 'Enemy team eliminated' : 'Your team was eliminated'
    return winner === attackers ? 'Target destroyed' : 'Time expired'
  }

  // ─────────────────────────────── per-frame ─────────────────────────────

  update() {
    const g = this.game
    const id = g.mode.id
    setClass(this.domBar, 'on', id === 'dom' && g.mode.objectives.length > 0)
    setClass(this.sdBar, 'on', id === 'sd')
    let capText = ''
    let capP = 0
    let capCls = ''
    let key = ''
    if (id === 'dom') {
      const r = this.updateDom()
      capText = r.text
      capP = r.p
      capCls = r.cls
    } else if (id === 'sd') {
      const r = this.updateSd()
      capText = r.text
      capP = r.p
      capCls = r.cls
      key = r.key
    } else {
      setClass(this.carry, 'on', false)
    }
    setClass(this.cap, 'on', capText !== '')
    if (capText) {
      this.capLabel.set(capText)
      if (this.capKey.textContent !== key) this.capKey.textContent = key
      setClass(this.capKey, 'on', key !== '')
      this.cap.dataset.cls = capCls
      if (Math.abs(capP - this.lastCapP) > 0.002) {
        this.lastCapP = capP
        this.capFill.style.transform = `scaleX(${capP.toFixed(3)})`
      }
    }
    this.updateMarkers()
  }

  private inside(pos: Vector3, radius: number): boolean {
    const p = this.game.player.position
    return Math.hypot(p.x - pos.x, p.z - pos.z) <= radius
  }

  private updateDom(): { text: string; p: number; cls: string } {
    const g = this.game
    const objs = g.mode.objectives
    const sig = objs.map((o) => o.id).join('')
    if (sig !== this.flagSig) {
      this.flagSig = sig
      this.domBar.textContent = ''
      this.flags = objs.map((o) => {
        const root = el('div', 'flag', this.domBar)
        root.innerHTML = `<svg viewBox="0 0 60 60"><circle class="bg" cx="30" cy="30" r="25"/><circle class="pr" cx="30" cy="30" r="25" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" transform="rotate(-90 30 30)"/></svg><b>${o.id}</b>`
        return { id: o.id, root, ring: root.querySelector('.pr') as SVGCircleElement, sig: '' }
      })
      for (const o of objs) if (!this.lastOwner.has(o.id)) this.lastOwner.set(o.id, o.owner)
    }
    let text = ''
    let p = 0
    let cls = ''
    const player = g.player
    objs.forEach((o, i) => {
      const f = this.flags[i]
      if (!f) return
      const own = this.side(o.owner)
      const capSide = this.side(o.capturingTeam)
      const fsig = `${own}|${capSide}|${o.contested ? 1 : 0}|${o.progress.toFixed(2)}`
      if (fsig !== f.sig) {
        f.sig = fsig
        f.root.className = `flag own-${own} cap-${capSide}${o.contested ? ' contested' : ''}`
        f.ring.setAttribute('stroke-dashoffset', String(RING_C * (1 - (o.capturingTeam || o.contested ? o.progress : 0))))
      }
      if (player.alive && this.inside(o.position, o.radius)) {
        if (o.contested) {
          text = `${o.id} CONTESTED`
          p = o.progress
          cls = 'contested'
        } else if (o.capturingTeam === player.team) {
          text = `CAPTURING ${o.id}`
          p = o.progress
          cls = 'friend'
        } else if (o.capturingTeam) {
          text = `LOSING ${o.id}`
          p = o.progress
          cls = 'enemy'
        }
      }
    })
    return { text, p, cls }
  }

  private updateSd(): { text: string; p: number; cls: string; key: string } {
    const g = this.game
    const b = g.mode.bomb
    const mine = g.player.team
    const theirs: Team = mine === 'tf141' ? 'opfor' : 'tf141'
    this.sdRound.set(`ROUND ${g.mode.round}`)
    const attack = b ? b.attackers === mine : true
    this.sdRole.set(attack ? 'ATTACKING' : 'DEFENDING')
    let af = 0
    let ae = 0
    for (const a of g.actors) {
      if (!a.alive) continue
      if (a.team === mine) af++
      else if (a.team === theirs) ae++
    }
    this.aliveF.set(String(af))
    this.aliveE.set(String(ae))
    for (const em of this.sdBar.querySelectorAll<HTMLElement>('.sd-em')) {
      if (!em.firstChild) em.innerHTML = emblemSvg(em.dataset.team === 'friend' ? mine : theirs)
    }
    const planted = !!b?.planted
    setClass(this.sdTimer, 'on', planted)
    if (b && planted) {
      const t = Math.max(0, b.fuseLeft)
      this.sdTimerTxt.set(t < 10 ? t.toFixed(1) : `0:${String(Math.ceil(t)).padStart(2, '0')}`)
      setClass(this.sdTimer, 'urgent', t < 10)
    }
    const p = g.player
    setClass(this.carry, 'on', !!b && b.carrier === p && p.alive)

    if (!b || !p.alive || g.mode.phase !== 'playing') return { text: '', p: 0, cls: '', key: '' }
    if (b.defuseProgress > 0) return { text: 'DEFUSING BOMB…', p: b.defuseProgress, cls: attack ? 'enemy' : 'friend', key: '' }
    if (b.plantProgress > 0) return { text: 'PLANTING BOMB…', p: b.plantProgress, cls: attack ? 'friend' : 'enemy', key: '' }
    if (!planted && b.carrier === p) {
      for (const s of g.map.bombSites) if (this.inside(s.position, s.radius)) return { text: `HOLD TO PLANT THE BOMB AT ${s.id}`, p: 0, cls: 'prompt', key: 'F' }
    }
    if (planted && !attack && p.position.distanceTo(b.position) < 2.2) return { text: 'HOLD TO DEFUSE THE BOMB', p: 0, cls: 'prompt', key: 'F' }
    return { text: '', p: 0, cls: '', key: '' }
  }

  // ─────────────────────────────── markers ───────────────────────────────

  private updateMarkers() {
    const g = this.game
    let n = 0
    const put = (pos: Vector3, icon: string, cls: string, label: string, lift = 2.4) => {
      const m = this.markers[n++]
      if (m) this.placeMarker(m, pos, icon, cls, label, lift)
    }
    if (g.mode.phase === 'playing' || g.mode.phase === 'intro') {
      if (g.mode.id === 'dom') {
        for (const o of g.mode.objectives) {
          // MW2 hides the marker of the flag you are standing on (the capture bar takes over).
          if (g.player.alive && this.inside(o.position, o.radius)) continue
          const own = this.side(o.owner)
          const verb = own === 'friend' ? 'DEFEND' : 'CAPTURE'
          put(o.position, o.id, `own-${own}${o.contested || o.capturingTeam ? ' hot' : ''}`, verb)
        }
      } else if (g.mode.id === 'sd') {
        const b = g.mode.bomb
        const attack = b ? b.attackers === g.player.team : true
        if (b?.planted) {
          if (!(g.player.alive && g.player.position.distanceTo(b.position) < 2.2)) put(b.position, 'bomb', 'enemy hot', attack ? 'DEFEND' : 'DEFUSE', 1.4)
        } else {
          for (const s of g.map.bombSites) {
            if (!(g.player.alive && this.inside(s.position, s.radius))) put(s.position, s.id, 'site', attack ? 'PLANT' : 'DEFEND')
          }
          if (b && !b.carrier && attack) put(b.position, 'bomb', 'friend', 'BOMB', 1)
        }
      }
    }
    for (let i = n; i < this.markers.length; i++) {
      const m = this.markers[i]!
      if (m.on) {
        m.on = false
        m.root.classList.remove('on')
      }
    }
  }

  private placeMarker(m: Marker, pos: Vector3, icon: string, cls: string, label: string, lift: number) {
    const g = this.game
    const cam = g.render.camera
    const W = this.designW
    const H = 1080
    const v = this.v.copy(pos)
    v.y += lift
    v.project(cam)
    let x = (v.x * 0.5 + 0.5) * W
    let y = (-v.y * 0.5 + 0.5) * H
    const behind = v.z > 1
    if (behind) {
      x = W - x
      y = H - 60
    }
    const pad = 60
    const clamped = behind || x < pad || x > W - pad || y < pad || y > H - pad
    x = Math.min(W - pad, Math.max(pad, x))
    y = Math.min(H - pad, Math.max(pad, y))
    const sig = `${icon}|${cls}|${label}`
    if (sig !== m.sig) {
      m.sig = sig
      m.icon.innerHTML = icon === 'bomb' ? ICON.bomb : objectiveSvg(icon)
      m.root.className = `wm ${cls} on`
      m.label.set(label)
    }
    if (!m.on) {
      m.on = true
      m.root.classList.add('on')
    }
    setClass(m.root, 'edge', clamped)
    const d = g.player.position.distanceTo(pos)
    m.dist.set(`${Math.round(d)}m`)
    m.root.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`
  }
}
