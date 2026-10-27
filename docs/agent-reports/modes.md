# MODES agent report

## Rules (`src/game/mode.ts` facade + `src/game/modes/{rules,tdm,ffa,dom,sd}.ts`)
- **TDM**: unchanged; uses `game.match` limits.
- **FFA**: first to `scoreLimit` kills or the most at time-out; spawns avoid all enemies.
- **DOM**:
  - Flags: `map.domFlags`, or a callout fallback.
  - Capture takes 10 s (faster with more cappers); contested when both teams are present.
  - Enemy flags go neutral first (5 s). Progress decays when the flag is empty.
  - 1 point per owned flag every 5 s; kill and capture bonuses.
  - Spawns favour owned flags.
- **S&D**:
  - Rounds with no respawns; sides swap every `scoreLimit-1` rounds.
  - The bomb starts at `bombSpawn` (or an attack-side spawn) and drops on death.
  - Plant 5 s, fuse 45 s, defuse 7.5 s; the blast kills within 10 m.
  - A round ends on wipe, detonation, defuse or time-out. Each new round has a 3 s `intro`.
- `isEnemy` is used in all combat, spawn and UAV checks.

## APIs and contract additions
- `GameMode` additions:
  - `winnerActor`, `placings`, `canRespawn` and `bombSites`.
  - `isUavActiveFor(actor)` and `uavReveals(viewer, target)`.
  - `wantsPlant`, `canDefuse`, `beginPlant`, `beginDefuse`, `cancel`, `use` and `spectateTarget(actor, i)`.
  - `endMatch` and `addPoints`.
  - `getNetState()`/`applyNetState()` (plain JSON).
- A plant or defuse needs the actor to stay still, and the player to hold F. The mode polls F, so `player.ts` is untouched.
- FFA: `score` holds the player's kills against the best opponent's.
- Types:
  - `SpawnPoint.modes?`.
  - `ObjectiveState.progressTeam`.
  - `BombState.carrierId`, `plantingId` and `defusingId`.
  - `InputState.useHeld?`.
- `startMatch` uses `bots.createForMatch` if it exists; otherwise it trims `createTeams` (at most 5v6).

## Verification
- `bunx tsc --noEmit` is clean.
- Headless full bot matches:
  - TDM: opfor won 15–11.
  - FFA: the bot with 6 kills won.
  - DOM: flags changed hands and opfor won 51–0.
  - S&D: 6 rounds with a side swap; opfor won 4–2.
- Scripted checks passed for DOM capture, neutralise and contest, and for every S&D round outcome.

## REQUESTS
- **AI**:
  - Add `createForMatch`.
  - Use `isEnemy` for targeting and hearing, and `isUavActiveFor(bot)` for UAV.
  - DOM: play `mode.objectives`.
  - S&D: get the bomb, go to `bombSites`, then stand still and call `beginPlant`/`beginDefuse`.
- **MAP**: in S&D, `tf141` spawns are the attack side and `opfor` the defend side. Use `SpawnPoint.modes` for mode-only spawns.
- **UI**:
  - Pass the lobby settings to `startMatch`.
  - Use `placings` on the FFA end screen.
  - S&D: progress bars, fuse, a "Press F" prompt and spectating.
  - Use `uavReveals` on the minimap.
- **NET**: use `getNetState`/`applyNetState`.
