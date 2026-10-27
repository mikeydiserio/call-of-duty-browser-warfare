import { Game } from './core/game'

const container = document.getElementById('game')
const uiRoot = document.getElementById('ui')
if (!container || !uiRoot) throw new Error('Missing #game / #ui root elements')

const game = new Game(container, uiRoot)
game.start()
// Debug handle for devtools inspection.
;(window as unknown as { game: Game }).game = game
