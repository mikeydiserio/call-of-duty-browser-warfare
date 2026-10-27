import { defaultMatch } from '../core/game'
import type { GameModeId, MatchSettings, Team } from '../core/types'
import type { LobbyInfo, LobbyPlayer, LobbyService } from '../net/lobby'
import { levelForXp, loadXp } from './data'
import { clamp, el, fmtTime, hash01, setClass } from './dom'
import { emblemSvg, rankSvg } from './icons'
import { MODE_SHORT, modeTagline } from './modes'
import { keyHints, MenuList, type Screen, type UiCtx } from './screen'
import { getMapOption, MAP_OPTIONS } from '../world/maps'

const MAX_TOTAL = 12
const MODES: GameModeId[] = ['tdm', 'ffa', 'dom', 'sd']
const DIFFICULTY: [number, string][] = [
  [0.3, 'RECRUIT'],
  [0.55, 'REGULAR'],
  [0.75, 'HARDENED'],
  [0.9, 'VETERAN'],
]
const SCORE_CHOICES: Record<GameModeId, number[]> = {
  tdm: [25, 50, 75, 100, 150],
  ffa: [10, 20, 30, 40, 50],
  dom: [100, 150, 200, 300],
  sd: [2, 3, 4, 5, 6],
}
const TIME_CHOICES: Record<GameModeId, number[]> = {
  tdm: [300, 600, 900, 1200],
  ffa: [300, 600, 900, 1200],
  dom: [600, 900, 1200],
  sd: [90, 120, 150, 180],
}

function withDefault(list: number[], v: number): number[] {
  return list.includes(v) ? list : [...list, v].sort((a, b) => a - b)
}

function pingBars(ms: number, host: boolean): number {
  if (host) return 4
  return ms < 60 ? 4 : ms < 120 ? 3 : ms < 200 ? 2 : 1
}

function pingHtml(n: number): string {
  return `<span class="pbars b${n}"><i></i><i></i><i></i><i></i></span>`
}

/** Optional extras the online lobby implements (kick, last disconnect reason, match running). */
type LobbyExtras = LobbyService & { kick?(id: string): void; message?: string; inProgress?: boolean }

function extras(l: LobbyService): LobbyExtras {
  return l as LobbyExtras
}

function difficultyName(v: number): string {
  let best = DIFFICULTY[0]!
  for (const d of DIFFICULTY) if (Math.abs(d[0] - v) < Math.abs(best[0] - v)) best = d
  return best[1]
}

// ─── Server browser ────────────────────────────────────────────────────────

export class BrowserScreen implements Screen {
  readonly id = 'browser' as const
  readonly el = el('section', 'screen s-browser')
  private list: MenuList
  private rowsEl: HTMLElement
  private status: HTMLElement
  private codeBox: HTMLElement
  private codeInput: HTMLInputElement
  private lobbies: LobbyInfo[] = []
  private rowIdx = 0
  private focus: 'menu' | 'list' | 'code' = 'menu'
  private refreshT = 0
  private loading = false
  private busy = false

  constructor(private ctx: UiCtx) {
    const head = el('div', 'screen-head', this.el)
    el('div', 'menu-header', head, 'FIND MATCH')
    el('div', 'menu-sub', head, 'ONLINE  //  SERVER BROWSER')
    el('div', 'menu-header-line', head)

    const left = el('div', 'sv-left', this.el)
    this.list = new MenuList(
      ctx,
      [
        { label: 'REFRESH', action: () => this.refresh() },
        { label: 'JOIN BY CODE', action: () => this.openCode() },
        { label: 'HOST GAME', sub: 'ONLINE LOBBY', action: () => this.hostGame() },
        { label: 'BACK', action: () => this.back() },
      ],
      70,
    )
    left.appendChild(this.list.el)

    const panel = el('div', 'sv-panel panel', this.el)
    el('div', 'panel-title', panel, 'OPEN LOBBIES')
    const cols = el('div', 'sv-row sv-cols', panel)
    for (const c of ['CODE', 'HOST', 'GAME TYPE', 'MAP', 'PLAYERS']) el('span', '', cols, c)
    this.rowsEl = el('div', 'sv-rows', panel)
    this.status = el('div', 'sv-status', panel)

    this.codeBox = el('div', 'sv-code panel', this.el)
    el('div', 'panel-title', this.codeBox, 'JOIN BY CODE')
    const row = el('div', 'sv-code-row', this.codeBox)
    this.codeInput = el('input', 'sv-input', row)
    this.codeInput.maxLength = 8
    this.codeInput.placeholder = 'CODE'
    this.codeInput.spellcheck = false
    this.codeInput.autocomplete = 'off'
    this.codeInput.addEventListener('input', () => (this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '')))
    const go = el('button', 'sv-go', row, 'JOIN')
    go.type = 'button'
    go.addEventListener('click', () => this.join(this.codeInput.value))
    el('div', 'sv-code-hint', this.codeBox, 'Ask the host for the code shown in their lobby.  ENTER join  ·  ESC cancel')

    keyHints(this.el, [
      ['↑ ↓', 'SELECT'],
      ['→', 'LOBBY LIST'],
      ['ENTER', 'JOIN / CONFIRM'],
      ['ESC', 'BACK'],
    ])
  }

  enter() {
    this.focus = 'menu'
    this.closeCode()
    this.list.setIndex(0, false)
    this.refresh()
  }

  leave() {
    this.closeCode()
  }

  update(dt: number) {
    this.refreshT += dt
    if (this.refreshT > 12 && this.focus !== 'code') this.refresh()
  }

  private refresh() {
    if (this.loading) return
    this.loading = true
    this.refreshT = 0
    this.status.textContent = 'SEARCHING FOR LOBBIES…'
    this.status.className = 'sv-status busy'
    this.ctx.game.lobby
      .listLobbies()
      .then((l) => {
        this.lobbies = l
        this.rowIdx = clamp(this.rowIdx, 0, Math.max(0, l.length - 1))
        this.renderRows()
        this.status.textContent = l.length ? `${l.length} LOBB${l.length === 1 ? 'Y' : 'IES'} FOUND` : 'NO OPEN LOBBIES FOUND — HOST ONE AND SHARE THE CODE'
        this.status.className = 'sv-status'
      })
      .catch((err: unknown) => {
        this.status.textContent = `SEARCH FAILED: ${err instanceof Error ? err.message : String(err)}`
        this.status.className = 'sv-status bad'
      })
      .finally(() => (this.loading = false))
  }

  private renderRows() {
    this.rowsEl.textContent = ''
    this.lobbies.forEach((l, i) => {
      const full = l.players >= l.maxPlayers
      const r = el('button', `sv-row${l.inProgress ? ' live' : ''}${full ? ' full' : ''}`, this.rowsEl)
      r.type = 'button'
      el('span', 'code', r, l.code)
      el('span', 'host', r, l.hostName)
      el('span', '', r, MODE_SHORT[l.mode])
      el('span', '', r, l.mapId.toUpperCase())
      el('span', 'pl', r, `${l.players}/${l.maxPlayers}${l.inProgress ? '  IN PROGRESS' : ''}`)
      r.addEventListener('mouseenter', () => {
        this.rowIdx = i
        this.focus = 'list'
        this.paintRows()
      })
      r.addEventListener('click', () => this.join(l.code))
    })
    this.paintRows()
  }

  private paintRows() {
    ;[...this.rowsEl.children].forEach((r, i) => setClass(r, 'sel', this.focus === 'list' && i === this.rowIdx))
  }

  private openCode() {
    this.focus = 'code'
    this.codeBox.classList.add('on')
    this.codeInput.value = ''
    window.setTimeout(() => this.codeInput.focus(), 30)
  }

  private closeCode() {
    this.codeBox.classList.remove('on')
    this.codeInput.blur()
    if (this.focus === 'code') this.focus = 'menu'
  }

  private join(code: string) {
    code = code.trim().toUpperCase()
    if (!code || this.busy) return
    this.busy = true
    this.ctx.sfx('select')
    this.status.textContent = `JOINING ${code}…`
    this.status.className = 'sv-status busy'
    this.ctx.game.lobby
      .join(code)
      .then(() => {
        this.closeCode()
        this.ctx.push('lobby')
      })
      .catch((err: unknown) => {
        this.status.className = 'sv-status bad'
        this.status.textContent = 'UNABLE TO JOIN'
        this.ctx.popup('UNABLE TO JOIN', err instanceof Error ? err.message : String(err))
      })
      .finally(() => (this.busy = false))
  }

  private hostGame() {
    if (this.busy) return
    const g = this.ctx.game
    this.busy = true
    g.lobby
      .host({ ...defaultMatch(g.match.mode), mapId: g.match.mapId, botDifficulty: g.match.botDifficulty }, true)
      .then(() => this.ctx.push('lobby'))
      .catch((err: unknown) => this.ctx.popup('UNABLE TO HOST', err instanceof Error ? err.message : String(err)))
      .finally(() => (this.busy = false))
  }

  private back() {
    this.ctx.sfx('back')
    this.ctx.pop()
  }

  key(e: KeyboardEvent) {
    if (this.focus === 'code') {
      if (e.code === 'Enter') this.join(this.codeInput.value)
      else if (e.code === 'Escape') {
        this.ctx.sfx('back')
        this.closeCode()
      }
      return
    }
    if (this.focus === 'list') {
      const n = this.lobbies.length
      if (e.code === 'ArrowDown' && n) this.rowIdx = (this.rowIdx + 1) % n
      else if (e.code === 'ArrowUp' && n) this.rowIdx = (this.rowIdx + n - 1) % n
      else if (e.code === 'Enter' && n) this.join(this.lobbies[this.rowIdx]!.code)
      else if (e.code === 'ArrowLeft' || e.code === 'Escape' || e.code === 'Backspace') this.focus = 'menu'
      else return
      this.ctx.sfx('hover')
      this.paintRows()
      return
    }
    if (e.code === 'ArrowRight' && this.lobbies.length) {
      this.focus = 'list'
      this.ctx.sfx('hover')
      this.paintRows()
    } else if (e.code === 'Escape' || e.code === 'Backspace') this.back()
    else this.list.key(e)
  }
}

// ─── Pre-game lobby ────────────────────────────────────────────────────────

interface SettingRow {
  label: () => string
  value: () => string
  /** Step the setting; returns the new settings or null when unchanged. */
  adjust: (s: MatchSettings, dir: number) => MatchSettings | null
  el?: HTMLElement
  valEl?: HTMLElement
  labelEl?: HTMLElement
}

export class LobbyScreen implements Screen {
  readonly id = 'lobby' as const
  readonly el = el('section', 'screen s-lobby')
  private list: MenuList
  private header: HTMLElement
  private sub: HTMLElement
  private codeVal: HTMLElement
  private codeSub: HTMLElement
  private playersTitle: HTMLElement
  private playersEl: HTMLElement
  private setPanel: HTMLElement
  private setNote: HTMLElement
  private mapCanvas: HTMLCanvasElement
  private modeName: HTMLElement
  private modeTag: HTMLElement
  private mapLabel: HTMLElement
  private rows: SettingRow[] = []
  private rowIdx = 0
  private focus: 'menu' | 'settings' = 'menu'
  private unsub: (() => void) | null = null
  private sig = ''

  constructor(private ctx: UiCtx) {
    const left = el('div', 'lb-left', this.el)
    this.header = el('div', 'menu-header', left, 'PRIVATE MATCH')
    this.sub = el('div', 'menu-sub', left, 'PRE-GAME LOBBY')
    el('div', 'menu-header-line', left)

    const code = el('div', 'lb-code', left)
    el('div', 'lb-code-l', code, 'LOBBY CODE')
    this.codeVal = el('div', 'lb-code-v', code)
    this.codeSub = el('div', 'lb-code-s', code)

    this.list = new MenuList(
      ctx,
      [
        {
          label: 'START MATCH',
          action: () => this.start(),
          disabled: () => !this.isHost || !this.allReady,
          tip: 'Only the host can start, once every player is ready.',
        },
        { label: 'READY', action: () => this.toggleReady(), disabled: () => this.isHost, tip: 'The host is always ready.' },
        {
          label: 'GAME SETUP',
          action: () => this.setFocus('settings'),
          disabled: () => !this.isHost,
          tip: 'Only the host can change the game settings.',
        },
        { label: 'SWITCH TEAM', action: () => this.switchTeam(), disabled: () => this.settings.mode === 'ffa', tip: 'No teams in Free-for-All.' },
        { label: 'CREATE A CLASS', action: () => ctx.push('class') },
        { label: 'LEAVE LOBBY', action: () => this.leaveLobby() },
      ],
      64,
    )
    left.appendChild(this.list.el)

    const mid = el('div', 'lb-players panel', this.el)
    this.playersTitle = el('div', 'panel-title', mid)
    this.playersEl = el('div', 'lb-plist', mid)

    this.setPanel = el('div', 'lb-settings panel', this.el)
    el('div', 'panel-title', this.setPanel, 'GAME SETUP')
    const frame = el('div', 'map-frame', this.setPanel)
    this.mapCanvas = el('canvas', 'map-canvas', frame)
    this.mapCanvas.width = 560
    this.mapCanvas.height = 350
    const tag = el('div', 'map-tag', frame)
    this.modeName = el('span', '', tag)
    const mt = el('div', 'lb-mapline', this.setPanel)
    this.mapLabel = el('span', 'lb-map', mt, 'RUST')
    this.modeTag = el('span', 'lb-tagline', mt)
    const rowsEl = el('div', 'lb-rows', this.setPanel)
    this.buildRows(rowsEl)
    this.setNote = el('div', 'lb-note', this.setPanel)

    keyHints(this.el, [
      ['↑ ↓', 'SELECT'],
      ['← →', 'CHANGE SETTING'],
      ['ENTER', 'CONFIRM'],
      ['ESC', 'BACK'],
    ])
  }

  // ── state helpers ──

  private get settings(): MatchSettings {
    return this.ctx.game.lobby.lobby?.settings ?? this.ctx.game.match
  }

  private get isHost(): boolean {
    return this.ctx.game.lobby.role !== 'client'
  }

  private get me(): LobbyPlayer | undefined {
    const l = this.ctx.game.lobby
    const ps = l.lobby?.players ?? []
    return this.isHost ? ps.find((p) => p.isHost) : (ps.find((p) => !p.isHost && p.name === l.localName) ?? ps.find((p) => !p.isHost))
  }

  private get humans(): number {
    return this.ctx.game.lobby.lobby?.players.length ?? 1
  }

  private get allReady(): boolean {
    const ps = this.ctx.game.lobby.lobby?.players ?? []
    return ps.every((p) => p.ready || p.isHost)
  }

  // ── settings rows ──

  private buildRows(root: HTMLElement) {
    const cycle = <T>(list: T[], cur: T, dir: number): T => {
      const i = list.indexOf(cur)
      return list[clamp((i < 0 ? 0 : i) + dir, 0, list.length - 1)]!
    }
    this.rows = [
      {
        label: () => 'GAME TYPE',
        value: () => MODE_SHORT[this.settings.mode],
        adjust: (s, dir) => {
          const i = MODES.indexOf(s.mode)
          const mode = MODES[(i + dir + MODES.length) % MODES.length]!
          const d = defaultMatch(mode)
          return { ...d, mapId: s.mapId, botDifficulty: s.botDifficulty, botCount: Math.min(d.botCount, MAX_TOTAL - this.humans) }
        },
      },
      {
        label: () => 'MAP',
        value: () => getMapOption(this.settings.mapId).name.toUpperCase(),
        adjust: (s, dir) => {
          const i = MAP_OPTIONS.findIndex((map) => map.id === s.mapId)
          const next = MAP_OPTIONS[(i + dir + MAP_OPTIONS.length) % MAP_OPTIONS.length]!
          return { ...s, mapId: next.id }
        },
      },
      {
        label: () => 'BOTS',
        value: () => String(this.settings.botCount),
        adjust: (s, dir) => ({ ...s, botCount: clamp(s.botCount + dir, 0, MAX_TOTAL - this.humans) }),
      },
      {
        label: () => 'BOT DIFFICULTY',
        value: () => difficultyName(this.settings.botDifficulty),
        adjust: (s, dir) => {
          const vals = DIFFICULTY.map((d) => d[0])
          const cur = vals.reduce((a, b) => (Math.abs(b - s.botDifficulty) < Math.abs(a - s.botDifficulty) ? b : a))
          return { ...s, botDifficulty: cycle(vals, cur, dir) }
        },
      },
      {
        label: () => (this.settings.mode === 'sd' ? 'ROUNDS TO WIN' : this.settings.mode === 'dom' ? 'SCORE LIMIT' : 'KILL LIMIT'),
        value: () => String(this.settings.scoreLimit),
        adjust: (s, dir) => ({ ...s, scoreLimit: cycle(withDefault(SCORE_CHOICES[s.mode], defaultMatch(s.mode).scoreLimit), s.scoreLimit, dir) }),
      },
      {
        label: () => (this.settings.mode === 'sd' ? 'ROUND TIME' : 'TIME LIMIT'),
        value: () => fmtTime(this.settings.timeLimit),
        adjust: (s, dir) => ({ ...s, timeLimit: cycle(withDefault(TIME_CHOICES[s.mode], defaultMatch(s.mode).timeLimit), s.timeLimit, dir) }),
      },
    ]
    this.rows.forEach((r, i) => {
      const e = el('div', 'lrow', root)
      r.el = e
      r.labelEl = el('span', 'lrow-l', e)
      const ctl = el('span', 'lrow-ctl', e)
      const l = el('button', 'arr', ctl, '◀')
      r.valEl = el('span', 'lrow-v', ctl)
      const rr = el('button', 'arr', ctl, '▶')
      l.type = rr.type = 'button'
      l.addEventListener('click', () => this.adjust(i, -1))
      rr.addEventListener('click', () => this.adjust(i, 1))
      e.addEventListener('mouseenter', () => {
        if (!this.isHost) return
        if (this.rowIdx !== i || this.focus !== 'settings') this.ctx.sfx('hover')
        this.rowIdx = i
        this.setFocus('settings', false)
      })
    })
  }

  private adjust(i: number, dir: number) {
    if (!this.isHost) return
    const row = this.rows[i]
    const l = this.ctx.game.lobby
    if (!row || !l.lobby) return
    const cur = l.lobby.settings
    const next = row.adjust(cur, dir)
    if (!next || JSON.stringify(next) === JSON.stringify(cur)) return
    this.rowIdx = i
    this.ctx.sfx('hover')
    l.updateSettings(next)
    this.ctx.game.match = { ...next }
    this.render()
  }

  // ── lifecycle ──

  enter() {
    this.focus = 'menu'
    if (!this.ctx.game.lobby.lobby) {
      // Lobby closed while a sub-screen was open.
      window.setTimeout(() => this.ctx.pop(), 0)
      return
    }
    this.unsub?.()
    this.unsub = this.ctx.game.lobby.onChange(() => this.onLobbyChange())
    this.sig = ''
    this.render()
    this.list.setIndex(this.isHost ? 0 : 1, false)
    this.list.refresh()
  }

  leave() {
    // Keep listening while a sub-screen (create-a-class) is on top; the coordinator re-enters us.
    this.unsub?.()
    this.unsub = null
  }

  private onLobbyChange() {
    const l = this.ctx.game.lobby
    if (!l.lobby) {
      // Lobby went away underneath us (host left / kicked).
      if (this.el.classList.contains('on')) {
        this.ctx.pop()
        const msg = extras(l).message
        if (msg) this.ctx.popup('LOBBY CLOSED', msg)
      }
      return
    }
    this.render()
  }

  update() {
    // Ping values can change without a lobby event on some transports; cheap signature check.
    this.render()
  }

  private render() {
    const g = this.ctx.game
    const lob = g.lobby.lobby
    if (!lob) return
    const s = lob.settings
    const running = !!extras(g.lobby).inProgress
    if (!running && g.mode.phase === 'menu') {
      g.match = { ...s }
      if (g.map.id !== s.mapId) g.setMap(s.mapId)
    }
    const sig = JSON.stringify([lob.code, s, lob.players, g.lobby.role, this.focus, this.rowIdx, g.lobby.localName, extras(g.lobby).inProgress])
    if (sig === this.sig) return
    this.sig = sig

    const online = g.lobby.role !== 'offline'
    this.header.textContent = online ? 'ONLINE LOBBY' : 'PRIVATE MATCH'
    this.sub.textContent = `${MODE_SHORT[s.mode]}  //  ${this.isHost ? 'HOST' : 'CLIENT'}`
    this.codeVal.textContent = lob.code
    this.codeSub.textContent = online ? 'Share this code so friends can join' : 'Offline — you vs bots'
    setClass(this.el, 'offline', !online)
    setClass(this.el, 'client', !this.isHost)
    setClass(this.el, 'focus-settings', this.focus === 'settings')

    // menu
    const me = this.me
    this.list.setLabel(1, me?.ready || this.isHost ? 'READY' : 'NOT READY', me?.ready || this.isHost ? '✔' : 'PRESS TO READY UP')
    const waiting = lob.players.filter((p) => !p.ready && !p.isHost).length
    this.list.setLabel(0, 'START MATCH', this.isHost ? (waiting ? `WAITING ON ${waiting}` : '') : 'HOST ONLY')
    this.list.refresh()

    // settings
    this.modeName.textContent = MODE_SHORT[s.mode]
    this.modeTag.textContent = modeTagline(s)
    this.mapLabel.textContent = getMapOption(s.mapId).name.toUpperCase()
    this.rows.forEach((r, i) => {
      r.labelEl!.textContent = r.label()
      r.valEl!.textContent = r.value()
      setClass(r.el!, 'sel', this.isHost && this.focus === 'settings' && i === this.rowIdx)
    })
    this.setNote.textContent = running
      ? 'MATCH IN PROGRESS — YOU WILL DROP IN ON THE NEXT SPAWN'
      : this.isHost
        ? `${this.humans + s.botCount} / ${MAX_TOTAL} PLAYERS INCLUDING BOTS`
        : 'THE HOST CONTROLS THE GAME SETUP'
    setClass(this.setNote, 'live', running)
    this.drawMap()

    // players
    this.renderPlayers(lob.players, s, lob.maxPlayers)
  }

  private renderPlayers(players: LobbyPlayer[], s: MatchSettings, maxHumans: number) {
    const root = this.playersEl
    root.textContent = ''
    const total = players.length + s.botCount
    this.playersTitle.textContent = `PLAYERS  ${players.length}/${Math.max(maxHumans, players.length)}  ·  ${s.botCount} BOT${s.botCount === 1 ? '' : 'S'}`
    const myLevel = levelForXp(loadXp())
    const human = (p: LobbyPlayer, parent: HTMLElement) => {
      const mine = p === this.me
      const r = el('div', `lp${mine ? ' you' : ''}`, parent)
      const rk = el('span', 'lp-rank', r)
      rk.innerHTML = rankSvg(mine ? myLevel : Math.floor(hash01(p.name.length * 31 + p.id.length) * 10))
      el('span', 'lp-name', r, p.name)
      el('span', 'lp-tag', r, p.isHost ? 'HOST' : p.team === null && s.mode !== 'ffa' ? 'AUTO' : '')
      el('span', `lp-ready${p.ready || p.isHost ? ' on' : ''}`, r, p.ready || p.isHost ? '✔' : '')
      el('span', 'lp-ping', r).innerHTML = pingHtml(pingBars(p.ping, p.isHost))
      const kick = extras(this.ctx.game.lobby).kick
      if (this.isHost && !p.isHost && kick) {
        const k = el('button', 'lp-kick', r, 'KICK')
        k.type = 'button'
        k.addEventListener('click', () => {
          this.ctx.sfx('back')
          kick.call(this.ctx.game.lobby, p.id)
        })
      }
    }
    const bot = (n: number, parent: HTMLElement) => {
      for (let i = 0; i < n; i++) {
        const r = el('div', 'lp bot', parent)
        el('span', 'lp-rank', r)
        el('span', 'lp-name', r, `BOT — ${difficultyName(s.botDifficulty)}`)
        el('span', 'lp-tag', r, '')
        el('span', 'lp-ready on', r, '✔')
        el('span', 'lp-ping', r)
      }
    }
    if (s.mode === 'ffa') {
      const box = el('div', 'lp-team ffa', root)
      const h = el('div', 'lp-head', box)
      el('span', 'lp-tn', h, 'FREE-FOR-ALL')
      el('span', 'lp-cnt', h, `${total}`)
      for (const p of players) human(p, box)
      bot(s.botCount, box)
      return
    }
    // Team modes: unassigned humans are shown on the smaller side (auto-balance), bots fill evenly.
    const side: Record<Team, LobbyPlayer[]> = { tf141: [], opfor: [] }
    for (const p of players) if (p.team) side[p.team].push(p)
    for (const p of players) if (!p.team) side[side.tf141.length <= side.opfor.length ? 'tf141' : 'opfor'].push(p)
    const sizeA = Math.ceil(total / 2)
    const botsA = clamp(sizeA - side.tf141.length, 0, s.botCount)
    const bots: Record<Team, number> = { tf141: botsA, opfor: s.botCount - botsA }
    for (const team of ['tf141', 'opfor'] as Team[]) {
      const box = el('div', `lp-team ${team === 'tf141' ? 'friend' : 'enemy'}`, root)
      const h = el('div', 'lp-head', box)
      el('span', 'lp-em', h).innerHTML = emblemSvg(team)
      el('span', 'lp-tn', h, team === 'tf141' ? 'TASK FORCE 141' : 'OPFOR')
      el('span', 'lp-cnt', h, String(side[team].length + bots[team]))
      for (const p of side[team]) human(p, box)
      bot(bots[team], box)
    }
  }

  private drawMap() {
    const c = this.mapCanvas
    const ctx = c.getContext('2d')
    if (!ctx) return
    const W = c.width
    const H = c.height
    ctx.fillStyle = '#16190f'
    ctx.fillRect(0, 0, W, H)
    const mm = this.ctx.game.map.minimap
    if (mm && mm.width > 0) {
      const sz = Math.max(W, H)
      ctx.drawImage(mm, (W - sz) / 2, (H - sz) / 2, sz, sz)
    }
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(0,0,0,.6)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, W, H)
  }

  // ── actions ──

  private start() {
    const l = this.ctx.game.lobby
    if (!this.isHost || !this.allReady || !l.lobby) return
    this.ctx.game.match = { ...l.lobby.settings }
    this.ctx.play(() => l.startMatch())
  }

  private toggleReady() {
    const me = this.me
    this.ctx.game.lobby.setReady(!(me?.ready ?? false))
  }

  private switchTeam() {
    const me = this.me
    const l = this.ctx.game.lobby
    const players = l.lobby?.players ?? []
    // Resolve "auto" to the side we are displayed on, then flip.
    let cur = me?.team ?? null
    if (!cur) {
      const a = players.filter((p) => p.team === 'tf141').length
      const b = players.filter((p) => p.team === 'opfor').length
      cur = a <= b ? 'tf141' : 'opfor'
    }
    l.setTeam(cur === 'tf141' ? 'opfor' : 'tf141')
  }

  private leaveLobby() {
    this.ctx.sfx('back')
    this.unsub?.()
    this.unsub = null
    this.ctx.game.lobby.leave()
    this.ctx.pop()
  }

  private setFocus(f: 'menu' | 'settings', sound = true) {
    if (f === 'settings' && !this.isHost) return
    if (sound && f !== this.focus) this.ctx.sfx(f === 'settings' ? 'select' : 'back')
    this.focus = f
    this.render()
  }

  key(e: KeyboardEvent) {
    if (this.focus === 'settings') {
      const n = this.rows.length
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        this.rowIdx = (this.rowIdx + 1) % n
        this.ctx.sfx('hover')
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        this.rowIdx = (this.rowIdx + n - 1) % n
        this.ctx.sfx('hover')
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.adjust(this.rowIdx, -1)
      else if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'Enter' || e.code === 'Space') this.adjust(this.rowIdx, 1)
      else if (e.code === 'Escape' || e.code === 'Backspace') this.setFocus('menu')
      this.render()
      return
    }
    if (e.code === 'ArrowRight' && this.isHost) this.setFocus('settings')
    else if (e.code === 'Escape' || e.code === 'Backspace') {
      // MW2 never drops you out of a lobby on a stray Esc: jump to LEAVE LOBBY instead.
      if (this.list.idx === 5) this.leaveLobby()
      else this.list.setIndex(5)
    } else this.list.key(e)
  }
}
