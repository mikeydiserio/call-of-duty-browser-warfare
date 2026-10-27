/**
 * Pluggable signalling: lobby discovery (presence) + per-lobby broadcast messages.
 * Production uses Supabase Realtime; `LocalSignaling` (BroadcastChannel) lets two tabs of the
 * same browser play together without any backend (dev/testing: add `?netlocal` to the URL).
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'

export type SignalPayload = Record<string, unknown> & { type: string }

export interface SignalChannel {
  send(msg: SignalPayload): void
  onMessage(fn: (msg: SignalPayload) => void): void
  /** Advertise (or with null, stop advertising) this peer's presence state. */
  track(state: Record<string, unknown> | null): void
  /** Every peer's tracked presence state. */
  presence(): Record<string, unknown>[]
  onPresence(fn: () => void): void
  close(): void
}

export interface SignalingTransport {
  readonly name: string
  open(topic: string, presenceKey: string): Promise<SignalChannel>
}

// ─── Supabase Realtime ──────────────────────────────────────────────────────

export class SupabaseSignaling implements SignalingTransport {
  readonly name = 'supabase'
  private client: SupabaseClient

  constructor(url: string, key: string) {
    this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 30 } } })
  }

  open(topic: string, presenceKey: string): Promise<SignalChannel> {
    const ch: RealtimeChannel = this.client.channel(topic, { config: { presence: { key: presenceKey }, broadcast: { self: false, ack: false } } })
    const msgFns: ((m: SignalPayload) => void)[] = []
    const presFns: (() => void)[] = []
    ch.on('broadcast', { event: 'm' }, ({ payload }) => {
      for (const fn of msgFns) fn(payload as SignalPayload)
    })
    ch.on('presence', { event: 'sync' }, () => {
      for (const fn of presFns) fn()
    })
    const wrapper: SignalChannel = {
      send: (msg) => void ch.send({ type: 'broadcast', event: 'm', payload: msg }),
      onMessage: (fn) => msgFns.push(fn),
      track: (state) => void (state ? ch.track(state) : ch.untrack()),
      presence: () => Object.values(ch.presenceState()).flatMap((list) => list as unknown as Record<string, unknown>[]),
      onPresence: (fn) => presFns.push(fn),
      close: () => void this.client.removeChannel(ch),
    }
    return new Promise((resolve, reject) => {
      let done = false
      const timer = window.setTimeout(() => {
        if (done) return
        done = true
        void this.client.removeChannel(ch)
        reject(new Error('Realtime connection timed out'))
      }, 10000)
      ch.subscribe((status) => {
        if (done) return
        if (status === 'SUBSCRIBED') {
          done = true
          clearTimeout(timer)
          resolve(wrapper)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          done = true
          clearTimeout(timer)
          reject(new Error(`Realtime ${status.toLowerCase()}`))
        }
      })
    })
  }
}

// ─── Same-browser loopback (BroadcastChannel) ───────────────────────────────

type LocalEnvelope =
  | { k: 'm'; from: string; msg: SignalPayload }
  | { k: 'p'; from: string; state: Record<string, unknown> }
  | { k: 'leave'; from: string }
  | { k: 'who'; from: string }

export class LocalSignaling implements SignalingTransport {
  readonly name = 'local'

  async open(topic: string, presenceKey: string): Promise<SignalChannel> {
    const bc = new BroadcastChannel(`mwnet:${topic}`)
    const msgFns: ((m: SignalPayload) => void)[] = []
    const presFns: (() => void)[] = []
    const peers = new Map<string, { state: Record<string, unknown>; at: number }>()
    let mine: Record<string, unknown> | null = null
    const post = (e: LocalEnvelope) => bc.postMessage(e)
    const notify = () => presFns.forEach((fn) => fn())
    bc.onmessage = (ev: MessageEvent<LocalEnvelope>) => {
      const e = ev.data
      if (e.from === presenceKey) return
      if (e.k === 'm') msgFns.forEach((fn) => fn(e.msg))
      else if (e.k === 'p') {
        const prev = peers.get(e.from)
        peers.set(e.from, { state: e.state, at: performance.now() })
        if (!prev || JSON.stringify(prev.state) !== JSON.stringify(e.state)) notify()
      } else if (e.k === 'leave') {
        if (peers.delete(e.from)) notify()
      } else if (e.k === 'who' && mine) post({ k: 'p', from: presenceKey, state: mine })
    }
    const beat = window.setInterval(() => {
      if (mine) post({ k: 'p', from: presenceKey, state: mine })
      const now = performance.now()
      let dropped = false
      for (const [k, p] of peers) if (now - p.at > 3500) dropped = peers.delete(k) || dropped
      if (dropped) notify()
    }, 1000)
    post({ k: 'who', from: presenceKey })
    return {
      send: (msg) => post({ k: 'm', from: presenceKey, msg }),
      onMessage: (fn) => msgFns.push(fn),
      track: (state) => {
        mine = state
        post(state ? { k: 'p', from: presenceKey, state } : { k: 'leave', from: presenceKey })
      },
      presence: () => {
        const list = [...peers.values()].map((p) => p.state)
        if (mine) list.push(mine)
        return list
      },
      onPresence: (fn) => presFns.push(fn),
      close: () => {
        if (mine) post({ k: 'leave', from: presenceKey })
        clearInterval(beat)
        bc.close()
      },
    }
  }
}
