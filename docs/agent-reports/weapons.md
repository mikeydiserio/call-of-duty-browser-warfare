# Weapons & Viewmodel report (pass 2)

## What changed
- **Gun models rebuilt from reference proportions** (ACR, M4A1, AK-47, UMP45, SPAS-12, USP .45, Desert Eagle).
  - New helpers in `geo.ts`: front-section extrusions, MIL-STD-1913 rails with real teeth, screws, cross pins, serrations.
  - M4: 33 mm bore-to-rail, KAC RAS, A2 front sight base, birdcage, BUIS, forward assist, dust cover, A2 grip, buffer tube and 6-position stock.
  - AK: AKM stamped receiver with rivets, ribbed cover, tangent sight, hooded post, gas tube vents, cleaning rod, slant brake, ribbed mag.
  - ACR: monolithic upper, angular lower and magwell, vented handguard, folding stock, Aimpoint-style dot.
  - Pistols and SPAS also got slide sections, controls, stippling and pumps.
- **Materials**
  - New parkerized/anodized metal, brushed steel, stippled polymer and laminated-walnut generators.
  - Shader **edge wear** from screen-space curvature.
  - Metal albedos raised to physical values; they were near-black and rendered as silhouettes in game.
  - A shared IBL gain plus a view fill/rim light keep the gun readable in shade.
- **3D menu preview** (`preview.ts`, `WeaponPreview`: `mount`/`setWeapon`/`setVisible`/`dispose`)
  - Uses the same cached geometry and materials as the viewmodel, with a studio PMREM, warm key and cool rim.
  - Turntable, drag-rotate with inertia, idle bob, spin-in plus fade on change. Renders only while the class screen is visible.
  - Picker and slot icons are thumbnails rendered once from the real models (`weaponThumbnail`).
  - `class-screen.ts` is wired to it (integrator exception). Killfeed SVGs are untouched.
- **Hands**: superellipsoid palm with a domed back and wrist taper, knuckle bumps, thicker finger bases.
- **World models**: the same builders feed the bot meshes, with a <6 mm detail filter (vertex count roughly halved on the heaviest models).

## Verified (Playwright, swiftshader)
- Menu preview and thumbnails for every weapon.
- First person: hip and ADS for all 8 guns. Sights stay on centre after the height changes.
- Mid-reload frame and hand close-ups.
- Screenshots: `docs/agent-reports/weapons/` (`ia*`, `ib*`, `vh*`, `va*`, `vl`, `vx`, `menu-class-*`).
- `bunx tsc --noEmit` is clean.

## Known issues
- Hands still look blocky up close at odd angles.
- The Intervention, frag and knife got no model pass.
- Bot weapons are still 20–52k verts each; there is one draw call per bot.
- Pistol thumbnails are small because the frame is fitted by length.

## CORE REQUESTS
- None new.
