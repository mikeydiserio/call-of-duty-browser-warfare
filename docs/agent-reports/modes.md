# MODES agent report

## Rules implemented (`src/game/mode.ts` facade + `src/game/modes/{rules,tdm,ffa,dom,sd}.ts`)
- **TDM**: unchanged behaviour; limits from `game.match`.
- **FFA**: first to `scoreLimit` kills or most kills at time-out. All spawns used and weighted away from every enemy. `winnerActor` is set (null on a tie), and `placings` gives the final standings, best first.
- **DOM**: flags come from `map.domFlags`, or are synthesised from callouts (Pipeline, Tower, Blue Containers). Capturing a neutral flag takes 10 s, and extra cappers speed it up (×1.5 for two, up to ×2.5). An enemy flag first goes neutral (5 s), then needs a normal capture. The flag is contested when both teams are in the radius. Progress decays when nobody is on the flag. Each owned flag scores 1 point every 5 s. Kills on a flag give ATTACK/DEFEND +50 and a capture gives +150 (via `player:points`). Respawns are biased to owned flags.
- **S&D**: rounds with no respawns. Sides swap every `scoreLimit-1` rounds. The bomb starts at `map.bombSpawn`, falling back to an attack-side spawn; it is picked up by walking over it and dropped on death. Plant takes 5 s, the fuse is 45 s and defuse takes 7.5 s. The blast kills everyone within 10 m. A round ends on wipe-out, detonation, defuse or time-out (defenders win). There is a 5 s round-end pause, then a 3 s `intro` before the next round.
- `isEnemy` is now used throughout combat: bullets, knife, explosions (no team damage), assists, kill credit and whizz. It is also used for spawn safety and UAV.

## APIs and contract additions
- `GameMode` additions:
  - `winnerActor`, `placings`, `placingIds`, `canRespawn` and `bombSites`.
  - `isUavActiveFor(actor)` and `uavReveals(viewer, target)`.
  - `wantsPlant`, `canDefuse`, `beginPlant`, `beginDefuse`, `cancel(actor)`, `use(actor)` and `spectateTarget(actor, index)`.
  - `endMatch`, `addPoints`, and `getNetState()`/`applyNetState()` (plain JSON).
- Plant and defuse continue only while the actor stays inside the site or by the bomb, keeps under 1.5 m/s and, for the player, keeps holding F. The mode polls F itself, so `player.ts` is untouched.
- FFA: `score[playerTeam]` holds the player's kills and the other key holds the best opponent's. `winner` is from the player's point of view.
- Types:
  - `SpawnPoint.modes?` restricts a spawn to the listed modes.
  - `ObjectiveState.progressTeam`.
  - `BombState.carrierId`, `plantingId` and `defusingId`.
  - `InputState.useHeld?` (set by `Input`).
- `startMatch` creates bots through `bots.createForMatch(match, playerTeam)` when it exists. Otherwise it trims `createTeams` to `botCount` (at most 5 allies and 6 enemies). It also applies `botDifficulty`.

## Verification
- `bunx tsc --noEmit` is clean.
- Full headless bot matches, stepped at dt = 1/60:
  - TDM 15-kill: opfor won 15–11.
  - FFA 6-kill, 7 bots: the bot with 6 kills won; `winnerActor` and the top 3 were correct.
  - DOM 50 points: flags changed hands and opfor won 51–0.
  - S&D: six rounds with side swap after round 3, wipes and time-outs; opfor won 4–2.
- Scripted checks:
  - DOM capture, neutralise, contest and the score tick all behave as described above.
  - S&D: pickup, plant, defuse (defenders win), detonation (kills a defender, attackers win), carrier death and drop, spectate, wipe, side swap and time-out all behave correctly.

## REQUESTS
- **AI**:
  - Add `createForMatch(match, playerTeam)`.
  - Use `mode.isEnemy` for targeting and hearing.
  - Use `isUavActiveFor(bot)` instead of `isUavActive(b.team)`.
  - Objective play:
    - DOM: `mode.objectives`.
    - S&D bomb: walk to `mode.bomb.position` when `carrier == null` (attackers).
    - Site: `mode.bombSites`.
    - Plant: when `wantsPlant(bot)`, stop and call `beginPlant`.
    - Defuse: when `canDefuse(bot)`, call `beginDefuse`.
- **MAP**: in S&D, spawn `team` labels mean sides: `tf141` is the attack side (near `bombSpawn`) and `opfor` is the defend side (near `bombSites`). Use `SpawnPoint.modes` for spawns that belong to only some modes.
- **UI**:
  - Pass the lobby settings to `startMatch`.
  - FFA end screen: `mode.placings`/`winnerActor`.
  - S&D:
    - Read `bomb.plantProgress`/`defuseProgress`/`fuseLeft` and `round`.
    - Show a "Press F" prompt when `wantsPlant(player)`/`canDefuse(player)`.
    - Use `spectateTarget` while dead.
    - Each round re-enters the `intro` phase for 3 s.
  - Minimap: use `uavReveals`.
- **NET**: `mode.getNetState()` / `applyNetState()`.
