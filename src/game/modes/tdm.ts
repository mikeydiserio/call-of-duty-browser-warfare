import type { DamageInfo } from '../../core/types'
import { ModeRules } from './rules'

/** Team Deathmatch: each enemy kill scores 1 for the team; first to scoreLimit or most at time-out. */
export class TeamDeathmatchRules extends ModeRules {
  readonly id = 'tdm' as const

  intro() {
    return { text: 'TEAM DEATHMATCH', sub: `Kill enemy players. First to ${this.mode.settings.scoreLimit} kills wins.`, voice: 'tdm_intro' }
  }

  onKill(info: DamageInfo, suicide: boolean) {
    const mode = this.mode
    const victim = info.victim
    const killer = info.attacker
    const events = this.game.events
    if (!suicide && killer && mode.isEnemy(killer, victim)) {
      mode.score[killer.team]++
      events.emit('score:changed', { ...mode.score })
      const limit = mode.settings.scoreLimit
      const s = mode.score[killer.team]
      if (s >= limit) {
        mode.endMatch(killer.team)
        return
      }
      // Near-win announcer lines.
      if (s === limit - 5) {
        const ours = killer.team === mode.playerTeam
        events.emit('match:announce', { text: ours ? 'FIVE KILLS TO WIN' : 'ENEMY FIVE KILLS FROM VICTORY', voice: ours ? 'near_win' : 'near_loss' })
      }
    } else if (suicide) {
      mode.score[victim.team] = Math.max(0, mode.score[victim.team] - 1)
      events.emit('score:changed', { ...mode.score })
    }
  }
}
