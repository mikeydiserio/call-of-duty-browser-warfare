# Integration report

All seven area branches (`agents/{map,render,player,weapons,ai,ui,audio}`, each revived in a cloud session from `02e0051`) are merged into `claude/eager-cray-7dfs3t`. They had no conflicts because every agent stayed inside its own directory. `bunx tsc --noEmit` and `bun run build` are both clean.

## Core requests applied
| Request | From | Change |
|---|---|---|
| Allocation-free raycast | player, render, AI | `CollisionWorld.raycastInto(origin, dir, max, out)`. `raycast` wraps it, and `lineOfSight`, `groundHeight` and `surfaceBelow` now allocate nothing. |
| Deprecated BVH option | render, map | `maxLeafSize` → `targetLeafSize` |
| Tracers from the muzzle | AI | `fireBullet(..., tracer, tracerFrom?)`. Bots now pass their muzzle. |
| Hit point for tracers | weapons | `fireBullet` returns `point`. The weapon system uses it instead of approximating. |
| Missing `ui.css`, convolver sample-rate crash | audio, player, weapons, map | Already fixed on the UI and audio branches. Verified: the game boots and the audio context runs. |
| Menus stayed up when a match started without the PLAY button | found in integration | The UI now clears its menu stack on `match:phase` intro. |

Not done:
- `respawnIn` returning 0: it only returns 0 when no timer is running, which was a stub-only artefact. Not re-verified in the live death flow.
- Spawn de-stacking: the map now has 6 base spawns per team.
- An `occluded` flag on fire and footstep events: optional.
- An AO or contact-shadow pass: render follow-up.

## Verification (headless Chromium, swiftshader)
- **Simulated match:** 180 s at 60 Hz with the sim stepped directly, because software GL takes about 2.5 s per rendered frame. Result: 61 kills, score 36–24, and every bot scored. No runtime errors. The only page errors were the expected pointer-lock rejections from scripted starts.
- **Per-frame JS cost:** bots 0.8 ms, player 0.75, UI 0.3, FX 0.02, audio 0.05, and render submit 8.3 (CPU side only). Real-GPU FPS not measured.
- **Screenshots** are in `integration/`.
  - Menu → loading → HUD flow works.
  - The minimap shows the UAV sweep.
  - The killfeed shows weapon icons, and the score bars and bullet-row ammo display.
  - The FX are visible: explosion with debris and smoke.

## Harsh critique (what still falls short of MW2)
1. **Soldiers are the weakest asset.** Heads are featureless with no face detail, and OpFor reads as near-black blobs in shade. In MW2 the silhouettes are readable at 30 m. They need face/balaclava texturing and a lighter OpFor palette.
2. **Bot carry and aim poses sometimes look stiff.** At times the rifle is at port arms or pointing perpendicular to the torso while the bot tracks off-screen targets, because the spine twist is too limited.
3. **The explosion core blows out to flat white.** It needs a darker fireball core and less bloom.
4. **Pipe paint wear tiles visibly** (leopard spots). There's no AO, so props look floaty, as the map agent noted.
5. **Nothing was tested on a real GPU, and nothing has been heard.** Audio was verified only structurally.
