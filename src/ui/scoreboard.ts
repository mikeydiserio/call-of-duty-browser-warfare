import type { Game } from '../core/game'
import type { Actor, GameModeId, Team } from '../core/types'
import { TEAM_NAMES } from '../core/types'
import { levelForXp, loadXp } from './data'
import { el, hash01, setClass } from './dom'
import { emblemSvg, ICON, rankSvg } from './icons'
import { ffaStandings, ordinal, stat, type ModeStats } from './modes'

interface RowRefs {
  root: HTMLElement
  rank: HTMLElement
  name: HTMLElement
  cells: HTMLElement[]
  ping: HTMLElement
  sig: string
}

interface Panel {
  team: Team | null
  root: HTMLElement
  total: HTMLElement
  body: HTMLElement
  rows: RowRefs[]
}

interface Column {
  label: string
  key: keyof ModeStats
}

const COLUMNS: Record<GameModeId, Column[]> = {
  tdm: [
    { label: 'SCORE', key: 'score' },
    { label: 'KILLS', key: 'kills' },
    { label: 'ASSISTS', key: 'assists' },
    { label: 'DEATHS', key: 'deaths' },
  ],
  ffa: [
    { label: 'SCORE', key: 'score' },
    { label: 'KILLS', key: 'kills' },
    { label: 'ASSISTS', key: 'assists' },
    { label: 'DEATHS', key: 'deaths' },
  ],
  dom: [
    { label: 'SCORE', key: 'score' },
    { label: 'KILLS', key: 'kills' },
    { label: 'CAPTURES', key: 'captures' },
    { label: 'DEFENDS', key: 'defends' },
    { label: 'DEATHS', key: 'deaths' },
  ],
  sd: [
    { label: 'SCORE', key: 'score' },
    { label: 'KILLS', key: 'kills' },
    { label: 'PLANTS', key: 'plants' },
    { label: 'DEFUSES', key: 'defuses' },
    { label: 'DEATHS', key: 'deaths' },
  ],
}

/**
 * MW2-style scoreboard. Two team panels (one ranked list in FFA), mode-specific
 * columns, pooled rows; DOM only changes when stats change.
 */
export class Scoreboard {
  readonly el: HTMLElement
  private panels: Panel[] = []
  private layout = ''
  private sig = ''
  private youLevel = 0

  constructor(
    private game: Game,
    private cls = '',
  ) {
    this.el = el('div', `scoreboard ${cls}`)
  }

  private build(mode: GameModeId) {
    this.layout = mode
    this.el.textContent = ''
    this.el.className = `scoreboard ${this.cls} m-${mode}`
    this.el.style.setProperty('--ncols', String(COLUMNS[mode].length + 1))
    this.panels =
      mode === 'ffa' ? [this.buildPanel(null, mode)] : (['tf141', 'opfor'] as Team[]).map((t) => this.buildPanel(t, mode))
  }

  private buildPanel(team: Team | null, mode: GameModeId): Panel {
    const side = team === null ? 'ffa' : team === this.game.player.team ? 'friend' : 'enemy'
    const root = el('div', `sb-team ${side}`, this.el)
    const head = el('div', 'sb-head', root)
    if (team) el('span', 'sb-emblem', head).innerHTML = emblemSvg(team)
    el('span', 'sb-teamname', head, team ? TEAM_NAMES[team].toUpperCase() : 'FREE-FOR-ALL')
    const total = el('span', 'sb-total', head, '0')
    const cols = el('div', 'sb-cols', root)
    el('span', 'sb-c-name', cols, 'PLAYER')
    for (const c of COLUMNS[mode]) el('span', 'sb-c', cols, c.label)
    el('span', 'sb-c', cols, 'PING')
    const body = el('div', 'sb-body', root)
    return { team, root, total, body, rows: [] }
  }

  private row(p: Panel, i: number): RowRefs {
    let r = p.rows[i]
    if (r) return r
    const root = el('div', 'sb-row', p.body)
    const rank = el('span', 'sb-rank', root)
    const name = el('span', 'sb-name', root)
    const cells = COLUMNS[this.layout as GameModeId].map(() => el('span', 'sb-c', root))
    const ping = el('span', 'sb-c sb-ping', root)
    r = { root, rank, name, cells, ping, sig: '' }
    p.rows.push(r)
    return r
  }

  /** Rebuild only if something changed. `force` skips the signature check. */
  render(force = false) {
    const g = this.game
    const mode = g.mode.id
    if (mode !== this.layout) {
      this.build(mode)
      force = true
    }
    const actors = g.actors
    let sig = `${actors.length}|${g.mode.score.tf141}|${g.mode.score.opfor}`
    for (const a of actors) {
      const s = a.stats as ModeStats
      sig += `|${a.id}:${s.score},${s.kills},${s.assists},${s.deaths},${s.captures ?? 0},${s.defends ?? 0},${s.plants ?? 0},${s.defuses ?? 0},${a.alive ? 1 : 0}`
    }
    if (!force && sig === this.sig) return
    this.sig = sig
    this.youLevel = levelForXp(loadXp())
    for (const p of this.panels) {
      let list: Actor[]
      if (p.team === null) {
        list = ffaStandings(g)
        p.total.textContent = list[0] ? `${list[0].stats.kills}` : '0'
      } else {
        list = actors
          .filter((a) => a.team === p.team)
          .sort((a, b) => b.stats.score - a.stats.score || b.stats.kills - a.stats.kills || a.id - b.id)
        p.total.textContent = String(g.mode.score[p.team])
      }
      const n = Math.max(list.length, p.team === null ? 0 : 6)
      for (let i = 0; i < n; i++) this.fillRow(this.row(p, i), list[i], p.team === null ? i + 1 : 0)
      for (let i = n; i < p.rows.length; i++) this.fillRow(p.rows[i]!, undefined, 0)
    }
  }

  private fillRow(row: RowRefs, a: Actor | undefined, place: number) {
    if (!a) {
      setClass(row.root, 'empty', true)
      row.sig = ''
      return
    }
    const sd = this.layout === 'sd'
    setClass(row.root, 'empty', false)
    setClass(row.root, 'you', a.isPlayer)
    setClass(row.root, 'dead', !a.alive)
    const level = a.isPlayer ? this.youLevel : 1 + Math.floor(hash01(a.id * 7 + 3) * 8)
    const cols = COLUMNS[this.layout as GameModeId]
    const vals = cols.map((c) => stat(a, c.key))
    const sig = `${a.id}|${level}|${place}|${vals.join(',')}|${sd && !a.alive ? 1 : 0}`
    if (sig === row.sig) return
    row.sig = sig
    // S&D marks the fallen with a skull instead of the rank (one life per round).
    row.rank.innerHTML = sd && !a.alive ? ICON.skull : rankSvg(level)
    row.name.textContent = place ? `${ordinal(place)}  ${a.name}` : a.name
    vals.forEach((v, i) => (row.cells[i]!.textContent = String(v)))
    const bars = a.isPlayer ? 4 : 3 + Math.round(hash01(a.id * 13 + 1))
    row.ping.innerHTML = `<span class="pbars b${bars}"><i></i><i></i><i></i><i></i></span>`
  }
}
