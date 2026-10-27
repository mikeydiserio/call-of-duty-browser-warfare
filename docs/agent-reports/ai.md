# AI agent report — `src/ai/**`

**Features**
- **Soldiers** (`soldier-model.ts`, `camo.ts`): skinned procedural rigs with per-bot variation. TF141 wear desert-tan multicam, a plate carrier, a helmet with NVG or goggles (or a boonie or cap), headsets, knee pads and gloves. OpFor wear mixed dark/civilian clothing with a shemagh, balaclava or beanie, chest rigs and sneakers. Fixed inherited skinning bugs (forearm sleeves were bound to the upper arm, thighs to the pelvis, helmet rims rotated about the feet).
- **Animation** (`animator.ts`): leg IK with planted feet, hip twist when strafing or backpedalling, and walk/run/sprint/crouch blends. Arm IK onto the weapon grips; spine and head follow aim pitch. Also: recoil and flinch springs, reload, grenade throw, knife, weapon switch, ladder climbing, jump and prone.
- **Death** (`ragdoll.ts`): 15-particle verlet ragdoll with an impulse along the damage direction (bigger for headshots, snipers and explosions). The gun drops, and the corpse sinks after 10 s.
- **Hitboxes** (`hitbox.ts`): bone-following capsules with a bounding-sphere reject first. Head/torso/arms/legs zones verified with ray tests from four sides.
- **Nav** (`nav.ts`): grid of all-hit BVH column rays over the map bounds, capsule fit with a wall nudge, and walk links (≤0.45 m steps), mantle links (≤1.15 m), drop links (≤3.5 m) and ladder links. Nodes not reachable both ways from the spawns are pruned. Also: 8-direction cover masks, sniper perches, `map.nav` merging, allocation-free A*, lookahead string-pull, stuck detection and repath, local avoidance.
- **Brain** (`bot.ts`):
  - Perception: 124° FOV, reaction time 0.24–0.72 s (slower in peripheral vision or against crouched/prone targets), staggered LOS checks.
  - Hearing (gunfire within 60 m, footsteps within 15 m), damage awareness and UAV pings.
  - Aim error that converges over time, ADAD strafing, crouch-peeking and weapon-paced bursts.
  - Retreats to cover when hurt, flanks, pursues, and lingers at hotspots (tower weighted).
  - Snipers camp prone or crouched on perches. Bots throw frags with ballistic solves, knife under 2 m, switch to the pistol when dry, flee cooking grenades and hold fire when a teammate is in the line.
- **Names**: MW2-lobby gamertags (clan tags, xX wrappers, leetspeak).

**Measured** (headless Chromium, local test map with a 3-floor ladder tower, pipeline ramp, stairs and containers)
- Nav: 5,753 nodes / 43,203 links in 0.36–0.53 s. On the committed stub map: 5,760 / 45,120 in 0.5 s.
- `bots.update` for 11 bots: **0.9 ms average** (p50 0.6, p95 2.3). This machine is noisy: a fixed workload shows p95 at 4× its median.
- 150 s bot-only match: 83–89 kills, scores close (e.g. 36–47). Every bot gets kills; snipers go 5/4 and 12/5. 16–17 frags, knife kills, ladders and tower floors used.
- Duel: one bot (difficulty 0.55) kills a *stationary* player at 20 m in a median of 2.1 s (1.75–4 s), which a human who reacts first should win.

**Known issues**
- Not yet tested on the real Rust map; nav only adapts to whatever geometry exists.
- Weapon world models are still stubs. Grip IK assumes the origin is at the pistol grip with the barrel along −Z.
- The ragdoll has no joint limits and its limbs can poke through thin props.
- Corpses sink rather than fade, because the material is shared.
- Prone is used only by camping snipers.

**CORE REQUESTS**
1. `combat.fireBullet`: an optional visual tracer origin, so bot tracers start at the muzzle instead of the eye.
2. `collision.raycast` allocates on every hit; add an allocation-free variant with an `out` parameter (the AI casts many rays).
3. `mode.spawnActor`: spread initial spawns. The 0.6 m jitter stacks squads; `Bot.spawn` works around this.
4. Cross-team problems that break the dev build and a headless match start:
   - `src/ui/ui.css` is missing from the repo.
   - `AudioEngine` throws because the ConvolverNode buffer's sample rate doesn't match the context's (32 kHz vs 44.1 kHz).
