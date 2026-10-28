/**
 * Recorded sound bank. Each entry replaces (or adds) a key in the AudioEngine bank;
 * keys without an entry keep their procedural version from synth.ts, and so does any
 * key whose files fail to load. Files are WAVs in assets-src/sounds encoded to
 * public/sounds/*.mp3 by tools/convert_sounds.py, which reads sampleFiles() below,
 * so only files referenced here are shipped.
 *
 * Fire sounds: "slst" (stereo) is the first-person shot, "slmn"/"sl" (mono) the same
 * gun heard third-person, which is what nearby enemies use.
 */

interface SampleSet {
  /** Paths under /sounds/, without extension. Several = random variations. */
  files: string[]
  /** Peak level every variation is normalised to (the synth bank's scale). Default 0.9. */
  peak?: number
  /** Loading order: lower first. Default 1. */
  prio?: number
}

const W = 'weapons/'
const seq = (base: string, nums: number[], pad = 2) => nums.map((n) => `${W}${base}${String(n).padStart(pad, '0')}`)

const MEDIUM_FAR = seq('distant/weap_medium_fardist_b', [3, 6, 8, 9, 10, 11, 20])
const SMALL_FAR = [`${W}distant/weap_small_fardist_1b`, `${W}distant/weap_small_fardist_2b`]

/** Per gun: first-person shot, third-person shot, distant shot, suppressed (1st / 3rd person). */
interface GunSamples {
  own: string[]
  near: string[]
  far: string[]
  supp?: string[]
  suppNear?: string[]
}

const SMG_SUPP = { supp: [`${W}mp5/weap_mp5_silencer_slst_2d`], suppNear: [`${W}mp5/weap_mp5_silencer_slmn_2d`] }

const GUNS: Record<string, GunSamples> = {
  // The ACR is the "Masada" (Magpul) in MW2's sound banks.
  acr: {
    own: [`${W}magpul/weap_magpul_slst_4b`], near: [`${W}magpul/weap_magpul_slmn_4b`], far: MEDIUM_FAR,
    supp: [`${W}magpul/weap_magpulsilenced_slst_3d3`], suppNear: [`${W}magpul/weap_magpulsilenced_slmn_3d3`],
  },
  m4a1: {
    own: [`${W}m4/weap_m4_slst_1c4`, `${W}m4/weap_m4_slst_65dmp`], near: [`${W}m4/weap_m4_slmn_10`, `${W}m4/weap_m4_slmn_65d`], far: MEDIUM_FAR,
    supp: [`${W}m4/weap_m4_silencer_slst_2b`], suppNear: [`${W}m4/weap_m4_silencer_slmn_2b`],
  },
  ak47: {
    own: [`${W}ak47/weap_ak47_slst_3`], near: [`${W}ak47/weap_ak47_slmn_21`],
    far: [`${W}distant/weap_ak47_fardist_11e`, ...MEDIUM_FAR.slice(0, 3)],
    supp: [`${W}m4/weap_m4_silencer_slst_2b`], suppNear: [`${W}m4/weap_m4_silencer_slmn_2b`],
  },
  ump45: { own: [`${W}ump45/weap_ump45_slst_10b`], near: [`${W}ump45/weap_ump45_slmn_1c3b`], far: SMALL_FAR, ...SMG_SUPP },
  intervention: {
    own: [`${W}cheytac/weap_cheytac_slst_2d3mp`], near: [`${W}cheytac/weap_cheytac_slmn_2d3mp`], far: MEDIUM_FAR.slice(0, 6),
    supp: [`${W}sniper/weap_snipersilenced_slst_1`], suppNear: [`${W}sniper/weap_snipersilenced_slmn_1`],
  },
  rpd: {
    own: [`${W}rpd/wpnfire_rpd_v2`], near: [`${W}rpd/wpnfire_rpd_v2_mn`], far: MEDIUM_FAR,
    supp: [`${W}m240/wpnfire_lmg_silenced_plyr`], suppNear: [`${W}m240/wpnfire_lmg_silenced_npc`],
  },
  rpg7: { own: [`${W}rpg7/weap_rpg_slmn_2`], near: [`${W}rpg7/weap_rpg_slmn_2`], far: [`${W}javelin/weap_javelin_fire_dist_v1`] },
  aa12: {
    own: [`${W}shotgun/weap_aa12_slst_1`], near: [`${W}shotgun/weap_aa12_slmn_1`], far: MEDIUM_FAR.slice(-3),
    supp: [`${W}shotgun/weap_shotgunsilenced_slst_17`], suppNear: [`${W}shotgun/weap_shotgunsilenced_slmn_17`],
  },
  // No SPAS-12 recording in the pack; the Winchester 1200 is the closest pump-action.
  spas12: {
    own: [`${W}shotgun/weap_win1200_slst_2`], near: [`${W}shotgun/weap_win1200_slmn_2`], far: MEDIUM_FAR.slice(-3),
    supp: [`${W}shotgun/weap_shotgunsilenced_slst_17`], suppNear: [`${W}shotgun/weap_shotgunsilenced_slmn_17`],
  },
  // No USP recording either; the M9 Beretta is the closest service pistol.
  usp45: { own: [`${W}beretta/weap_beretta_slst_3c`], near: [`${W}beretta/weap_beretta_sl_3c`], far: SMALL_FAR, ...SMG_SUPP },
  g18: { own: [`${W}glock/weap_glock_slst_1d2`], near: [`${W}glock/weap_glock_slmn_1d2`], far: SMALL_FAR, ...SMG_SUPP },
  deagle: { own: [`${W}de/weap_deserteagle_slst_2`], near: [`${W}de/weap_deserteagle_slmn_2`], far: SMALL_FAR, ...SMG_SUPP },
}

export const SAMPLES: Record<string, SampleSet> = {
  // Under-barrel grenade launchers: GP-25 on the AK, M203 on the western rifles.
  'gun.gl.gp25': { files: [`${W}gp25/weap_gp25_sl_1`], prio: 0 },
  'gun.gl.m203': { files: [`${W}m203/weap_m203_sl_1b`], prio: 0 },

  // Bullet impacts by surface.
  'imp.sand': { files: seq('impact/impact_dirt_', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), peak: 0.75 },
  'imp.concrete': { files: seq('impact/impact_masonry_', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 19, 20, 21, 22, 24, 25, 27, 28, 30]), peak: 0.75 },
  'imp.metal': {
    files: [...seq('impact/impact_metal_a', [1, 2, 3, 4, 5, 7, 14, 15, 16, 17]), ...seq('impact/impact_metal_b', [1, 2, 3, 5, 14, 15, 18, 19, 20, 21]), ...seq('impact/blt_imp_paintmetal_a', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
    peak: 0.75,
  },
  'imp.ricochet': { files: [`${W}impact/ric1`, `${W}impact/ric2`, `${W}impact/ric3`, ...seq('ricochet/mrk_rico_metal', [1, 2, 3])], peak: 0.7 },
  'imp.wood': { files: [...seq('impact/impact_wood_', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20]), ...seq('impact/bullet_imp_crate', [1, 2, 3, 4])], peak: 0.75 },
  'imp.glass': { files: [...seq('impact/bullet_glass', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ...seq('impact/blt_impact_auto_glass', [1, 2, 3, 4])], peak: 0.75 },
  'imp.flesh': {
    files: [...['11b', '12b', '13b', '20c', '21', '3b', '8b', '9b'].map((s) => `${W}impact/mrk_impact_flesh${s}`), `${W}impact/impact_flesh_06`, `${W}impact/impact_flesh_16`],
    peak: 0.8,
  },
  'imp.water': { files: seq('impact/bullet_water', [1, 2, 3, 4, 5]), peak: 0.7 },
  /** A round hitting the local player's body armour / kit. */
  'imp.body': {
    files: ['armor', 'big', 'gear', 'sharp'].map((s) => `${W}impact/bullet_imp_body_${s}_stereo`),
    peak: 0.7,
  },

  // Brass hitting the floor after the local player fires.
  'shell.lg': { files: seq('shells/shell_bounce_lg', [1, 2, 3, 4, 5, 6]), peak: 0.45, prio: 2 },
  'shell.sm': { files: seq('shells/shell_bounce_sm', [1, 2, 3, 4, 5, 6, 7, 8]), peak: 0.45, prio: 2 },
  'shell.sg': { files: seq('shells/shell_bounce_sg', [1, 2, 3, 4, 5, 6, 7]), peak: 0.45, prio: 2 },

  // Foley.
  'fol.shell': { files: [`${W}shotgun/wpnfoley_shotgun_load3`], peak: 0.75 },
  'fol.pumpback': { files: [`${W}shotgun/mrk_12ga_shotgun_pump1`], peak: 0.8 },

  // Knife.
  'knife.swish': { files: [`${W}melee/h2h_knife_swing1`, `${W}melee/h2h_knife_swing2`, `${W}melee/melee_swing01`, `${W}melee/melee_swing03`], peak: 0.8 },
  'knife.hit': { files: [`${W}melee/h2h_knife_stab1`, `${W}melee/h2h_knife_stab2`, `${W}melee/h2h_knife_slice1`, `${W}melee/h2h_knife_slice2`], peak: 0.9 },

  // Frag grenades.
  'gren.pin': { files: [`${W}grenade/us_grenade_pin`], peak: 0.7 },
  'gren.throw': { files: [`${W}grenade/grenade_toss`], peak: 0.7 },
  'gren.bounce.sand': { files: [`${W}grenade/grenade_bounce_earth07`], peak: 0.7 },
  'gren.bounce.concrete': { files: seq('grenade/grenade_bounce_stone', [1, 2, 3, 4, 5]), peak: 0.7 },
  'gren.bounce.wood': { files: seq('grenade/grenade_bounce_wood', [5, 6, 7]), peak: 0.7 },
  'exp.near': { files: seq('grenade/mrk_grenade_', [2, 3, 4, 5], 1), peak: 1, prio: 0 },

  // Player body: heartbeat at low health, sniper hold-breath.
  heart: { files: [`${W}foley/mrk_heartbeat_01`], peak: 0.6 },
  'breath.in': { files: [`${W}foley/mrk_breathin_01`], peak: 0.5 },
  'breath.out': { files: [`${W}foley/mrk_breathout_05`], peak: 0.5 },
  /** Held too long: the long recovery exhale. */
  'breath.gasp': { files: [`${W}foley/mrk_breathout_03`, `${W}foley/mrk_breathout_04`], peak: 0.55 },

  // Killstreaks.
  'ks.chain': { files: [`${W}chopper_gunner/weap_20mm_chopgunner_player`], peak: 0.9 },
  'ks.ac.40': { files: [`${W}flak/flak88_fire02`, `${W}flak/flak88_fire03`], peak: 0.95 },
  'ks.turret': { files: [`${W}50cal/weap_50cal_temp_v2`], peak: 0.85 },
  'ks.missile': { files: [`${W}javelin/weap_javelin_ignition_v1`], peak: 0.95 },
}

for (const [id, g] of Object.entries(GUNS)) {
  SAMPLES[`gun.${id}.own`] = { files: g.own, prio: 0 }
  SAMPLES[`gun.${id}.near`] = { files: g.near, prio: 0 }
  SAMPLES[`gun.${id}.far`] = { files: g.far, peak: 0.85 }
  if (g.supp) SAMPLES[`gun.${id}.supp`] = { files: g.supp, peak: 0.8, prio: 0 }
  if (g.suppNear) SAMPLES[`gun.${id}.supp.near`] = { files: g.suppNear, peak: 0.8, prio: 0 }
}

/** Every referenced file, deduplicated (used by tools/convert_sounds.py). */
export function sampleFiles(): string[] {
  return [...new Set(Object.values(SAMPLES).flatMap((s) => s.files))].sort()
}

const BASE = '/sounds/'
const EXT = '.mp3'
const bytes = new Map<string, Promise<ArrayBuffer | null>>()

function fetchBytes(file: string): Promise<ArrayBuffer | null> {
  let p = bytes.get(file)
  if (!p) {
    p = fetch(BASE + file + EXT)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null)
    bytes.set(file, p)
  }
  return p
}

/** Start downloading every file (before the AudioContext exists), loading-priority order. */
export function prefetchSamples() {
  const entries = Object.values(SAMPLES).sort((a, b) => (a.prio ?? 1) - (b.prio ?? 1))
  for (const s of entries) for (const f of s.files) void fetchBytes(f)
}

/**
 * Recordings are far denser than the synthesised sounds at the same peak, so they
 * sound louder; this pulls every sample down to sit with the rest of the mix.
 */
const SAMPLE_LEVEL = 0.6

function normalise(buf: AudioBuffer, peak: number) {
  let m = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]!))
  }
  if (m < 1e-6) return
  const g = (peak * SAMPLE_LEVEL) / m
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) d[i]! *= g
  }
}

/**
 * Decode every sample set and hand each finished key to `onReady`. A key is only
 * delivered if at least one of its files decoded; failures are logged once, not thrown.
 */
export async function loadSamples(ctx: BaseAudioContext, onReady: (key: string, buffers: AudioBuffer[]) => void) {
  prefetchSamples()
  const entries = Object.entries(SAMPLES).sort(([, a], [, b]) => (a.prio ?? 1) - (b.prio ?? 1))
  let failed = 0
  await Promise.all(
    entries.map(async ([key, set]) => {
      const out: AudioBuffer[] = []
      for (const file of set.files) {
        const data = await fetchBytes(file)
        if (!data) {
          failed++
          continue
        }
        try {
          // decodeAudioData detaches the buffer, so hand it a copy (variations can share a file).
          const buf = await ctx.decodeAudioData(data.slice(0))
          normalise(buf, set.peak ?? 0.9)
          out.push(buf)
        } catch {
          failed++
        }
      }
      if (out.length) onReady(key, out)
    }),
  )
  if (failed) console.warn(`[audio] ${failed} sample file(s) failed to load; those sounds stay procedural`)
}
