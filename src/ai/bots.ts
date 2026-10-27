// STUB — owned by the AI agent. Keep the public API.
import type { Game } from '../core/game'
import type { Actor, Team } from '../core/types'

export class BotManager {
  bots: Actor[] = []
  constructor(private game: Game) {}
  /** Create 5 allies for the player's team and 6 enemies. Returns the bots (not yet spawned). */
  createTeams(_playerTeam: Team): Actor[] {
    return this.bots
  }
  update(_dt: number) {}
  /** Remove all bots from the scene. */
  clear() {
    this.bots = []
  }
}
