import type { PerkId, Team, WeaponId } from '../core/types'

/**
 * Hand-drawn vector art for the whole UI: weapon silhouettes (side view, barrel
 * to the right), perk glyphs, team emblems, rank chevrons, HUD icons.
 * Shapes use currentColor; `.d` marks darker detail cut-lines.
 */

interface Art {
  vb: string
  body: string
}

const WEAPON_ART: Record<WeaponId, Art> = {
  acr: {
    vb: '2 18 308 88',
    body: `
      <path d="M6 42 L62 40 L66 62 L18 66 L6 58 Z"/>
      <path d="M62 36 H176 V62 H62 Z"/>
      <rect x="70" y="29" width="168" height="7"/>
      <path d="M112 62 H134 L126 96 H108 Z"/>
      <path d="M148 62 H174 L178 102 H152 Z"/>
      <path d="M176 38 L238 40 V56 L176 60 Z"/>
      <rect x="236" y="44" width="54" height="6"/>
      <rect x="288" y="41" width="18" height="12"/>
      <path d="M244 29 H252 V44 H244 Z"/>
      <rect x="76" y="22" width="11" height="8"/>
      <rect x="96" y="41" width="30" height="8" class="d"/>
      <path d="M134 62 V74 H146 V62 Z" class="d"/>
      <rect x="184" y="43" width="42" height="3" class="d"/>
      <rect x="184" y="51" width="42" height="3" class="d"/>
      <path d="M14 46 L58 45 L60 50 L16 52 Z" class="d"/>
      <rect x="292" y="44" width="3" height="6" class="d"/><rect x="298" y="44" width="3" height="6" class="d"/>`,
  },
  m4a1: {
    vb: '2 14 300 92',
    body: `
      <path d="M6 44 L26 42 V62 L6 66 Z"/>
      <rect x="24" y="46" width="44" height="10"/>
      <path d="M66 38 H152 V62 H66 Z"/>
      <path d="M72 38 V30 Q72 24 80 24 H128 Q138 24 138 32 V38 Z"/>
      <rect x="86" y="29" width="42" height="6" class="d"/>
      <path d="M110 62 H130 L122 96 H104 Z"/>
      <path d="M134 62 H158 L162 88 Q162 100 150 100 H140 Z"/>
      <rect x="152" y="40" width="72" height="19" rx="4"/>
      <rect x="222" y="44" width="62" height="6"/>
      <path d="M210 28 H218 L222 44 H208 Z"/>
      <rect x="280" y="41" width="18" height="12"/>
      <rect x="284" y="43" width="2.5" height="8" class="d"/><rect x="290" y="43" width="2.5" height="8" class="d"/>
      <rect x="160" y="44" width="52" height="3" class="d"/><rect x="160" y="52" width="52" height="3" class="d"/>
      <rect x="100" y="42" width="24" height="7" class="d"/>
      <path d="M130 62 V74 H144 V62 Z" class="d"/>
      <path d="M8 48 L22 47 V58 L8 60 Z" class="d"/>`,
  },
  ak47: {
    vb: '0 16 306 96',
    body: `
      <path d="M4 52 L68 42 V62 L24 80 L10 74 Z"/>
      <path d="M64 40 H152 V60 H64 Z"/>
      <path d="M70 40 Q72 34 80 34 H146 V40 Z"/>
      <path d="M118 60 H138 L128 94 H108 Z"/>
      <path d="M140 60 H166 C172 78 178 94 170 110 H146 C152 92 148 76 140 60 Z"/>
      <path d="M152 48 H214 V62 H152 Z"/>
      <path d="M152 40 H228 V46 H152 Z"/>
      <path d="M222 28 H231 L234 46 H220 Z"/>
      <rect x="214" y="47" width="68" height="6"/>
      <path d="M278 43 H298 L294 56 H278 Z"/>
      <path d="M4 52 L68 42 V62 L24 80 L10 74 Z" class="d"/>
      <path d="M118 60 H138 L128 94 H108 Z" class="d"/>
      <path d="M152 48 H214 V62 H152 Z" class="d"/>
      <rect x="74" y="44" width="30" height="7" class="d"/>
      <path d="M134 60 V72 H146 V60 Z" class="d"/>
      <rect x="156" y="41" width="62" height="2.5" class="d"/>`,
  },
  ump45: {
    vb: '2 20 262 92',
    body: `
      <path d="M6 44 L72 42 V60 L12 64 Z"/>
      <rect x="68" y="35" width="124" height="29" rx="5"/>
      <rect x="76" y="28" width="102" height="8"/>
      <path d="M112 64 H138 L130 98 H108 Z"/>
      <path d="M152 64 H178 L176 108 H154 Z"/>
      <path d="M190 38 L232 42 V58 L190 62 Z"/>
      <rect x="228" y="46" width="30" height="6"/>
      <rect x="252" y="43" width="10" height="12"/>
      <rect x="84" y="42" width="34" height="9" class="d"/>
      <rect x="196" y="44" width="28" height="3" class="d"/>
      <path d="M138 64 V76 H152 V64 Z" class="d"/>
      <path d="M12 46 L66 45 V52 L14 54 Z" class="d"/>
      <rect x="88" y="21" width="9" height="8"/>`,
  },
  intervention: {
    vb: '2 6 318 94',
    body: `
      <path d="M6 40 L58 44 L66 72 L40 74 L6 64 Z"/>
      <path d="M18 32 H56 L58 44 H12 Z"/>
      <path d="M58 42 H152 V66 H58 Z"/>
      <path d="M94 66 H114 L106 94 H90 Z"/>
      <rect x="118" y="66" width="18" height="16"/>
      <circle cx="73" cy="30" r="4.5"/><rect x="71" y="30" width="4" height="14"/>
      <rect x="64" y="14" width="130" height="14" rx="5"/>
      <path d="M186 10 H206 L210 31 H186 Z"/>
      <path d="M56 11 H68 V31 H56 Z"/>
      <rect x="88" y="28" width="12" height="14"/><rect x="146" y="28" width="12" height="14"/>
      <rect x="152" y="46" width="90" height="14"/>
      <rect x="240" y="49" width="60" height="7"/>
      <rect x="152" y="58" width="64" height="6"/>
      <path d="M294 44 H316 V61 H294 Z"/>
      <rect x="300" y="47" width="3" height="11" class="d"/><rect x="306" y="47" width="3" height="11" class="d"/>
      <rect x="70" y="46" width="40" height="8" class="d"/>
      <rect x="160" y="49" width="70" height="3" class="d"/>
      <rect x="74" y="17" width="30" height="3" class="d"/>`,
  },
  spas12: {
    vb: '2 24 294 82',
    body: `
      <path fill-rule="evenodd" d="M6 40 H64 V62 L30 78 L6 64 Z M14 47 H57 V57 L31 70 L14 58 Z"/>
      <path d="M64 38 H144 V62 H64 Z"/>
      <path d="M104 62 H126 L118 94 H100 Z"/>
      <rect x="144" y="40" width="134" height="7"/>
      <rect x="148" y="32" width="86" height="8"/>
      <rect x="144" y="50" width="122" height="7"/>
      <rect x="172" y="48" width="62" height="20" rx="4"/>
      <rect x="274" y="38" width="16" height="10"/>
      <path d="M262 30 H270 V42 H262 Z"/>
      <rect x="180" y="52" width="46" height="3" class="d"/><rect x="180" y="58" width="46" height="3" class="d"/>
      <rect x="152" y="34" width="76" height="2.5" class="d"/>
      <path d="M82 62 V74 H100 V62 Z" class="d"/>
      <rect x="72" y="42" width="30" height="7" class="d"/>`,
  },
  usp45: {
    vb: '88 28 152 86',
    body: `
      <path d="M96 40 H222 Q230 40 230 48 V58 H96 Z"/>
      <path d="M100 58 H204 V68 H100 Z"/>
      <path d="M104 62 H146 L140 104 H112 Z"/>
      <path fill-rule="evenodd" d="M144 64 H184 V86 Q184 90 178 90 H156 Q150 90 150 84 Z M156 68 H176 V80 H156 Z"/>
      <rect x="214" y="34" width="8" height="6"/><rect x="98" y="34" width="12" height="6"/>
      <rect x="108" y="43" width="3" height="12" class="d"/><rect x="114" y="43" width="3" height="12" class="d"/><rect x="120" y="43" width="3" height="12" class="d"/><rect x="126" y="43" width="3" height="12" class="d"/>
      <path d="M104 62 H146 L140 104 H112 Z" class="d"/>
      <rect x="112" y="76" width="26" height="2.5"/><rect x="113" y="84" width="24" height="2.5"/>`,
  },
  deagle: {
    vb: '88 24 184 92',
    body: `
      <path d="M96 42 H250 L262 46 V58 H96 Z"/>
      <rect x="96" y="32" width="12" height="9"/><rect x="236" y="34" width="10" height="9"/>
      <path d="M100 58 H196 V70 H100 Z"/>
      <path d="M104 62 H152 L144 106 H114 Z"/>
      <path fill-rule="evenodd" d="M150 64 H192 V88 Q192 92 186 92 H162 Q156 92 156 86 Z M162 70 H184 V82 H162 Z"/>
      <rect x="112" y="104" width="34" height="8"/>
      <rect x="116" y="38" width="100" height="3" class="d"/>
      <rect x="112" y="46" width="3" height="10" class="d"/><rect x="118" y="46" width="3" height="10" class="d"/><rect x="124" y="46" width="3" height="10" class="d"/>
      <path d="M104 62 H152 L144 106 H114 Z" class="d"/>
      <rect x="226" y="46" width="30" height="3" class="d"/>`,
  },
  frag: {
    vb: '0 0 64 64',
    body: `
      <ellipse cx="30" cy="38" rx="17" ry="20"/>
      <rect x="23" y="12" width="14" height="8" rx="2"/>
      <path d="M38 12 L54 8 Q58 8 58 12 L58 16 L40 20 Z"/>
      <circle cx="20" cy="14" r="5" fill="none" stroke="currentColor" stroke-width="2.5"/>
      <path d="M16 30 H44 M14 40 H46 M16 50 H44 M30 20 V58" stroke="#000" stroke-opacity=".4" stroke-width="2" fill="none"/>`,
  },
  knife: {
    vb: '0 0 200 60',
    body: `
      <path d="M62 24 L190 8 Q196 12 190 18 L84 38 Z"/>
      <rect x="54" y="18" width="12" height="28" rx="2"/>
      <path d="M8 24 H56 V40 H12 Q4 40 4 32 Q4 24 8 24 Z"/>
      <rect x="18" y="28" width="30" height="3" class="d"/>`,
  },
}

export function weaponSvg(id: WeaponId, cls = ''): string {
  const a = WEAPON_ART[id]
  if (cls.includes('big')) {
    // Large create-a-class render: gunmetal gradient body, edge highlight, darker detail cuts.
    const g = `wg-${id}`
    return `<svg class="wicon ${cls}" viewBox="${a.vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#9da397"/><stop offset=".18" stop-color="#5d6259"/>
        <stop offset=".55" stop-color="#2f322d"/><stop offset="1" stop-color="#1a1c19"/></linearGradient></defs>
      <g fill="url(#${g})" stroke="#b9bfb0" stroke-opacity=".55" stroke-width=".8" stroke-linejoin="round">${a.body}</g></svg>`
  }
  return `<svg class="wicon ${cls}" viewBox="${a.vb}" fill="currentColor" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${a.body}</svg>`
}

// ─── Perk glyphs (64x64) ───────────────────────────────────────────────────

const PERK_ART: Record<PerkId, string> = {
  marathon: `
    <path d="M10 44 Q10 36 18 34 L30 30 L36 20 L44 24 L40 34 L52 38 Q58 40 58 46 V50 H10 Z"/>
    <path d="M10 54 H58" stroke="currentColor" stroke-width="3" fill="none"/>
    <path d="M2 24 H14 M0 32 H10 M4 40 H12" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  sleightOfHand: `
    <rect x="22" y="8" width="20" height="36" rx="3"/>
    <rect x="25" y="12" width="14" height="4" class="d"/><rect x="25" y="20" width="14" height="4" class="d"/><rect x="25" y="28" width="14" height="4" class="d"/>
    <path d="M10 46 A24 24 0 0 0 54 46" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M54 36 V50 H42 Z"/>`,
  stoppingPower: `
    <path d="M4 26 H34 Q50 26 60 32 Q50 38 34 38 H4 Z"/>
    <rect x="4" y="26" width="12" height="12" class="d"/>
    <path d="M44 10 L38 20 M52 14 L44 22 M52 50 L44 42 M44 54 L38 44 M58 22 L50 27 M58 42 L50 37" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  lightweight: `
    <path d="M52 8 C34 10 14 22 12 44 C12 50 14 54 14 54 C20 52 26 48 30 42 L22 52 C36 50 54 36 52 8 Z"/>
    <path d="M12 56 C22 38 34 24 48 14" stroke="#000" stroke-opacity=".45" stroke-width="2.5" fill="none"/>`,
  commando: `
    <path d="M12 52 L46 14 Q52 8 56 12 Q58 16 52 22 L18 56 Z"/>
    <rect x="8" y="48" width="16" height="10" rx="2" transform="rotate(-45 16 53)"/>
    <path d="M6 20 H22 M2 30 H16" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  steadyAim: `
    <circle cx="32" cy="32" r="18" fill="none" stroke="currentColor" stroke-width="4"/>
    <circle cx="32" cy="32" r="4"/>
    <path d="M32 4 V16 M32 48 V60 M4 32 H16 M48 32 H60" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`,
}

export function perkSvg(id: PerkId, cls = ''): string {
  return `<svg class="picon ${cls}" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">${PERK_ART[id]}</svg>`
}

// ─── Misc HUD icons ────────────────────────────────────────────────────────

export const ICON = {
  uav: `<svg class="gicon" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
    <path d="M8 38 L30 30 L26 12 H33 L44 28 L58 26 Q62 26 62 30 Q62 34 58 34 L44 36 L33 52 H26 L30 38 L10 44 Z"/>
    <circle cx="32" cy="34" r="5" class="d"/>
    <path d="M14 56 A26 26 0 0 1 50 56" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/></svg>`,
  airstrike: `<svg class="gicon" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
    <path d="M32 4 L40 24 L60 34 V40 L40 36 L36 52 L42 58 V60 H22 V58 L28 52 L24 36 L4 40 V34 L24 24 Z"/></svg>`,
  skull: `<svg class="gicon" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
    <path d="M32 6 C16 6 8 18 8 30 C8 38 12 42 16 44 V54 H24 V50 H28 V54 H36 V50 H40 V54 H48 V44 C52 42 56 38 56 30 C56 18 48 6 32 6 Z"/>
    <circle cx="22" cy="31" r="6" class="d"/><circle cx="42" cy="31" r="6" class="d"/><path d="M32 38 L28 46 H36 Z" class="d"/></svg>`,
  headshot: `<svg class="gicon" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
    <path d="M32 6 C20 6 12 14 12 26 C12 34 16 40 20 44 V54 H44 V44 C48 40 52 34 52 26 C52 14 44 6 32 6 Z"/>
    <circle cx="32" cy="24" r="10" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="3"/>
    <path d="M32 8 V16 M32 32 V40 M16 24 H24 M40 24 H48" stroke="#000" stroke-opacity=".6" stroke-width="3"/></svg>`,
  grenadeWarn: `<svg class="gicon" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
    <ellipse cx="32" cy="38" rx="15" ry="18"/>
    <rect x="26" y="12" width="12" height="7" rx="2"/>
    <path d="M39 12 L52 9 Q55 9 55 12 V15 L40 19 Z"/>
    <path d="M18 32 H46 M17 42 H47 M32 20 V56" stroke="#000" stroke-opacity=".45" stroke-width="2" fill="none"/></svg>`,
  bomb: `<svg class="gicon" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
    <rect x="6" y="20" width="52" height="30" rx="3"/>
    <rect x="12" y="25" width="22" height="13" rx="1" class="d"/>
    <rect x="14" y="27" width="18" height="9" fill="#ff3a2a"/>
    <rect x="40" y="25" width="5" height="5" rx="1" class="d"/><rect x="47" y="25" width="5" height="5" rx="1" class="d"/>
    <rect x="40" y="32" width="5" height="5" rx="1" class="d"/><rect x="47" y="32" width="5" height="5" rx="1" class="d"/>
    <rect x="12" y="42" width="40" height="3" class="d"/>
    <path d="M18 20 Q18 10 30 10 H42" stroke="currentColor" stroke-width="3" fill="none"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 4 L18 12 L8 20 L6 18 L13 12 L6 6 Z"/></svg>`,
}

// ─── Objective marker (Domination flag / bomb site) ──────────────────────────

/** Square objective badge with its letter; colour comes from currentColor. */
export function objectiveSvg(letter: string, cls = ''): string {
  return `<svg class="objicon ${cls}" viewBox="0 0 48 48" aria-hidden="true">
    <rect x="3" y="3" width="42" height="42" rx="3" fill="rgba(8,10,6,.72)" stroke="currentColor" stroke-width="3"/>
    <text x="24" y="34" text-anchor="middle" font-family="Saira Condensed, sans-serif" font-weight="800" font-size="30" fill="currentColor">${letter}</text></svg>`
}

// ─── Team emblems ──────────────────────────────────────────────────────────

export function emblemSvg(team: Team, cls = ''): string {
  if (team === 'tf141') {
    return `<svg class="emblem tf141 ${cls}" viewBox="0 0 64 72" aria-hidden="true">
      <path d="M32 2 L60 12 V36 C60 54 48 66 32 70 C16 66 4 54 4 36 V12 Z" fill="currentColor"/>
      <path d="M32 8 L54 16 V36 C54 50 45 60 32 64 C19 60 10 50 10 36 V16 Z" fill="#0a0d08" fill-opacity=".72"/>
      <path d="M10 44 L54 24 V32 L10 52 Z" fill="currentColor" fill-opacity=".9"/>
      <text x="32" y="30" text-anchor="middle" font-family="Saira Condensed, sans-serif" font-weight="800" font-size="19" fill="currentColor">141</text>
      <path d="M22 56 L32 50 L42 56" stroke="currentColor" stroke-width="3" fill="none"/></svg>`
  }
  return `<svg class="emblem opfor ${cls}" viewBox="0 0 64 72" aria-hidden="true">
    <circle cx="32" cy="36" r="29" fill="none" stroke="currentColor" stroke-width="5"/>
    <circle cx="32" cy="36" r="22" fill="#0a0d08" fill-opacity=".72"/>
    <path d="M32 14 L37.6 29.4 L54 30 L41 40 L45.6 56 L32 46.8 L18.4 56 L23 40 L10 30 L26.4 29.4 Z" fill="currentColor"/>
    <path d="M2 36 H12 M52 36 H62" stroke="currentColor" stroke-width="5"/></svg>`
}

// ─── Rank insignia ─────────────────────────────────────────────────────────

export function rankSvg(level: number, cls = ''): string {
  const chev = (level % 3) + 1
  const rockers = Math.min(3, Math.floor(level / 3))
  const star = level >= 8
  let body = ''
  const top = star ? 22 : 14
  for (let i = 0; i < chev; i++) {
    const y = top + i * 9
    body += `<path d="M6 ${y + 12} L24 ${y} L42 ${y + 12} V${y + 18} L24 ${y + 6} L6 ${y + 18} Z"/>`
  }
  const base = top + chev * 9 + 12
  for (let i = 0; i < rockers; i++) {
    const y = base + i * 6
    body += `<path d="M6 ${y} Q24 ${y + 12} 42 ${y} V${y + 4} Q24 ${y + 16} 6 ${y + 4} Z"/>`
  }
  if (star) body += `<path d="M24 2 L27 10 H36 L29 15 L31.5 23 L24 18.5 L16.5 23 L19 15 L12 10 H21 Z"/>`
  return `<svg class="rank ${cls}" viewBox="0 0 48 64" fill="currentColor" aria-hidden="true">${body}</svg>`
}

// ─── Brand wordmark ────────────────────────────────────────────────────────

export const WORDMARK = `<div class="wordmark"><span class="wm-pre">MIKEY D PRESENTS</span><span class="wm-a">BROWSER</span><span class="wm-b">WARFARE</span></div>`
