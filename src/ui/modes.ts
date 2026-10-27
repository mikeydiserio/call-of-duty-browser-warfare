import type { Game } from '../core/game'
import type { Actor, ActorStats, GameModeId, MatchSettings } from '../core/types'

/** Short mode label as MW2 prints it in menus. */
export const MODE_SHORT: Record<GameModeId, string> = {
  tdm: 'TEAM DEATHMATCH',
  ffa: 'FREE-FOR-ALL',
  dom: 'DOMINATION',
  sd: 'SEARCH & DESTROY',
}

/** One-line objective used by announcements and the lobby. */
export function modeTagline(s: MatchSettings): string {
  switch (s.mode) {
    case 'ffa':
      return `Every man for himself. First to ${s.scoreLimit} kills wins.`
    case 'dom':
      return `Capture and hold the flags. First team to ${s.scoreLimit} points wins.`
    case 'sd':
      return `Attackers plant the bomb, defenders stop them. No respawns. First to ${s.scoreLimit} rounds.`
    default:
      return `Kill enemy players. First team to ${s.scoreLimit} kills wins.`
  }
}

/** Longer objective paragraph for the loading screen. */
export function modeObjective(s: MatchSettings): string {
  const mins = Math.round(s.timeLimit / 60)
  switch (s.mode) {
    case 'ffa':
      return `No teams, no friends. Eliminate every other combatant. The first player to ${s.scoreLimit} kills, or the player with the most kills after ${mins} minutes, wins the match.`
    case 'dom':
      return `Capture flags A, B and C by standing near them. Every flag your team holds earns points over time. The first team to ${s.scoreLimit} points wins.`
    case 'sd':
      return `Attackers must destroy one of two targets with the bomb. Defenders must stop them or defuse a planted bomb. One life per round. The first team to win ${s.scoreLimit} rounds takes the match.`
    default:
      return `Eliminate enemy combatants. The first team to ${s.scoreLimit} kills, or the team with the highest score when time expires, wins the match.`
  }
}

/** Optional per-mode stats the MODES agent may add to ActorStats. */
export type ModeStats = ActorStats & Partial<Record<'captures' | 'defends' | 'plants' | 'defuses', number>>

export function stat(a: Actor, key: keyof ModeStats): number {
  return (a.stats as ModeStats)[key] ?? 0
}

/** FFA ranking: kills, then score, then fewest deaths. */
export function ffaStandings(game: Game): Actor[] {
  return game.actors
    .slice()
    .sort((a, b) => b.stats.kills - a.stats.kills || b.stats.score - a.stats.score || a.stats.deaths - b.stats.deaths || a.id - b.id)
}

export function ordinal(n: number): string {
  const v = n % 100
  const suf = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suf}`
}

/** FFA winner as exposed by the mode (falls back to the standings leader). */
export function ffaWinner(game: Game): Actor | null {
  const w = (game.mode as { winnerActor?: Actor | null }).winnerActor
  return w ?? ffaStandings(game)[0] ?? null
}
