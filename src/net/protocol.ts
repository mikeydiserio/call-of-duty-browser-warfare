/**
 * Wire formats.
 *  - `state` data channel (unordered, no retransmits): compact binary host snapshots (20 Hz)
 *    and client poses (30 Hz), little-endian DataView encodings below.
 *  - `reliable` data channel (ordered): JSON `ReliableMsg`s. Game events are encoded
 *    generically: Actors become `{ $a: netId }` and Vector3s `{ $v: [x, y, z] }`.
 */
import { Vector3 } from 'three'
import type { Actor, Loadout, MatchSettings, ObjectiveId, Team, WeaponId } from '../core/types'
import type { KillstreakId } from '../game/killstreaks/defs'

export const WEAPON_IDS: WeaponId[] = ['acr', 'm4a1', 'ak47', 'ump45', 'intervention', 'spas12', 'usp45', 'deagle', 'frag', 'knife']
const weaponIndex = (id: WeaponId) => Math.max(0, WEAPON_IDS.indexOf(id))

export const MSG_SNAPSHOT = 1
export const MSG_POSE = 2

const POS_Q = 100 // cm
const ANG_Q = 10000

/** Actor flag bits. */
export const F_ALIVE = 1
export const F_STANCE_SHIFT = 1 // 2 bits
export const F_RELOAD = 8
export const F_SPRINT = 16
export const F_OPFOR = 32
export const F_GROUNDED = 64
export const F_ADS = 128

export interface ActorState {
  id: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  flags: number
  weapon: WeaponId
  health: number
}

export interface ObjectiveNet {
  id: ObjectiveId
  owner: Team | null
  capturing: Team | null
  progress: number
  contested: boolean
}

export interface BombNet {
  carrier: number
  x: number
  y: number
  z: number
  planted: boolean
  site: ObjectiveId | null
  fuseLeft: number
  plant: number
  defuse: number
  attackers: Team
}

export interface Snapshot {
  seq: number
  timeLeft: number
  introLeft: number
  score: Record<Team, number>
  round: number
  /** UAV seconds remaining per team. */
  uav: Record<Team, number>
  actors: ActorState[]
  objectives: ObjectiveNet[]
  bomb: BombNet | null
}

const OBJ = ['A', 'B', 'C'] as const
const teamCode = (t: Team | null) => (t === 'tf141' ? 1 : t === 'opfor' ? 2 : 0)
const codeTeam = (c: number): Team | null => (c === 1 ? 'tf141' : c === 2 ? 'opfor' : null)
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const size = 1 + 2 + 4 + 4 + 2 + 2 + 1 + 4 + 4 + 1 + s.actors.length * 15 + 1 + s.objectives.length * 5 + 1 + (s.bomb ? 20 : 0)
  const buf = new ArrayBuffer(size)
  const v = new DataView(buf)
  let o = 0
  v.setUint8(o++, MSG_SNAPSHOT)
  v.setUint16(o, s.seq & 0xffff, true), (o += 2)
  v.setFloat32(o, s.timeLeft, true), (o += 4)
  v.setFloat32(o, s.introLeft, true), (o += 4)
  v.setUint16(o, Math.min(65535, Math.max(0, s.score.tf141)), true), (o += 2)
  v.setUint16(o, Math.min(65535, Math.max(0, s.score.opfor)), true), (o += 2)
  v.setUint8(o++, s.round & 255)
  v.setFloat32(o, s.uav.tf141, true), (o += 4)
  v.setFloat32(o, s.uav.opfor, true), (o += 4)
  v.setUint8(o++, s.actors.length)
  for (const a of s.actors) {
    v.setUint16(o, a.id, true), (o += 2)
    v.setInt16(o, clamp16(a.x * POS_Q), true), (o += 2)
    v.setInt16(o, clamp16(a.y * POS_Q), true), (o += 2)
    v.setInt16(o, clamp16(a.z * POS_Q), true), (o += 2)
    v.setInt16(o, clamp16(wrapPi(a.yaw) * ANG_Q), true), (o += 2)
    v.setInt16(o, clamp16(a.pitch * ANG_Q), true), (o += 2)
    v.setUint8(o++, a.flags)
    v.setUint8(o++, weaponIndex(a.weapon))
    v.setUint8(o++, Math.max(0, Math.min(255, Math.ceil(a.health))))
  }
  v.setUint8(o++, s.objectives.length)
  for (const ob of s.objectives) {
    v.setUint8(o++, OBJ.indexOf(ob.id))
    v.setUint8(o++, teamCode(ob.owner))
    v.setUint8(o++, teamCode(ob.capturing))
    v.setUint8(o++, Math.round(Math.max(0, Math.min(1, ob.progress)) * 255))
    v.setUint8(o++, ob.contested ? 1 : 0)
  }
  v.setUint8(o++, s.bomb ? 1 : 0)
  if (s.bomb) {
    const b = s.bomb
    v.setUint16(o, b.carrier, true), (o += 2)
    v.setInt16(o, clamp16(b.x * POS_Q), true), (o += 2)
    v.setInt16(o, clamp16(b.y * POS_Q), true), (o += 2)
    v.setInt16(o, clamp16(b.z * POS_Q), true), (o += 2)
    v.setUint8(o++, (b.planted ? 1 : 0) | (teamCode(b.attackers) << 1))
    v.setUint8(o++, b.site ? OBJ.indexOf(b.site as 'A' | 'B' | 'C') + 1 : 0)
    v.setFloat32(o, b.fuseLeft, true), (o += 4)
    v.setFloat32(o, b.plant, true), (o += 4)
    v.setFloat32(o, b.defuse, true), (o += 4)
  }
  return buf
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot {
  const v = new DataView(buf)
  let o = 1
  const seq = v.getUint16(o, true)
  o += 2
  const timeLeft = v.getFloat32(o, true)
  o += 4
  const introLeft = v.getFloat32(o, true)
  o += 4
  const tf = v.getUint16(o, true)
  o += 2
  const op = v.getUint16(o, true)
  o += 2
  const round = v.getUint8(o++)
  const uavT = v.getFloat32(o, true)
  o += 4
  const uavO = v.getFloat32(o, true)
  o += 4
  const n = v.getUint8(o++)
  const actors: ActorState[] = []
  for (let i = 0; i < n; i++) {
    const id = v.getUint16(o, true)
    const x = v.getInt16(o + 2, true) / POS_Q
    const y = v.getInt16(o + 4, true) / POS_Q
    const z = v.getInt16(o + 6, true) / POS_Q
    const yaw = v.getInt16(o + 8, true) / ANG_Q
    const pitch = v.getInt16(o + 10, true) / ANG_Q
    const flags = v.getUint8(o + 12)
    const weapon = WEAPON_IDS[v.getUint8(o + 13)] ?? 'acr'
    const health = v.getUint8(o + 14)
    o += 15
    actors.push({ id, x, y, z, yaw, pitch, flags, weapon, health })
  }
  const nObj = v.getUint8(o++)
  const objectives: ObjectiveNet[] = []
  for (let i = 0; i < nObj; i++) {
    objectives.push({
      id: OBJ[v.getUint8(o)] ?? 'A',
      owner: codeTeam(v.getUint8(o + 1)),
      capturing: codeTeam(v.getUint8(o + 2)),
      progress: v.getUint8(o + 3) / 255,
      contested: v.getUint8(o + 4) === 1,
    })
    o += 5
  }
  let bomb: BombNet | null = null
  if (v.getUint8(o++) === 1) {
    const bits = v.getUint8(o + 8)
    const site = v.getUint8(o + 9)
    bomb = {
      carrier: v.getUint16(o, true),
      x: v.getInt16(o + 2, true) / POS_Q,
      y: v.getInt16(o + 4, true) / POS_Q,
      z: v.getInt16(o + 6, true) / POS_Q,
      planted: (bits & 1) === 1,
      attackers: codeTeam(bits >> 1) ?? 'opfor',
      site: site ? (OBJ[site - 1] ?? null) : null,
      fuseLeft: v.getFloat32(o + 10, true),
      plant: v.getFloat32(o + 14, true),
      defuse: v.getFloat32(o + 18, true),
    }
  }
  return { seq, timeLeft, introLeft, score: { tf141: tf, opfor: op }, round, uav: { tf141: uavT, opfor: uavO }, actors, objectives, bomb }
}

/** Client → host pose (the same 15-byte actor record, id = sender's net id). */
export function encodePose(a: ActorState, seq: number): ArrayBuffer {
  const buf = new ArrayBuffer(18)
  const v = new DataView(buf)
  v.setUint8(0, MSG_POSE)
  v.setUint16(1, seq & 0xffff, true)
  v.setUint16(3, a.id, true)
  v.setInt16(5, clamp16(a.x * POS_Q), true)
  v.setInt16(7, clamp16(a.y * POS_Q), true)
  v.setInt16(9, clamp16(a.z * POS_Q), true)
  v.setInt16(11, clamp16(wrapPi(a.yaw) * ANG_Q), true)
  v.setInt16(13, clamp16(a.pitch * ANG_Q), true)
  v.setUint8(15, a.flags)
  v.setUint8(16, weaponIndex(a.weapon))
  v.setUint8(17, Math.max(0, Math.min(255, Math.ceil(a.health))))
  return buf
}

export function decodePose(buf: ArrayBuffer): ActorState {
  const v = new DataView(buf)
  return {
    id: v.getUint16(3, true),
    x: v.getInt16(5, true) / POS_Q,
    y: v.getInt16(7, true) / POS_Q,
    z: v.getInt16(9, true) / POS_Q,
    yaw: v.getInt16(11, true) / ANG_Q,
    pitch: v.getInt16(13, true) / ANG_Q,
    flags: v.getUint8(15),
    weapon: WEAPON_IDS[v.getUint8(16)] ?? 'acr',
    health: v.getUint8(17),
  }
}

function clamp16(x: number) {
  return Math.max(-32768, Math.min(32767, Math.round(x)))
}

// ─── Reliable messages ──────────────────────────────────────────────────────

export interface RosterEntry {
  id: number
  name: string
  team: Team
  bot: boolean
  primary: WeaponId
  secondary: WeaponId
}

export type ReliableMsg =
  /** Client → host on connect and whenever it changes. */
  | { t: 'hello'; loadout: Loadout; name: string }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number }
  /** Host → client: the match started (or is in progress when joining late). */
  | { t: 'start'; settings: MatchSettings; seed: number; you: number; team: Team; roster: RosterEntry[]; phase: string; inProgress: boolean }
  | { t: 'roster'; roster: RosterEntry[] }
  /** Host → client: spawn your local player here. */
  | { t: 'spawn'; p: [number, number, number]; yaw: number }
  /** Host → clients: a replicated game event. */
  | { t: 'ev'; k: string; p: unknown; h?: number }
  /** Host → clients: per-actor stats (scoreboard), ~1 Hz. */
  | { t: 'stats'; s: [number, number, number, number, number, number][] }
  /** Host → clients: a grenade someone else threw, for local visual simulation. */
  | { t: 'gthrow'; owner: number; o: [number, number, number]; v: [number, number, number]; fuse: number }
  | { t: 'batch'; m: ReliableMsg[]; h: number }
  /** Seconds until respawn; -1 = wait for the next round. */
  | { t: 'respawnIn'; s: number }
  | { t: 'end' }
  // Client → host requests
  | { t: 'fire'; w: WeaponId; o: [number, number, number]; d: [number, number, number][]; m: [number, number, number] }
  | { t: 'nade'; o: [number, number, number]; v: [number, number, number]; fuse: number }
  | { t: 'knife' }
  | { t: 'respawn' }
  /** Client → host: call in a held killstreak (target / heading from the map picker or sentry placement). */
  | { t: 'ks'; id: KillstreakId; p?: [number, number, number]; h?: number }
  | { t: 'streak' }

// ─── Generic event (de)serialisation ────────────────────────────────────────

export const v3 = (v: Vector3): [number, number, number] => [round3(v.x), round3(v.y), round3(v.z)]
const round3 = (x: number) => Math.round(x * 1000) / 1000

function isActor(x: object): x is Actor {
  return typeof (x as Actor).raycast === 'function' && typeof (x as Actor).id === 'number'
}

export function encodeValue(x: unknown, netId: (a: Actor) => number): unknown {
  if (x === null || typeof x !== 'object') return x
  if (x instanceof Vector3) return { $v: v3(x) }
  if (Array.isArray(x)) return x.map((e) => encodeValue(e, netId))
  if (isActor(x)) return { $a: netId(x) }
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(x)) out[k] = encodeValue(val, netId)
  return out
}

/** Returns undefined when it references an actor this peer doesn't know (the event is then dropped). */
export function decodeValue(x: unknown, actor: (id: number) => Actor | null): unknown {
  if (x === null || typeof x !== 'object') return x
  if (Array.isArray(x)) {
    const out = x.map((e) => decodeValue(e, actor))
    return out.includes(undefined) ? undefined : out
  }
  const o = x as Record<string, unknown>
  if (Array.isArray(o.$v)) {
    const [a, b, c] = o.$v as number[]
    return new Vector3(a, b, c)
  }
  if (typeof o.$a === 'number') return actor(o.$a) ?? undefined
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(o)) {
    const d = decodeValue(val, actor)
    if (d === undefined) return undefined
    out[k] = d
  }
  return out
}
