# Architecture & Art Direction — "Modern Warfare: Rust"

Single-player browser FPS (Three.js r186 + Vite + TypeScript strict, bun). One map: **Rust**, the MW2 (2009) desert oil-yard. 6v6 Team Deathmatch vs bots. Target: it must *look, sound and feel* like Infinity Ward's Modern Warfare 2 multiplayer. Everything is procedural — no downloaded models, textures or audio files. Quality bar: AAA. "Programmer art" is a failure.

## Run

- Dev server is ALREADY running at `http://localhost:5173` (do not start another).
- `?debug` query param: mouse input works without pointer lock (automation).
- `window.game` exposes the `Game` instance in devtools. `game.freezeMenuCamera = true` stops the menu fly-through so you can pose `game.render.camera` yourself.
- Typecheck: `bunx tsc --noEmit` (from repo root). Several agents edit in parallel — only fix errors in files you own.
- Build: `bun run build`.

## Module ownership (do NOT edit files you don't own)

| Area | Path | Notes |
|---|---|---|
| Core (integrator) | `src/core/**`, `src/game/**`, `src/world/collision.ts`, `src/main.ts`, `index.html` | Read-only for agents. Need a change? List it under **CORE REQUESTS** in your final report. |
| Map | `src/world/**` (except collision.ts) | `buildRustMap(scene, collision): MapData` |
| Render | `src/render/**` | `GameRenderer` (renderer, sky, lights, post) and `Effects` (particles, tracers, decals, explosions) |
| Player | `src/player/**` | `Player implements Actor` — movement, stances, ladders, camera feel, death cam |
| Weapons | `src/weapons/**` | `WeaponSystem` (viewmodel, firing, ADS, reload, switch, frags, knife). May retune numbers in `defs.ts` but not its shape |
| AI | `src/ai/**` | `BotManager`, bots implementing `Actor`, soldier models, navigation |
| UI | `src/ui/**` | All DOM: menus, create-a-class, loading, HUD, scoreboard, end screen. Inject your own CSS |
| Audio | `src/audio/**` | `AudioEngine` — fully procedural WebAudio |

## Frame order (`src/core/game.ts`)

```
input.beginFrame()
if in match: mode.update → player.update → bots.update → combat.update
else: menu fly-through camera (map.menuCameraPath)
fx.update(dt) → audio.update(dt) → ui.update(dt) → render.render(dt)
input.endFrame()
```
`dt` is 0 while paused (fx gets 0; audio/ui/render get real dt).

## Key contracts (read the source — these files are the truth)

- `src/core/types.ts` — `Actor`, `WeaponDef`, `DamageInfo`, `MapData`, `Environment`, `InputState`, `Ladder`, `Surface`, `Loadout`.
- `src/core/events.ts` — `EventBus` + every `GameEvents` payload. Systems are decoupled through events: e.g. combat emits `bullet:impact`; FX spawns sparks and audio plays a ricochet.
- `src/world/collision.ts` — `CollisionWorld`: `raycast(origin, dir, max) → WorldHit{point,normal,distance,surface}`, `lineOfSight(a,b)`, `groundHeight(x,z)`, `surfaceBelow(x,y,z)`, `resolveCapsule(start,end,radius) → {onGround, groundNormal, push, collided}` (mutates the segment). BVH-accelerated over all registered geometry.
- `src/game/combat.ts` — `fireBullet(shooter, weaponId, origin, dir)` (one call per pellet; spread already applied; handles penetration/damage/kill/events), `melee(attacker)`, `throwGrenade(owner, origin, velocity, fuse)`, `explosion(pos, owner)`. Health regen lives here.
- `src/game/mode.ts` — TDM: `phase` ('menu'|'intro'|'playing'|'ended'), `score`, `timeLeft`, `introLeft`, `respawnIn(actor)`, `requestRespawn(actor)`, `isUavActive(team)`, `playerStreaks`, `usePlayerStreak()`, `spawnActor()`.
- `src/weapons/weapon-system.ts` — `WeaponSystem` API (MovementState in, adsAmount/spread/fovMultiplier/mobility/consumeRecoil()/getHudState() out).
- `src/render/renderer.ts` — `GameRenderer` implements `RenderContext` (`scene`, `camera`, `viewmodelScene`, `viewmodelCamera`) + `effects: ScreenEffects` (damage, flash, dead, ads, menu, shake) + `setEnvironment`, `setQuality`, `render`.
- `src/core/config.ts` — tunables (speeds, health regen, team size 6, score limit 75, 10 min).

Coordinates: metres, Y up. Yaw 0 looks down −Z; `directionFromYawPitch` in `core/math.ts`. The camera uses rotation order 'YXZ'.

Teams: `tf141` (player's team, Task Force 141 — desert multicam/tan) vs `opfor` (militia — dark olive, black/tan shemagh, mixed civilian/military). Player is always tf141, 5 bot teammates + 6 enemies.

## Art direction — MW2 "Rust"

**Reference memory:** late-afternoon desert oil yard. Low, warm sun (~25° elevation) raking long shadows; sky is a dusty gradient — pale grey-blue zenith → warm beige/peach horizon with a thick tan haze layer; the sun is a bright disc with a large soft glow. Everything is coated in dust. Ground is fine pale sand (#c9ac7e-ish) with darker compacted tire tracks, oil stains, scattered rocks and debris. Structures are **heavily corroded steel**: orange-brown rust over dark gunmetal, streaks running down, flaking yellow/grey paint remnants on pipes, corrugated sheet metal walls, riveted plates, diamond-plate floors, grated catwalks, chain-link fences, sandbags, wooden pallets, concrete jersey barriers and pipe supports. Distant backdrop: rolling dunes and rocky mesas fading into haze — the map feels enclosed in a sandy bowl.

**Layout (compact, ~64×64 m playable, MW2 Rust is tiny):** 12 zones — Front Gate (NE, OpFor initial spawn), Loading Dock (SW, TF141 initial spawn), central **Tower** (the hotspot: rusted multi-level steel structure ~11 m tall, open steel frame with partial corrugated walls, three floors, ladders, top reachable by ladder *and* by walking up the big pipeline), **Pipeline** (large-diameter rusty pipes on concrete saddles running across the map — players walk on and hide under them), **Oil Derrick** (lattice derrick tower / pump jack corner), **Blue Containers** and **Red Containers** (stacked shipping containers, corrugated), **Generators**, **Control Room** (small enterable concrete/sheet-metal building with windows), **Maintenance** (open shed), **Fuel Depot** (horizontal cylindrical fuel tanks), **Comms Station** (radio mast + shack). Sight lines must be broken up; there must be cover everywhere; height matters; flanking routes around the perimeter.

**Lighting/post:** ACES filmic tone mapping, warm sun (#ffd9a8) vs. cool sky-fill shadows (blue-grey), strong contrast, mild bloom on sun/sky/muzzle flashes, slight desaturation, warm highlights / teal-ish shadows grade, subtle film grain, vignette, fog/haze that eats distance, floating dust motes. MW2 is gritty and contrasty, not pastel and flat.

**Feel (non-negotiable for the player/weapons agents):** CoD movement — snappy acceleration, sprint with weapon lowered and canted, sprint-out delay before firing, crouch/prone, jump with small landing dip, smooth camera bob. Weapons: punchy recoil with fast recovery, viewmodel kick + muzzle climb, bright multi-frame muzzle flash, brass ejection, ADS snap (~0.2 s) to a proper iron sight/red-dot with FOV zoom, inertia sway, reload animations (mag out/in, bolt), weapon raise/lower on switch, hitmarker *tick*. Bots must fight like MW2 players, not stand still.

**HUD (MW2 2009):** top-left square minimap with north-up rotation and red UAV dots; bottom-left score bars (friendly/enemy) + time; bottom-right ammo as rows of tiny bullet icons + reserve number + weapon name + frag icon; killfeed left; dynamic 4-line crosshair; white "X" hitmarker; yellow "+100" points; red blood-splatter damage overlay + directional damage indicators; grenade indicator; killstreak icon on the right. Font: condensed military sans (Saira Condensed is loaded in index.html; Share Tech Mono for numbers).

## Performance budget

60 fps at 1080p on a mid-range GPU. < 400 draw calls for the map (merge static geometry by material, use InstancedMesh for repeated props), one shadow-casting directional light (map is small — fit the shadow camera tightly, 4096 map on high), pooled particles/decals (no per-shot allocation of geometries/materials), no per-frame `new Vector3()` in hot loops.
