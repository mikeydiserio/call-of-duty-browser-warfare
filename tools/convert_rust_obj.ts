/**
 * Convert the exported MW2 "mp_rust" OBJ (Z-up, inches) into the compact binary the game loads
 * (Y-up, metres, indexed per material) plus a baked top-down minimap.
 *
 *   bun tools/convert_rust_obj.ts [in=assets-src/maps/mp_rust.obj] [outDir=public/maps]
 *
 * Output:
 *   mp_rust.bin          'RMAP' | u32 version | u32 headerBytes | JSON header | pad4 | per group:
 *                        f32 positions[3n] | i8 normals[3n] (pad4) | u16|u32 indices[m]
 *   mp_rust_minimap.png  512² top-down covering the playable bounds, north (−Z) up
 */
import { deflateSync } from 'node:zlib'

const [inPath = 'assets-src/maps/mp_rust.obj', outDir = 'public/maps'] = process.argv.slice(2)

const INCH = 0.0254
/** Playable yard (the chain-link perimeter), in source units: x east, y north. */
const YARD = { minX: -490, maxX: 1662, minY: -248, maxY: 1846 }
const CX = (YARD.minX + YARD.maxX) / 2
const CY = (YARD.minY + YARD.maxY) / 2
/** Drop backdrop triangles further than this (metres) from the yard centre: the fog eats them anyway. */
const CROP = 520
/** Materials that are never drawn. */
const SKIP = /^shadowcaster$/
/** Overlay layers (CoD blend decals): drawn translucent, never collide, never on the minimap. */
const isDecal = (m: string) => /_dec$|decal|_dec_|stain|oil_leak|grime/.test(m)

// ─── parse ──────────────────────────────────────────────────────────────

const t0 = performance.now()
const text = await Bun.file(inPath).text()
const vx: number[] = []
const vn: number[] = []
const faceMat: number[] = []
const faceV: number[] = []
const faceN: number[] = []
const mats: string[] = []
let cur = -1
let mismatched = 0
let start = 0
while (start < text.length) {
  let end = text.indexOf('\n', start)
  if (end < 0) end = text.length
  const line = text.slice(start, end).trim()
  start = end + 1
  if (line.startsWith('v ')) {
    const p = line.split(/\s+/)
    vx.push(+p[1]!, +p[2]!, +p[3]!)
  } else if (line.startsWith('vn ')) {
    const p = line.split(/\s+/)
    vn.push(+p[1]!, +p[2]!, +p[3]!)
  } else if (line.startsWith('usemtl ')) {
    const name = line.slice(7).trim()
    cur = mats.indexOf(name)
    if (cur < 0) cur = mats.push(name) - 1
  } else if (line.startsWith('f ')) {
    const parts = line.split(/\s+/).slice(1)
    if (parts.length !== 3) throw new Error(`non-triangle face: ${line}`)
    faceMat.push(cur)
    for (const s of parts) {
      const [v, , n] = s.split('/')
      const vi = parseInt(v!, 10) - 1
      const ni = n ? parseInt(n, 10) - 1 : vi
      if (vi !== ni) mismatched++
      faceV.push(vi)
      faceN.push(ni)
    }
  }
}
const faces = faceMat.length
if (mismatched) throw new Error(`${mismatched} face corners use different v/vn indices — reindexing by v alone would be wrong`)

// ─── ground level: most common height of up-facing solid ground inside the yard ───

const hist = new Map<number, number>()
for (let f = 0; f < faces; f++) {
  const m = mats[faceMat[f]!]!
  if (isDecal(m) || SKIP.test(m)) continue
  const a = faceV[f * 3]!
  const x = vx[a * 3]!
  const y = vx[a * 3 + 1]!
  if (x < YARD.minX || x > YARD.maxX || y < YARD.minY || y > YARD.maxY) continue
  if (vn[faceN[f * 3]! * 3 + 2]! < 0.95) continue
  const z = Math.round(vx[a * 3 + 2]! / 2) * 2
  hist.set(z, (hist.get(z) ?? 0) + 1)
}
const GZ = [...hist.entries()].sort((p, q) => q[1] - p[1])[0]![0]

const toGame = (i: number, out: number[]) => {
  out[0] = (vx[i * 3]! - CX) * INCH
  out[1] = (vx[i * 3 + 2]! - GZ) * INCH
  out[2] = -(vx[i * 3 + 1]! - CY) * INCH
}

// ─── group faces by material, fix winding, crop the far backdrop ───

interface Group {
  name: string
  remap: Map<number, number>
  verts: number[]
  tris: number[]
}
const groups = new Map<number, Group>()
const A = [0, 0, 0]
const B = [0, 0, 0]
const C = [0, 0, 0]
let flipped = 0
let cropped = 0
for (let f = 0; f < faces; f++) {
  const mi = faceMat[f]!
  const name = mats[mi]!
  if (SKIP.test(name)) continue
  const ia = faceV[f * 3]!
  let ib = faceV[f * 3 + 1]!
  let ic = faceV[f * 3 + 2]!
  toGame(ia, A)
  toGame(ib, B)
  toGame(ic, C)
  if (Math.hypot((A[0]! + B[0]! + C[0]!) / 3, (A[2]! + B[2]! + C[2]!) / 3) > CROP) {
    cropped++
    continue
  }
  // geometric normal (game space) vs the authored vertex normals → consistent CCW front faces
  const ux = B[0]! - A[0]!, uy = B[1]! - A[1]!, uz = B[2]! - A[2]!
  const wx = C[0]! - A[0]!, wy = C[1]! - A[1]!, wz = C[2]! - A[2]!
  const gx = uy * wz - uz * wy
  const gy = uz * wx - ux * wz
  const gz = ux * wy - uy * wx
  let nx = 0, ny = 0, nz = 0
  for (const i of [ia, ib, ic]) {
    nx += vn[i * 3]!
    ny += vn[i * 3 + 2]!
    nz -= vn[i * 3 + 1]!
  }
  if (gx * nx + gy * ny + gz * nz < 0) {
    ;[ib, ic] = [ic, ib]
    flipped++
  }
  let g = groups.get(mi)
  if (!g) groups.set(mi, (g = { name, remap: new Map(), verts: [], tris: [] }))
  for (const i of [ia, ib, ic]) {
    let k = g.remap.get(i)
    if (k === undefined) {
      k = g.verts.length
      g.remap.set(i, k)
      g.verts.push(i)
    }
    g.tris.push(k)
  }
}

// ─── write the binary ───

const pad4 = (n: number) => (n + 3) & ~3
const P = [0, 0, 0]
const headerGroups: { name: string; decal: boolean; vertices: number; indices: number; index32: boolean; pos: number; nor: number; idx: number }[] = []
const chunks: Uint8Array[] = []
let offset = 0
for (const g of [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const n = g.verts.length
  const pos = new Float32Array(n * 3)
  const nor = new Int8Array(pad4(n * 3))
  for (let k = 0; k < n; k++) {
    const i = g.verts[k]!
    toGame(i, P)
    pos.set(P, k * 3)
    const x = vn[i * 3]!, y = vn[i * 3 + 2]!, z = -vn[i * 3 + 1]!
    const l = Math.hypot(x, y, z) || 1
    nor[k * 3] = Math.round((x / l) * 127)
    nor[k * 3 + 1] = Math.round((y / l) * 127)
    nor[k * 3 + 2] = Math.round((z / l) * 127)
  }
  const index32 = n > 65535
  const idx = index32 ? new Uint32Array(g.tris) : new Uint16Array(g.tris)
  const idxBytes = new Uint8Array(pad4(idx.byteLength))
  idxBytes.set(new Uint8Array(idx.buffer))
  const entry = { name: g.name, decal: isDecal(g.name), vertices: n, indices: g.tris.length, index32, pos: offset, nor: 0, idx: 0 }
  chunks.push(new Uint8Array(pos.buffer))
  offset += pos.byteLength
  entry.nor = offset
  chunks.push(new Uint8Array(nor.buffer))
  offset += nor.byteLength
  entry.idx = offset
  chunks.push(idxBytes)
  offset += idxBytes.byteLength
  headerGroups.push(entry)
}

const bounds = {
  minX: (YARD.minX - CX) * INCH,
  maxX: (YARD.maxX - CX) * INCH,
  minZ: -(YARD.maxY - CY) * INCH,
  maxZ: -(YARD.minY - CY) * INCH,
}
const header = new TextEncoder().encode(
  JSON.stringify({ source: 'mp_rust.obj', units: 'm', groundZ: GZ, origin: [CX, CY], bounds, groups: headerGroups }),
)
const pre = new Uint8Array(12 + pad4(header.length))
const dv = new DataView(pre.buffer)
pre.set(new TextEncoder().encode('RMAP'), 0)
dv.setUint32(4, 1, true)
dv.setUint32(8, header.length, true)
pre.set(header, 12)
await Bun.write(`${outDir}/mp_rust.bin`, new Blob([pre, ...chunks]))

// ─── minimap: top-down raster of the yard, MW2 palette ───

const S = 512
const top = new Float32Array(S * S).fill(-Infinity)
const sx = S / (bounds.maxX - bounds.minX)
const sz = S / (bounds.maxZ - bounds.minZ)
for (const g of groups.values()) {
  if (isDecal(g.name) || /wire|water|fence|vegitation/.test(g.name)) continue
  const pts = g.verts.map((i) => {
    toGame(i, P)
    return [(P[0]! - bounds.minX) * sx, (P[2]! - bounds.minZ) * sz, P[1]!] as const
  })
  for (let t = 0; t < g.tris.length; t += 3) {
    const a = pts[g.tris[t]!]!, b = pts[g.tris[t + 1]!]!, c = pts[g.tris[t + 2]!]!
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])))
    const x1 = Math.min(S - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])))
    const y1 = Math.min(S - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
    if (x0 > x1 || y0 > y1) continue
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if (Math.abs(d) < 1e-9) continue
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5
        const w1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d
        const w2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d
        const w3 = 1 - w1 - w2
        if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue
        const h = w1 * a[2] + w2 * b[2] + w3 * c[2]
        const k = y * S + x
        if (h > top[k]!) top[k] = h
      }
    }
  }
}
const img = new Uint8Array((S * 3 + 1) * S)
const H = (x: number, y: number) => top[Math.min(S - 1, Math.max(0, y)) * S + Math.min(S - 1, Math.max(0, x))]!
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const h = Number.isFinite(top[y * S + x]!) ? top[y * S + x]! : 0
    // ground stays the dark olive base; anything standing up lifts toward pale grey
    const lift = Math.min(1, Math.max(0, (h - 0.35) / 4.5))
    const raised = h > 0.35 ? 0.3 + 0.7 * lift : 0
    const edge = Math.max(...[H(x + 1, y), H(x - 1, y), H(x, y + 1), H(x, y - 1)].map((n) => Math.abs((Number.isFinite(n) ? n : 0) - h))) > 0.6
    // soft radial falloff like the procedural map's ground gradient
    const r = Math.hypot(x - S / 2, y - S / 2) / (S * 0.75)
    let R = 75 - 19 * r, G = 77 - 19 * r, Bc = 62 - 15 * r
    R += raised * 70; G += raised * 69; Bc += raised * 60
    if (edge) { R += 34; G += 34; Bc += 30 }
    const o = y * (S * 3 + 1) + 1 + x * 3
    img[o] = Math.min(255, R)
    img[o + 1] = Math.min(255, G)
    img[o + 2] = Math.min(255, Bc)
  }
}
const crcT = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (b: Uint8Array) => {
  let c = 0xffffffff
  for (const v of b) c = crcT[(c ^ v) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Uint8Array) => {
  const b = new Uint8Array(12 + data.length)
  const v = new DataView(b.buffer)
  v.setUint32(0, data.length)
  b.set(new TextEncoder().encode(type), 4)
  b.set(data, 8)
  v.setUint32(8 + data.length, crc(b.subarray(4, 8 + data.length)))
  return b
}
const ihdr = new Uint8Array(13)
new DataView(ihdr.buffer).setUint32(0, S)
new DataView(ihdr.buffer).setUint32(4, S)
ihdr[8] = 8
ihdr[9] = 2
await Bun.write(
  `${outDir}/mp_rust_minimap.png`,
  new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(img)), chunk('IEND', new Uint8Array())]),
)

const tris = headerGroups.reduce((s, g) => s + g.indices / 3, 0)
console.log(
  `mp_rust: ${faces} faces → ${tris} kept (${cropped} cropped, ${flipped} rewound) in ${headerGroups.length} groups, ` +
    `ground z ${GZ}, ${((pre.length + offset) / 1e6).toFixed(1)} MB, ${(performance.now() - t0).toFixed(0)} ms`,
)
console.log('bounds', bounds)
