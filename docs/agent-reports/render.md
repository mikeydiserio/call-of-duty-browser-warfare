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

---

## Follow-up after integration (merged `main` 8d28d27)

Fixed in `src/render/**` only. Sequence: `render/explosion_sequence.png` (real Rust map; rows are 4 m at 0.03/0.10/0.30/1.2 s, 10 m at 0.05/0.30/1.5 s, 25 m at 0.05/0.30/1.5 s; FX stepped manually at 1/60 s).

1. **Fireball no longer blows out to white.**
   - The flash phase is about 0.1 s: a star (0.07 s) plus a glow (0.12 s), at roughly half the old HDR intensity.
   - The fire is now 12 short-lived (0.28–0.5 s) turbulent puffs.
   - Rewritten fire shader:
     - Noise-driven temperature gradient: soot → deep red → orange → yellow.
     - Peak luminance capped at about 1.75×, so bloom only touches the core.
     - Mostly alpha-blended; only the hottest core is additive.
     - The sooty fringe is transparent while hot, so there are no dark outlines, and it cools into smoke.
2. **Smoke, dust and debris after the flash.**
   - Smoke starts earlier (0.02–0.2 s), is darker grey-brown and denser, and is sized 2.4–3.8 m.
   - The dust ring and dirt plume are more opaque.
   - Debris and sparks are unchanged.
   - The ground scorch decal was already present.
3. **Camera whiteout:** only within 6 m with line of sight, quadratic falloff, at most 0.45. At 4 m that gives about 0.05. The flash light was cut from 260 to 140 cd and lasts 0.25 s.
4. **Contact AO:** new `render/ao.ts`, enabled on medium and high, off on low.
   - Depth-only: normals come from depth derivatives, with 12 spiral samples, range falloff and fade beyond 33–60 m.
   - No NormalPass, because the built-in SSAO would re-render the whole scene and double the draw calls.
   - The pass runs between the world and viewmodel passes, so the gun never gets world AO (verified).
   - Effect: visible darkening under barriers, sandbags and pipe saddles.
5. **`raycastInto` everywhere:** all FX, sun-probe and decal raycasts now use it with one scratch `WorldHit`, so they don't allocate.

**`renderer.info` on the real map** (high quality, 1920×1080, SwiftShader; real-GPU FPS not measured):

| Scene | Draw calls | Triangles | Programs |
|---|---|---|---|
| Base view, before AO | 198 | 843,133 | 32 |
| With AO | 199 (+1, fullscreen pass) | +1 | 33 (+1) |
| During a grenade | 202 | +~250 (instanced quads) | — |

- The grenade adds at most 3 draw calls: billboards, streaks and decals.
- A grenade spawns about 90 billboards and 36 streaks.
- `bunx tsc --noEmit` is clean.

**Known issue:** the `THREE.Material: parameter 'side' has value of undefined` console warnings come from code outside `src/render`.
