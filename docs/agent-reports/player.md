# Player controller — report

**Features** (`src/player/player.ts`, `hitboxes.ts`)
- Sub-stepped capsule movement (≤0.14 m/step). On the ground it is a CoD/Quake step-slide: a 5-ray footprint probe follows the floor up stair treads, along slopes and down drops of up to 0.3 m. If a riser blocks it, a lead-ray step-up climbs anything ≤0.32 m, with a smoothed eye offset. Wall slide never adds upward speed. Slopes steeper than ~45° (ny < 0.7) block you.
- Accel 62 / decel 90 m/s², air accel 7. Speeds are CONFIG × weapon mobility × Lightweight (1.07).
- Sprint: Shift, forward only. Firing, ADS, backpedal, prone or `blocksSprint` cancels it. Strafing while sprinting is scaled to 0.4. It lasts 4 s (unlimited with Marathon) and refills at 1.5 s/s; after running out you must re-press Shift once 1 s has refilled. FOV kick ×1.05.
- Stances: crouch (C) and prone (Ctrl/Z) with ceiling checks. Prone from a sprint is a 0.55 s dive. Jump while prone goes to crouch; jump while crouched stands you up.
- Mantle: ledges 0.42–1.25 m, from the ground or for 0.65 s after a jump. Works on boxes and round pipes.
- Ladders: attach by walking into one; W climbs, and the direction depends on look pitch. You can mount from the top (the view turns onto the rungs and tilts down). Auto-dismount at the top, jump or crouch to detach, weapons get `onLadder`.
- Camera: horizontal FOV is converted to vertical, × `fovMultiplier`. ADS scales sensitivity by the zoom. Pitch is clamped to ±88°. Includes bob, landing-dip spring, strafe roll, and recoil with ~60% auto-recovery (pulling down cancels it). Damage flinch is about 2° pitch and 3° roll away from the hit.
- Health vignette below 70 HP that pulses below 40. MW2 death cam: drops to the ground in 0.55 s, rolls, turns to face the killer, and the forward slump is ray-checked against walls. Pressing fire respawns.
- Hitboxes: head sphere 0.135 m, torso, arm and leg capsules for each stance.

**Verified in headless Chromium (Playwright + swiftshader)** using a test course injected into `game.collision` (stairs, 0.3 m kerb, 0.9/1.15/1.8 m boxes, 30°/55° ramps, low slab, 4 m platform with ladder, 1.2 m pipe). Each case ran at a fixed 1/60 s step, reading position, grounded, stance, eye and FOV. Stairs up and down, kerb, both slopes, all three mantles plus no-mantle on 1.8 m, pipe mantle and walking along the pipe top, ceiling refusal, sprint exhaustion, dive, ladder up/down/from-top/jump-off, death cam angles, respawn input, flinch, intro movement lock, recoil, footstep/jump/land events with surfaces, and hitbox zones per stance all behaved as intended. Screenshots are in `docs/agent-reports/player/`.

**Known issues**
- The stub map has no ladders or geometry, so all of this needs re-checking on the real Rust map.
- Weapons are still a stub, so ADS sensitivity and the `blocksSprint` interaction are untested.
- There is no fall damage.

**CORE REQUESTS**
- `CollisionWorld.raycast` allocates two Vector3s per hit (`clone()`). The player casts about 5 rays per frame, so please add an allocation-free variant that takes an `out` hit.
- `src/ui/ui.ts` imports a missing `./ui.css`, and AudioEngine throws on `ConvolverNode` sample-rate mismatch in headless Chromium, which breaks `startMatch`.
