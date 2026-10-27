import type { Game } from '../core/game'
import type { Loadout, MatchSettings, NetRole, Team } from '../core/types'
import { ClientSession } from './client'
import { HostSession, type HostPeer } from './host'
import type { LobbyInfo, LobbyPlayer, LobbyService, LobbyState } from './lobby'
import { loadPlayerName, normalizePlayerName, OfflineLobby, savePlayerName } from './lobby'
import { PeerLink, type PeerSignal } from './peer'
import type { ReliableMsg } from './protocol'
import type { SignalChannel, SignalingTransport, SignalPayload } from './signaling'

/** Humans + bots. */
export const MAX_PLAYERS = 12
const LOBBY_LIST = 'mw-lobbies'
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Messages on the per-lobby broadcast channel `mw-lobby-<code>`. */
type LobbyMsg =
  | { type: 'join'; pid: string; name: string }
  | { type: 'welcome'; to: string; host: string; netId: number }
  | { type: 'reject'; to: string; reason: string }
  | { type: 'signal'; from: string; to: string; data: PeerSignal }
  | { type: 'lobby'; state: LobbyState; inProgress: boolean }
  | { type: 'ready'; pid: string; ready: boolean }
  | { type: 'team'; pid: string; team: Team | null }
  | { type: 'leave'; pid: string }
  | { type: 'kick'; to: string }
  | { type: 'close' }

const randomId = () => Math.random().toString(36).slice(2, 10)

/**
 * Online lobbies: Supabase Realtime (or any SignalingTransport) for discovery, lobby state and
 * WebRTC signalling; a star of WebRTC data channels to the host for the match itself.
 * `host(settings, false)` is a private solo lobby, exactly like OfflineLobby.
 */
export class OnlineLobby implements LobbyService {
  role: NetRole = 'offline'
  readonly onlineAvailable = true
  lobby: LobbyState | null = null
  localName: string
  /** True while the host is in a match (late joiners spawn on their next respawn). */
  inProgress = false
  /** Last disconnect / rejection reason, for the UI. */
  message = ''
  readonly pid = randomId()
  host_: HostSession | null = null
  client: ClientSession | null = null
  private solo: OfflineLobby
  private listeners = new Set<() => void>()
  private listCh: SignalChannel | null = null
  private listReady: Promise<SignalChannel> | null = null
  private ch: SignalChannel | null = null
  // Host
  private peers = new Map<string, HostPeer>()
  private nextNetId = 60000
  private myReady = true
  private myTeam: Team | null = null
  private beatTimer = 0
  // Client
  private hostPid = ''
  private hostLink: PeerLink | null = null
  private lastLobbyMsg = 0

  constructor(
    private game: Game,
    readonly transport: SignalingTransport,
  ) {
    this.solo = new OfflineLobby(game)
    this.solo.onChange(() => {
      if (this.role === 'offline') {
        this.lobby = this.solo.lobby
        this.changed()
      }
    })
    this.localName = loadPlayerName()
    this.solo.localName = this.localName
    window.addEventListener('beforeunload', () => this.leave())
    ;(window as unknown as { __net: OnlineLobby }).__net = this
  }

  // ─── Lobby browser ────────────────────────────────────────────────────────

  setLocalName(name: string) {
    const clean = normalizePlayerName(name)
    if (!clean) return
    this.localName = clean
    savePlayerName(clean)
    if (this.role === 'offline') this.solo.setLocalName(clean)
    else if (this.role === 'host') this.publish()
    else {
      this.sendHello()
      this.changed()
    }
  }

  private listChannel(): Promise<SignalChannel> {
    this.listReady ??= this.transport.open(LOBBY_LIST, this.pid).then((ch) => {
      this.listCh = ch
      ch.onPresence(() => this.changed())
      return ch
    })
    this.listReady.catch(() => (this.listReady = null))
    return this.listReady
  }

  async listLobbies(): Promise<LobbyInfo[]> {
    const fresh = !this.listCh
    const ch = await this.listChannel()
    if (fresh) await sleep(1200) // first presence sync
    return ch
      .presence()
      .map((p) => p as unknown as LobbyInfo)
      .filter((l) => typeof l.code === 'string' && l.code !== this.lobby?.code)
  }

  private advertise() {
    if (this.role !== 'host' || !this.lobby || !this.listCh) return
    const info: LobbyInfo = {
      code: this.lobby.code,
      hostName: this.localName,
      mode: this.lobby.settings.mode,
      mapId: this.lobby.settings.mapId,
      players: this.lobby.players.length,
      maxPlayers: this.lobby.maxPlayers,
      inProgress: this.inProgress,
    }
    this.listCh.track(info as unknown as Record<string, unknown>)
  }

  // ─── Hosting ──────────────────────────────────────────────────────────────

  async host(settings: MatchSettings, online: boolean): Promise<string> {
    this.leave()
    savePlayerName(this.localName)
    if (!online) {
      this.solo.localName = this.localName
      return this.solo.host(settings)
    }
    const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')
    const ch = await this.transport.open(`mw-lobby-${code}`, this.pid)
    this.ch = ch
    this.role = 'host'
    this.myReady = true
    this.myTeam = null
    this.inProgress = false
    this.lobby = { code, settings: { ...settings }, players: [], maxPlayers: MAX_PLAYERS }
    this.host_ = new HostSession(this.game, () => [...this.peers.values()])
    this.host_.hostName = () => this.localName
    ch.onMessage((m) => this.onHostMsg(m as unknown as LobbyMsg))
    this.offPhase = this.game.events.on('match:phase', ({ phase }) => {
      const was = this.inProgress
      this.inProgress = phase === 'intro' || phase === 'playing'
      if (was !== this.inProgress) this.publish()
    })
    try {
      await this.listChannel()
    } catch (err) {
      console.warn('[net] lobby list unavailable', err)
    }
    this.beatTimer = window.setInterval(() => this.publish(), 3000)
    this.setRole('host', true)
    this.publish()
    return code
  }

  private offPhase: (() => void) | null = null

  private onHostMsg(m: LobbyMsg) {
    const lobby = this.lobby
    if (!lobby || !this.ch) return
    switch (m.type) {
      case 'join': {
        if (this.peers.has(m.pid)) return
        if (this.peers.size + 1 >= MAX_PLAYERS) {
          this.send({ type: 'reject', to: m.pid, reason: 'Lobby is full' })
          return
        }
        const netId = this.nextNetId++
        const peer: HostPeer = {
          pid: m.pid, name: (m.name || 'Player').slice(0, 20), netId, loadout: null, wantTeam: null, team: 'tf141', ready: false, ping: 0, queue: [],
          link: new PeerLink((data) => this.send({ type: 'signal', from: this.pid, to: m.pid, data }), false),
        }
        this.peers.set(m.pid, peer)
        this.wireHostLink(peer)
        this.send({ type: 'welcome', to: m.pid, host: this.pid, netId })
        this.publish()
        return
      }
      case 'signal':
        if (m.to === this.pid) void this.peers.get(m.from)?.link.handleSignal(m.data)
        return
      case 'ready': {
        const p = this.peers.get(m.pid)
        if (p) (p.ready = m.ready), this.publish()
        return
      }
      case 'team': {
        const p = this.peers.get(m.pid)
        if (p) (p.wantTeam = m.team), this.publish()
        return
      }
      case 'leave':
        this.dropPeer(m.pid)
        return
      default:
    }
  }

  private wireHostLink(peer: HostPeer) {
    const link = peer.link
    let pingTimer = 0
    link.onOpen = () => {
      pingTimer = window.setInterval(() => link.sendReliable({ t: 'ping', at: performance.now() }), 1000)
      if (this.inProgress) this.host_?.joinInProgress(peer)
      this.publish()
    }
    link.onClose = () => {
      clearInterval(pingTimer)
      this.dropPeer(peer.pid)
    }
    link.onReliable = (msg: ReliableMsg) => {
      if (msg.t === 'pong') {
        const rtt = performance.now() - msg.at
        peer.ping = peer.ping ? peer.ping * 0.7 + rtt * 0.3 : rtt
      } else if (msg.t === 'ping') link.sendReliable({ t: 'pong', at: msg.at })
      else if (msg.t === 'hello') {
        peer.loadout = sanitizeLoadout(msg.loadout)
        if (msg.name) peer.name = msg.name.slice(0, 20)
        this.publish()
      } else this.host_?.handle(peer, msg)
    }
    link.onState = (buf) => this.host_?.handleState(peer, buf)
  }

  private dropPeer(pid: string) {
    const p = this.peers.get(pid)
    if (!p) return
    this.peers.delete(pid)
    p.link.close()
    this.host_?.removePeer(pid)
    this.publish()
  }

  kick(pid: string) {
    if (this.role !== 'host') return
    this.send({ type: 'kick', to: pid })
    this.dropPeer(pid)
  }

  /** Host: rebuild the player list and broadcast it. */
  private publish() {
    const lobby = this.lobby
    if (this.role !== 'host' || !lobby) return
    const players: LobbyPlayer[] = [
      { id: this.pid, name: this.localName, team: this.myTeam, ready: this.myReady, isHost: true, ping: 0 },
      ...[...this.peers.values()].map((p) => ({ id: p.pid, name: p.name, team: p.wantTeam, ready: p.ready, isHost: false, ping: Math.round(p.ping) })),
    ]
    lobby.players = players
    this.send({ type: 'lobby', state: lobby, inProgress: this.inProgress })
    this.advertise()
    this.changed()
  }

  updateSettings(settings: MatchSettings) {
    if (!this.lobby) return
    if (this.role === 'offline') return this.solo.updateSettings(settings)
    if (this.role !== 'host') return
    this.lobby.settings = { ...settings }
    this.game.events.emit('lobby:changed', { mode: settings.mode })
    this.publish()
  }

  setReady(ready: boolean) {
    if (this.role === 'offline') return this.solo.setReady(ready)
    if (this.role === 'host') {
      this.myReady = ready
      this.publish()
    } else if (this.role === 'client') {
      this.send({ type: 'ready', pid: this.pid, ready })
      this.sendHello()
    }
  }

  setTeam(team: Team | null) {
    if (this.role === 'offline') return this.solo.setTeam(team)
    if (this.role === 'host') {
      this.myTeam = team
      this.publish()
    } else if (this.role === 'client') this.send({ type: 'team', pid: this.pid, team })
  }

  startMatch() {
    if (this.role === 'offline') return this.solo.startMatch()
    if (this.role !== 'host' || !this.lobby || !this.host_) return
    const humans = 1 + [...this.peers.values()].filter((p) => p.link.open).length
    const s = this.lobby.settings
    // Bots fill the lobby up to 12 total.
    const settings: MatchSettings = { ...s, botCount: Math.max(0, Math.min(s.botCount, MAX_PLAYERS - humans)) }
    this.host_.start(settings, this.myTeam)
    this.inProgress = true
    this.publish()
  }

  // ─── Joining ──────────────────────────────────────────────────────────────

  async join(code: string): Promise<void> {
    this.leave()
    savePlayerName(this.localName)
    code = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{5}$/.test(code)) throw new Error('Lobby codes are 5 characters')
    const ch = await this.transport.open(`mw-lobby-${code}`, this.pid)
    this.ch = ch
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Lobby not found')), 8000)
        let linkTimer = 0
        ch.onMessage((raw) => {
          const m = raw as unknown as LobbyMsg
          if (m.type === 'welcome' && m.to === this.pid && !this.hostLink) {
            clearTimeout(timer)
            this.hostPid = m.host
            this.lobby = this.lobby ?? null
            const link = new PeerLink((data) => this.send({ type: 'signal', from: this.pid, to: this.hostPid, data }), true)
            this.hostLink = link
            linkTimer = window.setTimeout(() => {
              link.close()
              reject(new Error('Could not connect to the host (peer-to-peer blocked by the network?)'))
            }, 15000)
            link.onOpen = () => {
              clearTimeout(linkTimer)
              resolve()
            }
          } else if (m.type === 'reject' && m.to === this.pid) {
            clearTimeout(timer)
            reject(new Error(m.reason))
          } else this.onClientMsg(m)
        })
        this.send({ type: 'join', pid: this.pid, name: this.localName })
      })
    } catch (err) {
      this.teardown()
      throw err
    }
    const link = this.hostLink!
    this.client = new ClientSession(this.game, link)
    link.onReliable = (msg) => {
      this.lastLobbyMsg = performance.now()
      this.onClientReliable(msg)
    }
    link.onState = (buf) => {
      this.lastLobbyMsg = performance.now()
      this.client?.handleState(buf)
    }
    link.onClose = () => this.hostGone('Lost connection to the host')
    this.lastLobbyMsg = performance.now()
    // Long main-thread stalls (match loading) must not count as silence: check twice in a row.
    let silent = 0
    this.beatTimer = window.setInterval(() => {
      silent = performance.now() - this.lastLobbyMsg > 20000 ? silent + 1 : 0
      if (silent >= 2) this.hostGone('The host stopped responding')
      else link.sendReliable({ t: 'ping', at: performance.now() })
    }, 1000)
    this.setRole('client', true)
    this.sendHello()
  }

  private sendHello() {
    this.hostLink?.sendReliable({ t: 'hello', loadout: this.game.loadout, name: this.localName })
  }

  private onClientMsg(m: LobbyMsg) {
    switch (m.type) {
      case 'signal':
        if (m.to === this.pid && m.from === this.hostPid) void this.hostLink?.handleSignal(m.data)
        return
      case 'lobby':
        this.lastLobbyMsg = performance.now()
        this.lobby = m.state
        this.inProgress = m.inProgress
        if (this.client) {
          const me = m.state.players.find((p) => p.id === this.pid)
          if (me) me.ping = Math.round(this.client.rtt)
        }
        this.changed()
        return
      case 'kick':
        if (m.to === this.pid) this.hostGone('You were kicked from the lobby')
        return
      case 'close':
        this.hostGone('The host closed the lobby')
        return
      default:
    }
  }

  private onClientReliable(msg: ReliableMsg) {
    const c = this.client
    if (!c) return
    if (msg.t === 'ping') this.hostLink?.sendReliable({ t: 'pong', at: msg.at })
    else if (msg.t === 'start') {
      this.sendHello()
      c.start(msg)
    } else c.handle(msg)
  }

  private hostGone(message: string) {
    if (this.role !== 'client') return
    this.message = message
    const inMatch = this.game.mode.phase !== 'menu'
    this.teardown()
    if (inMatch) this.game.quitToMenu()
    this.setRole('offline', false, message)
  }

  // ─── Leaving ──────────────────────────────────────────────────────────────

  leave() {
    const wasOnline = this.role !== 'offline'
    if (this.role === 'host') {
      this.send({ type: 'close' })
      this.listCh?.track(null)
    } else if (this.role === 'client') this.send({ type: 'leave', pid: this.pid })
    const inMatch = this.game.mode.phase !== 'menu' && this.game.net !== null
    this.teardown()
    if (inMatch) this.game.quitToMenu()
    if (this.solo.lobby) this.solo.leave()
    if (wasOnline) this.setRole('offline', false)
    else if (this.lobby) {
      this.lobby = null
      this.changed()
    }
  }

  private teardown() {
    clearInterval(this.beatTimer)
    for (const p of this.peers.values()) {
      p.link.onClose = () => {}
      p.link.close()
    }
    this.peers.clear()
    if (this.hostLink) {
      this.hostLink.onClose = () => {}
      this.hostLink.close()
      this.hostLink = null
    }
    this.host_?.dispose()
    this.host_ = null
    this.client?.dispose()
    this.client = null
    this.offPhase?.()
    this.offPhase = null
    this.ch?.close()
    this.ch = null
    this.lobby = null
    this.inProgress = false
    this.game.net = null
  }

  private setRole(role: NetRole, connected: boolean, message?: string) {
    this.role = role
    this.game.netRole = role
    this.game.net = role === 'host' ? this.host_ : role === 'client' ? this.client : null
    this.game.events.emit('net:status', { role, connected, message })
    this.changed()
  }

  /** Network stats for debugging / the report. */
  stats() {
    return {
      role: this.role,
      peers: [...this.peers.values()].map((p) => ({ name: p.name, ping: Math.round(p.ping), bytesOut: p.link.bytesOut, bytesIn: p.link.bytesIn })),
      hostBytesPerSec: this.host_ ? Math.round(this.host_.bytesPerSec) : 0,
      clientBytesInPerSec: this.client ? Math.round(this.client.bytesPerSec) : 0,
      rtt: this.client ? Math.round(this.client.rtt) : 0,
    }
  }

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed() {
    for (const fn of this.listeners) fn()
  }

  private send(m: LobbyMsg) {
    this.ch?.send(m as unknown as SignalPayload)
  }
}

function sanitizeLoadout(l: Loadout | undefined): Loadout {
  const ok = (id: unknown) => typeof id === 'string'
  if (!l || !ok(l.primary) || !ok(l.secondary)) return { primary: 'm4a1', secondary: 'usp45', perks: [] }
  return { primary: l.primary, secondary: l.secondary, perks: Array.isArray(l.perks) ? l.perks.slice(0, 3) : [] }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
