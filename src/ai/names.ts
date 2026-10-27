import type { Team } from '../core/types'

/** MW2-lobby style gamertags. Fictional / generic only. */
const TF141_TAGS = ['[TF1]', '[141]', '[FTW]', '[iL]', '[RnG]', '[SAS]', '']
const OPFOR_TAGS = ['[FTW]', '[MLG]', '[xX]', '[404]', '[PWN]', '[RD]', '[JKR]', '']

const TAIL = [
  'Sn1p3r', 'xXDeadeyeXx', 'N00bSlayer', 'Hitman88', 'QuickScope', 'DesertFox', 'Vandal', 'MadDog',
  'xx_Reaper_xx', 'Rusty', 'Gh0stRider', 'DaWolfPack', 'Sandstorm', 'Viper', 'BlackMamba', 'IceMan',
  'Tr1gg3r', 'Havoc', 'Crimson', 'xXxFraGxXx', 'Dusty', 'T0xic', 'Specter', 'OneShot', 'Mav3rick',
  'Hawk_eye', 'Ironside', 'Banshee', 'Kr4ken', 'Jackal', 'Nomad', 'Outlaw', 'Cobr4', 'Razor',
  'ShadowStrike', 'ProHax', 'Tango', 'Delta_7', 'Bravo6', 'NightOwl', 'Zer0', 'Scorpion', 'Grizzly',
  'Wraith', 'Bullseye', 'Thunder', 'Lethal', 'FlashBang', 'C4Kid', 'HeadHunter', 'Pyro', 'Tank', 'Rogue',
]

export function generateNames(team: Team, count: number, used: Set<string>): string[] {
  const out: string[] = []
  const tags = team === 'tf141' ? TF141_TAGS : OPFOR_TAGS
  let guard = 0
  while (out.length < count && guard++ < 500) {
    const tail = TAIL[Math.floor(Math.random() * TAIL.length)]!
    const tag = tags[Math.floor(Math.random() * tags.length)]!
    let name = tag ? `${tag} ${tail}` : tail
    if (Math.random() < 0.18) name += Math.floor(Math.random() * 99)
    if (used.has(name)) continue
    used.add(name)
    out.push(name)
  }
  while (out.length < count) out.push(`Player${out.length + 1}`)
  return out
}
