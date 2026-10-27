import { Vector3 } from 'three'
import { CONFIG } from '../core/config'
import type { Game } from '../core/game'
import type { Actor, Team, WeaponId } from '../core/types'
import { WEAPONS } from '../weapons/defs'
import { damp, el, fmtTime, retrigger, setClass, Txt } from './dom'
import { emblemSvg, ICON, weaponSvg } from './icons'
import { Minimap } from './minimap'

const DESIGN_H = 1080
const FRIEND_CLS = 'friend'
const ENEMY_CLS = 'enemy'
const MAX_KILLFEED = 5
const DMG_POOL = 8
const GREN_POOL = 3

interface DmgInd {
  el: HTMLElement
  actor: Actor | null
  pos: Vector3
  born: number
  key: number
  angle: number
  active: boolean
}

interface GrenInd {
  el: HTMLElement
  icon: HTMLElement
  pos: Vector3 | null
  born: number
  angle: number
  active: boolean
}

interface FeedRow {
  el: HTMLElement
  born: number
  out: boolean
}

interface KillInfo {
  name: string
  weaponId: WeaponId
  headshot: boolean
  enemy: boolean
}

/** All in-match HUD elements. Positions are in 1080p design space (the UI root scales them). */
export class Hud {
  readonly el = el('div', 'hud')
  private minimap: Minimap
  private game: Game

  // score
  private scoreFriend: Txt
  private scoreEnemy: Txt
  private barFriend: HTMLElement
  private barEnemy: HTMLElement
  private timer: Txt
  private timerEl: HTMLElement
  private lastScore = [-1, -1]

  // ammo
  private ammoCanvas: HTMLCanvasElement
  private ammoCtx: CanvasRenderingContext2D
  private ammoWeapon: Txt
  private ammoReserve: Txt
  private ammoMode: Txt
  private ammoFrag: Txt
  private ammoOther: Txt
  private ammoEl: HTMLElement
  private ammoSig = ''
  private fragIcon: HTMLElement
  private canvasScale = 1

  // centre
  private cross: HTMLElement
  private crossGap = 10
  private lastCrossGap = -1
  private hit: HTMLElement
  private points: HTMLElement
  private lastPointT = -9
  private pointStack = 0
  private prompt: HTMLElement
  private promptTxt: Txt
  private promptSub: Txt

  // killfeed
  private feed: HTMLElement
  private feedRows: FeedRow[] = []

  // announcements
  private announce: HTMLElement
  private annT: Txt
  private annS: Txt
  private annQueue: { text: string; sub?: string; cls: string }[] = []
  private annUntil = 0
  private streakSplash: HTMLElement
  private ssT: Txt
  private ssS: Txt
  private ssUntil = 0
  private holdAnnounce = false

  // streak + uav
  private streakEl: HTMLElement
  private streakCount: Txt
  private lastStreakN = 0
  private uavLabel: HTMLElement
  private uavTxt: Txt

  // indicators
  private dmg: DmgInd[] = []
  private gren: GrenInd[] = []

  // death
  private death: HTMLElement
  private dName: Txt
  private dWeapon: HTMLElement
  private dResp: Txt
  private dRespSub: Txt
  private lastKill: KillInfo | null = null
  private deathShown = false

  private tmp = new Vector3()

  constructor(game: Game) {
    this.game = game
    const root = this.el

    // ── minimap ──
    this.minimap = new Minimap(game)
    root.appendChild(this.minimap.el)
    this.uavLabel = el('div', 'hud-uav', root)
    this.uavTxt = new Txt(this.uavLabel)

    // ── score block ──
    const score = el('div', 'hud-score', root)
    const trow = el('div', 'sc-time', score)
    el('span', 'sc-timelabel', trow, 'TIME')
    this.timerEl = el('span', 'sc-timer', trow)
    this.timer = new Txt(this.timerEl)
    const mk = (team: Team, cls: string) => {
      const r = el('div', `sc-row ${cls}`, score)
      const em = el('span', 'sc-emblem', r)
      em.innerHTML = emblemSvg(team)
      const track = el('div', 'sc-track', r)
      const fill = el('i', '', track)
      const num = el('span', 'sc-num', r)
      return { fill, num: new Txt(num) }
    }
    const f = mk('tf141', FRIEND_CLS)
    const e = mk('opfor', ENEMY_CLS)
    this.barFriend = f.fill
    this.barEnemy = e.fill
    this.scoreFriend = f.num
    this.scoreEnemy = e.num

    // ── killfeed ──
    this.feed = el('div', 'hud-feed', root)

    // ── ammo ──
    this.ammoEl = el('div', 'hud-ammo', root)
    this.ammoWeapon = new Txt(el('div', 'am-weapon', this.ammoEl))
    const main = el('div', 'am-main', this.ammoEl)
    this.ammoCanvas = el('canvas', 'am-bullets', main)
    const c = this.ammoCanvas.getContext('2d')
    if (!c) throw new Error('2D canvas unavailable')
    this.ammoCtx = c
    this.ammoReserve = new Txt(el('div', 'am-reserve', main))
    const sub = el('div', 'am-sub', this.ammoEl)
    this.ammoMode = new Txt(el('span', 'am-mode', sub))
    this.ammoOther = new Txt(el('span', 'am-other', sub))
    this.fragIcon = el('span', 'am-frag', sub)
    this.fragIcon.innerHTML = weaponSvg('frag')
    this.ammoFrag = new Txt(el('span', 'am-fragn', this.fragIcon))

    // ── crosshair & feedback ──
    this.cross = el('div', 'hud-cross', root)
    for (const s of ['t', 'b', 'l', 'r']) el('i', s, this.cross)
    this.hit = el('div', 'hud-hit', root)
    this.hit.innerHTML = `<svg viewBox="-20 -20 40 40"><path d="M-12 -12 L-5 -5 M12 -12 L5 -5 M-12 12 L-5 5 M12 12 L5 5" /></svg>`
    this.points = el('div', 'hud-points', root)
    this.prompt = el('div', 'hud-prompt', root)
    this.promptTxt = new Txt(el('div', 'pr-main', this.prompt))
    this.promptSub = new Txt(el('div', 'pr-sub', this.prompt))

    // ── announcements ──
    this.announce = el('div', 'hud-announce', root)
    this.annT = new Txt(el('div', 'an-t', this.announce))
    this.annS = new Txt(el('div', 'an-s', this.announce))
    this.streakSplash = el('div', 'hud-ssplash', root)
    this.ssT = new Txt(el('div', 'an-t', this.streakSplash))
    this.ssS = new Txt(el('div', 'an-s', this.streakSplash))

    // ── streak icon ──
    this.streakEl = el('div', 'hud-streak', root)
    this.streakEl.innerHTML = `<div class="st-ico">${ICON.uav}</div><div class="st-name">UAV</div><div class="st-key"><kbd>4</kbd></div>`
    this.streakCount = new Txt(el('div', 'st-count', this.streakEl))

    // ── damage & grenade indicators ──
    const dmgRoot = el('div', 'hud-dmg', root)
    for (let i = 0; i < DMG_POOL; i++) {
      const d = el('div', 'dmg-ind', dmgRoot)
      d.innerHTML = `<svg viewBox="-60 -230 120 80"><path d="M-48 -176 A180 180 0 0 1 48 -176 L36 -168 A166 166 0 0 0 -36 -168 Z"/></svg>`
      this.dmg.push({ el: d, actor: null, pos: new Vector3(), born: 0, key: -1, angle: 0, active: false })
    }
    const grRoot = el('div', 'hud-gren', root)
    for (let i = 0; i < GREN_POOL; i++) {
      const g = el('div', 'gren-ind', grRoot)
      const icon = el('div', 'gren-icon', g)
      icon.innerHTML = `${ICON.grenadeWarn}<span class="gr-arrow"></span>`
      this.gren.push({ el: g, icon, pos: null, born: 0, angle: 0, active: false })
    }

    // ── death ──
    this.death = el('div', 'hud-death', root)
    el('div', 'd-by', this.death, 'KILLED BY')
    this.dName = new Txt(el('div', 'd-name', this.death))
    this.dWeapon = el('div', 'd-weapon', this.death)
    this.dResp = new Txt(el('div', 'd-resp', this.death))
    this.dRespSub = new Txt(el('div', 'd-respsub', this.death))

    this.bind()
  }

  resize(designToPx: number) {
    this.minimap.resize(designToPx)
    this.canvasScale = designToPx * Math.min(window.devicePixelRatio || 1, 2)
    this.ammoSig = '' // force ammo canvas redraw at new resolution
  }

  /** Called when a match starts so stale transient state is cleared. */
  reset() {
    this.annQueue.length = 0
    this.annUntil = 0
    this.ssUntil = 0
    this.announce.classList.remove('on')
    this.streakSplash.classList.remove('on')
    this.feed.textContent = ''
    this.feedRows.length = 0
    this.points.textContent = ''
    for (const d of this.dmg) this.hideDmg(d)
    for (const g of this.gren) this.hideGren(g)
    this.lastKill = null
    this.deathShown = false
    this.lastScore = [-1, -1]
    this.ammoSig = ''
    this.lastStreakN = 0
    setClass(this.death, 'on', false)
  }

  /** When true, announcements are held back (e.g. while the loading screen is up). */
  setHoldAnnouncements(hold: boolean) {
    this.holdAnnounce = hold
  }

  // ─────────────────────────────── events ────────────────────────────────

  private bind() {
    const g = this.game
    const ev = g.events

    ev.on('actor:killed', (info) => {
      this.addFeed(info.attacker, info.victim, info.weaponId, info.headshot)
      if (info.victim.isPlayer) {
        const k = info.attacker
        this.lastKill = {
          name: k && k !== info.victim ? k.name : '',
          weaponId: info.weaponId,
          headshot: info.headshot,
          enemy: !!k && k.team !== info.victim.team,
        }
      }
    })

    ev.on('player:hitmarker', ({ headshot, kill }) => {
      const h = this.hit
      h.classList.toggle('kill', kill)
      h.classList.toggle('head', headshot)
      h.animate(
        [
          { opacity: 1, transform: `translate(-50%,-50%) scale(${kill ? 0.6 : 0.75})` },
          { opacity: 1, transform: `translate(-50%,-50%) scale(${kill ? 1.25 : 1})`, offset: 0.18 },
          { opacity: kill ? 0.9 : 0.8, transform: `translate(-50%,-50%) scale(${kill ? 1.25 : 1})`, offset: 0.55 },
          { opacity: 0, transform: `translate(-50%,-50%) scale(${kill ? 1.4 : 1.1})` },
        ],
        { duration: kill ? 520 : 300, easing: 'ease-out' },
      )
    })

    ev.on('player:points', ({ amount, reason }) => this.addPoints(amount, reason))

    ev.on('actor:damaged', (d) => {
      if (!d.victim.isPlayer || !d.attacker || d.attacker === d.victim) return
      this.addDamage(d.attacker)
    })

    ev.on('grenade:warning', ({ position }) => {
      let slot = this.gren.find((x) => !x.active)
      if (!slot) slot = this.gren[0]!
      slot.pos = position
      slot.born = g.realTime
      slot.active = true
      slot.el.classList.add('on')
    })
    ev.on('grenade:explode', ({ position }) => {
      for (const s of this.gren) {
        if (s.active && s.pos && s.pos.distanceTo(position) < 0.8) this.hideGren(s)
      }
    })

    ev.on('match:announce', ({ text, sub }) => {
      const enemy = /^ENEMY/i.test(text)
      this.annQueue.push({ text, sub, cls: enemy ? 'enemy' : 'friend' })
    })

    ev.on('killstreak:earned', ({ actor, streak }) => {
      if (!actor.isPlayer) return
      this.showStreakSplash(`${streak === 'uav' ? 'UAV' : 'AIRSTRIKE'} READY`, 'Press 4 to call in', 'friend')
    })
    ev.on('killstreak:used', ({ streak, team }) => {
      const ours = team === g.player.team
      const name = streak === 'uav' ? 'UAV' : 'AIRSTRIKE'
      if (ours) this.showStreakSplash(`${name} ONLINE`, 'Enemy positions revealed', 'friend')
      else this.showStreakSplash(`ENEMY ${name} INBOUND`, 'You are being tracked', 'enemy')
    })

    ev.on('match:phase', ({ phase }) => {
      if (phase === 'intro') this.reset()
    })
  }

  private addFeed(killer: Actor | null, victim: Actor, weaponId: WeaponId, headshot: boolean) {
    const mine = this.game.player.team
    const cls = (a: Actor) => (a.isPlayer ? 'you' : a.team === mine ? FRIEND_CLS : ENEMY_CLS)
    const row = el('div', 'kf')
    if (killer && killer !== victim) {
      el('span', `kf-n ${cls(killer)}`, row, killer.name)
      const w = el('span', 'kf-w', row)
      w.innerHTML = weaponSvg(weaponId)
      if (headshot) {
        const h = el('span', 'kf-hs', row)
        h.innerHTML = ICON.headshot
      }
    } else {
      const s = el('span', 'kf-w skull', row)
      s.innerHTML = ICON.skull
    }
    el('span', `kf-n ${cls(victim)}`, row, victim.name)
    this.feed.appendChild(row)
    this.feedRows.push({ el: row, born: this.game.realTime, out: false })
    while (this.feedRows.length > MAX_KILLFEED) this.feedRows.shift()!.el.remove()
  }

  private addPoints(amount: number, reason: string) {
    const now = this.game.realTime
    this.pointStack = now - this.lastPointT < 0.45 ? this.pointStack + 1 : 0
    this.lastPointT = now
    const p = el('div', 'pt', this.points)
    p.style.setProperty('--off', `${this.pointStack * 34}px`)
    p.innerHTML = `<b>+${amount}</b>${reason ? `<span>${reason}</span>` : ''}`
    p.addEventListener('animationend', () => p.remove(), { once: true })
    while (this.points.childElementCount > 6) this.points.firstElementChild?.remove()
  }

  private addDamage(attacker: Actor) {
    const now = this.game.realTime
    let slot = this.dmg.find((d) => d.active && d.key === attacker.id)
    slot ??= this.dmg.find((d) => !d.active)
    slot ??= this.dmg.reduce((a, b) => (a.born < b.born ? a : b))
    slot.key = attacker.id
    slot.actor = attacker
    slot.pos.copy(attacker.position)
    slot.born = now
    slot.active = true
    slot.el.classList.add('on')
    retrigger(slot.el, 'pulse')
  }

  private hideDmg(d: DmgInd) {
    d.active = false
    d.actor = null
    d.key = -1
    d.el.classList.remove('on', 'pulse')
  }

  private hideGren(s: GrenInd) {
    s.active = false
    s.pos = null
    s.el.classList.remove('on')
  }

  private showStreakSplash(t: string, s: string, cls: string) {
    this.ssT.set(t)
    this.ssS.set(s)
    this.streakSplash.classList.remove('friend', 'enemy')
    this.streakSplash.classList.add(cls)
    retrigger(this.streakSplash, 'on')
    this.ssUntil = this.game.realTime + 3
  }

  // ─────────────────────────────── per-frame ─────────────────────────────

  update(dt: number) {
    const g = this.game
    const now = g.realTime
    const mode = g.mode
    const player = g.player
    const playing = mode.phase === 'playing'
    const live = (playing || mode.phase === 'intro') && player.alive

    this.minimap.draw()
    this.updateScore()
    this.updateAmmo()
    this.updateCrosshair(dt, live && playing)
    this.updateFeed(now)
    this.updateAnnounce(now)
    this.updateStreak()
    this.updateIndicators(now)
    this.updateDeath(playing)
  }

  private updateScore() {
    const m = this.game.mode
    const mine = this.game.player.team
    const theirs: Team = mine === 'tf141' ? 'opfor' : 'tf141'
    const a = m.score[mine]
    const b = m.score[theirs]
    if (a !== this.lastScore[0]) {
      this.lastScore[0] = a
      this.scoreFriend.set(String(a))
      this.barFriend.style.transform = `scaleX(${Math.min(1, a / CONFIG.scoreLimit)})`
    }
    if (b !== this.lastScore[1]) {
      this.lastScore[1] = b
      this.scoreEnemy.set(String(b))
      this.barEnemy.style.transform = `scaleX(${Math.min(1, b / CONFIG.scoreLimit)})`
    }
    this.timer.set(fmtTime(m.timeLeft))
    setClass(this.timerEl, 'low', m.timeLeft <= 30 && m.phase === 'playing')
  }

  private updateAmmo() {
    const g = this.game
    const w = g.player.weapons
    const h = w.getHudState()
    this.ammoWeapon.set(h.weaponName.toUpperCase())
    this.ammoReserve.set(String(h.reserve))
    this.ammoMode.set(h.fireMode)
    this.ammoOther.set(h.otherWeaponName ? h.otherWeaponName.toUpperCase() : '')
    this.ammoFrag.set(h.frags > 0 ? `x${h.frags}` : 'x0')
    setClass(this.fragIcon, 'none', h.frags <= 0)

    const noAmmo = h.ammo === 0 && h.reserve === 0
    const lowMag = h.magSize > 0 && h.ammo <= Math.max(1, Math.floor(h.magSize * 0.33)) && h.reserve > 0 && h.weaponId !== 'frag'
    const lowTotal = h.magSize > 0 && h.reserve === 0 && h.ammo > 0 && h.ammo <= h.magSize * 0.33
    setClass(this.ammoEl, 'low', h.ammo <= h.magSize * 0.33 || noAmmo)

    const sig = `${h.weaponId}|${h.ammo}|${h.magSize}|${h.ammo <= h.magSize * 0.33 ? 1 : 0}`
    if (sig !== this.ammoSig) {
      this.ammoSig = sig
      this.drawBullets(h.ammo, h.magSize)
    }

    // centre prompt
    let msg = ''
    let sub = ''
    let cls = ''
    if (this.game.mode.phase === 'playing' && g.player.alive && h.magSize > 0) {
      if (noAmmo) {
        msg = 'NO AMMO'
        cls = 'bad'
      } else if (!h.reloading && lowMag) {
        msg = 'RELOAD'
        sub = 'Press R'
        cls = h.ammo === 0 ? 'bad' : 'warn'
      } else if (lowTotal) {
        msg = 'LOW AMMO'
        cls = 'warn'
      }
    }
    this.promptTxt.set(msg)
    this.promptSub.set(sub)
    setClass(this.prompt, 'on', msg !== '')
    this.prompt.classList.toggle('bad', cls === 'bad')
    this.prompt.classList.toggle('warn', cls === 'warn')
  }

  private drawBullets(ammo: number, mag: number) {
    const ctx = this.ammoCtx
    const cv = this.ammoCanvas
    if (mag <= 0) {
      cv.width = cv.height = 1
      return
    }
    const big = mag <= 8
    const bw = big ? 10 : mag <= 16 ? 7.5 : 6
    const bh = big ? 34 : mag <= 16 ? 24 : 19
    const gap = big ? 5 : 3.5
    const cols = mag <= 16 ? mag : Math.ceil(mag / 2)
    const rows = mag <= 16 ? 1 : 2
    const W = cols * (bw + gap) - gap
    const H = rows * (bh + gap) - gap
    cv.style.width = `${W}px`
    cv.style.height = `${H}px`
    const sc = this.canvasScale
    cv.width = Math.max(1, Math.round(W * sc))
    cv.height = Math.max(1, Math.round(H * sc))
    ctx.setTransform(sc, 0, 0, sc, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const low = ammo <= mag * 0.33
    const spent = 'rgba(255,255,255,0.16)'
    const full = low ? '#ff6a3c' : '#ffffff'
    for (let i = 0; i < mag; i++) {
      // fill from the left; depletes from the right-most / last row slot
      const row = Math.floor(i / cols)
      const col = i % cols
      const x = col * (bw + gap)
      const y = row * (bh + gap)
      const alive = i < ammo
      ctx.fillStyle = alive ? full : spent
      if (alive) {
        ctx.shadowColor = 'rgba(0,0,0,.9)'
        ctx.shadowBlur = 2
      } else ctx.shadowBlur = 0
      // casing
      ctx.beginPath()
      ctx.roundRect(x, y + bh * 0.3, bw, bh * 0.7, 1.2)
      ctx.fill()
      // tip
      ctx.beginPath()
      ctx.moveTo(x + 0.4, y + bh * 0.3)
      ctx.quadraticCurveTo(x + bw / 2, y - bh * 0.05, x + bw - 0.4, y + bh * 0.3)
      ctx.closePath()
      ctx.fill()
      if (alive) {
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(0,0,0,.35)'
        ctx.fillRect(x, y + bh * 0.3, bw, 1.2)
      }
    }
    ctx.shadowBlur = 0
  }

  private updateCrosshair(dt: number, active: boolean) {
    const g = this.game
    const w = g.player.weapons
    const speed = Math.hypot(g.player.velocity.x, g.player.velocity.z)
    const sprinting = g.input.state.sprint && speed > 3.2
    const hidden = !active || w.adsAmount > 0.3 || sprinting || w.scoped
    setClass(this.cross, 'hide', hidden)
    if (hidden) return
    const vfov = g.render.camera.fov
    const px = (Math.tan((w.spread * Math.PI) / 180) / Math.tan((vfov * Math.PI) / 360)) * (DESIGN_H / 2)
    const target = Math.min(150, Math.max(5, px))
    this.crossGap = damp(this.crossGap, target, 22, dt)
    if (Math.abs(this.crossGap - this.lastCrossGap) > 0.2) {
      this.lastCrossGap = this.crossGap
      this.cross.style.setProperty('--gap', `${this.crossGap.toFixed(1)}px`)
    }
  }

  private updateFeed(now: number) {
    for (let i = this.feedRows.length - 1; i >= 0; i--) {
      const r = this.feedRows[i]!
      const age = now - r.born
      if (!r.out && age > 5.4) {
        r.out = true
        r.el.classList.add('out')
      }
      if (age > 6.2) {
        r.el.remove()
        this.feedRows.splice(i, 1)
      }
    }
  }

  private updateAnnounce(now: number) {
    if (!this.holdAnnounce && now >= this.annUntil && this.annQueue.length) {
      const a = this.annQueue.shift()!
      this.annT.set(a.text)
      this.annS.set(a.sub ?? '')
      this.announce.classList.remove('friend', 'enemy')
      this.announce.classList.add(a.cls)
      retrigger(this.announce, 'on')
      this.annUntil = now + (a.sub ? 3.4 : 2.4)
    }
    if (this.ssUntil && now > this.ssUntil) {
      this.ssUntil = 0
      this.streakSplash.classList.remove('on')
    }
  }

  private updateStreak() {
    const g = this.game
    const n = g.mode.playerStreaks.length
    if (n !== this.lastStreakN) {
      if (n > this.lastStreakN) retrigger(this.streakEl, 'pop')
      this.lastStreakN = n
      this.streakCount.set(n > 1 ? `x${n}` : '')
      setClass(this.streakEl, 'on', n > 0)
      const first = g.mode.playerStreaks[0]
      const ico = this.streakEl.querySelector('.st-ico')
      const name = this.streakEl.querySelector('.st-name')
      if (first && ico && name) {
        ico.innerHTML = first === 'uav' ? ICON.uav : ICON.airstrike
        name.textContent = first === 'uav' ? 'UAV' : 'AIRSTRIKE'
      }
    }
    // UAV status under the minimap
    const mine = g.player.team
    const theirs: Team = mine === 'tf141' ? 'opfor' : 'tf141'
    let label = ''
    let cls = ''
    if (g.mode.isUavActive(mine)) {
      label = `UAV ONLINE  ${Math.max(0, Math.ceil(g.mode.uavUntil[mine] - g.time))}`
      cls = 'friend'
    } else if (g.mode.isUavActive(theirs)) {
      label = 'ENEMY UAV'
      cls = 'enemy'
    }
    this.uavTxt.set(label)
    this.uavLabel.classList.toggle('friend', cls === 'friend')
    this.uavLabel.classList.toggle('enemy', cls === 'enemy')
    setClass(this.uavLabel, 'on', label !== '')
  }

  private updateIndicators(now: number) {
    const g = this.game
    const p = g.player
    const sinY = Math.sin(p.yaw)
    const cosY = Math.cos(p.yaw)
    // forward = (-sin, -cos); right = (cos, -sin)
    for (const d of this.dmg) {
      if (!d.active) continue
      const age = now - d.born
      if (age > 2.4) {
        this.hideDmg(d)
        continue
      }
      const a = d.actor
      const pos = a && a.alive ? a.position : d.pos
      if (a && a.alive) d.pos.copy(pos)
      const dx = pos.x - p.position.x
      const dz = pos.z - p.position.z
      const ang = Math.atan2(dx * cosY - dz * sinY, -dx * sinY - dz * cosY)
      const deg = (ang * 180) / Math.PI
      if (Math.abs(deg - d.angle) > 0.6) {
        d.angle = deg
        d.el.style.transform = `rotate(${deg.toFixed(1)}deg)`
      }
      const o = age < 0.1 ? 1 : Math.max(0, 1 - (age - 0.6) / 1.8)
      d.el.style.opacity = o.toFixed(2)
    }
    for (const s of this.gren) {
      if (!s.active || !s.pos) continue
      const age = now - s.born
      if (age > 2.6) {
        this.hideGren(s)
        continue
      }
      const dx = s.pos.x - p.position.x
      const dz = s.pos.z - p.position.z
      const ang = Math.atan2(dx * cosY - dz * sinY, -dx * sinY - dz * cosY)
      const deg = (ang * 180) / Math.PI
      if (Math.abs(deg - s.angle) > 0.4) {
        s.angle = deg
        s.el.style.transform = `rotate(${deg.toFixed(1)}deg)`
        s.icon.style.transform = `translateY(-250px) rotate(${(-deg).toFixed(1)}deg)`
      }
      const flash = 0.55 + 0.45 * Math.sin(now * 14)
      s.el.style.opacity = (age > 2.1 ? Math.max(0, (2.6 - age) / 0.5) : flash).toFixed(2)
    }
  }

  private updateDeath(playing: boolean) {
    const g = this.game
    const p = g.player
    const dead = playing && !p.alive
    if (dead !== this.deathShown) {
      this.deathShown = dead
      setClass(this.death, 'on', dead)
      if (dead) {
        const k = this.lastKill
        const name = k?.name || (p.lastKiller?.name ?? '')
        const wid = k?.weaponId ?? p.lastKiller?.weaponId ?? null
        this.dName.set(name ? name : 'YOU WERE KILLED')
        setClass(this.death, 'noname', !name)
        this.dWeapon.innerHTML = wid
          ? `${weaponSvg(wid)}<span>${WEAPONS[wid]?.name.toUpperCase() ?? ''}</span>${k?.headshot ? '<em>HEADSHOT</em>' : ''}`
          : ''
        const enemy = k ? k.enemy : true
        this.death.classList.toggle('friendly', !enemy)
      }
    }
    if (!dead) return
    const left = g.mode.respawnIn(p)
    const canSkip = left > 0 && left < CONFIG.respawnDelay - 1.6
    this.dResp.set(left > 0 ? `RESPAWN IN ${Math.ceil(left)}` : 'RESPAWNING')
    this.dRespSub.set(canSkip ? 'PRESS FIRE TO RESPAWN' : '')
    setClass(this.death, 'ready', canSkip)
  }

  // visibility toggled by the coordinator
  setVisible(v: boolean) {
    setClass(this.el, 'on', v)
  }
}
