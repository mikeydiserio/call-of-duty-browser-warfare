import type { Team } from '../core/types'

/**
 * MW2-lobby style gamertags (2009 Xbox Live / PSN flavour): clan tags,
 * xX wrappers, leetspeak, trailing numbers. Fictional / generic words only.
 */
const TF141_TAGS = ['[TF1]', '[141]', '[FTW]', '[iL]', '[RnG]', '[SAS]', '[GhSt]', '[DLTA]']
const OPFOR_TAGS = ['[FTW]', '[MLG]', '[xX]', '[404]', '[PWN]', '[RD]', '[JKR]', '[NoOB]', '[r4ge]']

const WORDS = [
  'Sniper', 'Deadeye', 'NoobSlayer', 'Hitman', 'QuickScope', 'DesertFox', 'Vandal', 'MadDog', 'Reaper',
  'Rusty', 'GhostRider', 'WolfPack', 'Sandstorm', 'Viper', 'BlackMamba', 'IceMan', 'Trigger', 'Havoc',
  'Crimson', 'Frag', 'Dusty', 'Toxic', 'Specter', 'OneShot', 'Maverick', 'Hawkeye', 'Ironside',
  'Banshee', 'Kraken', 'Jackal', 'Nomad', 'Outlaw', 'Cobra', 'Razor', 'ShadowStrike', 'ProHax', 'Tango',
  'Bravo6', 'NightOwl', 'Zero', 'Scorpion', 'Grizzly', 'Wraith', 'Bullseye', 'Thunder', 'Lethal',
  'FlashBang', 'C4Kid', 'HeadHunter', 'Pyro', 'Tank', 'Rogue', 'Knifey', 'Camper', 'Noscope', 'Juggz',
  'Danger', 'Killjoy', 'Smokey', 'Turbo', 'Diesel', 'Ninja', 'Panda', 'Waffles', 'Tater', 'Spartan',
]
const PREFIX = ['', '', '', 'Its', 'Lil', 'Mr', 'Sgt', 'Pvt', 'Big', 'Dark', 'Epic', 'Sir']
const SUFFIX = ['', '', '', 'Pro', 'King', 'Kid', 'God', 'Ninja', 'Man', 'x', 'TTV', 'HD', 'Gaming']

const LEET: Record<string, string> = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' }

function leet(w: string, p: number): string {
  let out = ''
  for (const c of w) out += LEET[c.toLowerCase()] && Math.random() < p ? LEET[c.toLowerCase()]! : c
  return out
}

const pickOf = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!

function gamertag(tags: string[]): string {
  let core = pickOf(PREFIX) + pickOf(WORDS) + pickOf(SUFFIX)
  const r = Math.random()
  if (r < 0.28) core = leet(core, 0.5)
  if (Math.random() < 0.18) core = `xX${core}Xx`
  else if (Math.random() < 0.12) core = `x_${core}_x`
  else if (Math.random() < 0.15) core = core.toLowerCase().replace(/(\w)(\w+)/, '$1_$2')
  if (Math.random() < 0.38) core += pickOf(['', '1', '7', '23', '69', '88', '99', '420', '360', '2009', '13', '187'])
  if (core.length > 15) core = core.slice(0, 15)
  const tag = Math.random() < 0.45 ? pickOf(tags) : ''
  return tag ? `${tag}${core}` : core
}

export function generateNames(team: Team, count: number, used: Set<string>): string[] {
  const out: string[] = []
  const tags = team === 'tf141' ? TF141_TAGS : OPFOR_TAGS
  // Clans: lobbies often have 2-3 people from the same clan.
  const clan = pickOf(tags)
  let guard = 0
  while (out.length < count && guard++ < 500) {
    let name = gamertag(tags)
    if (out.length < 2 && Math.random() < 0.6) name = clan + name.replace(/^\[[^\]]+\]/, '')
    if (used.has(name)) continue
    used.add(name)
    out.push(name)
  }
  while (out.length < count) out.push(`Soldier${used.size + out.length}`)
  return out
}
