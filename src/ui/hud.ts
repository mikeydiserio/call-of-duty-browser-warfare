import { Vector3 } from 'three'
import { CONFIG } from '../core/config'
import type { Game } from '../core/game'
import type { Actor, Team, WeaponId } from '../core/types'
import { WEAPONS } from '../weapons/defs'
import { damp, el, fmtTime, retrigger, setClass, Txt } from './dom'
import { emblemSvg, ICON, weaponSvg } from './icons'
import { Minimap } from './minimap'
import { ModeHud } from './mode-hud'
import { StreakHud } from './streak-hud'
import { KILLSTREAKS, killstreakSvg, type KillstreakId } from '../game/killstreaks/defs'
import { ffaStandings, ordinal } from './modes'

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
  private scoreEl!: HTMLElement
  private emFriend!: HTMLElement
  private emEnemy!: HTMLElement
  private scoreLayout = ''
  private place!: Txt
  private modeHud: ModeHud

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
  private announceEl: HTMLElement
  private annT: Txt
  private annS: Txt
  private annQueue: { text: string; sub?: string; cls: string }[] = []
  private annUntil = 0
  private streakSplash: HTMLElement
  private ssT: Txt
  private ssS: Txt
  private ssUntil = 0
  private holdAnnounce = false

  // killstreaks + uav
  private ks: StreakHud
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
    this.scoreEl = score
    const trow = el('div', 'sc-time', score)
    el('span', 'sc-timelabel', trow, 'TIME')
    this.timerEl = el('span', 'sc-timer', trow)
    this.timer = new Txt(this.timerEl)
    this.place = new Txt(el('span', 'sc-place', trow))
    const mk = (cls: string) => {
      const r = el('div', `sc-row ${cls}`, score)
      const em = el('span', 'sc-emblem', r)
      const track = el('div', 'sc-track', r)
      const fill = el('i', '', track)
      const num = el('span', 'sc-num', r)
      return { em, fill, num: new Txt(num) }
    }
    const f = mk(FRIEND_CLS)
    const e = mk(ENEMY_CLS)
    this.emFriend = f.em
    this.emEnemy = e.em
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
    this.announceEl = el('div', 'hud-announce', root)
    this.annT = new Txt(el('div', 'an-t', this.announceEl))
    this.annS = new Txt(el('div', 'an-s', this.announceEl))
    this.streakSplash = el('div', 'hud-ssplash', root)
    this.ssT = new Txt(el('div', 'an-t', this.streakSplash))
    this.ssS = new Txt(el('div', 'an-s', this.streakSplash))

    // ── killstreaks ──
    this.ks = new StreakHud(game, root)
    root.appendChild(this.ks.el)

    // ── damage & grenade indicators ──
    const dmgRoot = el('div', 'hud-dmg', root)
    for (let i = 0; i < DMG_POOL; i++) {
      const d = el('div', 'dmg-ind', dmgRoot)
      d.innerHTML = `<svg viewBox="-80 -200 160 70"><defs><radialGradient id="dmg-g${i}" cx="0" cy="190" r="190" gradientUnits="userSpaceOnUse" fx="0" fy="190"><stop offset=".86" stop-color="#ff1a0a" stop-opacity="0"/><stop offset=".94" stop-color="#d80c06" stop-opacity=".7"/><stop offset="1" stop-color="#ff2a10" stop-opacity=".85"/></radialGradient><linearGradient id="dmg-h${i}" x1="-70" x2="70" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".3" stop-color="#fff"/><stop offset=".7" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="dmg-m${i}"><rect x="-80" y="-200" width="160" height="70" fill="url(#dmg-h${i})"/></mask></defs><path mask="url(#dmg-m${i})" fill="url(#dmg-g${i})" d="M-70 -176.6 A190 190 0 0 1 70 -176.6 L56 -156.3 A166 166 0 0 0 -56 -156.3 Z"/></svg>`
      this.dmg.push({ el: d, actor: null, pos: new Vector3(), born: 0, key: -1, angle: 0, active: false })
    }
    const grRoot = el('div', 'hud-gren', root)
    for (let i = 0; i < GREN_POOL; i++) {
      const g = el('div', 'gren-ind', grRoot)
      const icon = el('div', 'gren-icon', g)
      icon.innerHTML = ICON.grenadeWarn
      el('span', 'gr-arrow', g)
      this.gren.push({ el: g, icon, pos: null, born: 0, angle: 0, active: false })
    }

    // ── objective modes ──
    this.modeHud = new ModeHud(game, (t, sub, cls) => this.announce(t, sub, cls))
    root.appendChild(this.modeHud.el)

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
    this.modeHud.resize(window.innerWidth / designToPx)
    this.canvasScale = designToPx * Math.min(window.devicePixelRatio || 1, 2)
    this.ammoSig = '' // force ammo canvas redraw at new resolution
  }

  /** Called when a match starts so stale transient state is cleared. */
  reset() {
    this.annQueue.length = 0
    this.annUntil = 0
    this.ssUntil = 0
    this.announceEl.classList.remove('on')
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
    this.scoreLayout = ''
    this.modeHud.reset()
    setClass(this.death, 'on', false)
  }

  /** Queue a centre announcement (mode splashes use this too). */
  announce(text: string, sub = '', cls: 'friend' | 'enemy' = 'friend') {
    this.annQueue.push({ text, sub: sub || undefined, cls })
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
      this.addFeed(info.attacker, info.victim, info.weaponId, info.headshot, info.killstreak)
      if (info.victim.isPlayer) {
        const k = info.attacker
        this.lastKill = {
          name: k && k !== info.victim ? k.name : '',
          weaponId: info.weaponId,
          headshot: info.headshot,
          enemy: !!k && g.mode.isEnemy(info.victim, k),
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
    ev.on('player:scavenge', ({ rounds }) => this.addPoints(rounds, 'AMMO'))

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
      if (actor !== g.player) return
      const def = KILLSTREAKS[streak]
      this.showStreakSplash(`${def.kills} KILLSTREAK!`, `${def.name.toUpperCase()} — PRESS 4`, 'friend')
    })
    ev.on('killstreak:used', ({ actor, streak }) => {
      if (actor === g.player || streak === 'sentry') return
      const ours = !g.mode.isEnemy(g.player, actor)
      const name = KILLSTREAKS[streak].name.toUpperCase()
      if (streak === 'nuke') this.showStreakSplash(ours ? 'FRIENDLY TACTICAL NUKE' : 'ENEMY TACTICAL NUKE', `${actor.name.toUpperCase()} — 10 SECONDS`, ours ? 'friend' : 'enemy')
      else if (ours) this.showStreakSplash(`FRIENDLY ${name} INBOUND`, actor.name.toUpperCase(), 'friend')
      else this.showStreakSplash(`ENEMY ${name} INBOUND`, actor.name.toUpperCase(), 'enemy')
    })

    ev.on('match:phase', ({ phase }) => {
      if (phase === 'intro') this.reset()
    })
  }

  private addFeed(killer: Actor | null, victim: Actor, weaponId: WeaponId, headshot: boolean, streak?: KillstreakId) {
    const me = this.game.player
    const mode = this.game.mode
    const cls = (a: Actor) => (a.isPlayer ? 'you' : mode.isEnemy(me, a) ? ENEMY_CLS : FRIEND_CLS)
    const row = el('div', 'kf')
    if (killer && killer !== victim) {
      el('span', `kf-n ${cls(killer)}`, row, killer.name)
      const w = el('span', 'kf-w', row)
      w.innerHTML = streak ? killstreakSvg(streak) : weaponSvg(weaponId)
      if (streak) w.classList.add('ks')
      if (headshot && !streak) {
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
    this.modeHud.update()
    this.updateDeath(playing)
  }

  private updateScore() {
    const g = this.game
    const m = g.mode
    const ffa = m.id === 'ffa'
    const layout = ffa ? 'ffa' : `${m.id}|${g.player.team}`
    if (layout !== this.scoreLayout) {
      this.scoreLayout = layout
      this.lastScore = [-1, -1]
      setClass(this.scoreEl, 'ffa', ffa)
      if (!ffa) {
        const mine = g.player.team
        this.emFriend.innerHTML = emblemSvg(mine)
        this.emEnemy.innerHTML = emblemSvg(mine === 'tf141' ? 'opfor' : 'tf141')
      }
    }
    const limit = Math.max(1, g.match.scoreLimit)
    let a: number
    let b: number
    if (ffa) {
      // MW2 FFA: your score against the leader (or the runner-up when you lead).
      const standings = ffaStandings(g)
      const pos = standings.indexOf(g.player)
      const rival = pos === 0 ? standings[1] : standings[0]
      a = g.player.stats.kills
      b = rival ? rival.stats.kills : 0
      const rivalPlace = rival ? standings.indexOf(rival) + 1 : 2
      const tag = `${pos + 1}|${rivalPlace}`
      if (this.emFriend.dataset.tag !== tag) {
        this.emFriend.dataset.tag = tag
        this.emFriend.textContent = ordinal(pos + 1)
        this.emEnemy.textContent = ordinal(rivalPlace)
      }
      const tied = rival && rival.stats.kills === a && a > 0
      this.place.set(pos === 0 ? (tied ? 'TIED 1ST' : '1ST PLACE') : `${ordinal(pos + 1).toUpperCase()} PLACE`)
    } else {
      const mine = g.player.team
      const theirs: Team = mine === 'tf141' ? 'opfor' : 'tf141'
      a = m.score[mine]
      b = m.score[theirs]
      this.place.set('')
    }
    if (a !== this.lastScore[0]) {
      this.lastScore[0] = a
      this.scoreFriend.set(String(a))
      this.barFriend.style.transform = `scaleX(${Math.min(1, a / limit)})`
    }
    if (b !== this.lastScore[1]) {
      this.lastScore[1] = b
      this.scoreEnemy.set(String(b))
      this.barEnemy.style.transform = `scaleX(${Math.min(1, b / limit)})`
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
      this.announceEl.classList.remove('friend', 'enemy')
      this.announceEl.classList.add(a.cls)
      retrigger(this.announceEl, 'on')
      this.annUntil = now + (a.sub ? 3.4 : 2.4)
    }
    if (this.ssUntil && now > this.ssUntil) {
      this.ssUntil = 0
      this.streakSplash.classList.remove('on')
    }
  }

  private updateStreak() {
    const g = this.game
    this.ks.update()
    // UAV status under the minimap
    const mine = g.player.team
    const theirs: Team = mine === 'tf141' ? 'opfor' : 'tf141'
    let label = ''
    let cls = ''
    if (g.streaks.empAffects(g.player)) {
      label = 'EMP — SYSTEMS DOWN'
      cls = 'enemy'
    } else if (g.streaks.jammed(g.player)) {
      label = 'ENEMY COUNTER-UAV'
      cls = 'enemy'
    } else if (g.mode.isUavActive(mine)) {
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
      const flash = 0.8 + 0.2 * Math.sin(now * 14)
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
    if (!g.mode.canRespawn) {
      // One life per round: spectate a living teammate until the next round.
      const mate = g.mode.spectateTarget(p, 0)
      this.dResp.set(mate ? `SPECTATING ${mate.name.toUpperCase()}` : 'NO TEAMMATES ALIVE')
      this.dRespSub.set('WAITING FOR NEXT ROUND')
      setClass(this.death, 'ready', false)
      setClass(this.death, 'spectate', true)
      return
    }
    setClass(this.death, 'spectate', false)
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
