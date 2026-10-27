import type { Game } from '../core/game'
import type { Actor, Team } from '../core/types'
import { TEAM_NAMES } from '../core/types'
import { levelForXp, loadXp } from './data'
import { el, hash01, setClass } from './dom'
import { emblemSvg, rankSvg } from './icons'

interface RowRefs {
  root: HTMLElement
  rank: HTMLElement
  name: HTMLElement
  cells: HTMLElement[]
  ping: HTMLElement
  sig: string
}

interface TeamPanel {
  team: Team
  root: HTMLElement
  total: HTMLElement
  rows: RowRefs[]
}

const COLS = ['SCORE', 'KILLS', 'ASSISTS', 'DEATHS', 'PING']

/** MW2-style two-panel scoreboard. Rows are pooled; DOM only changes when stats change. */
export class Scoreboard {
  readonly el: HTMLElement
  private panels: TeamPanel[] = []
  private sig = ''
  private youLevel = 0

  constructor(
    private game: Game,
    cls = '',
  ) {
    this.el = el('div', `scoreboard ${cls}`)
    for (const team of ['tf141', 'opfor'] as Team[]) this.panels.push(this.buildPanel(team))
  }

  private buildPanel(team: Team): TeamPanel {
    const root = el('div', `sb-team ${team === 'tf141' ? 'friend' : 'enemy'}`, this.el)
    const head = el('div', 'sb-head', root)
    const em = el('span', 'sb-emblem', head)
    em.innerHTML = emblemSvg(team)
    el('span', 'sb-teamname', head, TEAM_NAMES[team].toUpperCase())
    const total = el('span', 'sb-total', head, '0')
    const cols = el('div', 'sb-cols', root)
    el('span', 'sb-c-name', cols, 'PLAYER')
    for (const c of COLS) el('span', 'sb-c', cols, c)
    const rows: RowRefs[] = []
    for (let i = 0; i < 6; i++) {
      const r = el('div', 'sb-row', root)
      const rank = el('span', 'sb-rank', r)
      const name = el('span', 'sb-name', r)
      const cells = [0, 1, 2, 3].map(() => el('span', 'sb-c', r))
      const ping = el('span', 'sb-c sb-ping', r)
      rows.push({ root: r, rank, name, cells, ping, sig: '' })
    }
    return { team, root, total, rows }
  }

  /** Rebuild only if something changed. `force` skips the signature check. */
  render(force = false) {
    const g = this.game
    const actors = g.actors
    let sig = `${actors.length}|${g.mode.score.tf141}|${g.mode.score.opfor}`
    for (const a of actors) sig += `|${a.id}:${a.stats.score},${a.stats.kills},${a.stats.assists},${a.stats.deaths},${a.alive ? 1 : 0}`
    if (!force && sig === this.sig) return
    this.sig = sig
    this.youLevel = levelForXp(loadXp())
    for (const p of this.panels) {
      const list = actors
        .filter((a) => a.team === p.team)
        .sort((a, b) => b.stats.score - a.stats.score || b.stats.kills - a.stats.kills || a.id - b.id)
      p.total.textContent = String(g.mode.score[p.team])
      p.rows.forEach((row, i) => this.fillRow(row, list[i]))
    }
  }

  private fillRow(row: RowRefs, a: Actor | undefined) {
    if (!a) {
      setClass(row.root, 'empty', true)
      row.sig = ''
      return
    }
    setClass(row.root, 'empty', false)
    setClass(row.root, 'you', a.isPlayer)
    setClass(row.root, 'dead', !a.alive)
    const level = a.isPlayer ? this.youLevel : 1 + Math.floor(hash01(a.id * 7 + 3) * 8)
    const sig = `${a.id}|${level}|${a.stats.score}|${a.stats.kills}|${a.stats.assists}|${a.stats.deaths}`
    if (sig === row.sig) return
    row.sig = sig
    row.rank.innerHTML = rankSvg(level)
    row.name.textContent = a.name
    row.cells[0]!.textContent = String(a.stats.score)
    row.cells[1]!.textContent = String(a.stats.kills)
    row.cells[2]!.textContent = String(a.stats.assists)
    row.cells[3]!.textContent = String(a.stats.deaths)
    const bars = a.isPlayer ? 4 : 3 + Math.round(hash01(a.id * 13 + 1))
    row.ping.innerHTML = `<span class="pbars b${bars}"><i></i><i></i><i></i><i></i></span>`
  }
}
