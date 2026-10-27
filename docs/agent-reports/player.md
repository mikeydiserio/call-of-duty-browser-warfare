# Player controller — report

**Features**
- Sub-stepped capsule (≤0.14 m). Ground step-slide: a 5-ray footprint follows treads, slopes and drops ≤0.3 m; a lead-ray step-up climbs ≤0.32 m with eye smoothing. Slopes over ~45° block. Wall slide never adds lift.
- Accel 62 / decel 90 / air 7 m/s². Speed = CONFIG × mobility × Lightweight 1.07.
- Sprint: forward only; firing, ADS, backpedal or `blocksSprint` cancels it; strafe ×0.4. Lasts 4 s (Marathon: unlimited) and refills at 1.5 s/s; once drained, re-press Shift after 1 s. FOV ×1.05.
- Crouch and prone with ceiling checks. Sprint into prone dives. Jump while prone → crouch.
- Mantle 0.42–1.25 m, from the ground or for 0.65 s after a jump (boxes and pipes).
- Ladders: climb direction follows look pitch; mount from the top (view turns to the rungs); auto-dismount at the top; jump off.
- Camera: horizontal FOV converted to vertical; ADS sensitivity scales with zoom. Bob, landing dip, strafe roll, recoil with about 60% auto-recovery, damage flinch about 2°.
- Health vignette below 70 HP. Death cam: drops to the ground in 0.55 s, rolls, faces the killer, and is wall-checked.
- Hitboxes for each stance; the leg gap is closed.

**Verified** in headless Chromium (Playwright + swiftshader) on a test course injected into `game.collision`, at a fixed 1/60 s step: stairs up and down, kerb, 30° and 55° ramps, mantles (and no mantle at 1.8 m), pipe, ceiling refusal, sprint exhaustion, dive, every ladder path, death cam, respawn, flinch, intro lock, recoil, step/jump/land events, and hitbox zones. Screenshots are in `docs/agent-reports/player/`.

**Known issues**
- The stub map has no ladders, so this needs re-checking on the real Rust map.
- Weapons are a stub, so ADS sensitivity and `blocksSprint` are untested.
- No fall damage.

**CORE REQUESTS**
- `CollisionWorld.raycast` clones two Vector3s per hit, about 5 casts per frame. Please add an allocation-free `out` variant.
- `ui.ts` imports a missing `ui.css`. The audio `ConvolverNode` sample-rate error breaks `startMatch` in headless Chromium.
