import type { PerkId, WeaponDef, WeaponId } from '../core/types'
import { WEAPONS } from '../weapons/defs'
import { clamp } from './dom'

export interface PerkInfo {
  id: PerkId
  name: string
  tier: 1 | 2 | 3
  desc: string
}

export const PERKS: Record<PerkId, PerkInfo> = {
  marathon: { id: 'marathon', name: 'Marathon', tier: 1, desc: 'Sprint indefinitely without tiring.' },
  sleightOfHand: { id: 'sleightOfHand', name: 'Sleight of Hand', tier: 1, desc: 'Reload weapons much faster.' },
  stoppingPower: { id: 'stoppingPower', name: 'Stopping Power', tier: 2, desc: 'Bullets deal extra damage.' },
  lightweight: { id: 'lightweight', name: 'Lightweight', tier: 2, desc: 'Move faster with your weapons equipped.' },
  commando: { id: 'commando', name: 'Commando', tier: 3, desc: 'Greater knife range and lunge distance.' },
  steadyAim: { id: 'steadyAim', name: 'Steady Aim', tier: 3, desc: 'Improved hip-fire accuracy.' },
}

export const PERK_TIERS: PerkId[][] = [
  ['marathon', 'sleightOfHand'],
  ['stoppingPower', 'lightweight'],
  ['commando', 'steadyAim'],
]

export const WEAPON_BLURB: Partial<Record<WeaponId, string>> = {
  acr: 'Adaptive Combat Rifle. A precise, hard-hitting assault rifle with controllable recoil.',
  m4a1: 'Standard-issue carbine. Highest rate of fire in its class with very low recoil.',
  ak47: 'Soviet-designed workhorse. Brutal stopping power, heavy kick and punishing at range.',
  ump45: 'Compact submachine gun with a lightning aim time. Deadly in close quarters.',
  intervention: 'High-calibre bolt-action sniper rifle. One shot to the upper body is a kill.',
  spas12: 'Semi-automatic combat shotgun. Devastating inside ten metres.',
  usp45: 'Reliable semi-automatic sidearm. Fast to draw, accurate and forgiving.',
  deagle: 'Hand cannon. Enormous damage per shot, at the cost of a violent recoil.',
}

export const CLASS_LABEL: Record<string, string> = {
  assault: 'ASSAULT RIFLE',
  smg: 'SUBMACHINE GUN',
  sniper: 'SNIPER RIFLE',
  shotgun: 'SHOTGUN',
  pistol: 'HANDGUN',
  grenade: 'EQUIPMENT',
  melee: 'MELEE',
}

export interface WeaponStats {
  accuracy: number
  damage: number
  range: number
  fireRate: number
  mobility: number
}

/** 0..100 bar values derived purely from the WeaponDef. */
export function weaponStats(def: WeaponDef): WeaponStats {
  const multi = def.pellets > 1
  const damage = Math.min(100, def.damageClose * (multi ? def.pellets * 0.45 : 1))
  const accuracy = multi
    ? 100 - def.hipSpreadMax * 9
    : 100 - def.hipSpread * 2.5 - def.adsSpread * 25 - (def.auto ? def.recoilV * 10 : def.recoilV * 2)
  return {
    accuracy: clamp(accuracy, 6, 100),
    damage: clamp(damage, 6, 100),
    range: clamp(def.rangeFar * 1.6, 6, 100),
    fireRate: clamp(def.rpm / 9, 6, 100),
    mobility: clamp(((def.mobility - 0.8) / 0.35) * 100, 6, 100),
  }
}

export function weaponName(id: WeaponId): string {
  return WEAPONS[id]?.name ?? id
}

// ─── Ranks & persistent XP ──────────────────────────────────────────────────

export const RANK_NAMES = [
  'Private',
  'Private First Class',
  'Lance Corporal',
  'Corporal',
  'Sergeant',
  'Staff Sergeant',
  'Gunnery Sergeant',
  'Master Sergeant',
  'Second Lieutenant',
  'Captain',
  'Major',
  'Colonel',
]

const XP_KEY = 'mw-rust-xp'

/** Cumulative XP needed to reach `level` (0-based). */
export function xpForLevel(level: number): number {
  return level <= 0 ? 0 : 2500 * level + 1250 * level * (level - 1)
}

export function loadXp(): number {
  try {
    return Math.max(0, Number(localStorage.getItem(XP_KEY)) || 0)
  } catch {
    return 0
  }
}

export function saveXp(xp: number) {
  try {
    localStorage.setItem(XP_KEY, String(Math.floor(xp)))
  } catch {
    /* storage unavailable */
  }
}

export function levelForXp(xp: number): number {
  let l = 0
  while (l < RANK_NAMES.length - 1 && xp >= xpForLevel(l + 1)) l++
  return l
}

export function rankName(level: number): string {
  return RANK_NAMES[clamp(level, 0, RANK_NAMES.length - 1)] ?? 'Private'
}

export const KEYBINDS: { section: string; rows: [string, string][] }[] = [
  {
    section: 'MOVEMENT',
    rows: [
      ['W A S D', 'Move'],
      ['SHIFT', 'Sprint'],
      ['C', 'Crouch'],
      ['CTRL / Z', 'Prone'],
      ['SPACE', 'Jump / Mantle'],
      ['MOUSE', 'Look'],
    ],
  },
  {
    section: 'COMBAT',
    rows: [
      ['LEFT MOUSE', 'Fire weapon'],
      ['RIGHT MOUSE', 'Aim down sights'],
      ['R', 'Reload'],
      ['Y / WHEEL', 'Switch weapon'],
      ['1 / 2', 'Primary / Secondary'],
      ['G', 'Throw frag grenade (hold to cook)'],
      ['V / E', 'Knife'],
    ],
  },
  {
    section: 'MISC',
    rows: [
      ['4', 'Call in killstreak'],
      ['TAB', 'Scoreboard'],
      ['ESC', 'Pause menu'],
    ],
  },
]
