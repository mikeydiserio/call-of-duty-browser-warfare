import type { Team } from '../core/types'
import { CONFIG } from '../core/config'
import type { Game } from '../core/game'
import { levelForXp, loadXp, rankName, saveXp, xpForLevel, RANK_NAMES } from './data'
import { clamp, el, setClass, Txt } from './dom'
import { emblemSvg, rankSvg, WORDMARK } from './icons'
import { MenuList, type UiCtx } from './screen'
import { Scoreboard } from './scoreboard'

// ─── Title card ────────────────────────────────────────────────────────────

export class TitleCard {
  readonly el = el('section', 'title-card')
  private t = 0
  done = false

  constructor() {
    this.el.insertAdjacentHTML(
      'beforeend',
      `<div class="tc-line"></div>${WORDMARK}<div class="tc-sub">MULTIPLAYER &nbsp;//&nbsp; RUST</div><div class="tc-press">PRESS ANY KEY</div>`,
    )
  }

  update(dt: number): boolean {
    this.t += dt
    if (this.t > 0.2) this.el.classList.add('go')
    if (this.t > 3.3 && !this.done) this.finish()
    return this.done
  }

  finish() {
    if (this.done) return
    this.done = true
    this.el.classList.add('out')
  }
}

// ─── Loading screen ────────────────────────────────────────────────────────

const TIPS = [
  'Killing three enemies without dying earns you a UAV. Press 4 to call it in.',
  'Your radar only shows enemies that fire unsuppressed, or while your UAV is up.',
  'Hold G to cook a frag. Release before the fuse runs out.',
  'The central tower dominates Rust. Take the high ground, but watch your back.',
  'Sprinting out of a reload cancels it. Finish the reload before you run.',
  'Aiming down sights tightens your spread. Hip-fire only up close.',
  'Health regenerates if you stay out of the fight for a few seconds.',
]

export class LoadingScreen {
  readonly el = el('section', 'loading')
  visible = false
  private t = 0
  private bar: HTMLElement
  private pct: HTMLElement
  private tip: HTMLElement
  private canvas: HTMLCanvasElement
  private name: HTMLElement
  private loc: HTMLElement
  private fading = false
  private tipIdx = 0

  constructor(private game: Game) {
    const bg = el('div', 'ld-bg', this.el)
    el('div', 'ld-vig', bg)
    const left = el('div', 'ld-left', this.el)
    el('div', 'ld-mode', left, 'TEAM DEATHMATCH')
    this.name = el('div', 'ld-name', left)
    this.loc = el('div', 'ld-loc', left)
    el('div', 'ld-rule', left)
    el('div', 'ld-objhead', left, 'OBJECTIVES')
    el('p', 'ld-obj', left, `Eliminate enemy combatants. The first team to ${CONFIG.scoreLimit} kills, or the team with the highest score when time expires, wins the match.`)
    const teams = el('div', 'ld-teams', left)
    teams.innerHTML = `<div class="ldt">${emblemSvg('tf141')}<span>TASK FORCE 141</span></div><div class="ldt-vs">VS</div><div class="ldt r"><span>OPFOR</span>${emblemSvg('opfor')}</div>`

    const right = el('div', 'ld-right', this.el)
    const frame = el('div', 'map-frame', right)
    this.canvas = el('canvas', 'map-canvas', frame)
    this.canvas.width = this.canvas.height = 420

    const foot = el('div', 'ld-foot', this.el)
    this.tip = el('div', 'ld-tip', foot)
    const row = el('div', 'ld-barrow', foot)
    el('span', 'ld-label', row, 'LOADING')
    const track = el('div', 'ld-track', row)
    this.bar = el('i', '', track)
    this.pct = el('span', 'ld-pct', row, '0%')
  }

  show() {
    const g = this.game
    this.name.textContent = g.map.displayName.toUpperCase()
    this.loc.textContent = g.map.location.toUpperCase()
    this.tipIdx = (this.tipIdx + 1) % TIPS.length
    this.tip.innerHTML = `<b>TIP</b> ${TIPS[this.tipIdx]}`
    const ctx = this.canvas.getContext('2d')
    if (ctx) {
      const W = this.canvas.width
      ctx.fillStyle = '#16190f'
      ctx.fillRect(0, 0, W, W)
      ctx.strokeStyle = 'rgba(190,210,140,.10)'
      for (let i = 0; i <= 20; i++) {
        const p = (i / 20) * W
        ctx.beginPath()
        ctx.moveTo(p, 0)
        ctx.lineTo(p, W)
        ctx.moveTo(0, p)
        ctx.lineTo(W, p)
        ctx.stroke()
      }
      if (g.map.minimap.width > 0) ctx.drawImage(g.map.minimap, 0, 0, W, W)
    }
    this.t = 0
    this.fading = false
    this.visible = true
    this.el.classList.remove('out')
    this.el.classList.add('on')
    this.bar.style.transform = 'scaleX(0)'
  }

  hideNow() {
    this.visible = false
    this.el.classList.remove('on', 'out')
  }

  /** Progress 0..1 with a few believable stalls. */
  private progress(t: number): number {
    const p = clamp(t / 1.9, 0, 1)
    const stepped = p < 0.35 ? p * 1.4 : p < 0.55 ? 0.49 + (p - 0.35) * 0.3 : 0.55 + (p - 0.55) * 1.0
    return clamp(stepped, 0, 1)
  }

  update(dt: number) {
    if (!this.visible) return
    this.t += dt
    const p = this.progress(this.t)
    this.bar.style.transform = `scaleX(${p})`
    this.pct.textContent = `${Math.floor(p * 100)}%`
    if (this.t > 2.1 && !this.fading) {
      this.fading = true
      this.el.classList.add('out')
    }
    if (this.t > 2.8) this.hideNow()
  }
}

// ─── Pre-match countdown ───────────────────────────────────────────────────

export class IntroOverlay {
  readonly el = el('section', 'intro')
  private num: HTMLElement
  private label: HTMLElement
  private txt: Txt
  constructor(private ctx: UiCtx) {
    el('div', 'in-mode', this.el, 'TEAM DEATHMATCH')
    this.label = el('div', 'in-label', this.el, 'MATCH BEGINS IN')
    this.num = el('div', 'in-num', this.el)
    this.txt = new Txt(this.num)
    const teams = el('div', 'in-teams', this.el)
    teams.innerHTML = `<div class="int"><div class="em">${emblemSvg('tf141')}</div><div class="nm">TASK FORCE 141</div></div><div class="in-vs">VS</div><div class="int r"><div class="em">${emblemSvg('opfor')}</div><div class="nm">OPFOR</div></div>`
  }

  show() {
    this.el.classList.add('on')
    this.lastN = -1
  }

  hide() {
    this.el.classList.remove('on')
  }

  private lastN = -1
  update() {
    const left = this.ctx.game.mode.introLeft
    const n = Math.ceil(left)
    const show = left <= 3.05 && left > 0
    setClass(this.el, 'counting', show)
    if (show) {
      this.txt.set(String(n))
      if (n !== this.lastN) {
        this.lastN = n
        this.num.classList.remove('tick')
        void this.num.offsetWidth
        this.num.classList.add('tick')
        this.ctx.sfx('countdown')
      }
    }
  }
}

// ─── End of match: splash + results ────────────────────────────────────────

export class ResultsOverlay {
  readonly el = el('section', 'results')
  private splash = el('div', 'rs-splash', this.el)
  private splashWord = el('div', 'rs-word', this.splash)
  private splashScore = el('div', 'rs-score', this.splash)
  private splashEmblem = el('div', 'rs-emblem', this.splash)
  private page = el('div', 'rs-page', this.el)
  private title: HTMLElement
  private stats: HTMLElement
  private xpText: HTMLElement
  private xpBar: HTMLElement
  private rankBox: HTMLElement
  private levelText: HTMLElement
  private board: Scoreboard
  private list: MenuList
  private t = 0
  active = false
  private pageShown = false

  constructor(private ctx: UiCtx) {
    const head = el('div', 'rs-head', this.page)
    this.title = el('div', 'menu-header', head)
    el('div', 'menu-sub', head, 'MATCH COMPLETE')
    el('div', 'menu-header-line', head)

    const body = el('div', 'rs-body', this.page)
    const me = el('div', 'rs-me panel', body)
    el('div', 'panel-title', me, 'YOUR PERFORMANCE')
    this.stats = el('div', 'rs-stats', me)
    const prog = el('div', 'rs-prog', me)
    this.rankBox = el('div', 'rs-rankbox', prog)
    const pi = el('div', 'rs-proginfo', prog)
    this.levelText = el('div', 'rs-level', pi)
    this.xpBar = el('div', 'pcard-xpbar', pi)
    el('i', '', this.xpBar)
    this.xpText = el('div', 'pcard-xptext', pi)

    this.board = new Scoreboard(ctx.game, 'full')
    const right = el('div', 'rs-board', body)
    right.appendChild(this.board.el)

    this.list = new MenuList(
      ctx,
      [
        { label: 'PLAY AGAIN', action: () => ctx.play() },
        { label: 'MAIN MENU', action: () => ctx.quit() },
      ],
      66,
    )
    const foot = el('div', 'rs-foot', this.page)
    foot.appendChild(this.list.el)
  }

  show(winner: Team | 'draw' | undefined) {
    const g = this.ctx.game
    const mine = g.player.team
    const result = winner === 'draw' || !winner ? 'draw' : winner === mine ? 'win' : 'loss'
    this.el.className = `results on ${result}`
    this.splashWord.textContent = result === 'win' ? 'VICTORY' : result === 'loss' ? 'DEFEAT' : 'DRAW'
    this.splashEmblem.innerHTML = emblemSvg(result === 'loss' ? (mine === 'tf141' ? 'opfor' : 'tf141') : mine)
    this.splashScore.textContent = `${g.mode.score.tf141}  —  ${g.mode.score.opfor}`
    this.title.textContent = result === 'win' ? 'VICTORY' : result === 'loss' ? 'DEFEAT' : 'DRAW'
    this.t = 0
    this.pageShown = false
    this.active = true
    this.page.classList.remove('on')
    this.splash.classList.remove('out')

    // Stats
    const s = g.player.stats
    const acc = s.shotsFired > 0 ? Math.round((s.shotsHit / s.shotsFired) * 100) : 0
    const kd = (s.kills / Math.max(1, s.deaths)).toFixed(2)
    const rows: [string, string][] = [
      ['SCORE', String(s.score)],
      ['KILLS', String(s.kills)],
      ['DEATHS', String(s.deaths)],
      ['K/D RATIO', kd],
      ['ASSISTS', String(s.assists)],
      ['HEADSHOTS', String(s.headshots)],
      ['ACCURACY', `${acc}%`],
    ]
    this.stats.textContent = ''
    for (const [k, v] of rows) {
      const r = el('div', 'rs-stat', this.stats)
      el('span', 'k', r, k)
      el('span', 'v', r, v)
    }

    // XP
    const before = loadXp()
    const gain = s.score + (result === 'win' ? 500 : 100)
    const after = before + gain
    saveXp(after)
    const lb = levelForXp(before)
    const la = levelForXp(after)
    this.rankBox.innerHTML = rankSvg(la)
    const next = la >= RANK_NAMES.length - 1 ? xpForLevel(la) : xpForLevel(la + 1)
    const cur = xpForLevel(la)
    const p = next === cur ? 1 : (after - cur) / (next - cur)
    this.levelText.textContent = `LEVEL ${la + 1} — ${rankName(la).toUpperCase()}${la > lb ? '   RANK UP!' : ''}`
    ;(this.xpBar.firstElementChild as HTMLElement).style.transform = `scaleX(${clamp(p, 0.02, 1)})`
    this.xpText.textContent = `+${gain.toLocaleString()} XP   ·   ${Math.floor(after).toLocaleString()} / ${next.toLocaleString()}`
    if (la > lb) this.pendingRankUp = true
    this.board.render(true)
  }

  private pendingRankUp = false

  hide() {
    this.active = false
    this.el.classList.remove('on')
    this.page.classList.remove('on')
  }

  update(dt: number) {
    if (!this.active) return
    this.t += dt
    if (this.t > 3.6 && !this.pageShown) {
      this.pageShown = true
      this.splash.classList.add('out')
      this.page.classList.add('on')
      this.list.setIndex(0, false)
      if (this.pendingRankUp) {
        this.pendingRankUp = false
        this.ctx.sfx('rankup')
      }
    }
    if (this.pageShown) this.board.render()
  }

  key(e: KeyboardEvent) {
    if (!this.pageShown) {
      if (e.code === 'Enter' || e.code === 'Space') this.t = Math.max(this.t, 3.6)
      return
    }
    this.list.key(e)
  }
}
