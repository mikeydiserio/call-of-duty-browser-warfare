/**
 * Procedural sound recipes. Each Job renders `count` variations of one sound
 * into Float32Arrays; the engine uploads them as AudioBuffers once, at unlock.
 */
import {
  addDelayed,
  Biquad,
  bp,
  buf,
  cloth,
  finalize,
  finalizeStereo,
  highpassInPlace,
  hp,
  hump,
  lowpassInPlace,
  lp,
  makeLoop,
  mixInto,
  noiseBurst,
  pitchSine,
  riseFall,
  Rng,
  ring,
  samples,
  saturate,
  SR,
  sweepNoise,
  tone,
  TWO_PI,
  fsin,
} from './dsp'

export type Rendered = Float32Array | [Float32Array, Float32Array]

export interface Job {
  key: string
  count: number
  /** Sample rate for this job's DSP (lower = cheaper, fine for dark/low content). */
  rate?: number
  /** Lower runs first. */
  prio: number
  make(i: number, rng: Rng): Rendered
}

export type GunId = 'acr' | 'm4a1' | 'ak47' | 'ump45' | 'intervention' | 'spas12' | 'usp45' | 'deagle'
export const GUN_IDS: GunId[] = ['acr', 'm4a1', 'ak47', 'ump45', 'intervention', 'spas12', 'usp45', 'deagle']

// ─── Gunshots ───────────────────────────────────────────────────────────────

type ActionKind = 'rifle' | 'smg' | 'bolt' | 'pump' | 'pistol' | 'deagle'

interface GunProfile {
  click: number
  crackF: number
  crackTau: number
  crackGain: number
  sizzle: number
  bodyF: number
  bodyTau: number
  bodyGain: number
  thumpF0: number
  thumpF1: number
  thumpFTau: number
  thumpTau: number
  thumpGain: number
  tailTau: number
  tailF: number
  tailGain: number
  drive: number
  /** [delay s, gain, lowpass Hz] */
  echo: [number, number, number][]
  len: number
  farLP: number
  action: ActionKind
  peak: number
}

const GUNS: Record<GunId, GunProfile> = {
  acr: {
    click: 1, crackF: 3400, crackTau: 0.011, crackGain: 1.0, sizzle: 0.5,
    bodyF: 1500, bodyTau: 0.05, bodyGain: 1.9, thumpF0: 150, thumpF1: 62, thumpFTau: 0.025, thumpTau: 0.03, thumpGain: 0.9,
    tailTau: 0.24, tailF: 1900, tailGain: 0.3, drive: 1.7,
    echo: [[0.11, 0.24, 2200], [0.26, 0.13, 1500]], len: 1.25, farLP: 650, action: 'rifle', peak: 0.95,
  },
  m4a1: {
    click: 1, crackF: 4300, crackTau: 0.008, crackGain: 1.05, sizzle: 0.6,
    bodyF: 1900, bodyTau: 0.04, bodyGain: 1.7, thumpF0: 140, thumpF1: 66, thumpFTau: 0.022, thumpTau: 0.026, thumpGain: 0.75,
    tailTau: 0.2, tailF: 2200, tailGain: 0.28, drive: 1.45,
    echo: [[0.1, 0.22, 2600], [0.24, 0.11, 1800]], len: 1.15, farLP: 760, action: 'rifle', peak: 0.93,
  },
  ak47: {
    click: 1, crackF: 2500, crackTau: 0.014, crackGain: 1.05, sizzle: 0.35,
    bodyF: 1100, bodyTau: 0.075, bodyGain: 2.3, thumpF0: 125, thumpF1: 55, thumpFTau: 0.03, thumpTau: 0.036, thumpGain: 1.0,
    tailTau: 0.32, tailF: 1500, tailGain: 0.36, drive: 2.3,
    echo: [[0.12, 0.28, 1900], [0.29, 0.16, 1300], [0.5, 0.08, 900]], len: 1.45, farLP: 560, action: 'rifle', peak: 0.97,
  },
  ump45: {
    click: 0.8, crackF: 2200, crackTau: 0.008, crackGain: 0.7, sizzle: 0.25,
    bodyF: 900, bodyTau: 0.055, bodyGain: 2.2, thumpF0: 115, thumpF1: 62, thumpFTau: 0.025, thumpTau: 0.028, thumpGain: 0.75,
    tailTau: 0.15, tailF: 1400, tailGain: 0.22, drive: 1.35,
    echo: [[0.09, 0.15, 1600]], len: 0.9, farLP: 520, action: 'smg', peak: 0.88,
  },
  intervention: {
    click: 1.3, crackF: 5200, crackTau: 0.02, crackGain: 1.3, sizzle: 0.9,
    bodyF: 700, bodyTau: 0.13, bodyGain: 3.0, thumpF0: 105, thumpF1: 45, thumpFTau: 0.05, thumpTau: 0.07, thumpGain: 1.4,
    tailTau: 0.75, tailF: 1500, tailGain: 0.5, drive: 2.5,
    echo: [[0.14, 0.38, 2000], [0.33, 0.3, 1400], [0.62, 0.22, 1000], [1.0, 0.15, 800], [1.5, 0.09, 600], [2.1, 0.05, 500]],
    len: 3.4, farLP: 420, action: 'bolt', peak: 1.0,
  },
  spas12: {
    click: 0.8, crackF: 1800, crackTau: 0.015, crackGain: 0.75, sizzle: 0.3,
    bodyF: 650, bodyTau: 0.1, bodyGain: 3.0, thumpF0: 95, thumpF1: 48, thumpFTau: 0.04, thumpTau: 0.055, thumpGain: 1.35,
    tailTau: 0.38, tailF: 1000, tailGain: 0.4, drive: 2.1,
    echo: [[0.1, 0.26, 1400], [0.25, 0.15, 1000], [0.44, 0.07, 800]], len: 1.7, farLP: 380, action: 'pump', peak: 0.98,
  },
  usp45: {
    click: 1.1, crackF: 4800, crackTau: 0.007, crackGain: 1.15, sizzle: 0.55,
    bodyF: 1700, bodyTau: 0.026, bodyGain: 1.5, thumpF0: 175, thumpF1: 95, thumpFTau: 0.02, thumpTau: 0.018, thumpGain: 0.5,
    tailTau: 0.12, tailF: 2600, tailGain: 0.2, drive: 1.25,
    echo: [[0.08, 0.17, 2800], [0.2, 0.07, 1800]], len: 0.85, farLP: 900, action: 'pistol', peak: 0.88,
  },
  deagle: {
    click: 1.2, crackF: 3300, crackTau: 0.013, crackGain: 1.2, sizzle: 0.6,
    bodyF: 1100, bodyTau: 0.065, bodyGain: 2.6, thumpF0: 110, thumpF1: 52, thumpFTau: 0.03, thumpTau: 0.04, thumpGain: 1.2,
    tailTau: 0.3, tailF: 1700, tailGain: 0.34, drive: 2.0,
    echo: [[0.1, 0.32, 2200], [0.24, 0.18, 1600], [0.45, 0.1, 1100]], len: 1.8, farLP: 600, action: 'deagle', peak: 0.97,
  },
}

function metalClick(d: Float32Array, t0: number, rng: Rng, level: number, f = 2400) {
  noiseBurst(d, t0, 0.012, 0.0018, 0.9 * level, rng, [hp(1400)], 0.00005)
  ring(d, t0, [f * rng.jit(0.05), f * 1.7 * rng.jit(0.05), f * 2.6], [0.014, 0.009, 0.006], 0.35 * level)
}

/** Muzzle-blast pressure wave: a sharp positive spike followed by a longer rarefaction lobe (N-wave). */
function blastPulse(d: Float32Array, gain: number, width: number) {
  const n1 = Math.max(2, samples(width))
  const n2 = Math.max(4, samples(width * 4.5))
  for (let i = 0; i < n1 && i < d.length; i++) d[i]! += gain * fsin((Math.PI * i) / n1)
  for (let i = 0; i < n2 && n1 + i < d.length; i++) d[n1 + i]! -= gain * 0.42 * fsin((Math.PI * i) / n2)
}

/** Noise whose amplitude is roughened by a fast random envelope — expanding gas crackle, not smooth hiss. */
function gritNoise(d: Float32Array, t0: number, dur: number, tau: number, gain: number, rng: Rng, filters: Biquad[], grit: number) {
  const s0 = samples(t0)
  const n = Math.min(samples(dur), d.length - s0)
  const dec = Math.exp(-1 / (tau * SR))
  const am = lp(320)
  const att = Math.max(1, 0.0003 * SR)
  let env = 1
  for (let i = 0; i < n; i++) {
    let x = rng.signed()
    for (let k = 0; k < filters.length; k++) x = filters[k]!.process(x)
    const m = 1 - grit + grit * Math.min(2.2, Math.abs(am.process(rng.signed())) * 9)
    d[s0 + i]! += x * env * m * gain * (i < att ? i / att : 1)
    env *= dec
  }
}

/** Blast only (no low thump) — also the source for slap-back echoes, so they don't re-boom. */
function gunBlast(P: GunProfile, rng: Rng): Float32Array {
  const d = new Float32Array(samples(P.len))
  // 1. transient: pressure N-wave + broadband crack + air sizzle
  blastPulse(d, 1.6 * P.click, 0.00022 + 0.00012 * (P.bodyTau / 0.05))
  noiseBurst(d, 0, 0.005, 0.0008, 0.9 * P.click, rng, [hp(900)], 0.00002)
  noiseBurst(d, 0, 0.1, P.crackTau * rng.jit(0.1), P.crackGain, rng, [bp(P.crackF * rng.jit(0.08), 0.8), hp(1100)], 0.00003)
  noiseBurst(d, 0, 0.035, 0.004, P.sizzle, rng, [hp(5500)], 0.00003)
  // 2. body: gritty, calibre-shaped gas blast
  gritNoise(d, 0.0003, 0.6, P.bodyTau * rng.jit(0.1), P.bodyGain, rng, [lp(P.bodyF * rng.jit(0.08), 0.8), hp(120)], 0.55)
  gritNoise(d, 0.0005, 0.3, P.bodyTau * 0.55, P.bodyGain * 0.6, rng, [bp(P.bodyF * 0.55, 1.2)], 0.4)
  // normalise then saturate so the blast is dense and loud; the thump is added afterwards so it
  // keeps its natural decay instead of being flattened into a droning sine.
  let m = 0
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]!))
  const g = 1 / Math.max(m, 1e-6)
  for (let i = 0; i < d.length; i++) d[i]! *= g
  saturate(d, P.drive)
  return d
}

/** Low-end punch: short pitch-dropping kick under the blast. */
function addThump(d: Float32Array, P: GunProfile, rng: Rng) {
  pitchSine(d, 0, Math.min(P.len, 0.6), P.thumpF0 * rng.jit(0.06), P.thumpF1, P.thumpFTau, P.thumpTau * rng.jit(0.08), P.thumpGain * 0.62, 0.0012, 0.3)
}

function gunMain(P: GunProfile, rng: Rng): Float32Array {
  const d = gunBlast(P, rng)
  addThump(d, P, rng)
  return d
}

function gunTail(P: GunProfile, rng: Rng): Float32Array {
  const t = new Float32Array(samples(P.len))
  const dec = Math.exp(-1 / (P.tailTau * SR))
  const f = lp(P.tailF)
  const att = 0.012 * SR
  let env = 1
  for (let i = 0; i < t.length; i++) {
    if ((i & 31) === 0) f.lowpass(Math.max(220, P.tailF * Math.exp(-i / SR / (P.tailTau * 1.3))))
    t[i] = f.process(rng.signed()) * env * P.tailGain * 3 * (i < att ? i / att : 1)
    env *= dec
  }
  return t
}

function gunEchoes(P: GunProfile, main: Float32Array, scale = 1): Float32Array[] {
  const head = main.subarray(0, samples(0.4))
  return P.echo.map(([delay, gain, lpHz]) => {
    const e = new Float32Array(main.length)
    addDelayed(e, head, delay, gain * scale, lpHz, 2)
    return e
  })
}

function gunAction(P: GunProfile, rng: Rng): Float32Array {
  const a = new Float32Array(samples(P.len))
  switch (P.action) {
    case 'rifle':
    case 'smg':
      metalClick(a, 0.014, rng, 0.14, 2200)
      metalClick(a, 0.04, rng, 0.11, 3600)
      break
    case 'pistol':
    case 'deagle':
      metalClick(a, 0.012, rng, 0.2, 2600)
      metalClick(a, 0.05, rng, 0.14, 1900)
      break
    case 'bolt':
      // bolt lift, pull back, push forward, lock down
      metalClick(a, 0.5, rng, 0.35, 1500)
      sweepNoise(a, 0.56, 0.2, 0.22, rng, 800, 2100, 1.5, hump)
      metalClick(a, 0.77, rng, 0.45, 1800)
      sweepNoise(a, 0.84, 0.14, 0.22, rng, 2000, 900, 1.5, hump)
      metalClick(a, 1.0, rng, 0.5, 1400)
      pitchSine(a, 1.0, 0.1, 200, 110, 0.02, 0.03, 0.2)
      break
    case 'pump':
      sweepNoise(a, 0.36, 0.14, 0.3, rng, 700, 1500, 1.3, hump)
      metalClick(a, 0.5, rng, 0.5, 1000)
      pitchSine(a, 0.5, 0.1, 160, 90, 0.02, 0.035, 0.3)
      sweepNoise(a, 0.58, 0.1, 0.3, rng, 1500, 700, 1.3, hump)
      metalClick(a, 0.67, rng, 0.55, 900)
      break
  }
  // brass hitting the dirt
  if (P.action !== 'pump') {
    const t = 0.25 + rng.next() * 0.12
    ring(a, t, [5200 * rng.jit(0.1), 7100 * rng.jit(0.1), 8800], [0.02, 0.014, 0.01], 0.05)
    ring(a, t + 0.055, [4900 * rng.jit(0.1), 6800 * rng.jit(0.1)], [0.016, 0.01], 0.03)
  } else {
    const t = 0.78 + rng.next() * 0.1
    ring(a, t, [1700 * rng.jit(0.1), 2900], [0.025, 0.015], 0.07)
    pitchSine(a, t, 0.05, 240, 150, 0.01, 0.02, 0.06)
  }
  return a
}

function sumInto(dst: Float32Array, srcs: Float32Array[], gains: number[] | number) {
  for (let k = 0; k < srcs.length; k++) mixInto(dst, srcs[k]!, typeof gains === 'number' ? gains : (gains[k] ?? 1))
}

/** Non-spatial (player) shot: stereo, punchy centre, wide decorrelated tail + slap echoes from the sides. */
function gunOwn(id: GunId, rng: Rng): [Float32Array, Float32Array] {
  const P = GUNS[id]
  const blast = gunBlast(P, rng)
  const echoes = gunEchoes(P, blast)
  const main = blast.slice()
  addThump(main, P, rng)
  const tailA = gunTail(P, rng)
  const tailB = gunTail(P, rng)
  const action = gunAction(P, rng)
  const L = new Float32Array(main.length)
  const R = new Float32Array(main.length)
  mixInto(L, main, 1.12)
  mixInto(R, main, 1.12)
  mixInto(L, tailA)
  mixInto(R, tailB)
  mixInto(L, action)
  mixInto(R, action)
  echoes.forEach((e, k) => {
    mixInto(L, e, k % 2 === 0 ? 1.25 : 0.45)
    mixInto(R, e, k % 2 === 0 ? 0.45 : 1.25)
  })
  // close-mic weight: a touch of the blast's low-mids on both channels
  const lows = main.slice(0, samples(0.12))
  lowpassInPlace(lows, 300)
  mixInto(L, lows, 0.25)
  mixInto(R, lows, 0.25)
  return finalizeStereo(L, R, P.peak)
}

/** Dull low boom, delayed crack, long rolling echoes. */
function gunFar(id: GunId, rng: Rng): Float32Array {
  const P = GUNS[id]
  const main = gunMain(P, rng)
  const len = P.len + 1.4
  const out = new Float32Array(samples(len))
  const boom = main.slice()
  lowpassInPlace(boom, P.farLP, 2)
  mixInto(out, boom, 1.5)
  pitchSine(out, 0.01, 0.9, 85 * rng.jit(0.08), 42, 0.15, 0.2, 0.3)
  // crack arrives late and dull
  const crack = main.slice(0, samples(0.15))
  const low = crack.slice()
  lowpassInPlace(low, 2600)
  for (let i = 0; i < crack.length; i++) crack[i]! -= low[i]!
  lowpassInPlace(crack, 4800)
  mixInto(out, crack, 0.3, 0.05)
  const head = boom.subarray(0, samples(0.6))
  const taps: [number, number][] = [[0.3, 0.5], [0.66, 0.36], [1.12, 0.24], [1.7, 0.13]]
  for (const [dly, g] of taps) addDelayed(out, head, dly * rng.jit(0.05), g * (0.75 + 0.25 * P.tailTau), 650, 1)
  const tail = gunTail(P, rng)
  lowpassInPlace(tail, 700, 2)
  mixInto(out, tail, 0.7, 0.08)
  return finalize(out, P.peak * 0.9, 40)
}

/** Suppressed "thup": little crack, short body, mechanical clatter. */
function gunSuppressed(rng: Rng): Float32Array {
  const d = new Float32Array(samples(0.55))
  noiseBurst(d, 0, 0.004, 0.0008, 0.35, rng, [hp(2000)], 0.00005)
  noiseBurst(d, 0, 0.12, 0.02, 1.8, rng, [bp(1500 * rng.jit(0.1), 0.7)], 0.0001)
  noiseBurst(d, 0.0, 0.2, 0.05, 1.4, rng, [lp(900), lp(700)])
  pitchSine(d, 0, 0.18, 190, 100, 0.02, 0.04, 0.45)
  metalClick(d, 0.018, rng, 0.35, 2100)
  metalClick(d, 0.045, rng, 0.25, 3300)
  const t = 0.26 + rng.next() * 0.1
  ring(d, t, [5400, 7200], [0.02, 0.012], 0.05)
  return finalize(d, 0.55)
}

// ─── Foley ──────────────────────────────────────────────────────────────────

function magOut(rng: Rng): Float32Array {
  const d = buf(0.46)
  metalClick(d, 0, rng, 0.9, rng.range(2000, 2600))
  sweepNoise(d, 0.03, 0.15, 0.6, rng, 900, 2200, 1.2, riseFall(0.3))
  pitchSine(d, 0.17, 0.1, 220, 110, 0.02, 0.03, 0.3)
  noiseBurst(d, 0.17, 0.06, 0.012, 0.5, rng, [bp(1400, 1)])
  return finalize(d, 0.75)
}

function magIn(rng: Rng): Float32Array {
  const d = buf(0.4)
  sweepNoise(d, 0, 0.12, 0.6, rng, 1800, 900, 1.2, riseFall(0.75))
  pitchSine(d, 0.12, 0.16, 165, 90, 0.025, 0.045, 0.7)
  noiseBurst(d, 0.115, 0.05, 0.01, 1.1, rng, [bp(1500, 1)])
  metalClick(d, 0.125, rng, 0.95, 2300)
  metalClick(d, 0.155, rng, 0.4, 3100)
  return finalize(d, 0.85)
}

function boltBack(rng: Rng): Float32Array {
  const d = buf(0.4)
  sweepNoise(d, 0, 0.17, 0.55, rng, 1000, 2000, 1.5, hump)
  for (let k = 0; k < 3; k++) metalClick(d, 0.03 + k * 0.03, rng, 0.28, 3000 + k * 200)
  metalClick(d, 0.18, rng, 0.9, 1800)
  pitchSine(d, 0.18, 0.1, 210, 120, 0.02, 0.03, 0.35)
  return finalize(d, 0.8)
}

function boltFwd(rng: Rng): Float32Array {
  const d = buf(0.35)
  sweepNoise(d, 0, 0.1, 0.6, rng, 2000, 1000, 1.5, hump)
  metalClick(d, 0.1, rng, 1.0, 1600)
  pitchSine(d, 0.1, 0.12, 190, 100, 0.02, 0.04, 0.55)
  ring(d, 0.1, [900 * rng.jit(0.05), 1650], [0.03, 0.02], 0.15)
  return finalize(d, 0.85)
}

function pumpBack(rng: Rng): Float32Array {
  const d = buf(0.45)
  sweepNoise(d, 0, 0.2, 0.55, rng, 600, 1300, 1.2, hump)
  metalClick(d, 0.2, rng, 0.75, 1000)
  pitchSine(d, 0.2, 0.12, 150, 80, 0.02, 0.04, 0.45)
  return finalize(d, 0.8)
}

function pumpFwd(rng: Rng): Float32Array {
  const d = buf(0.4)
  sweepNoise(d, 0, 0.14, 0.55, rng, 1400, 650, 1.2, hump)
  metalClick(d, 0.15, rng, 1.0, 900)
  pitchSine(d, 0.15, 0.14, 140, 70, 0.02, 0.05, 0.7)
  ring(d, 0.15, [520, 1100, 2300], [0.05, 0.03, 0.02], 0.2)
  return finalize(d, 0.9)
}

function shellIn(rng: Rng): Float32Array {
  const d = buf(0.25)
  noiseBurst(d, 0, 0.03, 0.006, 1.2, rng, [bp(1800 * rng.jit(0.1), 1.2)])
  ring(d, 0, [2800, 4300], [0.012, 0.008], 0.3)
  pitchSine(d, 0.01, 0.08, 200, 110, 0.015, 0.025, 0.3)
  metalClick(d, 0.06, rng, 0.5, 2000)
  return finalize(d, 0.7)
}

function dryClick(rng: Rng): Float32Array {
  const d = buf(0.18)
  metalClick(d, 0, rng, 1.0, 3000 * rng.jit(0.08))
  pitchSine(d, 0.002, 0.04, 320, 180, 0.01, 0.015, 0.3)
  return finalize(d, 0.7)
}

function weaponSwitch(rng: Rng): Float32Array {
  const d = buf(0.42)
  cloth(d, 0, 0.24, 0.9, rng, 400, 1600)
  metalClick(d, 0.05, rng, 0.3, rng.range(2000, 3500))
  metalClick(d, 0.11, rng, 0.25, rng.range(1800, 3000))
  metalClick(d, 0.17, rng, 0.2, rng.range(2500, 4000))
  metalClick(d, 0.26, rng, 0.65, 2000)
  pitchSine(d, 0.26, 0.08, 220, 130, 0.015, 0.025, 0.25)
  return finalize(d, 0.7)
}

function knifeSwish(rng: Rng): Float32Array {
  const d = buf(0.32)
  sweepNoise(d, 0, 0.2, 1.0, rng, 600, 2800, 1.3, riseFall(0.55))
  sweepNoise(d, 0.02, 0.16, 0.3, rng, 2400, 5200, 2, riseFall(0.5))
  return finalize(d, 0.7)
}

function knifeHit(rng: Rng): Float32Array {
  const d = buf(0.32)
  noiseBurst(d, 0, 0.14, 0.04, 2.2, rng, [lp(500), lp(450)])
  noiseBurst(d, 0, 0.012, 0.004, 0.9, rng, [bp(1700, 1)])
  sweepNoise(d, 0, 0.09, 0.6, rng, 4200, 1600, 1.5, riseFall(0.2))
  pitchSine(d, 0, 0.14, 105, 58, 0.03, 0.06, 0.8)
  return finalize(d, 0.85)
}

function grenadeThrow(rng: Rng): Float32Array {
  const d = buf(0.75)
  // pin pull + spoon ping, then the throw whoosh
  sweepNoise(d, 0, 0.05, 0.5, rng, 1500, 3000, 2, hump)
  ring(d, 0.03, [2900, 4700, 6400], [0.05, 0.025, 0.015], 0.5)
  ring(d, 0.13, [1850, 2650, 3900], [0.09, 0.05, 0.03], 0.4)
  cloth(d, 0.1, 0.25, 0.5, rng, 400, 1300)
  sweepNoise(d, 0.2, 0.38, 1.1, rng, 300, 1500, 0.9, riseFall(0.4))
  return finalize(d, 0.8)
}

type BounceKind = 'metal' | 'concrete' | 'sand' | 'wood'
function grenadeBounce(kind: BounceKind, rng: Rng): Float32Array {
  const d = buf(0.5)
  if (kind === 'metal') {
    metalClick(d, 0, rng, 1.0, rng.range(1700, 2300))
    ring(d, 0, [rng.range(800, 1100), rng.range(1900, 2500), rng.range(3200, 3900), 5200], [0.1, 0.07, 0.05, 0.03], 0.35)
    pitchSine(d, 0, 0.1, 240, 120, 0.02, 0.035, 0.4)
  } else if (kind === 'concrete') {
    noiseBurst(d, 0, 0.02, 0.005, 1.2, rng, [bp(2400, 0.9)])
    pitchSine(d, 0, 0.1, 260, 140, 0.02, 0.03, 0.55)
    ring(d, 0, [1500, 2900], [0.025, 0.015], 0.2)
  } else if (kind === 'sand') {
    noiseBurst(d, 0, 0.14, 0.035, 1.2, rng, [bp(600, 0.6)])
    pitchSine(d, 0, 0.1, 150, 75, 0.02, 0.04, 0.6)
  } else {
    noiseBurst(d, 0, 0.06, 0.016, 1.6, rng, [bp(700, 1.8)])
    pitchSine(d, 0, 0.12, 230, 120, 0.025, 0.04, 0.6)
  }
  return finalize(d, 0.75)
}

// ─── Impacts ────────────────────────────────────────────────────────────────

type ImpactKind = 'sand' | 'concrete' | 'metal' | 'ricochet' | 'wood' | 'glass' | 'flesh'
function impact(kind: ImpactKind, rng: Rng): Float32Array {
  const d = buf(kind === 'ricochet' ? 0.75 : kind === 'glass' ? 0.5 : 0.4)
  switch (kind) {
    case 'sand':
      noiseBurst(d, 0, 0.004, 0.001, 0.35, rng, [hp(1500)])
      noiseBurst(d, 0, 0.22, 0.05, 2.0, rng, [bp(rng.range(450, 800), 0.7)])
      pitchSine(d, 0, 0.15, rng.range(140, 200), 70, 0.02, 0.04, 0.8)
      noiseBurst(d, 0.006, 0.14, 0.03, 0.5, rng, [hp(3000)])
      break
    case 'concrete':
      noiseBurst(d, 0, 0.005, 0.0009, 0.8, rng, [hp(1200)], 0.00005)
      noiseBurst(d, 0, 0.07, 0.012, 1.4, rng, [bp(rng.range(2200, 3200), 0.9)], 0.00005)
      noiseBurst(d, 0, 0.18, 0.045, 2.0, rng, [bp(rng.range(700, 1000), 0.8)])
      pitchSine(d, 0, 0.1, 190, 100, 0.02, 0.03, 0.4)
      for (let k = 0; k < 5; k++) noiseBurst(d, rng.range(0.02, 0.2), 0.006, 0.0016, rng.range(0.08, 0.3), rng, [hp(rng.range(2500, 6000))])
      break
    case 'metal':
    case 'ricochet': {
      const f0 = rng.range(900, 1500)
      noiseBurst(d, 0, 0.006, 0.0012, 0.9, rng, [hp(1500)], 0.00005)
      ring(d, 0, [f0, f0 * 1.84, f0 * 2.76, f0 * 4.1], [0.13, 0.09, 0.06, 0.04], 0.5, [1, 0.7, 0.5, 0.35])
      noiseBurst(d, 0, 0.1, 0.02, 1.2, rng, [bp(rng.range(300, 450), 1)])
      pitchSine(d, 0, 0.08, 260, 150, 0.015, 0.025, 0.35)
      if (kind === 'ricochet') {
        // whining zip: falling pitch with a little flutter
        const n = samples(0.5)
        let ph = 0
        for (let i = 0; i < n; i++) {
          const u = i / n
          const f = 1100 + 2900 * Math.exp(-u * 3.4) + 40 * fsin(u * 90)
          ph += (TWO_PI * f) / SR
          d[samples(0.02) + i]! += fsin(ph) * Math.pow(1 - u, 2.2) * 0.3 * Math.min(1, i / 60)
        }
        sweepNoise(d, 0.02, 0.4, 0.18, rng, 5200, 1300, 3, riseFall(0.1))
      }
      break
    }
    case 'wood':
      noiseBurst(d, 0, 0.004, 0.001, 0.5, rng, [hp(1500)])
      noiseBurst(d, 0, 0.12, 0.03, 2.4, rng, [bp(rng.range(550, 750), 2.2)])
      pitchSine(d, 0, 0.14, rng.range(200, 260), 110, 0.025, 0.04, 0.7)
      for (let k = 0; k < 3; k++) noiseBurst(d, rng.range(0.01, 0.12), 0.006, 0.002, 0.2, rng, [hp(4000)])
      break
    case 'glass': {
      noiseBurst(d, 0, 0.005, 0.001, 0.8, rng, [hp(2500)])
      noiseBurst(d, 0, 0.1, 0.03, 1.5, rng, [bp(4200, 0.7)])
      for (let k = 0; k < 10; k++) {
        const f = rng.range(3500, 9500)
        ring(d, rng.range(0, 0.16), [f, f * 1.35], [rng.range(0.03, 0.12), 0.03], rng.range(0.1, 0.3))
      }
      break
    }
    case 'flesh':
      noiseBurst(d, 0, 0.14, 0.035, 2.6, rng, [lp(rng.range(550, 800)), lp(700)])
      noiseBurst(d, 0, 0.03, 0.01, 1.1, rng, [bp(1500, 1)])
      pitchSine(d, 0, 0.14, 92, 55, 0.03, 0.06, 0.8)
      break
  }
  return finalize(d, 0.8)
}

function whizz(rng: Rng): Float32Array {
  const d = buf(0.5)
  noiseBurst(d, 0, 0.012, 0.0025, 1.1, rng, [hp(3500)], 0.00005)
  sweepNoise(d, 0.004, 0.2, 1.1, rng, 6200, 1700, 1.2, riseFall(0.1))
  sweepNoise(d, 0.02, 0.3, 0.7, rng, 1800, 650, 0.8, riseFall(0.25))
  pitchSine(d, 0.004, 0.18, 3400, 1500, 0.05, 0.05, 0.28)
  return finalize(d, 0.9)
}

function hitTick(kind: 'tick' | 'head' | 'kill', rng: Rng): Float32Array {
  const d = buf(kind === 'kill' ? 0.2 : 0.14)
  const pj = rng.jit(0.03)
  noiseBurst(d, 0, 0.012, 0.0028, 1.3, rng, [bp(3800 * pj, 2)], 0.00004)
  ring(d, 0, [(kind === 'head' ? 3500 : 2650) * pj, 5200 * pj, 7800], [0.014, 0.007, 0.004], 0.5, [1, 0.45, 0.2])
  if (kind === 'kill') {
    // heavier body: a short, dry knock under the tick (not a boom)
    pitchSine(d, 0.0, 0.08, 260, 120, 0.012, 0.018, 0.55)
    noiseBurst(d, 0.0, 0.05, 0.012, 1.1, rng, [bp(900, 1.2)])
    noiseBurst(d, 0.052, 0.012, 0.0028, 1.0, rng, [bp(3300, 2)], 0.00004)
    ring(d, 0.052, [2300, 4600], [0.02, 0.01], 0.35)
  }
  return finalize(d, 0.85, 10)
}

function playerHurt(heavy: boolean, rng: Rng): Float32Array {
  const d = buf(heavy ? 0.6 : 0.4)
  pitchSine(d, 0, heavy ? 0.5 : 0.3, heavy ? 80 : 95, 38, 0.05, heavy ? 0.16 : 0.09, 1.0)
  noiseBurst(d, 0, 0.1, 0.03, 2.4, rng, [lp(450), lp(400)])
  noiseBurst(d, 0, 0.02, 0.006, 0.8, rng, [bp(1400, 1)])
  if (heavy) noiseBurst(d, 0, 0.4, 0.12, 2.0, rng, [lp(220), lp(200)])
  return finalize(d, 0.95)
}

function bodyFall(rng: Rng): Float32Array {
  const d = buf(0.55)
  pitchSine(d, 0, 0.3, 85, 42, 0.05, 0.1, 1.0)
  noiseBurst(d, 0, 0.14, 0.04, 2.2, rng, [lp(500), lp(420)])
  cloth(d, 0.02, 0.3, 0.5, rng, 500, 1400)
  for (let k = 0; k < 3; k++) metalClick(d, rng.range(0.03, 0.22), rng, 0.15, rng.range(2200, 4000))
  return finalize(d, 0.9)
}

// ─── Movement ───────────────────────────────────────────────────────────────

type StepKind = 'sand' | 'concrete' | 'metal' | 'grate' | 'wood'
function step(kind: StepKind, rng: Rng, heavy: number): Float32Array {
  const d = buf(heavy > 1 ? 0.55 : 0.34)
  switch (kind) {
    case 'sand': {
      noiseBurst(d, 0, 0.2, 0.065, 0.9 * heavy, rng, [bp(rng.range(700, 1100), 0.6)])
      const grains = Math.round(rng.range(22, 34))
      for (let k = 0; k < grains; k++) {
        noiseBurst(d, rng.range(0, 0.12), 0.004, 0.0012, rng.range(0.1, 0.3) * Math.sqrt(heavy), rng, [hp(rng.range(2500, 5500))])
      }
      pitchSine(d, 0, 0.13, rng.range(110, 150), 65, 0.03, 0.05, 0.55 * heavy)
      break
    }
    case 'concrete':
      pitchSine(d, 0, 0.14, rng.range(150, 210), 80, 0.02, 0.035, 0.7 * heavy)
      noiseBurst(d, 0, 0.06, 0.012, 1.1, rng, [bp(rng.range(1800, 2800), 0.8)])
      noiseBurst(d, 0, 0.22, 0.045, 1.3 * heavy, rng, [bp(rng.range(450, 700), 0.7)])
      noiseBurst(d, 0.02, 0.1, 0.03, 0.35, rng, [hp(4000)])
      break
    case 'metal': {
      const f = rng.range(380, 520)
      pitchSine(d, 0, 0.1, 210, 110, 0.02, 0.03, 0.5 * heavy)
      noiseBurst(d, 0, 0.01, 0.002, 1.0, rng, [hp(2000)])
      ring(d, 0, [f, f * 1.9, f * 3.1, f * 4.4], [0.14 * Math.sqrt(heavy), 0.1, 0.07, 0.05], 0.38 * heavy, [1, 0.7, 0.45, 0.3])
      noiseBurst(d, 0, 0.05, 0.012, 1.0, rng, [bp(1200, 1)])
      break
    }
    case 'grate': {
      pitchSine(d, 0, 0.26, 190, 118, 0.04, 0.12, 0.7 * heavy)
      ring(d, 0, [310 * rng.jit(0.06), 640 * rng.jit(0.05), 1020], [0.22, 0.14, 0.1], 0.3 * heavy, [1, 0.6, 0.35])
      noiseBurst(d, 0, 0.04, 0.01, 0.8, rng, [bp(1600, 1)])
      for (let k = 0; k < 3; k++) metalClick(d, rng.range(0.025, 0.14), rng, 0.2, rng.range(2500, 4200))
      break
    }
    case 'wood':
      pitchSine(d, 0.0, 0.1, rng.range(240, 300), 130, 0.025, 0.045, 0.8 * heavy)
      noiseBurst(d, 0, 0.16, 0.04, 1.8 * heavy, rng, [bp(rng.range(550, 700), 2)])
      noiseBurst(d, 0, 0.01, 0.002, 0.5, rng, [hp(2500)])
      if (rng.next() < 0.35) sweepNoise(d, 0.04, 0.16, 0.12, rng, 260, 420, 8, hump)
      break
  }
  if (heavy > 1) {
    // gear rattle on a hard landing
    cloth(d, 0, 0.25, 0.4, rng, 400, 1200)
    for (let k = 0; k < 4; k++) metalClick(d, rng.range(0.02, 0.2), rng, 0.15, rng.range(2000, 4000))
  }
  return finalize(d, heavy > 1 ? 0.95 : 0.8)
}

function jumpGear(rng: Rng): Float32Array {
  const d = buf(0.3)
  cloth(d, 0, 0.22, 0.9, rng, 450, 1500)
  for (let k = 0; k < 2; k++) metalClick(d, rng.range(0.02, 0.15), rng, 0.15, rng.range(2200, 3800))
  return finalize(d, 0.55)
}

// ─── Explosions ─────────────────────────────────────────────────────────────

function explosionNear(rng: Rng): Float32Array {
  const len = 5.2
  const d = buf(len)
  blastPulse(d, 2.4, 0.0011)
  noiseBurst(d, 0, 0.012, 0.0025, 2.0, rng, [hp(700)], 0.00003)
  noiseBurst(d, 0, 0.14, 0.032, 2.2, rng, [bp(1300, 0.5), hp(300)], 0.00008)
  noiseBurst(d, 0, 1.0, 0.28, 3.0, rng, [lp(1500, 0.7), lp(1000)])
  noiseBurst(d, 0.04, 0.8, 0.16, 1.7, rng, [bp(500, 0.8)])
  pitchSine(d, 0, 2.6, 96, 24, 0.5, 0.85, 1.0, 0.002, 0.2)
  noiseBurst(d, 0, 3.2, 0.95, 6.0, rng, [lp(100, 0.7), lp(90)])
  let m = 0
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]!))
  for (let i = 0; i < d.length; i++) d[i]! /= m
  saturate(d, 1.7)
  // debris rain
  const dbg = new Float32Array(d.length)
  for (let k = 0; k < 90; k++) {
    const t = 0.3 + -Math.log(1 - rng.next() * 0.97) * 0.85
    if (t > len - 0.3) continue
    const g = rng.range(0.08, 0.35) * Math.exp(-t * 0.35)
    if (k % 4 === 0) {
      noiseBurst(dbg, t, 0.06, 0.016, g * 3, rng, [bp(rng.range(500, 1100), 1.4)])
      pitchSine(dbg, t, 0.06, rng.range(200, 320), 110, 0.012, 0.02, g * 1.2)
    } else if (k % 7 === 0) {
      ring(dbg, t, [rng.range(1500, 3500)], [0.06], g * 0.6)
    } else {
      noiseBurst(dbg, t, 0.01, 0.002, g * 1.4, rng, [hp(rng.range(1800, 4500))])
    }
  }
  mixInto(d, dbg, 1)
  // outdoor echo off the dunes
  const head = d.subarray(0, samples(1.5))
  for (const [dly, g] of [[0.2, 0.42], [0.47, 0.3], [0.92, 0.2], [1.5, 0.11]] as const) addDelayed(d, head, dly, g, 700, 2)
  noiseBurst(d, 0.25, 3.6, 1.3, 1.4, rng, [lp(450), lp(400)])
  return finalize(d, 1.0, 80)
}

function explosionFar(rng: Rng): Float32Array {
  const len = 6.2
  const d = buf(len)
  noiseBurst(d, 0, 1.2, 0.35, 3.4, rng, [lp(420, 0.7), lp(380)])
  pitchSine(d, 0, 3.4, 70, 26, 0.5, 1.0, 1.0, 0.004, 0.15)
  noiseBurst(d, 0, 3.6, 1.0, 6.0, rng, [lp(90, 0.7), lp(90)])
  const crack = buf(0.2)
  noiseBurst(crack, 0, 0.12, 0.03, 2.0, rng, [bp(1200, 0.6), hp(400)])
  lowpassInPlace(crack, 2800)
  mixInto(d, crack, 0.35, 0.09)
  const head = d.subarray(0, samples(2))
  for (const [dly, g] of [[0.45, 0.45], [1.0, 0.32], [1.7, 0.2], [2.5, 0.1]] as const) addDelayed(d, head, dly, g, 450, 2)
  saturate(d, 1.3)
  return finalize(d, 0.95, 120)
}

// ─── Radio / killstreaks / match ────────────────────────────────────────────

function radioFilter(a: Float32Array, drive = 2) {
  highpassInPlace(a, 450)
  lowpassInPlace(a, 3200)
  saturate(a, drive)
}

function squelch(d: Float32Array, t0: number, rng: Rng, level = 0.5) {
  noiseBurst(d, t0, 0.07, 0.03, 2.2 * level, rng, [bp(2200, 0.7)], 0.002)
}

function squareTone(d: Float32Array, t0: number, dur: number, f: number, g: number, f1?: number) {
  tone(d, t0, dur, f, g, dur * 2, 0.004, [0, 0.33, 0, 0.2, 0, 0.14], f1)
}

function streakEarned(rng: Rng): Float32Array {
  const d = buf(0.75)
  squelch(d, 0, rng, 0.6)
  squareTone(d, 0.05, 0.075, 1100, 0.5)
  squareTone(d, 0.15, 0.075, 1480, 0.5)
  squareTone(d, 0.25, 0.14, 1960, 0.55)
  squelch(d, 0.45, rng, 0.35)
  radioFilter(d, 1.6)
  return finalize(d, 0.7)
}

function streakUsed(rng: Rng): Float32Array {
  const d = buf(1.05)
  squelch(d, 0, rng, 0.6)
  squareTone(d, 0.06, 0.45, 450, 0.5, 1900)
  squareTone(d, 0.6, 0.07, 1500, 0.5)
  squareTone(d, 0.72, 0.1, 1500, 0.5)
  noiseBurst(d, 0.06, 0.45, 0.2, 0.35, rng, [bp(1800, 0.5)])
  squelch(d, 0.88, rng, 0.35)
  radioFilter(d, 1.6)
  return finalize(d, 0.7)
}

function uavOn(): Float32Array {
  const d = buf(1.6)
  tone(d, 0, 0.9, 520, 0.4, 0.5, 0.01, [0.3, 0.1], 2500)
  for (const t of [0.1, 0.55, 1.0]) {
    tone(d, t, 0.5, 1320, 0.35 * (t > 0.5 ? 0.6 : 1), 0.18, 0.003, [0.2, 0.05])
    ring(d, t, [2640, 3950], [0.1, 0.06], 0.1)
  }
  return finalize(d, 0.7, 40)
}

function uavOff(): Float32Array {
  const d = buf(1.0)
  tone(d, 0, 0.7, 2200, 0.4, 0.4, 0.01, [0.25], 420)
  tone(d, 0.05, 0.5, 880, 0.3, 0.25, 0.004, [0.2])
  return finalize(d, 0.6, 40)
}

function radioAnnounce(rng: Rng): Float32Array {
  const d = buf(0.5)
  squelch(d, 0, rng, 0.7)
  squareTone(d, 0.08, 0.05, 1700, 0.45)
  squelch(d, 0.3, rng, 0.4)
  radioFilter(d, 1.8)
  return finalize(d, 0.6)
}

// ─── Player state ───────────────────────────────────────────────────────────

function heartbeat(rng: Rng): Float32Array {
  const d = buf(0.9)
  for (const [t, a, f0] of [[0, 1, 78], [0.2, 0.75, 88]] as const) {
    pitchSine(d, t, 0.3, f0, 42, 0.04, 0.07, a)
    noiseBurst(d, t, 0.09, 0.022, 2.4 * a, rng, [lp(230), lp(190)])
  }
  return finalize(d, 0.95, 60)
}

function breath(rng: Rng): Float32Array {
  const d = buf(3.0)
  sweepNoise(d, 0.0, 1.15, 2.2, rng, 600, 1500, 0.6, riseFall(0.55))
  sweepNoise(d, 0.0, 1.15, 0.8, rng, 2200, 3200, 0.8, riseFall(0.5))
  sweepNoise(d, 1.55, 1.35, 1.8, rng, 1300, 520, 0.6, riseFall(0.3))
  lowpassInPlace(d, 3600)
  return finalize(d, 0.8, 20)
}

// ─── Ambience ───────────────────────────────────────────────────────────────

function windLoop(seed: number): [Float32Array, Float32Array] {
  const N = samples(16)
  const X = samples(1.6)
  const chans: Float32Array[] = []
  for (let ch = 0; ch < 2; ch++) {
    const rng = new Rng(seed + ch * 1013)
    const raw = new Float32Array(N + X)
    const low = lp(380)
    const mid = new Biquad()
    mid.lowpass(900)
    const whistle = bp(1250 + ch * 90, 14)
    const warm = lp(180)
    for (let i = 0; i < raw.length; i++) {
      const t = i / N
      const n = rng.signed()
      const gust = 0.5 + 0.5 * fsin(TWO_PI * (2 * t + 0.13 * ch)) * 0.6 + 0.5 * 0.4 * fsin(TWO_PI * (5 * t + 0.4))
      if ((i & 63) === 0) {
        mid.lowpass(500 + 700 * gust)
        low.lowpass(220 + 220 * gust)
      }
      const body = mid.process(n) * (0.35 + 0.65 * gust) * 1.8
      const rumble = low.process(n) * 3.2 * (0.5 + 0.5 * gust)
      const wh = whistle.process(n) * 7 * Math.pow(Math.max(0, gust - 0.35), 2) * (0.6 + 0.4 * fsin(TWO_PI * 3 * t))
      raw[i] = body + rumble + wh + warm.process(n) * 2.5
    }
    chans.push(makeLoop(raw, N))
  }
  return finalizeStereo(chans[0]!, chans[1]!, 0.85, 0)
}

function creak(rng: Rng): Float32Array {
  const d = buf(1.5)
  const n = d.length
  const bandA = bp(800, 9)
  const bandB = bp(1700, 7)
  let f = rng.range(110, 220)
  let target = f
  let ph = 0
  for (let i = 0; i < n; i++) {
    const u = i / n
    if ((i & 1023) === 0) target = rng.range(90, 280)
    f += (target - f) * 0.0006
    ph += f / SR
    const sawv = 2 * (ph - Math.floor(ph)) - 1
    if ((i & 31) === 0) {
      bandA.bandpass(550 + 700 * u + 120 * fsin(u * 40), 9)
      bandB.bandpass(1300 + 900 * fsin(u * 11), 7)
    }
    const stick = Math.max(0, fsin(u * 60 + rng.next() * 0.2))
    const x = sawv * 0.7 + rng.signed() * 0.4
    d[i] = (bandA.process(x) * 1.6 + bandB.process(x) * 1.0) * Math.pow(fsin(Math.PI * u), 1.3) * (0.4 + 0.6 * stick)
  }
  return finalize(d, 0.6, 60)
}

function clank(rng: Rng): Float32Array {
  const d = buf(1.0)
  const f = rng.range(380, 640)
  noiseBurst(d, 0, 0.01, 0.002, 1.0, rng, [hp(1200)])
  ring(d, 0, [f, f * 2.32, f * 3.7, f * 5.2], [0.28, 0.16, 0.1, 0.06], 0.5, [1, 0.7, 0.5, 0.3])
  pitchSine(d, 0, 0.2, 180, 90, 0.03, 0.06, 0.4)
  lowpassInPlace(d, 5200)
  return finalize(d, 0.7, 60)
}

// ─── UI ─────────────────────────────────────────────────────────────────────

function uiHover(rng: Rng): Float32Array {
  const d = buf(0.08)
  tone(d, 0, 0.06, 2400 * rng.jit(0.02), 0.5, 0.012, 0.0008, [0.2])
  noiseBurst(d, 0, 0.004, 0.0012, 0.5, rng, [hp(5000)])
  return finalize(d, 0.32, 8)
}
function uiSelect(rng: Rng): Float32Array {
  const d = buf(0.28)
  noiseBurst(d, 0, 0.005, 0.0015, 0.7, rng, [hp(3500)])
  tone(d, 0, 0.1, 880, 0.55, 0.05, 0.001, [0.3, 0.15])
  tone(d, 0.055, 0.2, 1320, 0.55, 0.07, 0.001, [0.3, 0.15])
  ring(d, 0.055, [3100, 4700], [0.05, 0.03], 0.15)
  return finalize(d, 0.5, 25)
}
function uiBack(rng: Rng): Float32Array {
  const d = buf(0.24)
  noiseBurst(d, 0, 0.005, 0.0015, 0.6, rng, [hp(3000)])
  tone(d, 0, 0.09, 1050, 0.5, 0.05, 0.001, [0.25])
  tone(d, 0.05, 0.17, 700, 0.5, 0.07, 0.001, [0.25])
  return finalize(d, 0.45, 25)
}
function uiCountdown(): Float32Array {
  const d = buf(0.28)
  squareTone(d, 0, 0.2, 880, 0.55)
  ring(d, 0, [1760, 2640], [0.06, 0.04], 0.15)
  return finalize(d, 0.55, 30)
}
function uiCountdownFinal(): Float32Array {
  const d = buf(0.7)
  squareTone(d, 0, 0.5, 1320, 0.55)
  tone(d, 0, 0.5, 660, 0.3, 0.3, 0.003)
  ring(d, 0, [2640, 3960], [0.18, 0.1], 0.2)
  return finalize(d, 0.65, 60)
}
function uiError(rng: Rng): Float32Array {
  const d = buf(0.34)
  for (const t of [0, 0.15]) {
    tone(d, t, 0.11, 170, 0.8, 0.2, 0.002, [0.5, 0.35, 0.25])
    noiseBurst(d, t, 0.01, 0.003, 0.2, rng, [lp(1500)])
  }
  lowpassInPlace(d, 1100)
  return finalize(d, 0.5, 25)
}
function uiRankup(rng: Rng): Float32Array {
  const d = buf(1.3)
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((f, k) => {
    tone(d, k * 0.09, 0.9, f, 0.4, 0.25, 0.002, [0.35, 0.15])
    ring(d, k * 0.09, [f * 2.01, f * 3.97], [0.3, 0.15], 0.1)
  })
  noiseBurst(d, 0, 0.2, 0.06, 0.2, rng, [hp(6000)])
  return finalize(d, 0.6, 80)
}

// ─── Reverb impulse responses ───────────────────────────────────────────────

/** Short desert slap-back: a couple of hard reflections, thin diffuse tail. */
export function makeOutdoorIR(rate: number): [Float32Array, Float32Array] {
  const len = Math.round(rate * 1.5)
  const out: Float32Array[] = []
  for (let ch = 0; ch < 2; ch++) {
    const rng = new Rng(9001 + ch * 77)
    const ir = new Float32Array(len)
    const taps: [number, number][] = [[0.019, 0.5], [0.034, 0.4], [0.052, 0.3], [0.081, 0.27], [0.122, 0.7], [0.158, 0.3], [0.214, 0.38], [0.268, 0.25], [0.41, 0.15]]
    for (const [t0, g] of taps) {
      const s = Math.round((t0 + (ch ? 0.004 : -0.002) + rng.signed() * 0.003) * rate)
      for (let k = 0; k < 90; k++) {
        const j = s + k
        if (j < len) ir[j]! += (rng.signed() * g * Math.exp(-k / 22)) * (rng.next() < 0.5 ? 1 : -1)
      }
    }
    const f = new Biquad()
    const dec = Math.exp(-1 / (0.4 * rate))
    let env = 1
    for (let i = 0; i < len; i++) {
      if ((i & 127) === 0) f.lowpass(Math.max(700, 5200 * Math.exp(-i / rate / 0.7)))
      const t = i / rate
      if (t > 0.03) ir[i]! += f.process(rng.signed()) * env * 0.5 * Math.min(1, (t - 0.03) / 0.05)
      else f.process(0)
      env *= dec
    }
    out.push(ir)
  }
  return [out[0]!, out[1]!]
}

/** Larger cinematic hall for the score. */
export function makeHallIR(rate: number): [Float32Array, Float32Array] {
  const len = Math.round(rate * 3.6)
  const out: Float32Array[] = []
  for (let ch = 0; ch < 2; ch++) {
    const rng = new Rng(4242 + ch * 313)
    const ir = new Float32Array(len)
    const f = new Biquad()
    const dec = Math.exp(-1 / (0.5 * rate))
    let env = 1
    const pre = Math.round(0.028 * rate)
    for (let i = 0; i < len; i++) {
      if ((i & 127) === 0) f.lowpass(Math.max(500, 6000 * Math.exp(-i / rate / 0.9)))
      const x = f.process(rng.signed())
      if (i >= pre) ir[i] = x * env * Math.min(1, (i - pre) / (0.06 * rate))
      env *= dec
    }
    out.push(ir)
  }
  return [out[0]!, out[1]!]
}

// ─── Job table ──────────────────────────────────────────────────────────────

export function buildCoreJobs(): Job[] {
  const jobs: Job[] = []
  const add = (key: string, count: number, prio: number, make: (i: number, rng: Rng) => Rendered, rate?: number) =>
    jobs.push({ key, count, prio, make, rate })

  // UI (prio 0): tiny, ready instantly.
  add('ui.hover', 2, 0, (_i, r) => uiHover(r))
  add('ui.select', 1, 0, (_i, r) => uiSelect(r))
  add('ui.back', 1, 0, (_i, r) => uiBack(r))
  add('ui.countdown', 1, 0, () => uiCountdown())
  add('ui.countdownFinal', 1, 0, () => uiCountdownFinal())
  add('ui.error', 1, 0, (_i, r) => uiError(r))
  add('ui.rankup', 1, 0, (_i, r) => uiRankup(r))

  // Guns (prio 2)
  for (const id of GUN_IDS) {
    add(`gun.${id}.own`, 3, 2, (_i, r) => gunOwn(id, r))
    add(`gun.${id}.far`, 3, 2, (_i, r) => gunFar(id, r))
  }
  add('gun.supp', 3, 2, (_i, r) => gunSuppressed(r))
  add('gun.dry', 3, 2, (_i, r) => dryClick(r))
  add('hit.tick', 3, 2, (_i, r) => hitTick('tick', r))
  add('hit.head', 3, 2, (_i, r) => hitTick('head', r))
  add('hit.kill', 3, 2, (_i, r) => hitTick('kill', r))

  // Bullets + movement (prio 3)
  for (const k of ['sand', 'concrete', 'metal', 'ricochet', 'wood', 'glass', 'flesh'] as const) add(`imp.${k}`, k === 'ricochet' ? 3 : 4, 3, (_i, r) => impact(k, r))
  add('whizz', 4, 3, (_i, r) => whizz(r))
  for (const k of ['sand', 'concrete', 'metal', 'grate', 'wood'] as const) add(`step.${k}`, 5, 3, (_i, r) => step(k, r, 1))
  for (const k of ['sand', 'concrete', 'metal', 'wood'] as const) add(`land.${k}`, 3, 3, (_i, r) => step(k, r, 2))
  add('jump', 3, 3, (_i, r) => jumpGear(r))
  add('hurt', 3, 3, (_i, r) => playerHurt(false, r))
  add('hurt.heavy', 3, 3, (_i, r) => playerHurt(true, r))
  add('fall', 3, 3, (_i, r) => bodyFall(r))

  // Foley (prio 4)
  add('fol.magout', 3, 4, (_i, r) => magOut(r))
  add('fol.magin', 3, 4, (_i, r) => magIn(r))
  add('fol.boltback', 3, 4, (_i, r) => boltBack(r))
  add('fol.boltfwd', 3, 4, (_i, r) => boltFwd(r))
  add('fol.pumpback', 3, 4, (_i, r) => pumpBack(r))
  add('fol.pumpfwd', 3, 4, (_i, r) => pumpFwd(r))
  add('fol.shell', 3, 4, (_i, r) => shellIn(r))
  add('fol.switch', 3, 4, (_i, r) => weaponSwitch(r))
  add('fol.adson', 3, 4, (_i, r) => {
    const d = buf(0.16)
    cloth(d, 0, 0.14, 0.9, r, 500, 1300)
    return finalize(d, 0.45, 20)
  })
  add('fol.adsoff', 3, 4, (_i, r) => {
    const d = buf(0.14)
    cloth(d, 0, 0.12, 0.7, r, 1300, 500)
    return finalize(d, 0.32, 20)
  })
  add('knife.swish', 3, 4, (_i, r) => knifeSwish(r))
  add('knife.hit', 3, 4, (_i, r) => knifeHit(r))
  add('gren.throw', 3, 4, (_i, r) => grenadeThrow(r))
  for (const k of ['metal', 'concrete', 'sand', 'wood'] as const) add(`gren.bounce.${k}`, 3, 4, (_i, r) => grenadeBounce(k, r))

  // Big stuff (prio 5)
  add('exp.near', 3, 5, (_i, r) => explosionNear(r))
  add('exp.far', 3, 5, (_i, r) => explosionFar(r))
  add('ks.earned', 1, 5, (_i, r) => streakEarned(r))
  add('ks.used', 1, 5, (_i, r) => streakUsed(r))
  add('uav.on', 1, 5, () => uavOn())
  add('uav.off', 1, 5, () => uavOff())
  add('radio', 3, 5, (_i, r) => radioAnnounce(r))
  add('heart', 2, 5, (_i, r) => heartbeat(r))
  add('breath', 2, 5, (_i, r) => breath(r))
  add('creak', 3, 5, (_i, r) => creak(r))
  add('clank', 3, 5, (_i, r) => clank(r))
  add('wind', 1, 5, () => windLoop(7), 22050)

  return jobs
}
