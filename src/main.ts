import { loadOpforKit } from './ai/opfor-kit'
import { loadTf141Kit } from './ai/tf141-kit'
import { Game } from './core/game'
import { preloadGuns } from './weapons/gun-kit'
import { preloadRustMap } from './world/rust/obj-map'

loadOpforKit()
loadTf141Kit()

const container = document.getElementById('game')
const uiRoot = document.getElementById('ui')
if (!container || !uiRoot) throw new Error('Missing #game / #ui root elements')

// Rust (the boot map) is built from imported level geometry; it must be in memory first.
await preloadRustMap()
const game = new Game(container, uiRoot)
// MW2 gun models stream in behind the menu; the active class's weapons come first.
preloadGuns([game.loadout.primary, game.loadout.secondary, 'knife', 'frag'])
game.start()
// Debug handle for devtools inspection.
;(window as unknown as { game: Game }).game = game
