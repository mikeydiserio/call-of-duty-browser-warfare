# RENDER agent report

## What I built
**GameRenderer** (`renderer.ts`, `sky.ts`, `post.ts`). The public API is unchanged, and I added `setViewmodelSunVisibility`.
- WebGL with sRGB output. Tone mapping and grading happen in the post chain on HalfFloat buffers. Soft PCF sun shadows are fitted to ±52 m (4096 on high).
- Sky dome shader: grey-blue zenith, peach horizon, tan haze band, HDR sun disc with Mie glow, faint cirrus. The fog chunk is patched to add the same sun in-scatter, so fog blends into the horizon. A PMREM env map is baked from the sky. I brightened its ground bounce this session because the lower half of metal objects reflected near black.
- The viewmodel pass renders into the same HDR buffer with depth cleared, so it never clips into walls and gets the same grade.

**Effects** (`fx/effects.ts`, `fx/decals.ts`, `fx/particles.ts`, `fx/atlas.ts`). All pooled:
- One billboard batch (2400) and one streak batch (1200), one draw call each.
- One decal InstancedMesh (220, 4×4 procedural atlas). The oldest decals fade out, and metal holes have a hot rim that cools.
- 3 fixed point lights.
- Impacts per surface: sand (dust, spout, grains), concrete (dust, bouncing chips, the odd spark), metal (sparks with gravity and bounce, flash), wood (splinters), glass (shards, glints), water, and flesh (blood mist, droplets, wall and floor blood decals). Particles are shaded by a one-ray sun/shadow test.
- Tracers: only some are shown (1 in 4 for the player, 1 in 3 for bots). Bot tracers that pass within 3.5 m of the camera are always shown and brighter, and they fade near the lens.
- Bot muzzle flash: star, cone, glow, a puff of smoke and a light. The player's shots get a light flash near the camera.
- Grenades: flash, eroding fireball, drifting smoke column, ground dust ring, debris, sparks, scorch decal, light, shake and white-flash scaled by distance.
- Ambient dust motes and wind-blown sand wisps. A sun-visibility probe runs at 30 Hz. Everything freezes when `dt = 0`.

Fixed this session:
- Streak ribbons were back-face culled and never rendered. They now render double-sided.
- Puffs sliced visibly through walls. Their depth is now biased toward the camera, a cheap stand-in for soft particles.
- The blood overlay was a polka-dot texture. It is now a noise-based blood smear around the screen edges.

## Post chain order
World RenderPass → viewmodel RenderPass (depth cleared) → mipmap Bloom (threshold 1.05) → MW2ScreenFX (blur for menu/death/ADS, edge chromatic aberration, exposure, ACES, contrast S-curve, −14 % saturation, teal shadows / warm highlights, lift/gamma/gain, vignette, blood/death/menu overlays, grain, flash white-out) → SMAA.

## Measured (headless SwiftShader, so real-GPU FPS was not measured)
- Test scene: 33–37 draw calls, about 3.2k triangles, 16–17 programs. FX adds 3 draw calls in total.
- CPU stress test: 4 grenades plus 180 bullets (734 live billboards, 184 decals).
  - `fx.update`: 1.34 ms per frame on average, worst 11.8 ms (the first frame).
  - Emitting all of those events: 16.8 ms total.
- No console errors. The only warnings are the BVH `maxLeafSize` deprecation in core.

## Known issues
- The map is still a stub at 02e0051, so tuning was done on test blocks. The particle light level and the flash and fireball intensities may need another pass on the real Rust map.
- Particles are not true soft particles (no depth texture). Small hard intersections remain.
- Particle collision allocates through `CollisionWorld.raycast` (it clones vectors), capped at 40 rays per batch per frame.
- `src/ui/ui.css` is missing at this commit and the game won't boot without it. I used an uncommitted local stub to test.

## CORE REQUESTS
1. `CollisionWorld.raycast`: add an allocation-free variant that writes into an `out` object. It is hot in FX and AI.
2. Switch the BVH option `maxLeafSize` to `targetLeafSize`.
3. Optionally emit `weapon:fire` with the world-space muzzle point for the player too. The player light is currently placed at a fixed offset from the camera.
