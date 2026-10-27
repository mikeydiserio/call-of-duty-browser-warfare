/**
 * Fully procedural WebAudio engine (no audio files).
 *
 *   sources ─► voice gain ─► [air low-pass] ─► [HRTF panner | stereo pan] ─► bus
 *   weapons / sfx / ambience ─► muffle (damage, death, shellshock) ─┐
 *   reverb return ───────────────────────────────────────────────────┼► game duck (pause) ─┐
 *   inner (own heartbeat, breath, hitmarker, tinnitus) ──────────────┘                      ├► master ─► limiter ─► soft clip ─► out
 *   ui ──────────────────────────────────────────────────────────────────────────────────────┤
 *   music (+ hall reverb) ───────────────────────────────────────────────────────────────────┘
 *
 * All buffers are synthesised in time-sliced chunks (see synth.ts / music.ts) as
 * soon as the engine is constructed, so by the time a user gesture creates the
 * AudioContext the bank is usually ready.
 */
import { Quaternion, Vector3 } from 'three'
import type { Game } from '../core/game'
import type { Actor, Surface, WeaponId } from '../core/types'
import { WEAPONS } from '../weapons/defs'
import { Rng, setSampleRate } from './dsp'
import { buildMusicJobs } from './music'
import { buildCoreJobs, GUN_IDS, makeHallIR, makeOutdoorIR, type GunId, type Job, type Rendered } from './synth'

export type UiSound = 'hover' | 'select' | 'back' | 'countdown' | 'countdownFinal' | 'error' | 'rankup'

const MAX_VOICES = 48
const FAR_SHOT_DISTANCE = 35
const IMPACT_MAX_DISTANCE = 40
const STEP_MAX_DISTANCE = 22
const GEN_RATE = 44100

const _fwd = new Vector3()
const _up = new Vector3()
const _pos = new Vector3()
const _q = new Quaternion()

interface PlayOpts {
  bus: AudioNode
  gain?: number
  /** Base playback rate (before random pitch). */
  rate?: number
  /** Random pitch spread (fraction). Default 0.04. */
  pitch?: number
  pos?: Vector3
  ref?: number
  rolloff?: number
  prio?: number
  send?: number
  delay?: number
  /** Hard cap on audible length (s) — fades out. */
  dur?: number
  /** Apply distance low-pass (air absorption). */
  air?: boolean
  pan?: number
}

interface Voice {
  src: AudioBufferSourceNode
  nodes: AudioNode[]
  end: number
  score: number
  gain: GainNode
  dead: boolean
}

interface Graph {
  master: GainNode
  limiter: DynamicsCompressorNode
  analyser: AnalyserNode
  gameDuck: GainNode
  muffle: BiquadFilterNode
  weapons: GainNode
  sfx: GainNode
  amb: GainNode
  inner: GainNode
  ui: GainNode
  reverbIn: GainNode
  musicBus: GainNode
  musicIn: GainNode
}

const GUN_SET = new Set<string>(GUN_IDS)

function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h >>> 0
}

const yieldNow = (() => {
  let ch: MessageChannel | null = null
  let pending: (() => void) | null = null
  return () =>
    new Promise<void>((resolve) => {
      if (typeof MessageChannel === 'undefined') {
        setTimeout(resolve, 0)
        return
      }
      if (!ch) {
        ch = new MessageChannel()
        ch.port1.onmessage = () => {
          const p = pending
          pending = null
          p?.()
        }
      }
      pending = resolve
      ch.port2.postMessage(0)
    })
})()

export class AudioEngine {
  ctx: AudioContext | null = null
  private g: Graph | null = null
  /** key → variations */
  readonly bank = new Map<string, AudioBuffer[]>()
  private lastPick = new Map<string, number>()

  private masterVol = 0.8
  private musicVol = 0.5

  // generation stats
  genState: 'idle' | 'running' | 'done' = 'idle'
  genWallMs = 0
  genCpuMs = 0
  genFirstReadyMs = 0

  private voices: Voice[] = []
  private listenerPos = new Vector3()

  // state
  private hurtLevel = 0
  private shellT = 0
  private deathMuffle = false
  private beatTimer = 0
  private breathSrc: AudioBufferSourceNode | null = null
  private breathGain: GainNode | null = null
  private windSrc: AudioBufferSourceNode | null = null
  private windGain: GainNode | null = null
  private menuSrc: AudioBufferSourceNode | null = null
  private menuGain: GainNode | null = null
  private menuWanted = false
  private battleTimer = 4
  private creakTimer = 9
  private lastImpactWindow = 0
  private impactCount = 0
  private lastWhizz = 0
  private lastStep = new Map<number, number>()
  private pruneTimer = 0
  private gestureHooked = false
  private reverbReady = false
  private t = 0

  constructor(private game: Game) {
    this.bindEvents()
    this.hookGesture()
    // Kick off synthesis immediately (time-sliced, uses idle time between frames).
    void this.generate()
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Create/resume the AudioContext; called from a user gesture. Safe to call repeatedly. */
  unlock() {
    this.ensureContext(true)
  }

  setVolume(master: number, music: number) {
    this.masterVol = Math.max(0, Math.min(1, master))
    this.musicVol = Math.max(0, Math.min(1, music))
    this.applyVolumes()
  }

  /** Menu / HUD interface sounds, called by the UI (may be before a match). */
  playUi(kind: UiSound) {
    if (!this.ensureContext(false)) return
    const g = this.g
    if (!g || !this.running()) return
    const gain = kind === 'hover' ? 0.55 : kind === 'rankup' ? 0.9 : kind === 'countdownFinal' ? 0.9 : 0.8
    this.play(`ui.${kind}`, { bus: g.ui, gain, pitch: kind === 'hover' ? 0.03 : 0.01, prio: 200 })
  }

  update(dt: number) {
    this.t += dt
    const ctx = this.ctx
    const g = this.g
    if (!ctx || !g) return
    if (ctx.state !== 'running') {
      if (ctx.state === 'suspended' && this.userActive()) void ctx.resume().catch(() => {})
      return
    }
    const now = ctx.currentTime
    this.updateListener()

    const game = this.game
    const phase = game.mode.phase
    const player = game.player
    const inMatch = phase === 'playing' || phase === 'intro' || phase === 'ended'

    // pause → duck the whole game mix (UI + music stay)
    g.gameDuck.gain.setTargetAtTime(game.paused ? 0 : 1, now, 0.04)

    // muffle: damage flinch, death, shellshock
    this.hurtLevel = Math.max(0, this.hurtLevel - dt / 0.7)
    this.shellT = Math.max(0, this.shellT - dt)
    let f = 22000
    if (this.hurtLevel > 0) f = Math.min(f, 22000 * Math.pow(1000 / 22000, this.hurtLevel))
    if (this.shellT > 0) {
      const env = this.shellT > 1.8 ? 1 : this.shellT / 1.8
      f = Math.min(f, 22000 * Math.pow(420 / 22000, env))
    }
    if (this.deathMuffle) f = Math.min(f, 340)
    g.muffle.frequency.setTargetAtTime(f, now, this.deathMuffle ? 0.35 : 0.035)

    // low health: heartbeat + heavy breathing that fade as health regenerates
    const alive = player.alive && (phase === 'playing' || phase === 'intro')
    const h = alive ? Math.max(0, Math.min(1, (40 - player.health) / 40)) : 0
    if (this.breathGain) {
      this.breathGain.gain.setTargetAtTime(game.paused ? 0 : h * 0.55, now, 0.35)
      if (this.breathSrc) this.breathSrc.playbackRate.setTargetAtTime(1 + h * 0.3, now, 0.5)
    }
    if (h > 0.02 && !game.paused) {
      this.beatTimer -= dt
      if (this.beatTimer <= 0) {
        this.play('heart', { bus: g.inner, gain: 0.4 + 0.6 * h, pitch: 0.02, prio: 150 })
        this.beatTimer = 1.15 - 0.62 * h
      }
    } else this.beatTimer = 0

    // ambience
    if (this.windGain) {
      const base = inMatch ? 0.42 : 0.16
      const gust = 0.82 + 0.18 * Math.sin(this.t * 0.31) * Math.sin(this.t * 0.173 + 1.3)
      this.windGain.gain.setTargetAtTime(base * gust, now, 0.8)
    }
    if (phase === 'playing' && !game.paused) this.updateBattleAmbience(dt)

    // menu music
    const want = phase === 'menu' || phase === 'loading'
    if (want !== this.menuWanted) this.menuWanted = want
    this.updateMenuMusic(now)

    this.pruneTimer += dt
    if (this.pruneTimer > 1) {
      this.pruneTimer = 0
      this.voices = this.voices.filter((v) => !v.dead && v.end > now - 0.5)
    }
  }

  // ─── Debug / verification helpers ─────────────────────────────────────────

  debug() {
    const g = this.g
    let peak = 0
    if (g) {
      const a = new Float32Array(g.analyser.fftSize)
      g.analyser.getFloatTimeDomainData(a)
      for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i]!))
    }
    return {
      state: this.ctx?.state ?? 'none',
      sampleRate: this.ctx?.sampleRate ?? 0,
      voices: this.voices.filter((v) => !v.dead).length,
      gen: this.genState,
      genWallMs: Math.round(this.genWallMs),
      genCpuMs: Math.round(this.genCpuMs),
      bankKeys: this.bank.size,
      bankBuffers: [...this.bank.values()].reduce((n, a) => n + a.length, 0),
      peak,
      reduction: g?.limiter.reduction ?? 0,
      menuMusic: !!this.menuSrc,
    }
  }

  /** Peak amplitude seen at the output stage since last call (for clip checks). */
  peakNow(): number {
    const g = this.g
    if (!g) return 0
    const a = new Float32Array(g.analyser.fftSize)
    g.analyser.getFloatTimeDomainData(a)
    let p = 0
    for (let i = 0; i < a.length; i++) p = Math.max(p, Math.abs(a[i]!))
    return p
  }

  // ─── Context / graph ──────────────────────────────────────────────────────

  private userActive(): boolean {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
    return ua ? ua.hasBeenActive : true
  }

  private running(): boolean {
    return !!this.ctx && this.ctx.state === 'running'
  }

  private ensureContext(force: boolean): boolean {
    if (!this.ctx) {
      if (!force && !this.userActive()) return false
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.ctx = new Ctor({ latencyHint: 'interactive' })
      } catch {
        return false
      }
      this.buildGraph()
    }
    const ctx = this.ctx
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return true
  }

  private hookGesture() {
    if (this.gestureHooked || typeof window === 'undefined') return
    this.gestureHooked = true
    const handler = () => {
      this.ensureContext(true)
      if (this.running()) {
        window.removeEventListener('pointerdown', handler, true)
        window.removeEventListener('keydown', handler, true)
        window.removeEventListener('touchstart', handler, true)
      }
    }
    window.addEventListener('pointerdown', handler, true)
    window.addEventListener('keydown', handler, true)
    window.addEventListener('touchstart', handler, true)
  }

  private buildGraph() {
    const c = this.ctx!
    const mk = (v: number) => {
      const n = c.createGain()
      n.gain.value = v
      return n
    }
    const master = mk(0.9 * this.masterVol)
    const limiter = c.createDynamicsCompressor()
    limiter.threshold.value = -7
    limiter.knee.value = 8
    limiter.ratio.value = 14
    limiter.attack.value = 0.002
    limiter.release.value = 0.14
    // soft clip safety so nothing can exceed full scale
    const shaper = c.createWaveShaper()
    const curve = new Float32Array(2048)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(x * 1.15) / Math.tanh(1.15) * 0.98
    }
    shaper.curve = curve
    shaper.oversample = '2x'
    const analyser = c.createAnalyser()
    analyser.fftSize = 2048
    master.connect(limiter)
    limiter.connect(shaper)
    shaper.connect(c.destination)
    shaper.connect(analyser)

    const gameDuck = mk(1)
    gameDuck.connect(master)
    const muffle = c.createBiquadFilter()
    muffle.type = 'lowpass'
    muffle.frequency.value = 22000
    muffle.Q.value = 0.5
    muffle.connect(gameDuck)
    const weapons = mk(1)
    const sfx = mk(1)
    const amb = mk(0.9)
    weapons.connect(muffle)
    sfx.connect(muffle)
    amb.connect(muffle)
    const inner = mk(1)
    inner.connect(gameDuck)
    const ui = mk(0.9)
    ui.connect(master)

    // shared outdoor reverb send
    const reverbIn = mk(1)
    const reverbReturn = mk(0.7)
    reverbIn.connect(this.makeConvolver(makeOutdoorIR(32000), 32000)).connect(reverbReturn)
    reverbReturn.connect(muffle)

    // music bus with its own hall
    const musicBus = mk(this.musicVol * 0.9)
    musicBus.connect(master)
    const musicIn = mk(1)
    musicIn.connect(musicBus)
    const musicSend = mk(0.32)
    musicIn.connect(musicSend)
    musicSend.connect(this.makeConvolver(makeHallIR(22050), 22050)).connect(musicBus)
    this.reverbReady = true

    this.g = { master, limiter, analyser, gameDuck, muffle, weapons, sfx, amb, inner, ui, reverbIn, musicBus, musicIn }
    this.updateListener()
    this.startLoops()
  }

  private makeConvolver(ir: [Float32Array, Float32Array], rate: number): ConvolverNode {
    const c = this.ctx!
    const conv = c.createConvolver()
    const b = c.createBuffer(2, ir[0].length, rate)
    b.getChannelData(0).set(ir[0])
    b.getChannelData(1).set(ir[1])
    conv.buffer = b
    return conv
  }

  private applyVolumes() {
    const g = this.g
    const c = this.ctx
    if (!g || !c) return
    g.master.gain.setTargetAtTime(0.9 * this.masterVol, c.currentTime, 0.03)
    g.musicBus.gain.setTargetAtTime(this.musicVol * 0.9, c.currentTime, 0.05)
  }

  private updateListener() {
    const c = this.ctx
    if (!c) return
    const cam = this.game.render.camera
    cam.getWorldPosition(this.listenerPos)
    cam.getWorldDirection(_fwd)
    _up.set(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(_q))
    const l = c.listener
    const p = this.listenerPos
    if (l.positionX) {
      l.positionX.value = p.x
      l.positionY.value = p.y
      l.positionZ.value = p.z
      l.forwardX.value = _fwd.x
      l.forwardY.value = _fwd.y
      l.forwardZ.value = _fwd.z
      l.upX.value = _up.x
      l.upY.value = _up.y
      l.upZ.value = _up.z
    } else {
      l.setPosition(p.x, p.y, p.z)
      l.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z)
    }
  }

  // ─── Synthesis (bank) ─────────────────────────────────────────────────────

  private async generate() {
    if (this.genState !== 'idle') return
    this.genState = 'running'
    const wall0 = performance.now()
    let sliceStart = performance.now()
    const jobs: Job[] = [...buildCoreJobs(), ...buildMusicJobs()].sort((a, b) => a.prio - b.prio)
    let uiDone = false
    for (const job of jobs) {
      const rate = job.rate ?? GEN_RATE
      const out: AudioBuffer[] = []
      for (let i = 0; i < job.count; i++) {
        const s = performance.now()
        setSampleRate(rate)
        let rendered: Rendered
        try {
          rendered = job.make(i, new Rng(hashStr(job.key) + i * 7919))
        } catch (e) {
          console.warn('[audio] synth failed for', job.key, e)
          continue
        }
        const ab = this.toAudioBuffer(rendered, rate)
        if (ab) out.push(ab)
        const e = performance.now()
        this.genCpuMs += e - s
        if (e - sliceStart > 6) {
          await yieldNow()
          sliceStart = performance.now()
        }
      }
      if (out.length) this.bank.set(job.key, out)
      if (!uiDone && job.prio > 0) {
        uiDone = true
        this.genFirstReadyMs = performance.now() - wall0
      }
    }
    setSampleRate(GEN_RATE)
    this.genWallMs = performance.now() - wall0
    this.genState = 'done'
  }

  private toAudioBuffer(r: Rendered, rate: number): AudioBuffer | null {
    const chans = Array.isArray(r) ? r : [r]
    try {
      const ab = new AudioBuffer({ numberOfChannels: chans.length, length: chans[0]!.length, sampleRate: rate })
      for (let c = 0; c < chans.length; c++) ab.getChannelData(c).set(chans[c]!)
      return ab
    } catch {
      return null
    }
  }

  // ─── Voices ───────────────────────────────────────────────────────────────

  private pick(key: string): AudioBuffer | null {
    const arr = this.bank.get(key)
    if (!arr || arr.length === 0) return null
    if (arr.length === 1) return arr[0]!
    let i = (Math.random() * arr.length) | 0
    if (i === this.lastPick.get(key)) i = (i + 1) % arr.length
    this.lastPick.set(key, i)
    return arr[i]!
  }

  private play(key: string, o: PlayOpts, buffer?: AudioBuffer | null): Voice | null {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return null
    const buf = buffer ?? this.pick(key)
    if (!buf) return null

    let dist = 0
    if (o.pos) dist = this.listenerPos.distanceTo(o.pos)
    const score = (o.prio ?? 50) - dist * 0.25
    const now = ctx.currentTime
    if (this.voices.length >= MAX_VOICES) {
      let worst: Voice | null = null
      for (const v of this.voices) if (!v.dead && (!worst || v.score < worst.score)) worst = v
      if (worst && worst.score >= score) return null
      if (worst) this.kill(worst, now)
      else this.voices = this.voices.filter((v) => !v.dead)
    }

    const pitch = o.pitch ?? 0.04
    const rate = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * pitch)
    const gainV = (o.gain ?? 1) * (0.92 + Math.random() * 0.16)
    const startT = now + (o.delay ?? 0)

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    const nodes: AudioNode[] = [src]
    const gain = ctx.createGain()
    gain.gain.value = gainV
    src.connect(gain)
    nodes.push(gain)
    let last: AudioNode = gain

    if (o.air && o.pos) {
      const lpf = ctx.createBiquadFilter()
      lpf.type = 'lowpass'
      lpf.frequency.value = Math.max(1600, Math.min(19000, 20000 / (1 + dist / 16)))
      lpf.Q.value = 0.4
      last.connect(lpf)
      nodes.push(lpf)
      last = lpf
    }
    if ((o.send ?? 0) > 0 && this.g) {
      const send = ctx.createGain()
      send.gain.value = (o.send ?? 0) * (1 + Math.min(1.2, dist / 60))
      last.connect(send)
      send.connect(this.g.reverbIn)
      nodes.push(send)
    }
    if (o.pos) {
      const p = ctx.createPanner()
      p.panningModel = dist < 45 ? 'HRTF' : 'equalpower'
      p.distanceModel = 'inverse'
      p.refDistance = o.ref ?? 4
      p.rolloffFactor = o.rolloff ?? 1
      p.maxDistance = 10000
      p.positionX.value = o.pos.x
      p.positionY.value = o.pos.y
      p.positionZ.value = o.pos.z
      last.connect(p)
      p.connect(o.bus)
      nodes.push(p)
    } else if (o.pan !== undefined && o.pan !== 0) {
      const sp = ctx.createStereoPanner()
      sp.pan.value = o.pan
      last.connect(sp)
      sp.connect(o.bus)
      nodes.push(sp)
    } else {
      last.connect(o.bus)
    }

    const natural = buf.duration / rate
    const len = o.dur !== undefined ? Math.min(o.dur, natural) : natural
    if (o.dur !== undefined && o.dur < natural) {
      gain.gain.setValueAtTime(gainV, startT + Math.max(0, len - 0.15))
      gain.gain.linearRampToValueAtTime(0, startT + len)
    }
    const voice: Voice = { src, nodes, end: startT + len + 0.05, score, gain, dead: false }
    src.onended = () => this.release(voice)
    src.start(startT)
    if (o.dur !== undefined && o.dur < natural) src.stop(startT + len + 0.02)
    this.voices.push(voice)
    return voice
  }

  private release(v: Voice) {
    if (v.dead) return
    v.dead = true
    for (const n of v.nodes) {
      try {
        n.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    const i = this.voices.indexOf(v)
    if (i >= 0) this.voices.splice(i, 1)
  }

  private kill(v: Voice, now: number) {
    try {
      v.gain.gain.cancelScheduledValues(now)
      v.gain.gain.setTargetAtTime(0, now, 0.005)
      v.src.stop(now + 0.03)
    } catch {
      /* not started yet */
    }
    v.score = -1e9
  }

  // ─── Loops: wind, breath ──────────────────────────────────────────────────

  private startLoops() {
    // Loops depend on the bank, which may still be generating; poll until ready.
    const tryStart = () => {
      const c = this.ctx
      const g = this.g
      if (!c || !g) return
      let pending = false
      if (!this.windSrc) {
        const w = this.bank.get('wind')?.[0]
        if (w) {
          const src = c.createBufferSource()
          src.buffer = w
          src.loop = true
          const gn = c.createGain()
          gn.gain.value = 0
          src.connect(gn).connect(g.amb)
          src.start()
          this.windSrc = src
          this.windGain = gn
        } else pending = true
      }
      if (!this.breathSrc) {
        const b = this.bank.get('breath')?.[0]
        if (b) {
          const src = c.createBufferSource()
          src.buffer = b
          src.loop = true
          const gn = c.createGain()
          gn.gain.value = 0
          src.connect(gn).connect(g.inner)
          src.start()
          this.breathSrc = src
          this.breathGain = gn
        } else pending = true
      }
      if (pending) setTimeout(tryStart, 250)
    }
    tryStart()
  }

  private updateMenuMusic(now: number) {
    const c = this.ctx
    const g = this.g
    if (!c || !g) return
    if (this.menuWanted && !this.menuSrc) {
      const m = this.bank.get('mus.menu')?.[0]
      if (!m) return
      const src = c.createBufferSource()
      src.buffer = m
      src.loop = true
      const gn = c.createGain()
      gn.gain.value = 0
      gn.gain.setTargetAtTime(1, now, 1.1)
      src.connect(gn).connect(g.musicIn)
      src.start()
      this.menuSrc = src
      this.menuGain = gn
    } else if (!this.menuWanted && this.menuSrc && this.menuGain) {
      const src = this.menuSrc
      const gn = this.menuGain
      gn.gain.cancelScheduledValues(now)
      gn.gain.setTargetAtTime(0, now, 0.45)
      src.stop(now + 3)
      src.onended = () => {
        try {
          gn.disconnect()
        } catch {
          /* noop */
        }
      }
      this.menuSrc = null
      this.menuGain = null
    }
  }

  private updateBattleAmbience(dt: number) {
    const g = this.g
    if (!g) return
    this.battleTimer -= dt
    if (this.battleTimer <= 0) {
      this.battleTimer = 2.2 + Math.random() * 5.5
      const roll = Math.random()
      const ang = Math.random() * Math.PI * 2
      const d = 90 + Math.random() * 90
      _pos.set(this.listenerPos.x + Math.cos(ang) * d, 2, this.listenerPos.z + Math.sin(ang) * d)
      if (roll < 0.8) {
        const ids: GunId[] = ['ak47', 'acr', 'm4a1', 'ump45', 'ak47', 'deagle', 'usp45', 'acr']
        const id = ids[(Math.random() * ids.length) | 0]!
        const shots = 1 + ((Math.random() * Math.random() * 7) | 0)
        const gap = id === 'deagle' || id === 'usp45' ? 0.28 + Math.random() * 0.2 : 0.075 + Math.random() * 0.05
        const buf = this.pick(`gun.${id}.far`)
        for (let i = 0; i < shots; i++) {
          this.play('', { bus: g.weapons, pos: _pos, gain: 0.5 * (0.6 + Math.random() * 0.5), ref: 70, rolloff: 1, prio: 5, send: 0.45, delay: i * gap, dur: 1.5, air: true, pitch: 0.06 }, buf)
        }
      } else {
        this.play('exp.far', { bus: g.weapons, pos: _pos, gain: 0.55, ref: 90, rolloff: 1, prio: 8, send: 0.4, air: true, pitch: 0.06 })
      }
    }
    this.creakTimer -= dt
    if (this.creakTimer <= 0) {
      this.creakTimer = 6 + Math.random() * 12
      const ang = Math.random() * Math.PI * 2
      const d = 12 + Math.random() * 30
      _pos.set(this.listenerPos.x + Math.cos(ang) * d, 3, this.listenerPos.z + Math.sin(ang) * d)
      const key = Math.random() < 0.55 ? 'creak' : 'clank'
      this.play(key, { bus: g.amb, pos: _pos, gain: key === 'creak' ? 0.6 : 0.5, ref: 7, rolloff: 1, prio: 10, send: 0.3, air: true, pitch: 0.12 })
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  private bindEvents() {
    const ev = this.game.events

    ev.on('weapon:fire', ({ shooter, weaponId, origin, suppressed }) => {
      const g = this.g
      if (!g || !GUN_SET.has(weaponId)) return
      const cls = WEAPONS[weaponId].class
      if (shooter.isPlayer) {
        if (suppressed) {
          this.play('gun.supp', { bus: g.weapons, gain: 0.8, rate: cls === 'sniper' ? 0.85 : cls === 'pistol' ? 1.1 : 1, prio: 150, send: 0.12 })
        } else {
          this.play(`gun.${weaponId}.own`, { bus: g.weapons, gain: 1, pitch: 0.03, prio: 150, send: weaponId === 'intervention' ? 0.45 : 0.28 })
        }
        return
      }
      const d = this.listenerPos.distanceTo(origin)
      const long = cls === 'sniper'
      if (suppressed) {
        if (d > 45) return
        this.play('gun.supp', { bus: g.weapons, pos: origin, gain: 0.7, ref: 4, rolloff: 1.3, prio: 60, air: true, rate: cls === 'sniper' ? 0.85 : 1, dur: 0.5 })
        return
      }
      if (d > FAR_SHOT_DISTANCE) {
        this.play(`gun.${weaponId}.far`, { bus: g.weapons, pos: origin, gain: 1.0, ref: 30, rolloff: 0.9, prio: 45, send: 0.45, air: true, dur: long ? undefined : 1.6 })
      } else {
        this.play(`gun.${weaponId}.own`, { bus: g.weapons, pos: origin, gain: 1.15, ref: 5, rolloff: 1.05, prio: 70, send: 0.2, air: true, dur: long ? undefined : 1.0 })
      }
    })

    ev.on('weapon:dryfire', ({ shooter }) => {
      const g = this.g
      if (!g) return
      if (shooter.isPlayer) this.play('gun.dry', { bus: g.weapons, gain: 0.8, prio: 140 })
      else this.actorSound('gun.dry', shooter, g.weapons, 0.6, 25, 1.4)
    })

    ev.on('weapon:reload', ({ actor, weaponId, stage }) => {
      const g = this.g
      if (!g) return
      const def = WEAPONS[weaponId]
      const shotgun = def.class === 'shotgun'
      const rate = def.class === 'pistol' || def.class === 'smg' ? 1.12 : def.class === 'sniper' ? 0.88 : 1
      let key: string | null = null
      switch (stage) {
        case 'start':
          key = 'fol.adson'
          break
        case 'magout':
          key = shotgun ? 'fol.shell' : 'fol.magout'
          break
        case 'magin':
          key = shotgun ? 'fol.shell' : 'fol.magin'
          break
        case 'boltback':
          key = shotgun ? 'fol.pumpback' : 'fol.boltback'
          break
        case 'boltforward':
          key = shotgun ? 'fol.pumpfwd' : 'fol.boltfwd'
          break
        case 'end':
          key = null
          break
      }
      if (!key) return
      if (actor.isPlayer) this.play(key, { bus: g.sfx, gain: 0.85, rate, prio: 120 })
      else this.actorSound(key, actor, g.sfx, 0.65, 22, 1.5, rate)
    })

    ev.on('weapon:switch', ({ actor }) => {
      const g = this.g
      if (g && actor.isPlayer) this.play('fol.switch', { bus: g.sfx, gain: 0.8, prio: 120 })
    })

    ev.on('weapon:ads', ({ actor, on }) => {
      const g = this.g
      if (g && actor.isPlayer) this.play(on ? 'fol.adson' : 'fol.adsoff', { bus: g.sfx, gain: 0.7, prio: 100 })
    })

    ev.on('weapon:melee', ({ actor, hit }) => {
      const g = this.g
      if (!g) return
      if (actor.isPlayer) {
        this.play('knife.swish', { bus: g.sfx, gain: 0.85, prio: 140 })
        if (hit) this.play('knife.hit', { bus: g.sfx, gain: 1, delay: 0.09, prio: 145, send: 0.1 })
      } else {
        this.actorSound('knife.swish', actor, g.sfx, 0.8, 30, 1.3)
        if (hit) this.actorSound('knife.hit', actor, g.sfx, 0.9, 30, 1.3, 1, 0.09)
      }
    })

    ev.on('bullet:impact', ({ point, surface, shooter }) => {
      const g = this.g
      if (!g || !this.running()) return
      const d = this.listenerPos.distanceTo(point)
      if (d > IMPACT_MAX_DISTANCE) return
      const nowT = this.t
      if (nowT - this.lastImpactWindow > 0.08) {
        this.lastImpactWindow = nowT
        this.impactCount = 0
      }
      const mine = !!shooter?.isPlayer
      if (this.impactCount >= (mine ? 6 : 3)) return
      this.impactCount++
      let key = impactKey(surface)
      if (key === 'metal' && Math.random() < 0.38) key = 'ricochet'
      this.play(`imp.${key}`, { bus: g.sfx, pos: point, gain: mine ? 1.0 : 0.8, ref: 3, rolloff: 1.4, prio: mine ? 90 : 40, send: 0.1, air: true })
    })

    ev.on('bullet:whizz', ({ actor, point }) => {
      const g = this.g
      if (!g || !actor.isPlayer) return
      if (this.t - this.lastWhizz < 0.07) return
      this.lastWhizz = this.t
      this.play('whizz', { bus: g.sfx, pos: point, gain: 1.15, ref: 1, rolloff: 1.2, prio: 160, send: 0.12, pitch: 0.08 })
    })

    ev.on('player:hitmarker', ({ headshot, kill }) => {
      const g = this.g
      if (!g) return
      this.play(kill ? 'hit.kill' : headshot ? 'hit.head' : 'hit.tick', { bus: g.inner, gain: kill ? 1 : 0.85, pitch: 0.02, prio: 190 })
    })

    ev.on('actor:damaged', (info) => {
      const g = this.g
      if (!g || !info.victim.isPlayer || !this.running()) return
      const amt = info.amount
      this.play(info.explosive || amt > 55 ? 'hurt.heavy' : 'hurt', { bus: g.inner, gain: Math.min(1, 0.55 + amt / 80), prio: 180 })
      this.hurtLevel = Math.max(this.hurtLevel, Math.min(1, 0.4 + amt / 70))
    })

    ev.on('actor:killed', (info) => {
      const g = this.g
      if (!g) return
      const v = info.victim
      if (v.isPlayer) {
        this.deathMuffle = true
        this.play('hurt.heavy', { bus: g.inner, gain: 1, prio: 190 })
        return
      }
      const pos = _pos.copy(v.position)
      pos.y += 0.3
      this.play('fall', { bus: g.sfx, pos, gain: 0.95, ref: 3, rolloff: 1.3, prio: 55, delay: 0.28, send: 0.12, air: true })
    })

    ev.on('actor:spawned', ({ actor }) => {
      if (actor.isPlayer) {
        this.deathMuffle = false
        this.hurtLevel = 0
      }
    })

    ev.on('actor:footstep', ({ actor, surface, position, intensity }) => {
      const g = this.g
      if (!g) return
      const k = stepKey(surface, position.y)
      const iGain = 0.35 + 0.65 * Math.min(1, intensity)
      if (actor.isPlayer) {
        this.play(`step.${k}`, { bus: g.sfx, gain: 0.5 * iGain, prio: 60, pitch: 0.06 })
        return
      }
      const d = this.listenerPos.distanceTo(position)
      if (d > STEP_MAX_DISTANCE) return
      const last = this.lastStep.get(actor.id) ?? -1
      if (this.t - last < 0.12) return
      this.lastStep.set(actor.id, this.t)
      this.play(`step.${k}`, { bus: g.sfx, pos: position, gain: 1.35 * iGain, ref: 2.2, rolloff: 1.25, prio: 75, send: 0.06, air: true, pitch: 0.07 })
    })

    ev.on('actor:jump', ({ actor }) => {
      const g = this.g
      if (!g) return
      if (actor.isPlayer) this.play('jump', { bus: g.sfx, gain: 0.5, prio: 60 })
      else this.actorSound('jump', actor, g.sfx, 0.7, 18, 2)
    })

    ev.on('actor:land', ({ actor, surface, impact }) => {
      const g = this.g
      if (!g) return
      const k = landKey(surface)
      const gain = Math.max(0.35, Math.min(1.1, impact / 9))
      if (actor.isPlayer) this.play(`land.${k}`, { bus: g.sfx, gain: 0.9 * gain, prio: 130 })
      else {
        const d = this.listenerPos.distanceTo(actor.position)
        if (d > 24) return
        this.play(`land.${k}`, { bus: g.sfx, pos: _pos.copy(actor.position), gain: 1.3 * gain, ref: 2.5, rolloff: 1.2, prio: 80, air: true })
      }
    })

    ev.on('grenade:throw', ({ actor }) => {
      const g = this.g
      if (!g) return
      if (actor.isPlayer) this.play('gren.throw', { bus: g.sfx, gain: 0.9, prio: 140 })
      else this.actorSound('gren.throw', actor, g.sfx, 0.85, 40, 1.2)
    })

    ev.on('grenade:bounce', ({ position, surface }) => {
      const g = this.g
      if (!g) return
      const d = this.listenerPos.distanceTo(position)
      if (d > 35) return
      const k = bounceKey(surface)
      this.play(`gren.bounce.${k}`, { bus: g.sfx, pos: position, gain: 1.0, ref: 3, rolloff: 1.2, prio: 85, send: 0.12, air: true })
    })

    ev.on('grenade:explode', ({ position }) => {
      const g = this.g
      if (!g || !this.running()) return
      const d = this.listenerPos.distanceTo(position)
      const key = d > 45 ? 'exp.far' : 'exp.near'
      this.play(key, { bus: g.weapons, pos: position, gain: 1.25, ref: key === 'exp.far' ? 40 : 14, rolloff: 0.85, prio: 195, send: 0.35, air: d > 20, pitch: 0.03 })
      if (d < 10 && this.game.player.alive) this.shellshock(Math.sqrt(1 - d / 10))
    })

    ev.on('killstreak:earned', ({ actor }) => {
      const g = this.g
      if (g && actor.isPlayer) this.play('ks.earned', { bus: g.inner, gain: 0.8, prio: 170 })
    })

    ev.on('killstreak:used', ({ actor }) => {
      const g = this.g
      if (g && actor.isPlayer) this.play('ks.used', { bus: g.inner, gain: 0.85, prio: 170 })
    })

    ev.on('uav:changed', ({ team, active }) => {
      const g = this.g
      if (!g) return
      const mine = team === this.game.player.team
      if (active) this.play('uav.on', { bus: g.inner, gain: mine ? 0.8 : 0.5, rate: mine ? 1 : 0.72, prio: 165 })
      else if (mine) this.play('uav.off', { bus: g.inner, gain: 0.7, prio: 165 })
    })

    ev.on('match:announce', ({ text }) => {
      const g = this.g
      if (!g || text === 'FIGHT') return
      this.play('radio', { bus: g.inner, gain: 0.7, prio: 150 })
    })

    ev.on('match:phase', ({ phase, winner }) => {
      const g = this.g
      this.deathMuffle = false
      this.hurtLevel = 0
      if (!g) return
      if (phase === 'intro') {
        this.shellT = 0
        this.play('mus.intro', { bus: g.musicIn, gain: 0.95, pitch: 0, prio: 250 })
      } else if (phase === 'playing') {
        this.play('mus.go', { bus: g.musicIn, gain: 0.8, pitch: 0, prio: 250 })
      } else if (phase === 'ended') {
        const mine = this.game.player.team
        const key = winner === 'draw' || winner === undefined ? 'mus.draw' : winner === mine ? 'mus.victory' : 'mus.defeat'
        this.play(key, { bus: g.musicIn, gain: 1, pitch: 0, prio: 250 })
      }
    })
  }

  /** Spatialised sound at an actor's chest height, gated by distance. */
  private actorSound(key: string, actor: Actor, bus: AudioNode, gain: number, maxDist: number, rolloff: number, rate = 1, delay = 0) {
    const pos = _pos.copy(actor.position)
    pos.y += 1.2
    const d = this.listenerPos.distanceTo(pos)
    if (d > maxDist) return
    this.play(key, { bus, pos, gain, ref: 2.5, rolloff, rate, prio: 60, send: 0.06, air: true, delay })
  }

  /** MW2 shellshock: tinnitus + everything else collapses into a muffled low-pass for ~3 s. */
  private shellshock(intensity: number) {
    const ctx = this.ctx
    const g = this.g
    if (!ctx || !g) return
    if (this.shellT > 2.5 && intensity < 0.6) return
    this.shellT = 3.4
    this.hurtLevel = Math.max(this.hurtLevel, 0.9)
    const now = ctx.currentTime
    const level = 0.05 + 0.1 * intensity
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(level, now + 0.06)
    env.gain.setValueAtTime(level, now + 1.4)
    env.gain.exponentialRampToValueAtTime(0.0005, now + 4.2)
    env.connect(g.inner)
    const oscs: OscillatorNode[] = []
    for (const [f, a] of [[4120, 1], [4165, 0.6], [6310, 0.35], [2740, 0.25]] as const) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      const og = ctx.createGain()
      og.gain.value = a
      o.connect(og).connect(env)
      o.start(now)
      o.stop(now + 4.3)
      oscs.push(o)
    }
    oscs[0]!.onended = () => {
      try {
        env.disconnect()
      } catch {
        /* noop */
      }
    }
  }
}

// ─── Surface mapping ────────────────────────────────────────────────────────

function impactKey(s: Surface): 'sand' | 'concrete' | 'metal' | 'wood' | 'glass' | 'flesh' {
  switch (s) {
    case 'concrete':
      return 'concrete'
    case 'metal':
      return 'metal'
    case 'wood':
      return 'wood'
    case 'glass':
      return 'glass'
    case 'flesh':
      return 'flesh'
    default:
      return 'sand'
  }
}

function stepKey(s: Surface, y: number): 'sand' | 'concrete' | 'metal' | 'grate' | 'wood' {
  switch (s) {
    case 'concrete':
    case 'glass':
      return 'concrete'
    case 'metal':
      return y > 0.8 && Math.random() < 0.7 ? 'grate' : 'metal'
    case 'wood':
      return 'wood'
    default:
      return 'sand'
  }
}

function landKey(s: Surface): 'sand' | 'concrete' | 'metal' | 'wood' {
  switch (s) {
    case 'concrete':
    case 'glass':
      return 'concrete'
    case 'metal':
      return 'metal'
    case 'wood':
      return 'wood'
    default:
      return 'sand'
  }
}

function bounceKey(s: Surface): 'metal' | 'concrete' | 'sand' | 'wood' {
  switch (s) {
    case 'metal':
      return 'metal'
    case 'concrete':
    case 'glass':
      return 'concrete'
    case 'wood':
      return 'wood'
    default:
      return 'sand'
  }
}

export type { WeaponId }
