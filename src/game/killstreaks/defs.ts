/**
 * MW2 (2009) killstreak roster: kill costs, durations and how each one is called in.
 * Kills earned by killstreaks count towards the next one (MW2 rules — the famous
 * Harrier → Chopper Gunner → Nuke chain), and earned rewards survive death until used.
 */

export type KillstreakId =
  | 'uav'
  | 'carePackage'
  | 'counterUav'
  | 'predator'
  | 'sentry'
  | 'airstrike'
  | 'harrier'
  | 'attackHeli'
  | 'airdrop'
  | 'paveLow'
  | 'stealthBomber'
  | 'chopperGunner'
  | 'ac130'
  | 'emp'
  | 'nuke'

/**
 * How the reward is called in:
 * - instant: active the moment it is used (UAV, Counter-UAV, helicopters, EMP, Nuke)
 * - marker: throw a smoke marker, a helicopter drops crates on it (Care Package, Airdrop)
 * - location: pick a spot (and heading) on the overhead map (Airstrike, Harrier, Stealth Bomber)
 * - place: carry and set down (Sentry Gun)
 * - control: remote-control view (Predator, Chopper Gunner, AC-130)
 */
export type KillstreakKind = 'instant' | 'marker' | 'location' | 'place' | 'control'

export interface KillstreakDef {
  id: KillstreakId
  name: string
  kills: number
  kind: KillstreakKind
  /** Seconds the reward stays active (0 = one-shot). */
  duration: number
  desc: string
  /** Picks a heading on the map picker as well as a spot. */
  directional?: boolean
}

export const KILLSTREAKS: Record<KillstreakId, KillstreakDef> = {
  uav: { id: 'uav', name: 'UAV', kills: 3, kind: 'instant', duration: 30, desc: 'Shows the enemy on the minimap.' },
  carePackage: { id: 'carePackage', name: 'Care Package', kills: 4, kind: 'marker', duration: 0, desc: 'Airdrop a random killstreak or ammo. Throw the marker where you want it.' },
  counterUav: { id: 'counterUav', name: 'Counter-UAV', kills: 4, kind: 'instant', duration: 30, desc: 'Temporarily disables the enemy minimap.' },
  predator: { id: 'predator', name: 'Predator Missile', kills: 5, kind: 'control', duration: 14, desc: 'Remote-controlled missile. Fire to boost.' },
  sentry: { id: 'sentry', name: 'Sentry Gun', kills: 5, kind: 'place', duration: 90, desc: 'Automated gun that covers an area. Place it with fire.' },
  airstrike: { id: 'airstrike', name: 'Precision Airstrike', kills: 6, kind: 'location', duration: 0, desc: 'Three jets carpet a target line from the direction you choose.', directional: true },
  harrier: { id: 'harrier', name: 'Harrier Strike', kills: 7, kind: 'location', duration: 45, desc: 'Airstrike, then a Harrier stays to defend the area.' },
  attackHeli: { id: 'attackHeli', name: 'Attack Helicopter', kills: 7, kind: 'instant', duration: 60, desc: 'Support helicopter that hunts the enemy.' },
  airdrop: { id: 'airdrop', name: 'Emergency Airdrop', kills: 8, kind: 'marker', duration: 0, desc: 'Four care packages dropped on your marker.' },
  paveLow: { id: 'paveLow', name: 'Pave Low', kills: 9, kind: 'instant', duration: 60, desc: 'Heavily armored attack helicopter.' },
  stealthBomber: { id: 'stealthBomber', name: 'Stealth Bomber', kills: 9, kind: 'location', duration: 0, desc: 'Radar-invisible carpet bombing run.', directional: true },
  chopperGunner: { id: 'chopperGunner', name: 'Chopper Gunner', kills: 11, kind: 'control', duration: 40, desc: 'Man the gun of a circling attack helicopter.' },
  ac130: { id: 'ac130', name: 'AC-130', kills: 11, kind: 'control', duration: 40, desc: 'Gunner on an AC-130: 105mm, 40mm and 25mm. 1 / 2 / 3 or Y to switch.' },
  emp: { id: 'emp', name: 'EMP', kills: 15, kind: 'instant', duration: 60, desc: 'Disables enemy electronics and destroys enemy air support.' },
  nuke: { id: 'nuke', name: 'Tactical Nuke', kills: 25, kind: 'instant', duration: 10, desc: 'Ends the game. Everyone dies.' },
}

/** Roster in kill-cost order (Create-a-Class list). */
export const KILLSTREAK_IDS: KillstreakId[] = (Object.keys(KILLSTREAKS) as KillstreakId[]).sort(
  (a, b) => KILLSTREAKS[a].kills - KILLSTREAKS[b].kills,
)

export const DEFAULT_KILLSTREAKS: KillstreakId[] = ['uav', 'carePackage', 'predator']

/** Three unique, valid rewards in kill order (fills gaps from the defaults; repairs old saves). */
export function normalizeKillstreaks(list: readonly string[] | undefined): KillstreakId[] {
  const out: KillstreakId[] = []
  for (const id of list ?? []) {
    if (id in KILLSTREAKS && !out.includes(id as KillstreakId)) out.push(id as KillstreakId)
    if (out.length === 3) break
  }
  for (const id of [...DEFAULT_KILLSTREAKS, ...KILLSTREAK_IDS]) {
    if (out.length === 3) break
    if (!out.includes(id)) out.push(id)
  }
  return out.sort((a, b) => KILLSTREAKS[a].kills - KILLSTREAKS[b].kills)
}

/** Lobby-style sets bots pick from; better bots run the high-tier ones. */
const BOT_SETS: KillstreakId[][] = [
  ['uav', 'carePackage', 'predator'],
  ['uav', 'counterUav', 'sentry'],
  ['uav', 'carePackage', 'airstrike'],
  ['uav', 'predator', 'harrier'],
  ['carePackage', 'sentry', 'attackHeli'],
  ['uav', 'airstrike', 'paveLow'],
  ['counterUav', 'harrier', 'stealthBomber'],
]
const ELITE_SETS: KillstreakId[][] = [
  ['predator', 'harrier', 'chopperGunner'],
  ['uav', 'airstrike', 'ac130'],
  ['harrier', 'chopperGunner', 'nuke'],
  ['attackHeli', 'paveLow', 'emp'],
]

export function botKillstreaks(seed: number, skill: number): KillstreakId[] {
  const h = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1
  const elite = h < 0.12 + skill * 0.25
  const pool = elite ? ELITE_SETS : BOT_SETS
  return normalizeKillstreaks(pool[Math.floor(((h * 97) % 1) * pool.length)]!)
}

/** Weighted MW2 care-package roll (null = ammo resupply). */
const CRATE_TABLE: [KillstreakId | null, number][] = [
  [null, 14],
  ['uav', 21],
  ['counterUav', 17],
  ['sentry', 14],
  ['predator', 14],
  ['airstrike', 10],
  ['harrier', 6],
  ['attackHeli', 7],
  ['stealthBomber', 3],
  ['paveLow', 2],
  ['chopperGunner', 2],
  ['ac130', 2],
  ['emp', 1],
]

export function rollCrate(r = Math.random()): KillstreakId | null {
  const total = CRATE_TABLE.reduce((s, [, w]) => s + w, 0)
  let x = r * total
  for (const [id, w] of CRATE_TABLE) if ((x -= w) <= 0) return id
  return null
}

// ─── Icons (64×64 silhouettes, currentColor) ────────────────────────────────

const ART: Record<KillstreakId, string> = {
  uav: '<path d="M6 34 L28 28 L26 14 H32 L42 27 L58 25 Q62 25 62 30 Q62 35 58 35 L42 33 L32 46 H26 L28 32 L8 40 Z"/><path d="M14 56 A26 26 0 0 1 50 56" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>',
  carePackage: '<path d="M10 24 L32 14 L54 24 V46 L32 56 L10 46 Z" opacity=".9"/><path d="M10 24 L32 34 L54 24 M32 34 V56" stroke="#000" stroke-opacity=".5" stroke-width="3" fill="none"/><path d="M20 8 L32 4 L44 8" stroke="currentColor" stroke-width="2" fill="none"/>',
  counterUav: '<path d="M6 34 L28 28 L26 14 H32 L42 27 L58 25 Q62 25 62 30 Q62 35 58 35 L42 33 L32 46 H26 L28 32 L8 40 Z" opacity=".55"/><path d="M8 8 L56 56 M56 8 L8 56" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>',
  predator: '<path d="M30 4 H34 L36 14 V46 L44 54 V58 H36 V54 L34 52 H30 L28 54 V58 H20 V54 L28 46 V14 Z"/><path d="M32 52 L28 62 H36 Z" opacity=".6"/>',
  sentry: '<path d="M18 58 L28 40 H36 L46 58 H40 L32 46 L24 58 Z"/><rect x="20" y="26" width="24" height="14" rx="3"/><rect x="40" y="30" width="20" height="5"/><rect x="26" y="20" width="10" height="6"/>',
  airstrike: '<path d="M32 4 L38 22 L58 32 V37 L38 33 L35 48 L41 54 V57 H23 V54 L29 48 L26 33 L6 37 V32 L26 22 Z"/>',
  harrier: '<path d="M32 4 L36 18 L52 26 V31 L36 29 L35 44 L44 52 V55 H20 V52 L29 44 L28 29 L12 31 V26 L28 18 Z"/><circle cx="20" cy="36" r="5" opacity=".6"/><circle cx="44" cy="36" r="5" opacity=".6"/>',
  attackHeli: '<path d="M4 18 H60 V21 H4 Z"/><path d="M14 30 Q14 24 24 24 H38 Q48 24 50 32 L58 30 V36 L50 38 Q46 44 34 44 H22 Q14 44 14 38 Z"/><path d="M22 44 L18 52 H44 L40 44" stroke="currentColor" stroke-width="3" fill="none"/>',
  airdrop: '<path d="M6 30 L18 24 L30 30 V44 L18 50 L6 44 Z"/><path d="M34 30 L46 24 L58 30 V44 L46 50 L34 44 Z"/><path d="M20 12 L32 6 L44 12 V24 L32 30 L20 24 Z" opacity=".8"/>',
  paveLow: '<path d="M2 16 H62 V19 H2 Z"/><path d="M8 28 Q8 22 18 22 H44 Q52 22 54 30 L62 28 V34 L54 36 Q50 44 36 44 H16 Q8 44 8 38 Z"/><rect x="18" y="44" width="4" height="8"/><rect x="40" y="44" width="4" height="8"/>',
  stealthBomber: '<path d="M32 18 L62 40 L54 44 L46 40 L40 44 L32 40 L24 44 L18 40 L10 44 L2 40 Z"/>',
  chopperGunner: '<path d="M4 18 H60 V21 H4 Z"/><path d="M14 30 Q14 24 24 24 H38 Q48 24 50 32 L58 30 V36 L50 38 Q46 44 34 44 H22 Q14 44 14 38 Z" opacity=".55"/><circle cx="32" cy="46" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 32 V40 M32 52 V60 M18 46 H26 M38 46 H46" stroke="currentColor" stroke-width="3"/>',
  ac130: '<path d="M32 6 L35 22 L60 26 V31 L35 31 L34 50 L44 55 V58 H20 V55 L30 50 L29 31 L4 31 V26 L29 22 Z"/><rect x="12" y="24" width="4" height="9"/><rect x="48" y="24" width="4" height="9"/><rect x="20" y="24" width="4" height="9"/><rect x="40" y="24" width="4" height="9"/>',
  emp: '<path d="M36 4 L16 36 H30 L26 60 L48 26 H34 Z"/>',
  nuke: '<circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="32" cy="32" r="5"/><path d="M32 32 L18 8 A28 28 0 0 1 46 8 Z M32 32 L58 44 A28 28 0 0 1 44 57 Z M32 32 L20 57 A28 28 0 0 1 6 44 Z"/>',
}

export function killstreakSvg(id: KillstreakId, cls = ''): string {
  return `<svg class="ksicon ${cls}" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">${ART[id]}</svg>`
}
