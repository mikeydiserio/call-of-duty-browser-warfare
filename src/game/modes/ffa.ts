import type { Actor, DamageInfo, SpawnPoint } from '../../core/types'
import { otherTeam } from '../../core/types'
import { ModeRules } from './rules'

/**
 * Free-for-All: everyone is an enemy. First to scoreLimit kills, or the most kills
 * at time-out. `team` is only used for character models.
 */
export class FreeForAllRules extends ModeRules {
  readonly id = 'ffa' as const

  intro() {
    return { text: 'FREE-FOR-ALL', sub: `Kill everyone. First to ${this.mode.settings.scoreLimit} kills wins.`, voice: 'ffa_intro' }
  }

  begin() {
    this.syncScore()
  }

  /** Spread out: every spawn is candidate, weighted away from all enemies; no friends. */
  chooseSpawn(actor: Actor, initial: boolean): SpawnPoint {
    const all = this.allSpawns()
    if (initial) {
      // Farthest from everyone already placed.
      const placed = this.game.actors.filter((a) => a !== actor && a.alive)
      let best = all[0]!
      let bestD = -1
      for (const s of all) {
        if (this.mode.lastSpawnUse.has(s)) continue
        let d = Infinity
        for (const a of placed) d = Math.min(d, a.position.distanceTo(s.position))
        d += Math.random() * 2
        if (d > bestD) {
          bestD = d
          best = s
        }
      }
      return best
    }
    return this.bestSpawn(actor, all, undefined, -10)
  }

  onKill(info: DamageInfo, suicide: boolean) {
    const killer = info.attacker
    this.syncScore()
    if (suicide || !killer) return
    const limit = this.mode.settings.scoreLimit
    const k = killer.stats.kills
    if (k >= limit) {
      this.finish()
      return
    }
    if (k === limit - 5 && killer.isPlayer) this.game.events.emit('match:announce', { text: 'FIVE KILLS TO WIN', voice: 'near_win' })
  }

  onTimeUp() {
    this.finish()
  }

  /** Winner = most kills; a tie on top is a draw. `winner` is from the local player's point of view. */
  private finish() {
    const ranked = this.mode.rankActors()
    const first = ranked[0] ?? null
    const tie = !!first && ranked.length > 1 && ranked[1]!.stats.kills === first.stats.kills
    const player = this.game.player
    const winner = tie ? 'draw' : first === player ? player.team : otherTeam(player.team)
    this.mode.endMatch(winner, tie ? null : first)
  }

  /** Mirror into the team score record: [player's team] = player's kills, [other team] = best opponent's. */
  private syncScore() {
    const player = this.game.player
    let best = 0
    for (const a of this.game.actors) if (a !== player) best = Math.max(best, a.stats.kills)
    const mine = player.team
    this.mode.score = { tf141: 0, opfor: 0 }
    this.mode.score[mine] = player.stats.kills
    this.mode.score[otherTeam(mine)] = best
    this.game.events.emit('score:changed', { ...this.mode.score })
  }
}
