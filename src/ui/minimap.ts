import type { Game } from '../core/game'
import { el } from './dom'

export const MINIMAP_SIZE = 236
/** World metres visible across the whole minimap square. */
const VIEW_METERS = 58
const FRIEND = '#6fc8ff'
const ENEMY = '#ff4a3c'

/**
 * Heading-up square radar. Friendlies are always drawn; enemies only while
 * they have fired unsuppressed recently or while our UAV is up (MW2 rules).
 */
export class Minimap {
  readonly el: HTMLElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  /** Actor id -> realTime at which its "spotted" flash expires. */
  private spotted = new Map<number, number>()
  private scale = 1
  private contacts: { x: number; z: number; yaw: number; friendly: boolean; heli: boolean }[] = []

  constructor(private game: Game) {
    this.el = el('div', 'hud-minimap')
    this.canvas = el('canvas', '', this.el)
    const c = this.canvas.getContext('2d')
    if (!c) throw new Error('2D canvas unavailable')
    this.ctx = c
    this.resize(1)

    game.events.on('weapon:fire', ({ shooter, suppressed }) => {
      if (suppressed || !game.mode.isEnemy(game.player, shooter)) return
      this.spotted.set(shooter.id, game.realTime + 1.6)
    })
    game.events.on('actor:killed', ({ victim }) => this.spotted.delete(victim.id))
    game.events.on('match:phase', () => this.spotted.clear())
  }

  resize(designToPx: number) {
    this.scale = designToPx * Math.min(window.devicePixelRatio || 1, 2)
    const px = Math.round(MINIMAP_SIZE * this.scale)
    this.canvas.width = this.canvas.height = px
    this.canvas.style.width = this.canvas.style.height = `${MINIMAP_SIZE}px`
  }

  draw() {
    const g = this.game
    const ctx = this.ctx
    const S = MINIMAP_SIZE
    const player = g.player
    const yaw = player.yaw
    const k = S / VIEW_METERS // design px per metre
    const cosY = Math.cos(yaw)
    const sinY = Math.sin(yaw)
    const px = player.position.x
    const pz = player.position.z

    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)
    ctx.clearRect(0, 0, S, S)
    ctx.fillStyle = '#0c0f09'
    ctx.fillRect(0, 0, S, S)

    // Terrain image (world metres -> rotated about the player)
    const mm = g.map.minimap
    const b = g.map.bounds
    ctx.save()
    ctx.translate(S / 2, S / 2)
    ctx.rotate(yaw)
    ctx.scale(k, k)
    ctx.translate(-px, -pz)
    if (mm && mm.width > 0) {
      ctx.globalAlpha = 0.92
      ctx.drawImage(mm, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ)
      ctx.globalAlpha = 1
    }
    ctx.restore()

    // Subtle grid + tint so a bare image still reads as a radar
    ctx.fillStyle = 'rgba(20,34,10,.20)'
    ctx.fillRect(0, 0, S, S)

    const toScreen = (wx: number, wz: number, out: { x: number; y: number }) => {
      const dx = wx - px
      const dz = wz - pz
      out.x = S / 2 + (dx * cosY - dz * sinY) * k
      out.y = S / 2 + (dx * sinY + dz * cosY) * k
    }
    const pt = { x: 0, y: 0 }
    const team = player.team
    const uav = g.mode.isUavActiveFor(player)
    const now = g.realTime

    // UAV sweep
    if (uav) {
      const sweep = (now * 1.6) % (Math.PI * 2)
      ctx.save()
      ctx.translate(S / 2, S / 2)
      ctx.rotate(sweep)
      const grad = ctx.createLinearGradient(0, 0, S * 0.7, 0)
      grad.addColorStop(0, 'rgba(110,255,160,.0)')
      grad.addColorStop(1, 'rgba(110,255,160,.18)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, S, -0.5, 0)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(140,255,180,.55)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(S, 0)
      ctx.stroke()
      ctx.restore()
      const ring = (now * 0.7) % 1
      ctx.strokeStyle = `rgba(140,255,180,${0.35 * (1 - ring)})`
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(S / 2, S / 2, ring * S * 0.75, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Objectives (under the actor blips)
    this.drawObjectives(toScreen, pt)

    // Enemies
    for (const a of g.actors) {
      if (!a.alive || !g.mode.isEnemy(player, a)) continue
      let alpha = 0
      const until = this.spotted.get(a.id)
      if (until !== undefined && until > now) alpha = Math.min(1, (until - now) / 0.5)
      if (g.mode.uavReveals(player, a)) alpha = Math.max(alpha, 0.9)
      if (alpha <= 0.01) continue
      toScreen(a.position.x, a.position.z, pt)
      if (pt.x < -6 || pt.y < -6 || pt.x > S + 6 || pt.y > S + 6) continue
      ctx.globalAlpha = alpha
      ctx.fillStyle = ENEMY
      ctx.shadowColor = ENEMY
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 4.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1
    }

    // Friendlies (none in FFA)
    for (const a of g.actors) {
      if (!g.mode.isTeamMode || !a.alive || a.isPlayer || g.mode.isEnemy(player, a)) continue
      toScreen(a.position.x, a.position.z, pt)
      if (pt.x < -8 || pt.y < -8 || pt.x > S + 8 || pt.y > S + 8) continue
      this.arrow(pt.x, pt.y, yaw - a.yaw, 7.5, FRIEND)
    }

    // Bomb carrier / dropped / planted bomb (S&D)
    this.drawBomb(toScreen, pt)

    // Air support (killstreak helicopters, jets, gunships; the Stealth Bomber stays off radar)
    for (const c of g.streaks.radarContacts(this.contacts)) {
      toScreen(c.x, c.z, pt)
      if (pt.x < -10 || pt.y < -10 || pt.x > S + 10 || pt.y > S + 10) continue
      this.aircraft(pt.x, pt.y, yaw - c.yaw, c.heli, c.friendly ? FRIEND : ENEMY)
    }

    // Player
    this.arrow(S / 2, S / 2, 0, 9.5, '#ffffff')

    // Compass letters on the edge, rotating with heading
    ctx.font = '600 15px "Saira Condensed", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const dirs: [string, number, number, boolean][] = [
      ['N', 0, -1, true],
      ['E', 1, 0, false],
      ['S', 0, 1, false],
      ['W', -1, 0, false],
    ]
    for (const [label, dx, dz, major] of dirs) {
      let ex = dx * cosY - dz * sinY
      let ey = dx * sinY + dz * cosY
      const m = Math.max(Math.abs(ex), Math.abs(ey))
      ex /= m
      ey /= m
      const x = S / 2 + ex * (S / 2 - 11)
      const y = S / 2 + ey * (S / 2 - 11)
      ctx.fillStyle = major ? 'rgba(10,12,8,.85)' : 'rgba(10,12,8,.6)'
      ctx.beginPath()
      ctx.arc(x, y, major ? 9.5 : 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = major ? '#ffffff' : 'rgba(255,255,255,.65)'
      ctx.fillText(label, x, y + 0.5)
    }
    if (g.streaks.jammed(player)) this.drawStatic(S)
  }

  /** Killstreak aircraft glyph: rotor disc for helicopters, delta for jets. */
  private aircraft(x: number, y: number, rot: number, heli: boolean, color: string) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineWidth = 1.4
    if (heli) {
      ctx.beginPath()
      ctx.arc(0, 0, 8, 0, Math.PI * 2)
      ctx.globalAlpha = 0.35
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.fillRect(-2, -7, 4, 14)
    } else {
      ctx.beginPath()
      ctx.moveTo(0, -9)
      ctx.lineTo(8, 6)
      ctx.lineTo(0, 3)
      ctx.lineTo(-8, 6)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  /** Counter-UAV / EMP: the radar is nothing but noise. */
  private drawStatic(S: number) {
    const ctx = this.ctx
    const t = this.game.realTime
    ctx.fillStyle = '#0c0f09'
    ctx.fillRect(0, 0, S, S)
    for (let i = 0; i < 260; i++) {
      const v = Math.floor(Math.random() * 200)
      ctx.fillStyle = `rgba(${v},${v},${v},0.55)`
      ctx.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 5, 1.5)
    }
    const band = ((t * 90) % (S + 30)) - 15
    ctx.fillStyle = 'rgba(200,200,200,0.12)'
    ctx.fillRect(0, band, S, 14)
  }

  private drawObjectives(toScreen: (x: number, z: number, o: { x: number; y: number }) => void, pt: { x: number; y: number }) {
    const g = this.game
    const ctx = this.ctx
    const mine = g.player.team
    const pts: { id: string; x: number; z: number; color: string; pulse: boolean }[] = []
    if (g.mode.id === 'dom') {
      for (const o of g.mode.objectives) {
        const color = o.owner === null ? '#e8e8e0' : o.owner === mine ? FRIEND : ENEMY
        pts.push({ id: o.id, x: o.position.x, z: o.position.z, color, pulse: o.contested || o.capturingTeam !== null })
      }
    } else if (g.mode.id === 'sd') {
      const b = g.mode.bomb
      for (const site of g.mode.bombSites) {
        const hot = !!b?.planted && b.site === site.id
        pts.push({ id: site.id, x: site.position.x, z: site.position.z, color: hot ? ENEMY : '#ffd23a', pulse: hot })
      }
    }
    if (!pts.length) return
    const S = MINIMAP_SIZE
    ctx.font = '800 13px "Saira Condensed", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const o of pts) {
      toScreen(o.x, o.z, pt)
      // Clamp to the radar edge so off-screen objectives stay visible.
      const x = Math.min(S - 10, Math.max(10, pt.x))
      const y = Math.min(S - 10, Math.max(10, pt.y))
      const a = o.pulse ? 0.55 + 0.45 * Math.sin(this.game.realTime * 8) : 1
      ctx.globalAlpha = a
      ctx.fillStyle = 'rgba(8,10,6,.85)'
      ctx.strokeStyle = o.color
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.rect(x - 8, y - 8, 16, 16)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = o.color
      ctx.fillText(o.id, x, y + 0.5)
      ctx.globalAlpha = 1
    }
  }

  private drawBomb(toScreen: (x: number, z: number, o: { x: number; y: number }) => void, pt: { x: number; y: number }) {
    const g = this.game
    const b = g.mode.bomb
    if (g.mode.id !== 'sd' || !b) return
    const attacking = b.attackers === g.player.team
    let x: number
    let z: number
    if (b.planted) {
      x = b.position.x
      z = b.position.z
    } else if (b.carrier ?? g.mode.actorById(b.carrierId)) {
      const carrier = (b.carrier ?? g.mode.actorById(b.carrierId))!
      // Only your own team sees who has the bomb.
      if (g.mode.isEnemy(g.player, carrier) || carrier.isPlayer) return
      x = carrier.position.x
      z = carrier.position.z
    } else {
      if (!attacking) return
      x = b.position.x
      z = b.position.z
    }
    toScreen(x, z, pt)
    const S = MINIMAP_SIZE
    const cx = Math.min(S - 9, Math.max(9, pt.x))
    const cy = Math.min(S - 9, Math.max(9, pt.y)) - (b.carrier && !b.planted ? 11 : 0)
    const ctx = this.ctx
    const blink = b.planted ? 0.5 + 0.5 * Math.sin(g.realTime * 10) : 1
    ctx.globalAlpha = blink
    ctx.fillStyle = 'rgba(0,0,0,.8)'
    ctx.fillRect(cx - 8, cy - 5.5, 16, 11)
    ctx.fillStyle = '#f2f2ea'
    ctx.fillRect(cx - 7, cy - 4.5, 14, 9)
    ctx.fillStyle = '#ff3a2a'
    ctx.fillRect(cx - 5.5, cy - 3, 6, 4)
    ctx.globalAlpha = 1
  }

  private arrow(x: number, y: number, rot: number, size: number, color: string) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.fillStyle = color
    ctx.strokeStyle = 'rgba(0,0,0,.85)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(0, -size)
    ctx.lineTo(size * 0.72, size * 0.8)
    ctx.lineTo(0, size * 0.38)
    ctx.lineTo(-size * 0.72, size * 0.8)
    ctx.closePath()
    ctx.stroke()
    ctx.fill()
    ctx.restore()
  }
}
