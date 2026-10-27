# AI agent report (`src/ai/**`)

## Phase 3: soldier polish and game modes (verified on the real Rust map)

**Soldiers** (`soldier-model.ts`, `camo.ts`, 6×6 atlas)
- **Heads:** a sculpted head (brow ridge, eye sockets, cheekbones, jaw, chin) with eyeballs, nose and ears. A per-pixel painted face covers hair, brows, lids and lips, in clean, stubble and beard variants. Faces stay readable under TF141 helmets; goggles now sit on the brow.
- **OpFor masks:** balaclavas and shemaghs are cloth shells with a clean, cut eye slit. Shemaghs have sculpted folds.
- **OpFor palette:** lighter and varied (olive camo, heather grey, tan shirts, faded denim, urban) with per-tile roughness. They're readable in shade and distinct from TF141's tan multicam.
- **Poses:** no sprinting while looking off the run line (that was the "port arms" look). More spine twist, and the lower body turns in place once the aim is past ~60° off the hips.
- **Corpses:** a body still lying there at respawn is detached into its own clone with the dropped gun. It fades out after 10 s.
- **Remote players:** `createSoldierVisual(game, team, seed)` in `soldier-visual.ts` covers pose-driven animation, hitboxes, ragdoll, corpse fade and the muzzle.

**Modes**
- `game.mode.isEnemy` is used everywhere (perception, hearing, targeting, friendly fire, UAV).
- `createForMatch(match, playerTeam)`: teams are even counting the player (the player's side gets one fewer if odd). FFA mixes both character sets. Every bot uses `botDifficulty`. `createTeams` wraps it.
- **Domination:** bots weigh distance, ownership, contests and threats, spread out across flags, and hold covered nodes inside the radius.
- **S&D:**
  - The carrier plants at the round's chosen site, with escorts following.
  - The nearest attacker picks up a dropped bomb.
  - Defenders spread across sites, rotate toward gunfire, and defuse when clear.
  - Bots play cautiously because there are no respawns.
- **Nav fixes:**
  - Pruned to the strongly connected component around a spawn: A* failures went from 39% to 0.
  - Drop-only ledges are kept as path starts.
  - Nodes bots get stuck on are penalised in A*.
  - Bots wedged in geometry or under the terrain snap back onto the nav.

**Measured** (stepped simulation, real map)
- **Nav:** 4,667 nodes / 30,010 links in 0.6–0.7 s.
- **`bots.update`, 11 bots, TDM:** 0.89–0.96 ms mean, 0.7 ms p50.
- **Mode runs (150–200 s, zero errors):**

  | Mode | Result |
  |---|---|
  | TDM | 93 kills |
  | FFA | 68 kills, spread across all bots |
  | Domination | flags captured C → A → B → B |
  | S&D (4v4, 700 s) | 15 pickups, a plant and a defuse; rounds 6–4 |

- **Screenshots:** `ai/r_*.png` (faces, 9 m and 30 m lines, aiming, running, dead).

**Known issues**
- S&D attackers plant rarely (about once in 10 rounds), because rounds usually end in elimination first.
- Shemagh checks on the neck and tail are coarse.
- A corpse snapshot taken while the ragdoll is still moving freezes mid-fall (rare).

**CORE REQUESTS:** none.
