# Weapons & Viewmodel report

## Features
- **WeaponSystem** (`weapon-system.ts`, API unchanged). Primary and secondary slots with their own mag and reserve, 1 frag, fire rate from rpm (sub-frame carry), auto or semi, phase gating.
  - Intervention: bolt cycle unscopes, then re-scopes. SPAS-12: pump, plus shell-by-shell reload that firing interrupts.
  - Tactical and empty reload timelines. Sleight of Hand halves them. Sprint or switch cancels a reload.
  - Switch via Y, wheel or 1/2 with drop and raise. Sprint-out delay (0.26 s, pistols 0.17 s). `blocksSprint`. ADS uses `adsTime`.
  - Spread grows with fire, movement and air; stance scales it; Steady Aim ×0.65.
  - Recoil goes out through `consumeRecoil()`. Dry-fire, then auto-reload.
  - Frag: hold G to cook; overcooking blows up in hand. Knife on V/E.
  - Every pellet is hitscan from the eye. Muzzle position comes from viewmodel NDC unprojected at 0.6 m and feeds `weapon:fire` and tracers (every 3rd round). Emits all reload stages, plus switch, ads and dryfire.
- **Viewmodel** (`viewmodel.ts`, `hands.ts`, `rigs.ts`)
  - Gloved hands with 3-joint fingers and thumb, posed per weapon.
  - Forearms aim at elbow anchors, with bare skin, rolled multicam sleeves and a watch.
  - Spring-driven: breathing, figure-8 walk and sprint bob, sprint pose, crouch and prone, jump and land, look-sway lag, recoil kick.
  - ADS puts the sight exactly on the camera axis, and the viewmodel FOV narrows.
  - Reload: mag drops as a falling copy, hand goes to the pouch and comes back with a mag, charging handle or slide release.
  - Pistol slide locks back when empty. Also animated: bolt cycle, pump, shell insert, knife slash, frag pull/cook/throw, switch, ladder lower.
- **FX** (`fx.ts`): pooled. 3 flash variants, front star plus side jets, a point light, smoke wisps, brass/sniper cases/red shells with tumble, dropped mags.
- **Scope** (`scope.ts`): DOM mil-dot overlay with sway. Sprint holds breath. The aim follows the sway.
- **World models**: same profiles baked into 1 vertex-coloured mesh per weapon. Origin at the grip, `muzzle` child.

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
- Debug: `window.__weapons` exposes `timeScale`, `debugPose`, `debugGive`, `debugAds`, and `vm.debugSock`.
