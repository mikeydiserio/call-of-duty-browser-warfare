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
