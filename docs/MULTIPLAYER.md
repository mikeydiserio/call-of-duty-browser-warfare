# Lobby, game modes and online play: plan and contracts

Goal: MW2-style custom games. Host a lobby, other players join, and the host picks the game type (TDM, FFA, Domination or Search & Destroy), bot count, bot difficulty and limits. Weapons are chosen in create-a-class.

## Contracts (already on `main`; code against these and don't change their shape)
- `src/core/types.ts`:
  - `GameModeId`, `GAME_MODE_NAMES`, `MatchSettings`, `NetRole`.
  - `ObjectivePoint`, `ObjectiveState` and `BombState`.
  - `MapData.domFlags`, `MapData.bombSites` and `MapData.bombSpawn`.
- `src/core/events.ts`:
  - `objective:state`, `objective:captured`.
  - `bomb:pickup`, `bomb:dropped`, `bomb:planted`, `bomb:defused`, `bomb:exploded`.
  - `round:phase`, `lobby:changed`, `net:status`.
- `src/game/mode.ts` (`GameMode`):
  - `id`, `settings`, `isTeamMode`, `isEnemy(a, b)`.
  - `objectives`, `bomb`, `round`, plus the existing TDM API.
  - **Always use `game.mode.isEnemy(a, b)` instead of comparing `.team`.** In FFA everyone else is an enemy.
- `src/core/game.ts`: `game.match: MatchSettings`, `defaultMatch(mode)`, `startMatch(loadout, match?)`, `game.netRole` and `game.lobby: LobbyService`.
- `src/net/lobby.ts`:
  - `LobbyService` is the only API the UI uses for lobbies.
  - `OfflineLobby` is a working solo implementation (just you plus bots).

## Ownership for this phase
| Area | Owner | Scope |
|---|---|---|
| Mode rules | MODES agent | `src/game/**`, plus `src/core/**` except net hooks. TDM, FFA, Domination and S&D rules, round flow, per-mode spawning, bot fill from `match.botCount`, and `isEnemy` used in combat. |
| Online | NET agent | `src/net/**`, plus clearly marked net hooks in `src/core/game.ts` and `src/game/combat.ts`. A Supabase Realtime lobby with WebRTC data channels, replacing `OfflineLobby`. |
| Map | MAP agent | `src/world/**`. Flags A/B/C, bomb sites A/B, bomb spawn and per-mode spawns, plus the flag and bomb-site props. |
| AI | AI agent | `src/ai/**`. Objective play, FFA via `isEnemy`, and team sizes from `match`. Exports a soldier model that remote humans can use. |
| UI | UI agent | `src/ui/**`. Lobby screens and the mode HUDs and scoreboards. |
| Weapons | WEAPONS agent | `src/weapons/**`, plus a `WeaponPreview` hook-up in `src/ui/class-screen.ts`. 3D gun previews in the menus. |
| Audio | (later) | Announcer stingers for the mode events. |

## Network architecture (NET agent)
- **Signalling and lobby list:** Supabase Realtime only, with no database tables.
  - A presence channel `mw-lobbies` advertises open lobbies as `LobbyInfo`.
  - Each lobby uses a broadcast channel `mw-lobby-<code>` for joining, settings, ready state and WebRTC offer/answer/ICE exchange.
  - Config comes from `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. When they're missing, `onlineAvailable` is false and the game falls back to `OfflineLobby`.
- **Topology:** star. The host's browser is the authority.
  - Each client opens two WebRTC data channels to the host: a reliable one for events and an unreliable one for state.
  - STUN uses public Google servers. There is no TURN server, so some networks may fail to connect; that's a documented limitation.
- **Authority:**
  - The host runs the mode, the bots, combat (damage and kills) and the grenades.
  - Each client simulates its own movement for responsiveness and sends its pose at 20–30 Hz.
  - Clients send fire requests (`origin`, `dir` and weapon). The host validates them loosely (rate of fire, origin near the client's pose), resolves them with `combat.fireBullet`, and broadcasts the results.
  - The host broadcasts snapshots at 20 Hz: actors' pose, stance, weapon, health and alive state, plus mode, objective and bomb state and the score. It also sends reliable events such as kills, damage, phase changes and announcements.
  - Clients interpolate remote actors about 100 ms behind.
- **Remote humans** are `Actor`s from `src/net` (a `RemotePlayer`), rendered with the AI's soldier model.
- **Re-emitted events:** clients re-emit the host's gameplay events locally (`actor:killed`, `weapon:fire`, `bullet:impact` and so on), so the HUD, FX and audio work unchanged.
