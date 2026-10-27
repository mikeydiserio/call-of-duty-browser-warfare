import type { Game } from '../core/game'
import { type LobbyService, OfflineLobby } from './lobby'
import { OnlineLobby } from './online-lobby'
import { LocalSignaling, SupabaseSignaling } from './signaling'

/**
 * Pick the lobby implementation: Supabase Realtime when VITE_SUPABASE_URL and
 * VITE_SUPABASE_PUBLISHABLE_KEY are set, a same-browser loopback with `?netlocal`
 * (two tabs, no backend; for development), else the offline solo lobby.
 */
export function createLobby(game: Game): LobbyService {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  if (new URLSearchParams(location.search).has('netlocal')) return new OnlineLobby(game, new LocalSignaling())
  if (url && key) {
    try {
      return new OnlineLobby(game, new SupabaseSignaling(url, key))
    } catch (err) {
      console.warn('[net] Supabase unavailable, playing offline', err)
    }
  }
  return new OfflineLobby(game)
}

export type { NetHooks } from './hooks'
