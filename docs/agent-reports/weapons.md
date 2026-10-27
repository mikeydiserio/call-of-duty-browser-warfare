# Weapons & Viewmodel report

## Features
- **WeaponSystem** (API unchanged): two slots plus 1 frag, rpm fire rate, auto or semi, phase gating.
  - Intervention bolt cycle (unscopes, then re-scopes). SPAS pump plus a shell reload that firing interrupts.
  - Tactical and empty reloads (Sleight of Hand halves them). Sprint or switch cancels a reload.
  - Switch (Y, wheel, 1/2), sprint-out delay, ADS from `adsTime`.
  - Spread bloom (Steady Aim ×0.65), recoil, dry-fire with auto-reload, frag cook/overcook, knife.
  - Hitscan pellets from the eye. The world muzzle (viewmodel NDC unprojected) feeds `weapon:fire` and tracers. All events are emitted.
- **Viewmodel**: articulated gloved hands, forearms with rolled multicam sleeves and a watch.
  - Spring animation: breathing, figure-8 bob, sprint, stance, jump and land, sway, recoil.
  - ADS puts the sight exactly on the camera axis.
  - Reloads with a falling mag and charging handle. Pistol slide locks when empty.
  - Bolt, pump, shells, knife, frag, switch, ladder.
- **FX** (pooled): flash variants with a light, smoke, brass and shells.
- **Scope**: mil-dot overlay with sway that the aim follows. Sprint holds breath.
- **World models**: one vertex-coloured mesh per weapon, with a `muzzle` node.

## Status
All 8 guns plus frag and knife render. ADS alignment was checked on every gun (`g-a1.png`, `g-a2.png`). Screenshots are in `docs/agent-reports/weapons/`.

## Verified in browser (event log)
Auto fire, tactical reload, switch, pistol empty → auto-reload with slide release, knife hit event, frag throw and explode, Intervention scope → unscope during bolt → re-scope, SPAS pump, shell reload interrupted by fire, no firing during intro.

## Known issues
- Hands are still blocky up close, and the knife slash reads end-on mid-swing.
- Brass lives in camera space, so it doesn't stay put in the world when you turn.
- Bot world models are about 15–30k verts each.
- Commando perk is ignored.

## CORE REQUESTS
- `src/ui/ui.css` is missing at 02e0051, so the app 500s. I tested with an untracked empty stub.
- `audio.ts` ConvolverNode sample-rate mismatch throws in `startMatch` (headless 44.1 kHz).
- `fireBullet` should return the hit point for actor hits; tracers currently approximate it.
- Debug handle: `window.__weapons` (`timeScale`, `debugPose`, `debugGive`).
