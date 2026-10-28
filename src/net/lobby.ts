import { defaultMatch, type Game } from '../core/game'
import type { GameModeId, MatchSettings, NetRole, Team } from '../core/types'

/** A human in the lobby (bots are not listed; they fill to MatchSettings.botCount). */
export interface LobbyPlayer {
  id: string
  name: string
  /** Chosen team in team modes (null = auto-balance). Ignored in FFA. */
  team: Team | null
  ready: boolean
  isHost: boolean
  /** Round-trip ms to the host (0 for the host itself). */
  ping: number
}

/** A joinable lobby as shown in the server browser. */
export interface LobbyInfo {
  code: string
  hostName: string
  mode: GameModeId
  mapId: string
  players: number
  maxPlayers: number
  inProgress: boolean
}

export interface LobbyState {
  code: string
  settings: MatchSettings
  players: LobbyPlayer[]
  /** Max humans; bots fill the rest. */
  maxPlayers: number
}

/**
 * Contract between the UI (lobby screens) and the net layer.
 * The UI only talks to `game.lobby`; the net agent replaces OfflineLobby with the
 * Supabase Realtime + WebRTC implementation behind this same interface.
 */
export interface LobbyService {
  readonly role: NetRole
  /** False when online play is unavailable (e.g. Supabase env vars missing) — UI should grey out Host/Join. */
  readonly onlineAvailable: boolean
  /** Players currently connected to the online service (menus + matches), or null when unknown/offline. */
  readonly onlineCount: number | null
  readonly lobby: LobbyState | null
  localName: string
  /** Set and persist this player's name. */
  setLocalName(name: string): void
  /** Server browser. */
  listLobbies(): Promise<LobbyInfo[]>
  /** Create a lobby; resolves with its join code. `online=false` makes a private solo lobby (bots only). */
  host(settings: MatchSettings, online: boolean): Promise<string>
  join(code: string): Promise<void>
  leave(): void
  /** Host only. */
  updateSettings(settings: MatchSettings): void
  setReady(ready: boolean): void
  setTeam(team: Team | null): void
  /** Host only, must be called from a user gesture: starts the match for everyone. */
  startMatch(): void
  /** Subscribe to any lobby/role/player change. Returns an unsubscribe fn. */
  onChange(fn: () => void): () => void
}

/** Solo implementation: a local lobby with just you + bots. */
export class OfflineLobby implements LobbyService {
  readonly role: NetRole = 'offline'
  readonly onlineAvailable = false
  readonly onlineCount = null
  lobby: LobbyState | null = null
  localName = loadPlayerName()
  private listeners = new Set<() => void>()

  constructor(private game: Game) {}

  setLocalName(name: string) {
    const clean = normalizePlayerName(name)
    if (!clean) return
    this.localName = clean
    savePlayerName(clean)
    const me = this.lobby?.players[0]
    if (me) me.name = clean
    this.changed()
  }

  async listLobbies(): Promise<LobbyInfo[]> {
    return []
  }

  async host(settings: MatchSettings): Promise<string> {
    this.lobby = {
      code: 'LOCAL',
      settings: { ...settings },
      players: [{ id: 'local', name: this.localName, team: null, ready: true, isHost: true, ping: 0 }],
      maxPlayers: 1,
    }
    this.changed()
    return this.lobby.code
  }

  async join(): Promise<void> {
    throw new Error('Online play is not configured')
  }

  leave() {
    this.lobby = null
    this.changed()
  }

  updateSettings(settings: MatchSettings) {
    if (!this.lobby) return
    this.lobby.settings = { ...settings }
    this.game.events.emit('lobby:changed', { mode: settings.mode })
    this.changed()
  }

  setReady(ready: boolean) {
    const me = this.lobby?.players[0]
    if (me) me.ready = ready
    this.changed()
  }

  setTeam(team: Team | null) {
    const me = this.lobby?.players[0]
    if (me) me.team = team
    this.changed()
  }

  startMatch() {
    const settings = this.lobby?.settings ?? defaultMatch('tdm')
    this.game.startMatch(this.game.loadout, settings)
  }

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed() {
    for (const fn of this.listeners) fn()
  }
}

const NAME_KEY = 'mw-rust-name'

export function normalizePlayerName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20)
}

export function loadPlayerName(): string {
  try {
    const saved = normalizePlayerName(localStorage.getItem(NAME_KEY) ?? '')
    return saved || `Soldier${Math.floor(Math.random() * 900 + 100)}`
  } catch {
    return 'Soldier'
  }
}

export function savePlayerName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    /* private mode */
  }
}
