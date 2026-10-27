import { el } from './dom'
import { keyHints, MenuList, type Screen, type UiCtx } from './screen'
import { Scoreboard } from './scoreboard'

export class PauseScreen implements Screen {
  readonly id = 'pause' as const
  readonly el = el('section', 'screen s-pause')
  private list: MenuList
  private board: Scoreboard

  constructor(private ctx: UiCtx) {
    const left = el('div', 'pause-left', this.el)
    el('div', 'menu-header', left, 'PAUSED')
    el('div', 'menu-sub', left, 'TEAM DEATHMATCH')
    el('div', 'menu-header-line', left)
    this.list = new MenuList(
      ctx,
      [
        { label: 'RESUME', action: () => ctx.resume() },
        { label: 'OPTIONS', action: () => ctx.push('options') },
        { label: 'CHANGE CLASS', sub: 'NEXT SPAWN', action: () => ctx.push('class') },
        { label: 'END GAME', action: () => ctx.quit() },
      ],
      74,
    )
    left.appendChild(this.list.el)
    this.board = new Scoreboard(ctx.game, 'compact')
    const right = el('div', 'pause-right', this.el)
    right.appendChild(this.board.el)
    keyHints(this.el, [
      ['↑ ↓', 'SELECT'],
      ['ENTER', 'CONFIRM'],
      ['ESC', 'RESUME'],
    ])
  }

  enter() {
    this.list.setIndex(0, false)
    this.board.render(true)
  }

  leave() {}

  update() {
    this.board.render()
  }

  key(e: KeyboardEvent) {
    if (e.code === 'Escape') {
      this.ctx.resume()
      return
    }
    this.list.key(e)
  }
}
