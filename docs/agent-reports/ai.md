# AI agent report (`src/ai/**`)

**Features**
- **Soldiers:** skinned procedural rigs with per-bot variation.
  - TF141: tan multicam, plate carrier, helmet with NVG (or boonie/cap), headset, pads, gloves.
  - OpFor: dark civilian/militia clothing, shemagh/balaclava/beanie, chest rigs.
  - Fixed inherited skinning bugs: forearms were bound to the upper arm, thighs to the pelvis.
- **Animation:** IK legs with planted feet, strafe hip-twist, walk/run/sprint/crouch/prone. Arm IK onto the gun grips and aim-driven spine. Also recoil, flinch, reload, throw, knife, weapon switch, ladder climb and jump.
- **Death:** verlet ragdoll with a damage-direction impulse (bigger for headshots and explosions). The gun drops and the corpse sinks after 10 s.
- **Hitboxes:** bone-following capsules with a bounding-sphere reject first. Zones verified by rays from four sides.
- **Nav:** BVH column sampling, capsule fit, and step/mantle/drop/ladder links, pruned to nodes reachable from the spawns. Plus cover masks, sniper perches, A* and stuck repath.
- **Brain:**
  - Senses: 124° FOV with reaction times of 0.24–0.72 s; hearing; awareness of who hit them; UAV.
  - Aim error that converges over time, with weapon-paced bursts.
  - ADAD strafing, crouch-peeking, cover, flanking.
  - Hotspot patrols (tower weighted); snipers camp prone on perches.
  - Frags, knife, pistol swap; flee cooking grenades; never shoot through teammates.
- **Gamertags** in MW2-lobby style.

**Measured** (headless, local test map with a ladder tower, pipe ramp, stairs and containers)
- **Nav:** 5,753 nodes / 43,203 links built in 0.36–0.53 s. The committed stub map gives 5,760 nodes in 0.5 s.
- **`bots.update` (11 bots):** 0.9 ms average (p50 0.6, p95 2.3), on a noisy machine.
- **150 s bot-only match:** about 85 kills with close scores; every bot gets kills. Frags, knife kills, ladders and tower floors all get used.
- **Duel:** at difficulty 0.55, a bot kills a stationary player at 20 m in a median of 2.1 s.

**Known issues**
- Untested on the real Rust map.
- Weapon models are still stubs. Grip IK assumes the origin is at the pistol grip, with the barrel along −Z.
- The ragdoll has no joint limits.
- Corpses sink instead of fading.
- Only snipers go prone.

**CORE REQUESTS**
1. `fireBullet`: an optional tracer origin, so bot tracers come from the muzzle.
2. An allocation-free `collision.raycast` variant.
3. Spread out the initial spawns (the AI de-stacks them itself for now).
4. Other teams:
   - `src/ui/ui.css` is missing.
   - The audio ConvolverNode's sample rate doesn't match the context's, which crashes `startMatch` in headless Chromium.
