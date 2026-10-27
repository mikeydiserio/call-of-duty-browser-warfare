# UI agent report

**State found:** the earlier agent left about 2,900 lines of working TS in `src/ui/**`, but `ui.css` was missing. `ui.ts` imports it, so every screen and HUD element rendered unstyled.

## Built / fixed this session
- **`src/ui/ui.css` (new):** the full MW2 look in a 1080-tall design space, scaled to viewport height. Dark translucent panels with olive corner ticks, condensed uppercase type, a sliding olive highlight bar with scanlines and a shine, animated film noise, and a CRT scan sweep over menus.
- **Screens styled:** title card (wordmark fade/blur-in, "press any key"), main lobby (menu, player card with rank/XP, RUST map panel), create-a-class (slots, weapon render with stat bars and an equipped-weapon marker, perk options), options (sliders and toggles), controls (keycaps), pause (with live scoreboard), loading (RUST, location, objectives, tip, progress bar), intro countdown (TF141 vs OPFOR), death, Tab scoreboard, and VICTORY/DEFEAT/DRAW splash with a results page.
- **HUD:** rotating minimap frame, UAV status, score bars and timer, killfeed (you in yellow, friendlies cyan, enemies red, weapon and headshot icons), bullet-glyph ammo, reserve count, frag count, dynamic crosshair, red-on-kill hitmarker, stacked points popups, RELOAD/LOW/NO AMMO prompts, soft-gradient damage crescents, grenade indicator with a direction arrow, killstreak icon, and announcement/splash text.
- **Fixes:**
  - The options rows collapsed because the `.slider` class was on both the row and the track.
  - The grenade arrow was counter-rotated along with its icon, so it never pointed at the grenade.
  - The intro countdown overlapped the match announcement.
  - The points popup overlapped the killstreak splash.
  - The HUD showed through the results screen.
  - The Tab scoreboard had no backdrop.
  - Removed `backdrop-filter` and full-screen `mix-blend-mode`, which were expensive over the WebGL canvas.
- **Weapon art:** large create-a-class weapons now have gunmetal gradient shading.

## Verified
`bunx tsc --noEmit` reports no errors in `src/ui`. I drove the game with Playwright and Chromium (SwiftShader) and screenshotted every screen at 1920×1080, plus 2560×1440 for the scaling check, into `docs/agent-reports/ui/`. Bots are stubs at commit 02e0051, so I injected fake actors to exercise the killfeed, minimap, damage indicators, scoreboard and results. I also checked the DOM state numerically, because software-GL screenshots lag behind the live DOM.

## Known issues
- The map preview and minimap are empty, because the map stub's `minimap` canvas is blank at this commit.
- The weapon silhouettes are still fairly blocky. They are recognisable, but nothing like MW2's 3D renders.
- The main menu shows an "ESC BACK" hint, but Esc does nothing there.

## CORE REQUESTS
- Audio (not UI): `ConvolverNode` throws when the impulse response's sample rate (32000) doesn't match the context rate (44100).
- Respawn: `mode.respawnIn` returns 0 in the stub, so the death screen goes straight to "RESPAWNING" and the "Press FIRE" prompt never appears.
- `HudWeaponState` needs real `ammo` and `reloading` values from `weapon-system.ts` for the low-ammo and reload prompts to fire.

---

# Phase 2: lobbies and mode HUDs (on top of main c2dcc5b)

## Built
- **Main menu:**
  - PLAY ONLINE is greyed out, with a tooltip, whenever `lobby.onlineAvailable` is false.
  - PRIVATE MATCH hosts an offline lobby.
  - QUICK PLAY starts the default TDM.
- **Server browser (`lobby-screens.ts`):** `listLobbies()` table with code, host, mode, map and players (full and in-progress rows are marked), REFRESH, JOIN BY CODE (text input), and HOST GAME. It auto-refreshes every 12 seconds.
- **Lobby:**
  - The code is shown big.
  - Player list: split by team in team modes, with "auto" humans placed on the smaller side, plus bot fill rows. Each row has a rank icon, HOST/AUTO tag, ready tick and ping bars.
  - Host-editable settings: game type, bots (0–11, capped at 12 total), difficulty (Recruit to Veteran), kill/score limit or rounds to win, and time or round time. Changing the mode applies `defaultMatch` and keeps the difficulty.
  - Clients see the settings read-only.
  - Actions: START MATCH (host only; enabled when everyone is ready; calls `lobby.startMatch()` inside the click), READY, SWITCH TEAM, CREATE A CLASS and LEAVE.
  - Esc jumps the selection to LEAVE instead of leaving outright.
  - After a match it returns to the lobby, and results offer RETURN TO LOBBY.
- **Popups:** MW2-style modal for `net:status` messages, with a queue.
- **FFA:**
  - The score widget shows you vs the leader (or the runner-up when you lead), with placing ("4TH PLACE").
  - Killfeed and minimap use `mode.isEnemy`, so there are no friendlies.
  - The scoreboard is a single ranked list.
  - The end screen shows VICTORY/DEFEAT, your placing, and the top-3 podium.
- **Domination:**
  - A/B/C rings top-centre in owner colours, with a capture progress arc and a blinking contested state.
  - World markers (CAPTURE/DEFEND plus distance, clamped to the screen edge). The flag you stand on is hidden there and replaced by the CAPTURING/LOSING/CONTESTED bar.
  - Minimap letters, "A CAPTURED!" / "WE LOST A" splashes, and CAPTURES/DEFENDS scoreboard columns.
- **S&D:**
  - Round and role header, alive count per team, and a planted-bomb fuse timer that gets urgent under 10 seconds.
  - A BOMB indicator when you carry it, and bomb icons on the minimap (friendly carrier, dropped, planted).
  - "F — HOLD TO PLANT/DEFUSE" prompt, plus a progress bar driven by `plantProgress`/`defuseProgress`.
  - Site and bomb world markers, splashes for round start, win/loss (with the reason), plant and defuse, and spectating text when you're dead.
  - PLANTS/DEFUSES columns and skulls for dead players.

## Verified
`bunx tsc --noEmit` is clean. Playwright with headless Chromium at 1080p captured 26 screenshots in `docs/agent-reports/ui/modes/`. Lobbies were driven through `OfflineLobby`, plus a fake online `LobbyService` for the client and browser views. Objective and bomb state were set directly, because the map has no flags or sites yet and the MODES agent's rules aren't merged.

## Integration with MODES and NET (main 5d76ef3)
- **Mode APIs used:**
  - `placings`/`winnerActor` for FFA.
  - `isUavActiveFor`/`uavReveals` for minimap dots and the sweep.
  - `canRespawn`/`spectateTarget` for the spectate screen.
  - `mode.bombSites`, `progressTeam` for the flag arcs, `wantsPlant`/`canDefuse`, and `plantingId`/`defusingId`/`carrierId`.
- **Duplicate splashes removed:** the rules already announce secured/lost flags, round start/win/loss, and bomb planted. The UI adds only "YOU HAVE THE BOMB" and "BOMB DROPPED".
- **Net:**
  - `net:status` shows as toasts at the top right.
  - When the lobby closes under you, a "LOBBY CLOSED" popup shows `lobby.message`.
  - The host gets a KICK button on remote players when hovering.
  - The lobby shows a "MATCH IN PROGRESS" note while one is running.
- **Fixes from real play:**
  - World markers are hidden while you're dead (they collided with KILLED BY).
  - Edge-clamped markers stay clear of the minimap and the bottom HUD band.

**Verified with the real code:**
- **`?netlocal`, two tabs:** host → browser lists the lobby → client joins; settings, ready and team sync both ways; the host kicks → the client gets a toast and a popup and returns to the browser (`docs/agent-reports/ui/net/`).
- **Domination, real rules:** a real capture of B with the arc and the bar.
- **S&D, real rules:** hold-F planting through the mode's own input polling, then the fuse timer (`modes/40–43`).

`tsc` is clean.

## Still open
- AI should play the objectives.
- Score limits are not yet surfaced per mode in the intro.

## Earlier requests (mostly resolved by MODES/NET)
- **MODES:**
  - Announce the right mode in `begin()`; it's hardcoded to "TEAM DEATHMATCH".
  - Expose `winnerActor` (FFA).
  - Add `captures`/`defends`/`plants`/`defuses` to `ActorStats`; the UI reads them optionally.
- **MAP:** `domFlags`, `bombSites` and `bombSpawn`; the markers read `map.bombSites` and `mode.objectives`.
- **AI:** `createTeams` ignores `match.botCount`, so the lobby's bot count isn't applied yet.
