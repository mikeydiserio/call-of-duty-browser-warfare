/**
 * Procedural score: a looping cinematic menu cue (dark drones, minor pads, sparse
 * taiko/pulse, glassy bells) and the match stingers. Rendered offline at a low
 * sample rate — the content is dark, so there is nothing above ~10 kHz worth paying for.
 */
import {
  Biquad,
  bp,
  buf,
  finalizeStereo,
  hp,
  lp,
  lowpassInPlace,
  midiToHz,
  noiseBurst,
  pitchSine,
  ring,
  Rng,
  samples,
  SR,
  sweepNoise,
  tone,
  TWO_PI,
  fsin,
  riseFall,
} from './dsp'
import type { Job, Rendered } from './synth'

interface PadOpts {
  notes: number[]
  /** Held length (s) before the release starts. */
  dur: number
  release: number
  attack: number
  cut0: number
  cut1: number
  level: number
  /** Detune in cents between L and R voices. */
  detune?: number
  vibrato?: number
  q?: number
}

/** Detuned-saw pad (also used as "brass" with a faster swell). Returns stereo of length dur+release. */
function synthPad(o: PadOpts, rng: Rng): [Float32Array, Float32Array] {
  const n = samples(o.dur + o.release)
  const out: Float32Array[] = [new Float32Array(n), new Float32Array(n)]
  const det = (o.detune ?? 7) / 1200
  for (let ch = 0; ch < 2; ch++) {
    const dst = out[ch]!
    const inc: number[] = []
    const ph: number[] = []
    for (const m of o.notes) {
      const f = midiToHz(m) * Math.pow(2, (ch === 0 ? -1 : 1) * det * (0.6 + 0.8 * rng.next()))
      inc.push(f / SR)
      ph.push(rng.next())
    }
    const f1 = new Biquad()
    const f2 = new Biquad()
    const vibInc = (o.vibrato ?? 0) > 0 ? 5.2 / SR : 0
    let vp = rng.next()
    for (let i = 0; i < n; i++) {
      const t = i / SR
      if ((i & 63) === 0) {
        const u = Math.min(1, t / o.dur)
        const c = o.cut0 * Math.pow(o.cut1 / o.cut0, u * u * (3 - 2 * u))
        f1.lowpass(c, o.q ?? 0.9)
        f2.lowpass(c * 1.3, 0.6)
      }
      let a = Math.min(1, t / o.attack)
      a = a * a * (3 - 2 * a)
      const r = t > o.dur ? Math.max(0, 1 - (t - o.dur) / o.release) : 1
      const vib = vibInc ? 1 + (o.vibrato ?? 0) * fsin(TWO_PI * vp) : 1
      vp += vibInc
      let s = 0
      for (let k = 0; k < inc.length; k++) {
        let p = ph[k]! + inc[k]! * vib
        p -= Math.floor(p)
        ph[k] = p
        s += 2 * p - 1
      }
      dst[i] = f2.process(f1.process(s)) * a * r * r * o.level
    }
  }
  return [out[0]!, out[1]!]
}

function addStereo(dl: Float32Array, dr: Float32Array, src: [Float32Array, Float32Array], t0: number, wrap: boolean) {
  const off = samples(t0)
  const n = src[0].length
  for (let i = 0; i < n; i++) {
    let j = off + i
    if (j >= dl.length) {
      if (!wrap) break
      j %= dl.length
    }
    dl[j]! += src[0][i]!
    dr[j]! += src[1][i]!
  }
}

function addMono(dl: Float32Array, dr: Float32Array, src: Float32Array, t0: number, wrap: boolean, panL = 1, panR = 1) {
  const off = samples(t0)
  for (let i = 0; i < src.length; i++) {
    let j = off + i
    if (j >= dl.length) {
      if (!wrap) break
      j %= dl.length
    }
    dl[j]! += src[i]! * panL
    dr[j]! += src[i]! * panR
  }
}

/** Taiko-style low drum hit. */
function boom(rng: Rng, level = 1, len = 3.2): Float32Array {
  const d = buf(len)
  pitchSine(d, 0, len, 98 * rng.jit(0.03), 41, 0.09, 0.62, 1.0 * level, 0.002, 0.1)
  noiseBurst(d, 0, 0.5, 0.14, 2.6 * level, rng, [lp(260), lp(220)])
  noiseBurst(d, 0, 0.06, 0.015, 0.9 * level, rng, [bp(900, 0.9)], 0.0008)
  return d
}

function snareRoll(rng: Rng, level: number): Float32Array {
  const d = buf(0.45)
  noiseBurst(d, 0, 0.3, 0.07, 1.6 * level, rng, [bp(1900, 0.7), hp(600)], 0.001)
  pitchSine(d, 0, 0.2, 210, 130, 0.02, 0.05, 0.4 * level)
  return d
}

function bell(f: number, level: number, tail = 3.4): Float32Array {
  const d = buf(tail)
  tone(d, 0, tail, f, 0.5 * level, 1.4, 0.003, [0.08, 0.04])
  ring(d, 0, [f * 2.01, f * 2.76, f * 4.07], [1.1, 0.7, 0.4], 0.18 * level)
  return d
}

function pluck(f: number, level: number, rng: Rng): Float32Array {
  const d = buf(0.8)
  const filt = lp(f * 4.2, 1.2)
  let p1 = rng.next()
  let p2 = rng.next()
  const dec = Math.exp(-1 / (0.2 * SR))
  let env = 1
  for (let i = 0; i < d.length; i++) {
    p1 += (f * 1.003) / SR
    p2 += (f * 0.997) / SR
    p1 -= Math.floor(p1)
    p2 -= Math.floor(p2)
    d[i] = filt.process((2 * p1 - 1 + (2 * p2 - 1)) * 0.5) * env * level * Math.min(1, i / 40)
    env *= dec
  }
  return d
}

const MENU_LEN = 40

/** Number of menu stems; each renders on its own worker and they loop sample-locked. */
export const MENU_STEMS = 3
/** Fixed mix gain (calibrated so the summed stems peak at ~0.82, like a normalised mix). */
const MENU_GAIN = 0.413

/** One stem of the 40 s menu cue: 0 drones+bass, 1 pads, 2 bells/percussion/pulse/texture. */
function menuLoop(rng: Rng, stem: number): [Float32Array, Float32Array] {
  const N = samples(MENU_LEN)
  const L = new Float32Array(N)
  const R = new Float32Array(N)
  if (stem === 0) {
    menuDrones(L, R, N)
    menuHarmony(L, R, rng, 'bass')
  } else if (stem === 1) menuHarmony(L, R, rng, 'pads')
  else {
    menuHarmony(L, R, rng, 'bells')
    menuRhythm(L, R, N, rng)
  }
  dcBlockStereo(L, R)
  for (let i = 0; i < N; i++) {
    L[i]! *= MENU_GAIN
    R[i]! *= MENU_GAIN
  }
  return [L, R]
}

/** Linear DC removal (stems sum exactly like a mix filtered as a whole). */
function dcBlockStereo(L: Float32Array, R: Float32Array) {
  for (const a of [L, R]) {
    let px = 0
    let py = 0
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!
      py = x - px + 0.9975 * py
      px = x
      a[i] = py
    }
  }
}

function menuDrones(L: Float32Array, R: Float32Array, N: number) {
  // 1. Sub drone + dark saw drone, both periodic over the loop so the seam is invisible.
  const subF = 1308 / MENU_LEN // 32.7 Hz (C1) — integer cycles per loop
  const sawF = 2616 / MENU_LEN // C2
  const droneLP = [new Biquad(), new Biquad()]
  let sp = 0
  const ph = [0.1, 0.6]
  for (let i = 0; i < N; i++) {
    const t = i / N
    sp += (TWO_PI * subF) / SR
    const swell = 0.7 + 0.3 * fsin(TWO_PI * 2 * t - 1.2)
    const sub = (fsin(sp) + 0.35 * fsin(sp * 2 + 0.7)) * swell * 0.34
    if ((i & 127) === 0) {
      const c = 110 + 90 * (0.5 + 0.5 * fsin(TWO_PI * 4 * t))
      droneLP[0]!.lowpass(c, 1.1)
      droneLP[1]!.lowpass(c * 1.07, 1.1)
    }
    for (let ch = 0; ch < 2; ch++) {
      ph[ch]! += (sawF * (ch ? 1.002 : 0.998)) / SR
      ph[ch]! -= Math.floor(ph[ch]!)
      const s = droneLP[ch]!.process(2 * ph[ch]! - 1) * 0.55 * swell
      ;(ch ? R : L)[i]! += s + sub
    }
  }
}

function menuHarmony(L: Float32Array, R: Float32Array, rng: Rng, part: 'pads' | 'bass' | 'bells') {
  // 2. Chord pads, bass, bells.
  const chords: { t: number; bass: number; pad: number[] }[] = [
    { t: 0, bass: 36, pad: [48, 55, 60, 63] }, // Cm
    { t: 10, bass: 32, pad: [51, 56, 60, 63] }, // Ab
    { t: 20, bass: 29, pad: [48, 53, 56, 60] }, // Fm
    { t: 30, bass: 31, pad: [50, 55, 59, 62] }, // G
  ]
  chords.forEach((c, k) => {
    if (part === 'bells') return
    if (part === 'pads') {
      const pad = synthPad({ notes: c.pad, dur: 10.5, release: 4, attack: 3.2, cut0: 380, cut1: 1500 + k * 120, level: 0.055, detune: 9, vibrato: 0.0015 }, rng)
      addStereo(L, R, pad, c.t - 0.4 < 0 ? c.t + MENU_LEN - 0.4 : c.t - 0.4, true)
      return
    }
    const b = buf(14)
    tone(b, 0, 12.5, midiToHz(c.bass), 0.42, 9, 1.0, [0.28, 0.12])
    lowpassInPlace(b, 420)
    for (let i = 0; i < b.length; i++) {
      const tt = i / SR
      b[i]! *= tt > 10.5 ? Math.max(0, 1 - (tt - 10.5) / 2) : 1
    }
    addMono(L, R, b, c.t, true, 0.9, 0.9)
  })
  if (part !== 'bells') return
  const bells: [number, number, number][] = [
    [2.5, 79, 0.55], [6.25, 75, 0.45], [8.75, 72, 0.5],
    [12.5, 75, 0.5], [16.25, 72, 0.45], [18.75, 68, 0.5],
    [22.5, 72, 0.5], [26.25, 68, 0.45], [28.75, 65, 0.5],
    [32.5, 74, 0.5], [36.25, 71, 0.45], [38.75, 67, 0.55],
  ]
  for (const [t, m, lv] of bells) {
    const b = bell(midiToHz(m), lv * 0.55)
    const pan = 0.5 + 0.5 * fsin(t * 1.7)
    addMono(L, R, b, t, true, 0.55 + 0.45 * (1 - pan), 0.55 + 0.45 * pan)
  }
}

function menuRhythm(L: Float32Array, R: Float32Array, N: number, rng: Rng) {
  // 3. Percussion — taiko on bar downbeats, building in the second half.
  const hitAt = (t: number, lv: number) => addMono(L, R, boom(rng, lv), t, true, 0.95, 0.95)
  for (let bar = 0; bar < 8; bar++) {
    const t = bar * 5
    hitAt(t, bar < 4 ? 0.62 : 0.85)
    if (bar >= 4) hitAt(t + 2.5, 0.42)
    if (bar === 5 || bar === 7) hitAt(t + 3.75, 0.35)
  }
  // closing roll into the loop point
  ;[36.25, 37.5, 38.125, 38.75, 39.2, 39.55].forEach((t, k) => addMono(L, R, snareRoll(rng, 0.14 + k * 0.05), t, true, 0.8, 0.8))

  // 4. Low pulse + hats in the second half.
  for (let bar = 4; bar < 8; bar++) {
    const rootHz = midiToHz(bar < 6 ? (bar === 4 || bar === 5 ? 24 : 17) : 19)
    for (let k = 0; k < 8; k++) {
      const accent = k % 2 === 0 ? 1 : 0.55
      addMono(L, R, pluck(rootHz * 2, 0.34 * accent, rng), bar * 5 + k * 0.625, true, 0.85, 0.85)
    }
  }
  for (let bar = 6; bar < 8; bar++) {
    for (let k = 0; k < 8; k++) {
      const h = buf(0.08)
      noiseBurst(h, 0, 0.06, 0.012, 0.9, rng, [hp(5000)], 0.0005)
      const side = k % 2 === 0
      addMono(L, R, h, bar * 5 + k * 0.625 + 0.3125, true, side ? 0.5 : 0.25, side ? 0.25 : 0.5)
    }
  }

  // 5. Tension riser through the last two bars.
  const riser = buf(10)
  sweepNoise(riser, 0, 9.8, 0.2, rng, 260, 3600, 0.7, riseFall(0.92))
  addMono(L, R, riser, 30, true, 0.7, 0.7)
  const wash = buf(40)
  noiseBurst(wash, 0, 40, 100, 0.35, rng, [bp(520, 0.5), lp(900)], 0.5)
  for (let i = 0; i < N; i++) {
    const g = 0.5 + 0.5 * fsin(TWO_PI * (3 * i / N) + 0.9)
    L[i]! += wash[i]! * g * 0.2
    R[i]! += wash[(i + 5000) % N]! * g * 0.2
  }
}

// ─── Stingers ───────────────────────────────────────────────────────────────

/** Intro: low brass swell + accelerating drums, final hit lands at exactly 4.0 s (intro length). */
function introStinger(rng: Rng): [Float32Array, Float32Array] {
  const N = samples(6.4)
  const L = new Float32Array(N)
  const R = new Float32Array(N)
  const brass = synthPad({ notes: [36, 43, 48, 51, 55, 60], dur: 4.0, release: 1.8, attack: 3.1, cut0: 240, cut1: 2400, level: 0.075, detune: 12, vibrato: 0.004, q: 1.3 }, rng)
  addStereo(L, R, brass, 0, false)
  const drums: [number, number][] = [[0.0, 1.0], [1.4, 0.55], [2.2, 0.6], [2.8, 0.65], [3.2, 0.7], [3.5, 0.8], [3.75, 0.85]]
  drums.forEach(([t, lv]) => addMono(L, R, boom(rng, lv, 2.4), t, false, 0.95, 0.95))
  ;[1.0, 1.9, 2.55, 3.0, 3.35, 3.6, 3.8, 3.9].forEach((t, k) => addMono(L, R, snareRoll(rng, 0.25 + k * 0.08), t, false, 0.8, 0.8))
  // the downbeat: huge hit + cymbal wash + brass stab
  addMono(L, R, boom(rng, 1.5, 3.4), 4.0, false, 1, 1)
  const cym = buf(2.4)
  noiseBurst(cym, 0, 2.4, 0.7, 0.8, rng, [hp(4500, 0.6)], 0.002)
  addMono(L, R, cym, 4.0, false, 0.55, 0.55)
  const stab = synthPad({ notes: [36, 43, 48, 51, 55, 60, 63], dur: 0.5, release: 1.6, attack: 0.02, cut0: 1800, cut1: 900, level: 0.08, detune: 10, q: 1.1 }, rng)
  addStereo(L, R, stab, 4.0, false)
  return finalizeStereo(L, R, 0.9, 150)
}

function goBeep(rng: Rng): [Float32Array, Float32Array] {
  const d = buf(0.9)
  tone(d, 0, 0.35, 1480, 0.5, 0.18, 0.002, [0.3, 0.15])
  ring(d, 0, [2960, 4440], [0.2, 0.1], 0.12)
  pitchSine(d, 0, 0.7, 70, 38, 0.05, 0.3, 0.7)
  noiseBurst(d, 0, 0.5, 0.2, 0.2, rng, [hp(5000)], 0.001)
  const c = d.slice()
  return finalizeStereo(d, c, 0.75, 60)
}

function victoryStinger(rng: Rng): [Float32Array, Float32Array] {
  const N = samples(7.2)
  const L = new Float32Array(N)
  const R = new Float32Array(N)
  const pad = synthPad({ notes: [51, 58, 63, 67, 70, 77], dur: 3.6, release: 3.4, attack: 1.3, cut0: 600, cut1: 4800, level: 0.065, detune: 10, vibrato: 0.002, q: 0.8 }, rng)
  addStereo(L, R, pad, 0, false)
  const low = synthPad({ notes: [27, 39], dur: 3.6, release: 3.2, attack: 0.8, cut0: 300, cut1: 700, level: 0.1, detune: 4 }, rng)
  addStereo(L, R, low, 0, false)
  ;[75, 79, 82, 87, 91].forEach((m, k) => addMono(L, R, bell(midiToHz(m), 0.55, 3.2), 0.9 + k * 0.17, false, 0.6 + 0.08 * (k % 2), 0.6 + 0.08 * ((k + 1) % 2)))
  addMono(L, R, boom(rng, 0.9, 2.8), 0.0, false, 1, 1)
  addMono(L, R, boom(rng, 0.6, 2.4), 0.9, false, 1, 1)
  const cym = buf(3.0)
  noiseBurst(cym, 0, 3.0, 1.0, 0.7, rng, [hp(4000, 0.6)], 0.9)
  addMono(L, R, cym, 0.2, false, 0.5, 0.5)
  return finalizeStereo(L, R, 0.88, 200)
}

function defeatStinger(rng: Rng): [Float32Array, Float32Array] {
  const N = samples(7.4)
  const L = new Float32Array(N)
  const R = new Float32Array(N)
  // descending cluster drone: pitch slides down ~3 semitones
  for (let ch = 0; ch < 2; ch++) {
    const dst = ch ? R : L
    const ph = [0, 0.3, 0.6, 0.8]
    const inc = [24, 25, 30, 36].map((m, k) => (midiToHz(m) * (1 + (ch ? 0.003 : -0.003) * (k + 1))) / SR)
    const f1 = new Biquad()
    const f2 = new Biquad()
    let slide = 1
    for (let i = 0; i < N; i++) {
      const t = i / SR
      if ((i & 63) === 0) slide = Math.pow(2, (-3 * Math.min(1, t / 6)) / 12)
      if ((i & 63) === 0) {
        const c = 260 * Math.exp(-t / 3) + 80
        f1.lowpass(c, 1.4)
        f2.lowpass(c, 0.8)
      }
      let s = 0
      for (let k = 0; k < 4; k++) {
        ph[k]! += inc[k]! * slide
        ph[k]! -= Math.floor(ph[k]!)
        s += 2 * ph[k]! - 1
      }
      const a = Math.min(1, t / 0.15) * (t > 5.4 ? Math.max(0, 1 - (t - 5.4) / 2) : 1)
      dst[i]! += f2.process(f1.process(s)) * a * 0.17
    }
  }
  addMono(L, R, boom(rng, 1.2, 4.0), 0, false, 1, 1)
  // distant gong-ish inharmonic ring
  const g = buf(6)
  ring(g, 0, [139, 233, 361, 587, 811], [3.2, 2.4, 1.8, 1.2, 0.8], 0.22, [1, 0.8, 0.6, 0.4, 0.25])
  lowpassInPlace(g, 1800)
  addMono(L, R, g, 0.05, false, 0.9, 0.9)
  return finalizeStereo(L, R, 0.88, 250)
}

function drawStinger(rng: Rng): [Float32Array, Float32Array] {
  const N = samples(5.6)
  const L = new Float32Array(N)
  const R = new Float32Array(N)
  const pad = synthPad({ notes: [48, 55, 60, 67], dur: 3.2, release: 2.4, attack: 1.4, cut0: 400, cut1: 1500, level: 0.07, detune: 8 }, rng)
  addStereo(L, R, pad, 0, false)
  addMono(L, R, bell(midiToHz(79), 0.5, 3), 0.8, false, 0.8, 0.5)
  addMono(L, R, bell(midiToHz(72), 0.45, 3), 1.6, false, 0.5, 0.8)
  addMono(L, R, boom(rng, 0.7, 2.6), 0, false, 1, 1)
  return finalizeStereo(L, R, 0.8, 200)
}

export function buildMusicJobs(): Job[] {
  const jobs: Job[] = []
  const add = (key: string, prio: number, rate: number, make: (i: number, rng: Rng) => Rendered) => jobs.push({ key, count: 1, prio, rate, make })
  for (let k = 0; k < MENU_STEMS; k++) add(`mus.menu.${k}`, 1, 22050, (_i, r) => menuLoop(r, k))
  add('mus.intro', 5, 32000, (_i, r) => introStinger(r))
  add('mus.go', 5, 32000, (_i, r) => goBeep(r))
  add('mus.victory', 5, 32000, (_i, r) => victoryStinger(r))
  add('mus.defeat', 5, 32000, (_i, r) => defeatStinger(r))
  add('mus.draw', 5, 32000, (_i, r) => drawStinger(r))
  return jobs
}
