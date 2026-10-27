# MAP agent report — Rust

## Files
- `src/world/rust/map.ts`: `buildRustMap` entry point. Sets up tracks and decals, spawns, callouts, environment, menu path and the invisible bounds walls.
- `src/world/rust/terrain.ts`: analytic `groundY` (flat yard, berms, dune sea), a 0.5 m visual grid, a 1 m collision grid, the polar dune ring and the track/oil/soil decals.
- `src/world/rust/props.ts`: Instancer, I-beams, angles, real corrugated sheets (sine/trapezoid), ladders, railings, containers, jersey barriers, sandbags, crates, pallets, fences, lights, pipes and saddles, rocks.
- `src/world/rust/tower.ts`, `zones.ts`, `backdrop.ts`, `minimap.ts`.
- Changed: `textures.ts` (less tiling on sand, paint wear tuned, new `panel` texture) and `materials.ts` (double-sided containers, sandbag tint, `panel`).

## Layout (north = −Z, bounds ±34)
| Zone | Centre (x, z) |
|---|---|
| Tower | 0, 0.5 |
| Front Gate (OpFor spawn) | 25, −27 |
| Loading Dock (TF141 spawn) | −24, 27 |
| Pipeline | −17, 8 |
| Oil Derrick | −24, −23 |
| Blue Containers | 9, −20 |
| Red Containers | 22, 8 |
| Fuel Depot | 25, −8 |
| Generators | 22, 24 |
| Control Room | 4, 23 |
| Maintenance | −26, −5 |
| Comms Station | −6, −27 |

**Tower:** 8×8 m frame. Floors at 0.15, 3.6 (with a south balcony to z 5.4), 7.2 and a roof at 10.5 under a canopy.

**Big pipe:** 1.2 m diameter. It runs from (−33.5, 13.5) up to the F1 west edge at (−4, 2), and its top sits flush with the deck. A flat collision strip along the top keeps it walkable; I checked the heights match the pipe top all the way along.

**Ladders** (6, all dismounts checked):
- Tower east, ground to F1: (4.1, −1.5)
- Tower west, ground to F1: (−4.1, −2.5)
- Tower balcony, F1 to F2: (1.6, 4.1)
- Tower, F2 to roof: (−1, −3.1)
- Fuel-depot catwalk: (21.7, −8.7), top at 3.23
- Control-room roof: (8.3, 25.25), top at 3.54

**Spawns:** 6 TF141, 6 OpFor and 22 `any`. All 34 start clear of geometry (checked with a capsule test).

## Budget (measured in swiftshader)
- Map meshes: 76 merged, 14 InstancedMesh (1,019 instances), 2 terrain, 3 decal, 1 backdrop. The whole frame took **154 draw calls**.
- Visible triangles: about 144k static, 229k instanced and 89k terrain.
- Collision: about 34k triangles.
- Build time: about 0.8 s for the map plus about 2 s of texture generation on this CPU.

## Known weaknesses
- With no ambient occlusion, crates and props have no contact shadows and can look like they float when the sun is behind them.
- Paint and rust textures still visibly repeat on the large warehouse wall. The pickup truck and generators are blocky, and interiors are plain and dark.
- Shrubs and tumbleweeds are simple. Nothing is destructible.
- Bullets stop at the pipe-walk strip and deck slabs (all marked `metal`).
- Only the setup was cloud-tested, under swiftshader and at medium quality. I did not check performance on real hardware.

## CORE REQUESTS
- `collision.ts` logs a warning: `maxLeafSize` is deprecated, use `targetLeafSize`.
- `src/ui/ui.css` is imported but missing at 02e0051, so Vite fails until it exists (UI agent). I used an empty, git-excluded copy for testing only.
- Render: a screen-space AO or contact-shadow pass would ground the props.

Screenshots are in `docs/agent-reports/map/`.
