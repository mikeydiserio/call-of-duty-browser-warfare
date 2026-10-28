import { DEFAULT_KILLSTREAKS, normalizeKillstreaks } from '../game/killstreaks/defs'
import { PERK_TIERS } from '../ui/data'
import { attachmentsFor, PRIMARIES, SECONDARIES } from '../weapons/defs'
import type { CustomClass, Loadout } from './types'

export const CLASS_COUNT = 5
export const CLASS_NAME_MAX = 20

const CLASSES_KEY = 'mw-rust-classes'
/** Pre-multi-class save: a single loadout. Migrated into custom class 1. */
const LEGACY_LOADOUT_KEY = 'mw-rust-loadout'

/** Five starting classes so each slot plays differently out of the box (MW2 defaults-ish). */
const DEFAULT_LOADOUTS: Loadout[] = [
  { primary: 'acr', secondary: 'usp45', perks: ['sleightOfHand', 'stoppingPower', 'commando'], killstreaks: DEFAULT_KILLSTREAKS },
  { primary: 'm4a1', secondary: 'deagle', perks: ['marathon', 'lightweight', 'commando'], killstreaks: DEFAULT_KILLSTREAKS },
  { primary: 'ump45', secondary: 'usp45', perks: ['marathon', 'lightweight', 'commando'], killstreaks: DEFAULT_KILLSTREAKS },
  { primary: 'intervention', secondary: 'deagle', perks: ['sleightOfHand', 'stoppingPower', 'steadyAim'], killstreaks: DEFAULT_KILLSTREAKS },
  { primary: 'ak47', secondary: 'spas12', perks: ['sleightOfHand', 'stoppingPower', 'steadyAim'], killstreaks: DEFAULT_KILLSTREAKS },
]

export function defaultClassName(i: number): string {
  return `CUSTOM CLASS ${i + 1}`
}

/** Trim/collapse whitespace and clamp length; empty means "use the default name". */
export function normalizeClassName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, CLASS_NAME_MAX)
}

export interface ClassStore {
  active: number
  classes: CustomClass[]
}

export function loadClasses(): ClassStore {
  const stored = readJSON(CLASSES_KEY)
  const list = isRecord(stored) ? stored.classes : undefined
  if (isRecord(stored) && Array.isArray(list)) {
    const classes = Array.from({ length: CLASS_COUNT }, (_, i) => sanitizeClass(list[i], i))
    const active = typeof stored.active === 'number' && stored.active >= 0 && stored.active < CLASS_COUNT ? Math.floor(stored.active) : 0
    return { active, classes }
  }
  const legacy = readJSON(LEGACY_LOADOUT_KEY)
  const classes = Array.from({ length: CLASS_COUNT }, (_, i) => sanitizeClass(i === 0 && legacy ? { loadout: legacy } : undefined, i))
  return { active: 0, classes }
}

export function saveClasses(store: ClassStore) {
  try {
    localStorage.setItem(CLASSES_KEY, JSON.stringify(store))
  } catch {
    /* storage unavailable (private mode) — classes just won't persist */
  }
}

function sanitizeClass(raw: unknown, i: number): CustomClass {
  const r = isRecord(raw) ? raw : {}
  const name = typeof r.name === 'string' ? normalizeClassName(r.name) : ''
  return { name: name || defaultClassName(i), loadout: sanitizeLoadout(r.loadout, DEFAULT_LOADOUTS[i]!) }
}

function sanitizeLoadout(raw: unknown, def: Loadout): Loadout {
  const r = isRecord(raw) ? raw : {}
  const primary = PRIMARIES.find((w) => w === r.primary) ?? def.primary
  const secondary = SECONDARIES.find((w) => w === r.secondary) ?? def.secondary
  const perks = PERK_TIERS.map((tier, t) => {
    const p = Array.isArray(r.perks) ? r.perks[t] : undefined
    return tier.find((id) => id === p) ?? def.perks[t] ?? tier[0]!
  })
  const killstreaks = normalizeKillstreaks(Array.isArray(r.killstreaks) ? r.killstreaks.filter((k): k is string => typeof k === 'string') : def.killstreaks)
  const deathstreak = r.deathstreak === 'lastStand' || r.deathstreak === 'martyrdom' ? r.deathstreak : undefined
  const out: Loadout = { primary, secondary, perks, deathstreak, killstreaks }
  const primaryAttachment = attachmentsFor(primary).find((a) => a === r.primaryAttachment)
  const secondaryAttachment = attachmentsFor(secondary).find((a) => a === r.secondaryAttachment)
  if (primaryAttachment) out.primaryAttachment = primaryAttachment
  if (secondaryAttachment) out.secondaryAttachment = secondaryAttachment
  return out
}

function readJSON(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
