# NET agent report — online lobbies + P2P netcode

## Architecture
- `createLobby` (`src/net/index.ts`) picks the lobby: `OnlineLobby` over Supabase Realtime when both `VITE_SUPABASE_*` vars are set, a BroadcastChannel loopback with `?netlocal` (two tabs, no backend), else `OfflineLobby`. The transport sits behind `SignalingTransport`.
- **Lobby** (`online-lobby.ts`): `mw-lobbies` presence advertises `LobbyInfo`. `mw-lobby-<CODE>` (5 chars) carries join/welcome/reject, the lobby state (re-broadcast every 3 s), ready/team, kick, close and the SDP/ICE exchange.
  - Max 12 total; `botCount` is clamped to 12 − humans at start.
  - If the host leaves, clients get `net:status` with a message and `lobby.message`, and drop back to the menu.
  - A late joiner gets `start` with `inProgress` and spawns right away; in S&D it waits for the next round.
- **Transport** (`peer.ts`): one RTCPeerConnection per client, STUN `stun.l.google.com:19302`, two negotiated data channels: `reliable` (ordered JSON) and `state` (unordered, maxRetransmits 0, binary).
- **Host** (`host.ts`):
  - One `RemotePlayer` proxy per client, with an AI soldier rig and bone hitboxes.
  - Validates and resolves `fire`/`nade`/`knife`/`respawn` requests through `Combat`: real-time ROF, origin within 3 m, pellet count, 2 nades per life.
  - Relays events in per-frame batches, skipping the shooter's own predicted fire, tracer and impact events.
  - Sends targeted hitmarkers and points, 20 Hz snapshots, 1 Hz stats and respawn timers.
- **Client** (`client.ts`):
  - Moves locally and sends its pose at 30 Hz.
  - All other actors are mirrors interpolated 100 ms behind.
  - Mode, score, time, objectives, bomb and UAV follow snapshots.
  - Host events are re-emitted locally, so the HUD, FX and audio are unchanged. Whizz is computed locally.
- **Hooks** (`// NET:`): `game.ts` (`game.net`, `createLobby`, client skips bots/mode, online doesn't pause, `net.update`) and `combat.ts` (onShot/onMelee/onGrenade, client skips damage/explosions, remote perks).

## Formats / bandwidth
- Snapshot: 28 B header + 15 B per actor (int16 cm pos, int16 angles, flags, weapon, health) + objectives (5 B each) + bomb (20 B).
- Pose: 18 B.
- Measured in a 13-actor TDM: host → client ≈ **10–12 KB/s**; client → host < 1 KB/s at rest.

## Verified
Two Playwright pages over `?netlocal` with real WebRTC data channels:
- lobby browser, join, settings/ready/team sync, ping
- match start with identical 13-actor rosters
- client movement on the host to within 2–6 mm; bot positions mirrored exactly
- client kills a bot (host: 3 requests, 0 rejected; client: damage, hitmarker, killed, +points)
- a bot kills the client (client dies, death event); host respawn reaches the client
- host leaves → client back to menu with "The host closed the lobby"

`bunx tsc --noEmit` is clean. Not tested against real Supabase (no credentials here).

## Limitations
- No TURN, so symmetric NAT and some corporate networks can't connect.
- No lag compensation; the host trusts client movement (loose checks only).
- No host migration.
- Remote humans' UAVs auto-activate.
- A client that quits mid-match stays in the lobby.

## Setup
1. Create a Supabase project. Realtime is on by default (Broadcast + Presence; no tables).
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (Project Settings → API).
3. Restart `bun run dev`.

## REQUESTS
- **UI:** use `lobby.kick(id)`, `lobby.message`, `lobby.inProgress`, and `net:status` for disconnect toasts.
- **MODES:** `createTeams` should count humans per team in `game.actors`; make `Player.team` writable (net casts it); use `mode.isEnemy` in `combat.melee` and `explosion`.
- **AI:** bots should add memories for actors added mid-match. Net calls `initMemories(game.actors)`.
- **Core:** `Input.lock()` throws an unhandled rejection without a gesture (seen when a client's match starts).
