import { defaultMatch } from '../core/game'
import { levelForXp, loadXp, rankName, xpForLevel, RANK_NAMES } from './data'
import { el } from './dom'
import { emblemSvg, rankSvg, WORDMARK } from './icons'
import { keyHints, MenuList, type Screen, type UiCtx } from './screen'
import { getMapOption } from '../world/maps'

export class MainScreen implements Screen {
  readonly id = 'main' as const
  readonly el = el('section', 'screen s-main')
  private list: MenuList
  private preview: HTMLCanvasElement
  private cardRank: HTMLElement
  private cardLevel: HTMLElement
  private cardXp: HTMLElement
  private cardXpText: HTMLElement
  private cardName: HTMLElement
  private mapName: HTMLElement
  private mapLoc: HTMLElement
  private mapDesc: HTMLElement

  constructor(private ctx: UiCtx) {
    const root = this.el

    // Left column
    const left = el('div', 'main-left', root)
    left.insertAdjacentHTML('beforeend', WORDMARK)
    el('div', 'menu-header', left, 'MULTIPLAYER')
    el('div', 'menu-header-line', left)
    this.list = new MenuList(
      ctx,
      [
        {
          label: 'PLAY ONLINE',
          sub: 'FIND / HOST',
          action: () => ctx.push('browser'),
          disabled: () => !ctx.game.lobby.onlineAvailable,
          tip: 'Online play is not configured on this build (no Supabase keys). Use Private Match to play against bots.',
        },
        { label: 'PRIVATE MATCH', sub: 'CUSTOM GAME VS BOTS', action: () => this.privateMatch() },
        {
          label: 'QUICK PLAY',
          sub: 'TEAM DEATHMATCH 6v6',
          action: () => ctx.play(() => ctx.game.startMatch(ctx.game.loadout, { ...defaultMatch('tdm'), mapId: ctx.game.match.mapId })),
        },
        { label: 'CREATE A CLASS', action: () => ctx.push('class') },
        { label: 'OPTIONS', action: () => ctx.push('options') },
        { label: 'CONTROLS', action: () => ctx.push('controls') },
      ],
      70,
    )
    left.appendChild(this.list.el)

    // Player card (top right)
    const card = el('div', 'pcard', root)
    this.cardRank = el('div', 'pcard-rank', card)
    const info = el('div', 'pcard-info', card)
    this.cardName = el('div', 'pcard-name', info)
    this.cardLevel = el('div', 'pcard-level', info)
    const bar = el('div', 'pcard-xpbar', info)
    this.cardXp = el('i', '', bar)
    this.cardXpText = el('div', 'pcard-xptext', info)
    const em = el('div', 'pcard-emblem', card)
    em.innerHTML = emblemSvg('tf141')

    // Map preview (right)
    const right = el('div', 'main-right panel', root)
    el('div', 'panel-title', right, 'SELECTED MAP')
    const frame = el('div', 'map-frame', right)
    this.preview = el('canvas', 'map-canvas', frame)
    this.preview.width = this.preview.height = 440
    const tag = el('div', 'map-tag', frame)
    el('span', '', tag, 'TEAM DEATHMATCH')
    this.mapName = el('div', 'map-name', right)
    this.mapLoc = el('div', 'map-loc', right)
    el('div', 'map-sub', right, 'TEAM DEATHMATCH — 6v6')
    this.mapDesc = el('p', 'map-desc', right)
    const teams = el('div', 'map-teams', right)
    const a = el('div', 'mt', teams)
    a.innerHTML = `${emblemSvg('tf141')}<span>TASK FORCE 141</span>`
    el('div', 'mt-vs', teams, 'VS')
    const b = el('div', 'mt r', teams)
    b.innerHTML = `<span>OPFOR</span>${emblemSvg('opfor')}`

    keyHints(root, [
      ['↑ ↓', 'SELECT'],
      ['ENTER', 'CONFIRM'],
      ['ESC', 'BACK'],
    ])
  }

  enter() {
    const g = this.ctx.game
    const mapInfo = getMapOption(g.map.id)
    this.mapName.textContent = mapInfo.name.toUpperCase()
    this.mapLoc.textContent = mapInfo.location.toUpperCase()
    this.mapDesc.textContent = mapInfo.description
    this.cardName.textContent = g.player.name.toUpperCase()
    const xp = loadXp()
    const lv = levelForXp(xp)
    this.cardRank.innerHTML = rankSvg(lv)
    const next = lv >= RANK_NAMES.length - 1 ? xpForLevel(lv) : xpForLevel(lv + 1)
    const cur = xpForLevel(lv)
    const p = next === cur ? 1 : (xp - cur) / (next - cur)
    this.cardLevel.textContent = `LEVEL ${lv + 1}  —  ${rankName(lv).toUpperCase()}`
    this.cardXp.style.transform = `scaleX(${Math.max(0.02, Math.min(1, p))})`
    this.cardXpText.textContent = `${Math.floor(xp).toLocaleString()} / ${next.toLocaleString()} XP`
    this.drawPreview()
    this.list.refresh()
    this.list.setIndex(this.list.idx, false)
  }

  leave() {}

  private busy = false

  private privateMatch() {
    if (this.busy) return
    const g = this.ctx.game
    this.busy = true
    g.lobby
      .host({ ...defaultMatch(g.match.mode), mapId: g.match.mapId, botDifficulty: g.match.botDifficulty }, false)
      .then(() => this.ctx.push('lobby'))
      .catch((err: unknown) => this.ctx.popup('UNABLE TO CREATE GAME', err instanceof Error ? err.message : String(err)))
      .finally(() => (this.busy = false))
  }

  private drawPreview() {
    const c = this.preview
    const ctx = c.getContext('2d')
    if (!ctx) return
    const W = c.width
    ctx.clearRect(0, 0, W, W)
    const bg = ctx.createLinearGradient(0, 0, W, W)
    bg.addColorStop(0, '#2a2d1f')
    bg.addColorStop(1, '#14160f')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, W)
    ctx.strokeStyle = 'rgba(190,210,140,.10)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 22; i++) {
      const p = (i / 22) * W
      ctx.beginPath()
      ctx.moveTo(p, 0)
      ctx.lineTo(p, W)
      ctx.moveTo(0, p)
      ctx.lineTo(W, p)
      ctx.stroke()
    }
    const mm = this.ctx.game.map.minimap
    if (mm && mm.width > 0) {
      ctx.globalAlpha = 0.95
      ctx.drawImage(mm, 0, 0, W, W)
      ctx.globalAlpha = 1
    }
    // spawn markers
    const { bounds, spawns } = this.ctx.game.map
    for (const s of spawns) {
      if (s.team === 'any') continue
      const x = ((s.position.x - bounds.minX) / (bounds.maxX - bounds.minX)) * W
      const y = ((s.position.z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * W
      ctx.fillStyle = s.team === 'tf141' ? 'rgba(111,200,255,.85)' : 'rgba(255,84,72,.85)'
      ctx.beginPath()
      ctx.arc(x, y, 6, 0, Math.PI * 2)
      ctx.fill()
    }
    const vg = ctx.createRadialGradient(W / 2, W / 2, W * 0.35, W / 2, W / 2, W * 0.75)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(0,0,0,.55)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, W, W)
  }

  key(e: KeyboardEvent) {
    this.list.key(e)
  }
}
