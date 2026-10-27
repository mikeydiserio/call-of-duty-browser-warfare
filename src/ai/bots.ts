import { Vector3 } from 'three'
import type { Game } from '../core/game'
import type { Actor, MatchSettings, ObjectiveId, ObjectivePoint, Team, WeaponId } from '../core/types'
import { otherTeam } from '../core/types'
import { Bot, type BotProfile, type BotSquad } from './bot'
import { getNavGraph, type NavGraph } from './nav'
import { generateNames } from './names'

const _cam = new Vector3()
const _fwd = new Vector3()
const _to = new Vector3()

/**
 * Owns the bots: builds the nav graph (cached per map), creates the squads for
 * a match (team modes or FFA) with MW2-lobby names, loadouts and skill, routes
 * hearing/damage/UAV stimuli, coordinates objective assignments, and updates
 * everyone each frame.
 */
export class BotManager implements BotSquad {
  bots: Actor[] = []
  private list: Bot[] = []
  /** 0..1 — scales reaction time and aim (per-bot skill jitters around it). */
  difficulty = 0.55
  nav: NavGraph | null = null
  /** Rolling average of update() cost in ms (debug/perf). */
  perfMs = 0
  private uavT = 0
  private seed = (Math.random() * 1e9) | 0
  private sdRound = -1
  private sdSite: ObjectiveId = 'A'

  constructor(private game: Game) {
    const ev = game.events
    ev.on('weapon:fire', ({ shooter, origin, suppressed }) => {
      const range = suppressed ? 12 : 60
      for (const b of this.list) {
        if (!b.alive || !this.game.mode.isEnemy(b, shooter)) continue
        if (b.position.distanceToSquared(origin) < range * range) b.hear(shooter, origin, 1)
      }
    })
    ev.on('actor:footstep', ({ actor, position, intensity }) => {
      const range = 15 * Math.max(0.3, intensity)
      for (const b of this.list) {
        if (!b.alive || !this.game.mode.isEnemy(b, actor)) continue
        if (b.position.distanceToSquared(position) < range * range) b.hear(actor, position, 0.3)
      }
    })
    ev.on('grenade:warning', ({ position }) => {
      for (const b of this.list) if (b.alive) b.fleeGrenade(position)
    })
    ev.on('actor:damaged', (info) => {
      if (info.victim instanceof Bot) info.victim.onDamaged(info)
    })
  }

  /** Classic 6v6: 5 allies for the player's team and 6 enemies (not yet spawned). */
  createTeams(playerTeam: Team): Actor[] {
    return this.createForMatch({ ...this.game.match, mode: this.game.match.mode === 'ffa' ? 'tdm' : this.game.match.mode, botCount: 11 }, playerTeam)
  }

  /**
   * Bots for a match: `match.botCount` of them. Team modes split them so the
   * teams are even counting the player (the player's side gets one fewer when
   * uneven); FFA mixes both character sets. Every bot uses match.botDifficulty.
   */
  createForMatch(match: MatchSettings, playerTeam: Team): Actor[] {
    this.clear()
    this.difficulty = match.botDifficulty
    this.nav = getNavGraph(this.game)
    this.nav.resetPenalties()
    const s = this.nav.stats
    console.info(`[ai] nav: ${s.nodes} nodes, ${s.links} links, ${s.buildMs.toFixed(0)} ms (${s.candidates} candidate surfaces)`)
    const count = Math.max(0, Math.round(match.botCount))
    const used = new Set<string>()
    if (match.mode === 'ffa') {
      // Everyone for themselves: alternate character sets for variety, one sniper.
      this.make(otherTeam(playerTeam), Math.ceil(count / 2), used, count > 3)
      this.make(playerTeam, Math.floor(count / 2), used, false)
    } else {
      const allies = Math.max(0, Math.floor((count + 1) / 2) - 1)
      this.make(playerTeam, allies, used, allies >= 3)
      this.make(otherTeam(playerTeam), count - allies, used, count - allies >= 3)
    }
    this.bots = this.list
    // Memories need the full actor list (player + bots); the net host re-inits with remote humans.
    const all: Actor[] = [this.game.player, ...this.list]
    for (const b of this.list) b.initMemories(all)
    return this.bots
  }

  private make(team: Team, count: number, used: Set<string>, withSniper: boolean) {
    if (count <= 0) return
    const names = generateNames(team, count, used)
    // ~1 sniper per side, a shotgun rusher sometimes, the rest ARs/SMGs.
    const pool: WeaponId[] = ['acr', 'm4a1', 'ak47', 'ump45', 'm4a1', 'acr', 'ak47', 'ump45']
    const sniperIdx = withSniper ? Math.floor(Math.random() * count) : -1
    const shotgunIdx = count > 1 && Math.random() < 0.5 ? (Math.max(0, sniperIdx) + 1 + Math.floor(Math.random() * (count - 1))) % count : -1
    for (let i = 0; i < count; i++) {
      const sniper = i === sniperIdx
      const primary: WeaponId = sniper ? 'intervention' : i === shotgunIdx ? 'spas12' : pool[Math.floor(Math.random() * pool.length)]!
      const profile: BotProfile = {
        primary,
        secondary: Math.random() < 0.35 ? 'deagle' : 'usp45',
        skill: Math.min(1, Math.max(0, this.difficulty + (Math.random() - 0.5) * 0.1)),
        aggression: sniper ? 0.25 : 0.35 + Math.random() * 0.6,
        sniper,
      }
      const bot = new Bot(this.game, names[i]!, team, profile, this.nav!, this.seed + this.list.length * 7919, this)
      this.game.render.scene.add(bot.rig.root)
      this.list.push(bot)
    }
  }

  // ─── Squad coordination (BotSquad) ────────────────────────────────────────

  objectiveLoad(team: Team, id: ObjectiveId, self: Bot): number {
    let n = 0
    for (const b of this.list) if (b !== self && b.alive && b.team === team && b.objId === id) n++
    return n
  }

  attackSite(sites: ObjectivePoint[]): ObjectiveId {
    const round = this.game.mode.round
    if (round !== this.sdRound || !sites.some((s) => s.id === this.sdSite)) {
      this.sdRound = round
      this.sdSite = sites[Math.floor(Math.random() * sites.length)]!.id
    }
    return this.sdSite
  }

  closestOfTeam(team: Team, p: Vector3): Bot | null {
    let best: Bot | null = null
    let bd = Infinity
    for (const b of this.list) {
      if (!b.alive || b.team !== team) continue
      const d = b.position.distanceToSquared(p)
      if (d < bd) {
        bd = d
        best = b
      }
    }
    return best
  }

  update(dt: number) {
    const t0 = performance.now()
    const cam = this.game.render.camera
    cam.getWorldPosition(_cam)
    cam.getWorldDirection(_fwd)
    const cosHalf = Math.cos(((cam.fov * Math.max(1, cam.aspect)) / 2 + 12) * (Math.PI / 180))
    for (const b of this.list) {
      _to.set(b.position.x - _cam.x, b.position.y + 1 - _cam.y, b.position.z - _cam.z)
      const d = _to.length()
      const onScreen = d < 3 || _to.dot(_fwd) > cosHalf * d
      b.update(dt, !onScreen ? 2 : d > 40 ? 1 : 0)
    }
    // UAV sweeps reveal enemies to the owning team.
    this.uavT -= dt
    if (this.uavT <= 0) {
      this.uavT = 2.5
      const mode = this.game.mode
      for (const b of this.list) if (b.alive && mode.isUavActiveFor(b)) b.uavPing()
    }
    const ms = performance.now() - t0
    this.perfMs = this.perfMs * 0.95 + ms * 0.05
  }

  /** Remove all bots from the scene. */
  clear() {
    for (const b of this.list) b.dispose()
    this.list = []
    this.bots = []
  }
}
