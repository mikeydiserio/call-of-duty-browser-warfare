import type { WeaponDef, WeaponId } from '../core/types'

/**
 * Weapon stats modelled on MW2 (2009) multiplayer values: 100 HP, ARs 3-4
 * shots to kill, snipers one-shot to the upper body, shotguns one-shot close.
 */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  acr: {
    id: 'acr', name: 'ACR', class: 'assault', slot: 'primary', auto: true,
    rpm: 750, magSize: 30, reserve: 120, reloadTime: 2.2, reloadEmptyTime: 2.75,
    damageClose: 40, damageFar: 30, rangeClose: 22, rangeFar: 45, headMultiplier: 1.4, pellets: 1,
    hipSpread: 3.0, hipSpreadMax: 7.0, adsSpread: 0.08, recoilV: 0.55, recoilH: 0.22,
    adsTime: 0.22, adsZoom: 0.8, mobility: 0.95, penetration: 0.6,
  },
  m4a1: {
    id: 'm4a1', name: 'M4A1', class: 'assault', slot: 'primary', auto: true,
    rpm: 800, magSize: 30, reserve: 120, reloadTime: 2.1, reloadEmptyTime: 2.6,
    damageClose: 30, damageFar: 20, rangeClose: 22, rangeFar: 45, headMultiplier: 1.4, pellets: 1,
    hipSpread: 2.8, hipSpreadMax: 6.5, adsSpread: 0.06, recoilV: 0.42, recoilH: 0.18,
    adsTime: 0.2, adsZoom: 0.8, mobility: 1.0, penetration: 0.6,
  },
  ak47: {
    id: 'ak47', name: 'AK-47', class: 'assault', slot: 'primary', auto: true,
    rpm: 600, magSize: 30, reserve: 120, reloadTime: 2.4, reloadEmptyTime: 3.0,
    damageClose: 40, damageFar: 30, rangeClose: 22, rangeFar: 45, headMultiplier: 1.4, pellets: 1,
    hipSpread: 3.2, hipSpreadMax: 7.5, adsSpread: 0.1, recoilV: 0.75, recoilH: 0.32,
    adsTime: 0.24, adsZoom: 0.8, mobility: 0.95, penetration: 0.75,
  },
  ump45: {
    id: 'ump45', name: 'UMP45', class: 'smg', slot: 'primary', auto: true,
    rpm: 666, magSize: 32, reserve: 128, reloadTime: 2.0, reloadEmptyTime: 2.5,
    damageClose: 40, damageFar: 35, rangeClose: 10, rangeFar: 32, headMultiplier: 1.1, pellets: 1,
    hipSpread: 2.0, hipSpreadMax: 4.5, adsSpread: 0.22, recoilV: 0.38, recoilH: 0.2,
    adsTime: 0.16, adsZoom: 0.85, mobility: 1.08, penetration: 0.35,
  },
  intervention: {
    id: 'intervention', name: 'Intervention', class: 'sniper', slot: 'primary', auto: false,
    rpm: 45, magSize: 5, reserve: 25, reloadTime: 3.2, reloadEmptyTime: 3.6,
    damageClose: 98, damageFar: 98, rangeClose: 200, rangeFar: 300, headMultiplier: 1.5, pellets: 1,
    hipSpread: 9.0, hipSpreadMax: 14.0, adsSpread: 0.0, recoilV: 3.5, recoilH: 0.8,
    adsTime: 0.38, adsZoom: 0.24, mobility: 0.9, penetration: 1.0,
  },
  spas12: {
    id: 'spas12', name: 'SPAS-12', class: 'shotgun', slot: 'secondary', auto: false,
    rpm: 80, magSize: 8, reserve: 32, reloadTime: 3.0, reloadEmptyTime: 3.6,
    damageClose: 30, damageFar: 8, rangeClose: 6, rangeFar: 20, headMultiplier: 1.0, pellets: 8,
    hipSpread: 5.5, hipSpreadMax: 6.5, adsSpread: 4.5, recoilV: 2.6, recoilH: 0.9,
    adsTime: 0.24, adsZoom: 0.9, mobility: 1.0, penetration: 0.2,
  },
  usp45: {
    id: 'usp45', name: 'USP .45', class: 'pistol', slot: 'secondary', auto: false,
    rpm: 600, magSize: 12, reserve: 48, reloadTime: 1.6, reloadEmptyTime: 1.9,
    damageClose: 40, damageFar: 30, rangeClose: 12, rangeFar: 30, headMultiplier: 1.4, pellets: 1,
    hipSpread: 2.2, hipSpreadMax: 4.5, adsSpread: 0.35, recoilV: 1.1, recoilH: 0.3,
    adsTime: 0.14, adsZoom: 0.9, mobility: 1.1, penetration: 0.3,
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', class: 'pistol', slot: 'secondary', auto: false,
    rpm: 260, magSize: 7, reserve: 28, reloadTime: 1.8, reloadEmptyTime: 2.1,
    damageClose: 55, damageFar: 40, rangeClose: 12, rangeFar: 30, headMultiplier: 1.4, pellets: 1,
    hipSpread: 2.6, hipSpreadMax: 5.5, adsSpread: 0.4, recoilV: 2.4, recoilH: 0.6,
    adsTime: 0.16, adsZoom: 0.9, mobility: 1.1, penetration: 0.45,
  },
  frag: {
    id: 'frag', name: 'Frag', class: 'grenade', slot: 'equipment', auto: false,
    rpm: 60, magSize: 1, reserve: 0, reloadTime: 0, reloadEmptyTime: 0,
    damageClose: 130, damageFar: 20, rangeClose: 2.5, rangeFar: 7, headMultiplier: 1, pellets: 0,
    hipSpread: 0, hipSpreadMax: 0, adsSpread: 0, recoilV: 0, recoilH: 0,
    adsTime: 0, adsZoom: 1, mobility: 1, penetration: 0,
  },
  knife: {
    id: 'knife', name: 'Knife', class: 'melee', slot: 'melee', auto: false,
    rpm: 70, magSize: 0, reserve: 0, reloadTime: 0, reloadEmptyTime: 0,
    damageClose: 200, damageFar: 200, rangeClose: 1.9, rangeFar: 1.9, headMultiplier: 1, pellets: 0,
    hipSpread: 0, hipSpreadMax: 0, adsSpread: 0, recoilV: 0, recoilH: 0,
    adsTime: 0, adsZoom: 1, mobility: 1, penetration: 0,
  },
}

export const PRIMARIES: WeaponId[] = ['acr', 'm4a1', 'ak47', 'ump45', 'intervention']
export const SECONDARIES: WeaponId[] = ['usp45', 'deagle', 'spas12']

/** Damage for a single bullet/pellet at distance (before hit-zone multiplier). */
export function damageAt(def: WeaponDef, distance: number): number {
  if (distance <= def.rangeClose) return def.damageClose
  if (distance >= def.rangeFar) return def.damageFar
  const t = (distance - def.rangeClose) / (def.rangeFar - def.rangeClose)
  return def.damageClose + (def.damageFar - def.damageClose) * t
}

export const ZONE_MULTIPLIER = { head: 1, torso: 1, arms: 1, legs: 0.9 } as const
