import { Vector3 } from 'three'
import type { Game } from '../core/game'
import type { Actor, Team, WeaponId } from '../core/types'
import { otherTeam } from '../core/types'
import { Bot, type BotProfile } from './bot'
import { getNavGraph, type NavGraph } from './nav'
import { generateNames } from './names'

const _cam = new Vector3()

/**
 * Owns the bots: builds the nav graph (cached per map), creates the two squads
 * with MW2-lobby names, loadouts and per-bot skill, routes hearing/damage/UAV
 * stimuli, and updates everyone each frame.
 */
export class BotManager {
  bots: Actor[] = []
  private list: Bot[] = []
  /** 0..1 — scales reaction time and aim (per-bot skill jitters around it). */
  difficulty = 0.55
  nav: NavGraph | null = null
  /** Rolling average of update() cost in ms (debug/perf). */
  perfMs = 0
  private uavT = 0
  private seed = (Math.random() * 1e9) | 0

  constructor(private game: Game) {
    const ev = game.events
    ev.on('weapon:fire', ({ shooter, origin, suppressed }) => {
      const range = suppressed ? 12 : 60
      for (const b of this.list) {
        if (!b.alive || b.team === shooter.team) continue
        if (b.position.distanceToSquared(origin) < range * range) b.hear(shooter, origin, 1)
      }
    })
    ev.on('actor:footstep', ({ actor, position, intensity }) => {
      const range = 15 * Math.max(0.3, intensity)
      for (const b of this.list) {
        if (!b.alive || b.team === actor.team) continue
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

  /** Create 5 allies for the player's team and 6 enemies. Returns the bots (not yet spawned). */
  createTeams(playerTeam: Team): Actor[] {
    this.clear()
    this.nav = getNavGraph(this.game)
    const s = this.nav.stats
    console.info(`[ai] nav: ${s.nodes} nodes, ${s.links} links, ${s.buildMs.toFixed(0)} ms (${s.candidates} candidate surfaces)`)
    const used = new Set<string>()
    const make = (team: Team, count: number) => {
      const names = generateNames(team, count, used)
      // ~1 sniper per team, a shotgun rusher sometimes, the rest ARs/SMGs.
      const pool: WeaponId[] = ['acr', 'm4a1', 'ak47', 'ump45', 'm4a1', 'acr', 'ak47', 'ump45']
      const sniperIdx = Math.floor(Math.random() * count)
      const shotgunIdx = Math.random() < 0.5 ? (sniperIdx + 1 + Math.floor(Math.random() * (count - 1))) % count : -1
      for (let i = 0; i < count; i++) {
        const sniper = i === sniperIdx
        const primary: WeaponId = sniper ? 'intervention' : i === shotgunIdx ? 'spas12' : pool[Math.floor(Math.random() * pool.length)]!
        const profile: BotProfile = {
          primary,
          secondary: Math.random() < 0.35 ? 'deagle' : 'usp45',
          skill: Math.min(1, Math.max(0, this.difficulty + (Math.random() - 0.5) * 0.24)),
          aggression: sniper ? 0.25 : 0.35 + Math.random() * 0.6,
          sniper,
        }
        const bot = new Bot(this.game, names[i]!, team, profile, this.nav!, this.seed + this.list.length * 7919)
        this.game.render.scene.add(bot.rig.root)
        this.list.push(bot)
      }
    }
    make(playerTeam, 5)
    make(otherTeam(playerTeam), 6)
    this.bots = this.list
    // Memories need the full actor list (player + bots).
    const all: Actor[] = [this.game.player, ...this.list]
    for (const b of this.list) b.initMemories(all)
    return this.bots
  }

  update(dt: number) {
    const t0 = performance.now()
    this.game.render.camera.getWorldPosition(_cam)
    for (const b of this.list) {
      const far = b.position.distanceToSquared(_cam) > 40 * 40
      b.update(dt, far)
    }
    // UAV sweeps reveal enemies to the owning team.
    this.uavT -= dt
    if (this.uavT <= 0) {
      this.uavT = 2.5
      const mode = this.game.mode
      for (const b of this.list) if (b.alive && mode.isUavActive(b.team)) b.uavPing()
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
