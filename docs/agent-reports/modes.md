# MODES agent report

## Rules (`src/game/mode.ts` facade + `src/game/modes/{rules,tdm,ffa,dom,sd}.ts`)
- **TDM**: unchanged; limits come from `game.match`.
- **FFA**: first to `scoreLimit` kills or most kills at time-out. Spawns are weighted away from all enemies. The result is in `winnerActor` and `placings`.
- **DOM**:
  - Flags come from `map.domFlags`, with a callout fallback.
  - Capture: 10 s, faster with more cappers; contested when both teams are present.
  - Enemy flags go neutral in 5 s before they can be captured. Progress decays when nobody is on a flag.
  - Scoring: 1 point per owned flag every 5 s. ATTACK/DEFEND +50, CAPTURE +150.
  - Respawns are biased to owned flags.
- **S&D**:
  - Rounds with no respawns; sides swap every `scoreLimit-1` rounds.
  - The bomb starts at `bombSpawn` (fallback: an attack-side spawn). It is picked up by walking over it and dropped on death.
  - Plant 5 s, fuse 45 s, defuse 7.5 s. The blast kills everyone within 10 m.
  - A round ends on wipe, detonation, defuse or time-out (defenders win). Each new round has a 3 s `intro`.
- `isEnemy` is used throughout combat (bullets, knife, explosions, assists, kill credit), spawns and UAV.

## APIs and contract additions
- `GameMode` additions:
  - `winnerActor`, `placings`, `canRespawn` and `bombSites`.
  - `isUavActiveFor(actor)` and `uavReveals(viewer, target)`.
  - `wantsPlant`, `canDefuse`, `beginPlant`, `beginDefuse`, `cancel`, `use` and `spectateTarget(actor, i)`.
  - `endMatch` and `addPoints`.
  - `getNetState()`/`applyNetState()` (plain JSON).
- A plant or defuse continues while the actor stays in place (under 1.5 m/s). The player must also hold F; the mode polls F itself, so `player.ts` is untouched.
- FFA: `score[playerTeam]` is the player's kills and the other key is the best opponent's. `winner` is from the player's point of view.
- Types:
  - `SpawnPoint.modes?`.
  - `ObjectiveState.progressTeam`.
  - `BombState.carrierId`, `plantingId` and `defusingId`.
  - `InputState.useHeld?`.
- `startMatch` uses `bots.createForMatch` if it exists. Otherwise it trims `createTeams` to `botCount` (at most 5 allies and 6 enemies).

## Verification
- `bunx tsc --noEmit` is clean.
- Headless full bot matches:
  - TDM: opfor won 15–11.
  - FFA: the bot with 6 kills won.
  - DOM: flags changed hands and opfor won 51–0.
  - S&D: 6 rounds with a side swap; opfor won 4–2.
- Scripted checks passed for DOM capture, neutralise, contest and the score tick.
- Scripted S&D checks passed for plant, defuse, detonation, drop, spectate, wipe, swap and time-out.

## REQUESTS
- **AI**:
  - Add `createForMatch`.
  - Use `isEnemy` for targeting and hearing, and `isUavActiveFor(bot)` for UAV.
  - DOM: play `mode.objectives`.
  - S&D: fetch `bomb.position` when it has no carrier, go to `mode.bombSites`, then `beginPlant` when `wantsPlant` and `beginDefuse` when `canDefuse`, standing still.
- **MAP**: S&D spawn labels mean sides: `tf141` is the attack side and `opfor` the defend side. Use `SpawnPoint.modes` for spawns used only in some modes.
- **UI**:
  - Pass the lobby settings to `startMatch`.
  - Use `placings` on the FFA end screen.
  - S&D: show the progress bars and fuse, a "Press F" prompt, and `spectateTarget`.
  - Use `uavReveals` on the minimap.
- **NET**: use `getNetState`/`applyNetState`.
