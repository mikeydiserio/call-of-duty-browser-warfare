# MAP agent report — Rust

## Files
- `src/world/rust/`: `map.ts` (entry point: spawns, callouts, environment, menu path, bounds walls), `terrain.ts` (analytic `groundY`, terrain, collision grid, dune ring, decals), `props.ts` (instancer, beams, corrugated sheets, ladders, railings, containers, barriers, sandbags, fences, pipes, rocks), `tower.ts`, `zones.ts`, `backdrop.ts`, `minimap.ts`.
- Changed: `textures.ts` (sand tiling, paint wear, new `panel` texture) and `materials.ts`.

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

**Tower:** 8×8 m frame with floors at 0.15, 3.6 (plus a south balcony), 7.2 and a roof at 10.5.

**Big pipe:** 1.2 m wide, from (−33.5, 13.5) up to the F1 west edge at (−4, 2). Its top meets the deck and is walkable all the way along.

**Ladders** (6, all dismounts checked):
- Tower, ground to F1: east (4.1, −1.5) and west (−4.1, −2.5)
- Tower, F1 to F2: balcony (1.6, 4.1)
- Tower, F2 to roof: (−1, −3.1)
- Fuel-depot catwalk: (21.7, −8.7)
- Control-room roof: (8.3, 25.25)

**Spawns:** 6 TF141, 6 OpFor, 22 `any`. All 34 pass a capsule test.

## Game-mode objectives (`src/world/rust/objectives.ts`)
| Objective | Position (x, y, z) | Radius | Where |
|---|---|---|---|
| Dom A | −14.5, 0.05, 19.5 | 4.5 | TF141 side, south pipeline yard |
| Dom B | 0.4, 0.15, 0.6 | 5 | under the Tower (on the pad) |
| Dom C | 17.5, 0.03, −15.5 | 4.5 | OpFor side, by the Blue Containers |
| Bomb site A | 11.8, 0.06, 24.4 | 3 | open yard between the Control Room and the Generators |
| Bomb site B | −25.2, 0.18, −6.4 | 3 | inside the Maintenance shed |
| Bomb spawn | 25.6, 0.04, −31.0 | | inside the Front Gate |

- **S&D:** OpFor attack first from the Front Gate (`SD_ATTACKERS_FIRST`) and TF141 defend.
- **Props:** `map.root.getObjectByName(...)` finds them.
  - `domflag_A/B/C` is a Group containing `pole`, `knob` and `cloth`. Each `cloth` has its own off-white material; tint it with `cloth.material.color`.
  - `bombsite_A/B` is a Group containing `sign_front`, `sign_back` and `sign_top`.
  - The flag footing and the bomb cabinet are merged static geometry and have collision.
- **Spawns:** no `modes` field was needed. Domination uses the team bases (Loading Dock next to A, Front Gate next to C). FFA has 22 `any` spawns. S&D uses the clustered base spawns.
- **Minimap:** flags are drawn as small letters in circles, bomb sites as letters in squares, with no team colour.
- **Checks:**
  - Ground height matches at every objective centre.
  - 25–33 of 36 sampled points inside each radius are standable; the rest fall inside cover such as pipes, containers and tower columns.
  - The bomb spawn is clear of geometry.

## Budget (swiftshader)
- 76 merged meshes and 14 instanced meshes. The whole frame took **154 draw calls**.
- About 460k visible triangles and 34k collision triangles.
- Build: about 0.8 s, plus 2 s generating textures.

## Known weaknesses
- No ambient occlusion, so props can look like they float.
- Textures repeat visibly on the large warehouse wall.
- Truck, generators and interiors are simple.
- Not tested on real hardware.

## CORE REQUESTS
- `collision.ts`: replace the deprecated `maxLeafSize` with `targetLeafSize`.
- `src/ui/ui.css` is missing at 02e0051, so Vite fails until it exists (UI agent).
- Render: add an AO or contact-shadow pass.
