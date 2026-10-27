/**
 * Tiny offline DSP toolkit. Everything the game plays is synthesised from these
 * primitives into Float32Arrays at start-up — no audio files, no runtime allocation.
 * Generators are synchronous and non-reentrant, so a module-level sample rate is safe.
 */

export let SR = 44100
export const TWO_PI = Math.PI * 2

export function setSampleRate(sr: number) {
  SR = sr
}

// Interpolated sine table: ~4x cheaper than Math.sin in the hot synthesis loops, error < 3e-7.
const LUT_N = 4096
const LUT = new Float32Array(LUT_N + 1)
for (let i = 0; i <= LUT_N; i++) LUT[i] = Math.sin((i / LUT_N) * TWO_PI)
const LUT_K = LUT_N / TWO_PI

export function fsin(x: number): number {
  let p = x * LUT_K
  p -= Math.floor(p / LUT_N) * LUT_N
  const i = p | 0
  const a = LUT[i]!
  return a + (LUT[i + 1]! - a) * (p - i)
}

export const samples = (t: number) => Math.max(0, Math.round(t * SR))
export const buf = (seconds: number) => new Float32Array(samples(seconds))

/** Deterministic mulberry32 — variations are reproducible. */
export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = (seed >>> 0) || 1
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  signed(): number {
    return this.next() * 2 - 1
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next()
  }
  /** 1 ± amount multiplicative jitter. */
  jit(amount: number): number {
    return 1 + this.signed() * amount
  }
}

// ─── Filters ────────────────────────────────────────────────────────────────

export class Biquad {
  b0 = 1
  b1 = 0
  b2 = 0
  a1 = 0
  a2 = 0
  z1 = 0
  z2 = 0

  private prep(f: number, q: number) {
    const fc = Math.min(Math.max(f, 10), SR * 0.45)
    const w = (TWO_PI * fc) / SR
    return { c: Math.cos(w), al: Math.sin(w) / (2 * Math.max(0.05, q)) }
  }
  lowpass(f: number, q = 0.7071): this {
    const { c, al } = this.prep(f, q)
    const a0 = 1 + al
    this.b0 = (1 - c) / 2 / a0
    this.b1 = (1 - c) / a0
    this.b2 = this.b0
    this.a1 = (-2 * c) / a0
    this.a2 = (1 - al) / a0
    return this
  }
  highpass(f: number, q = 0.7071): this {
    const { c, al } = this.prep(f, q)
    const a0 = 1 + al
    this.b0 = (1 + c) / 2 / a0
    this.b1 = -(1 + c) / a0
    this.b2 = this.b0
    this.a1 = (-2 * c) / a0
    this.a2 = (1 - al) / a0
    return this
  }
  /** Constant 0 dB peak-gain band-pass. */
  bandpass(f: number, q = 1): this {
    const { c, al } = this.prep(f, q)
    const a0 = 1 + al
    this.b0 = al / a0
    this.b1 = 0
    this.b2 = -al / a0
    this.a1 = (-2 * c) / a0
    this.a2 = (1 - al) / a0
    return this
  }
  process(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

export const lp = (f: number, q = 0.7071) => new Biquad().lowpass(f, q)
export const hp = (f: number, q = 0.7071) => new Biquad().highpass(f, q)
export const bp = (f: number, q = 1) => new Biquad().bandpass(f, q)

/** In-place 2-pole low-pass, optionally cascaded. */
export function lowpassInPlace(a: Float32Array, fc: number, cascades = 1) {
  for (let k = 0; k < cascades; k++) {
    const f = lp(fc)
    for (let i = 0; i < a.length; i++) a[i] = f.process(a[i]!)
  }
}

export function highpassInPlace(a: Float32Array, fc: number) {
  const f = hp(fc)
  for (let i = 0; i < a.length; i++) a[i] = f.process(a[i]!)
}

// ─── Generators (all additive into dst at t0 seconds) ───────────────────────

/** Exponentially decaying filtered white-noise burst. */
export function noiseBurst(
  d: Float32Array,
  t0: number,
  dur: number,
  tau: number,
  gain: number,
  rng: Rng,
  filters: Biquad[] = [],
  attack = 0.0004,
) {
  const s0 = Math.max(0, samples(t0))
  const n = Math.min(samples(dur), d.length - s0)
  if (n <= 0) return
  const dec = Math.exp(-1 / (tau * SR))
  const att = Math.max(1, attack * SR)
  // short release so a burst cut off at `dur` never ends on a step (click)
  const rel = Math.max(1, Math.min(n >> 2, Math.round(0.006 * SR)))
  let env = 1
  const nf = filters.length
  for (let i = 0; i < n; i++) {
    let x = rng.signed()
    for (let k = 0; k < nf; k++) x = filters[k]!.process(x)
    const r = n - i < rel ? (n - i) / rel : 1
    d[s0 + i]! += x * env * (i < att ? i / att : 1) * r * gain
    env *= dec
  }
}

/** Band-passed noise whose centre sweeps f0 → f1 under an arbitrary envelope u∈[0,1]. */
export function sweepNoise(
  d: Float32Array,
  t0: number,
  dur: number,
  gain: number,
  rng: Rng,
  f0: number,
  f1: number,
  q: number,
  env: (u: number) => number = hump,
) {
  const s0 = Math.max(0, samples(t0))
  const n = Math.min(samples(dur), d.length - s0)
  if (n <= 0) return
  const f = new Biquad()
  for (let i = 0; i < n; i++) {
    const u = i / n
    if ((i & 31) === 0) f.bandpass(f0 * Math.pow(f1 / f0, u), q)
    d[s0 + i]! += f.process(rng.signed()) * env(u) * gain
  }
}

export const hump = (u: number) => fsin(Math.PI * u)
export const riseFall = (peak: number) => (u: number) => (u < peak ? Math.pow(u / peak, 1.5) : Math.pow(1 - (u - peak) / (1 - peak), 1.5))

/** Sine whose pitch decays f0 → f1 (kick / thump / boom). */
export function pitchSine(
  d: Float32Array,
  t0: number,
  dur: number,
  f0: number,
  f1: number,
  fTau: number,
  aTau: number,
  gain: number,
  attack = 0.001,
  harm = 0,
) {
  const s0 = Math.max(0, samples(t0))
  const n = Math.min(samples(dur), d.length - s0)
  if (n <= 0) return
  const fd = Math.exp(-1 / (fTau * SR))
  const ad = Math.exp(-1 / (aTau * SR))
  const att = Math.max(1, attack * SR)
  const rel = Math.max(1, Math.min(n >> 2, Math.round(0.012 * SR)))
  let fe = 1
  let ae = 1
  let ph = 0
  for (let i = 0; i < n; i++) {
    const f = f1 + (f0 - f1) * fe
    ph += (TWO_PI * f) / SR
    const s = fsin(ph) + harm * fsin(ph * 2)
    const r = n - i < rel ? (n - i) / rel : 1
    d[s0 + i]! += s * ae * (i < att ? i / att : 1) * r * gain
    fe *= fd
    ae *= ad
  }
}

/** Plain decaying sine; shape 'sq' adds odd harmonics for a digital timbre. */
export function tone(
  d: Float32Array,
  t0: number,
  dur: number,
  f: number,
  gain: number,
  aTau = 0.1,
  attack = 0.002,
  harmonics: number[] = [],
  f1?: number,
) {
  const s0 = Math.max(0, samples(t0))
  const n = Math.min(samples(dur), d.length - s0)
  if (n <= 0) return
  const ad = Math.exp(-1 / (aTau * SR))
  const att = Math.max(1, attack * SR)
  const rel = Math.min(n, Math.round(0.004 * SR))
  let ae = 1
  let ph = 0
  for (let i = 0; i < n; i++) {
    const fi = f1 === undefined ? f : f + (f1 - f) * (i / n)
    ph += (TWO_PI * fi) / SR
    let s = fsin(ph)
    for (let h = 0; h < harmonics.length; h++) s += harmonics[h]! * fsin(ph * (h + 2))
    const tail = i > n - rel ? (n - i) / rel : 1
    d[s0 + i]! += s * ae * (i < att ? i / att : 1) * tail * gain
    ae *= ad
  }
}

/** A set of damped inharmonic partials — struck metal / glass / casings. */
export function ring(
  d: Float32Array,
  t0: number,
  freqs: number[],
  taus: number[],
  gain: number,
  gains?: number[],
) {
  const s0 = Math.max(0, samples(t0))
  for (let k = 0; k < freqs.length; k++) {
    const tau = taus[k] ?? taus[taus.length - 1]!
    const n = Math.min(samples(tau * 6), d.length - s0)
    if (n <= 0) continue
    const dec = Math.exp(-1 / (tau * SR))
    const w = (TWO_PI * freqs[k]!) / SR
    const g = gain * (gains?.[k] ?? 1)
    // recursive sine oscillator: y[n] = 2cos(w)·y[n-1] − y[n-2]
    const c2 = 2 * Math.cos(w)
    let y1 = 0
    let y2 = -Math.sin(w)
    let env = 1
    for (let i = 0; i < n; i++) {
      const y = c2 * y1 - y2
      y2 = y1
      y1 = y
      d[s0 + i]! += y2 * env * g * (i < 8 ? i / 8 : 1)
      env *= dec
    }
  }
}

/** Fabric rustle: band-passed noise gated by a random smooth envelope. */
export function cloth(d: Float32Array, t0: number, dur: number, gain: number, rng: Rng, f0 = 500, f1 = 1700) {
  const s0 = Math.max(0, samples(t0))
  const n = Math.min(samples(dur), d.length - s0)
  if (n <= 0) return
  const band = new Biquad()
  const smooth = lp(rng.range(18, 35))
  const hi = hp(300)
  for (let i = 0; i < n; i++) {
    const u = i / n
    if ((i & 31) === 0) band.bandpass(f0 * Math.pow(f1 / f0, u), 0.7)
    let m = Math.abs(smooth.process(rng.signed())) * 7
    m = Math.min(1, m * m)
    d[s0 + i]! += hi.process(band.process(rng.signed())) * m * fsin(Math.PI * u) * gain
  }
}

/** Add `src` into `dst` at a delay, optionally low-passed (echo / reflection). */
export function addDelayed(dst: Float32Array, src: Float32Array, delay: number, gain: number, lpHz = 0, lpPasses = 1) {
  const off = samples(delay)
  const filters: Biquad[] = []
  if (lpHz > 0) for (let k = 0; k < lpPasses; k++) filters.push(lp(lpHz))
  const n = Math.min(src.length, dst.length - off)
  for (let i = 0; i < n; i++) {
    let x = src[i]!
    for (let k = 0; k < filters.length; k++) x = filters[k]!.process(x)
    dst[off + i]! += x * gain
  }
}

export function mixInto(dst: Float32Array, src: Float32Array, gain = 1, offsetSeconds = 0) {
  const off = samples(offsetSeconds)
  const n = Math.min(src.length, dst.length - off)
  for (let i = 0; i < n; i++) dst[off + i]! += src[i]! * gain
}

export function saturate(a: Float32Array, drive: number) {
  const norm = 1 / Math.tanh(drive)
  for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i]! * drive) * norm
}

/** Remove DC with a 1-pole high-pass, fade the edges and normalise to `peak`. */
export function finalize(a: Float32Array, peak = 0.9, fadeOutMs = 12, fadeInMs = 0.15): Float32Array {
  let px = 0
  let py = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    py = x - px + 0.9975 * py
    px = x
    a[i] = py
  }
  const fi = Math.max(1, Math.round((fadeInMs / 1000) * SR))
  for (let i = 0; i < fi && i < a.length; i++) a[i]! *= i / fi
  const fo = Math.min(a.length, Math.round((fadeOutMs / 1000) * SR))
  for (let i = 0; i < fo; i++) a[a.length - 1 - i]! *= i / fo
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!))
  if (m > 1e-6) {
    const g = peak / m
    for (let i = 0; i < a.length; i++) a[i]! *= g
  }
  return a
}

/** Normalise a stereo pair jointly (preserves balance), same edge treatment. */
export function finalizeStereo(l: Float32Array, r: Float32Array, peak = 0.9, fadeOutMs = 12): [Float32Array, Float32Array] {
  finalize(l, 1, fadeOutMs)
  finalize(r, 1, fadeOutMs)
  let m = 0
  for (let i = 0; i < l.length; i++) m = Math.max(m, Math.abs(l[i]!), Math.abs(r[i]!))
  if (m > 1e-6) {
    const g = peak / m
    for (let i = 0; i < l.length; i++) {
      l[i]! *= g
      r[i]! *= g
    }
  }
  return [l, r]
}

/** Seamless noise loop: blend the tail (rendered past N) into the head with equal power. */
export function makeLoop(raw: Float32Array, loopSamples: number): Float32Array {
  const out = new Float32Array(loopSamples)
  const x = raw.length - loopSamples
  for (let i = 0; i < loopSamples; i++) out[i] = raw[i]!
  for (let i = 0; i < x; i++) {
    const u = i / x
    out[i] = raw[i]! * Math.sqrt(u) + raw[loopSamples + i]! * Math.sqrt(1 - u)
  }
  return out
}

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/** Naive (bright, intentionally gritty) saw for synth pads/brass; phase in [0,1). */
export const saw = (phase: number) => 2 * phase - 1

/** djb2 — stable per-key seed so variations are identical on every thread. */
export function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h >>> 0
}
