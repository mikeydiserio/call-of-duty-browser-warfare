import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three'
import { seeded } from '../core/math'

/** Soldier texture atlas: 4x4 tiles of 256px. Vertex colours tint each tile. */
export const TILE = {
  MULTICAM: 0,
  KHAKI: 1,
  OLIVE: 2,
  DARK: 3,
  SHEMAGH: 4,
  DENIM: 5,
  LEATHER: 6,
  METAL: 7,
  SKIN: 8,
  WHITE: 9,
  BLACK_NYLON: 10,
  COYOTE: 11,
  RANGER: 12,
  KNIT: 13,
  SHEMAGH_RED: 14,
  URBAN: 15,
} as const

const TILE_PX = 256
const COLS = 4
const MARGIN = 0.07

export interface SoldierAtlas {
  map: CanvasTexture
  orm: CanvasTexture
}

let cached: SoldierAtlas | null = null

/** Remap a tile-local uv (0..1) into atlas space (with a safe margin against mip bleeding). */
export function tileU(tile: number, u: number): number {
  const col = tile % COLS
  return (col + MARGIN + u * (1 - 2 * MARGIN)) / COLS
}
export function tileV(tile: number, v: number): number {
  const row = Math.floor(tile / COLS)
  // canvas row 0 is at the top; texture v=1 is the top (flipY).
  return 1 - (row + MARGIN + (1 - v) * (1 - 2 * MARGIN)) / COLS
}

function blobCamo(ctx: CanvasRenderingContext2D, ox: number, oy: number, base: string, colors: string[], rnd: () => number, count: number, size: number) {
  ctx.fillStyle = base
  ctx.fillRect(ox, oy, TILE_PX, TILE_PX)
  for (const c of colors) {
    ctx.fillStyle = c
    for (let i = 0; i < count; i++) {
      const cx = ox + rnd() * TILE_PX
      const cy = oy + rnd() * TILE_PX
      const r = size * (0.5 + rnd())
      const pts = 7 + Math.floor(rnd() * 4)
      const radii: number[] = []
      for (let k = 0; k < pts; k++) radii.push(r * (0.55 + rnd() * 0.7) * (k % 2 ? 1.0 : 1.35))
      ctx.save()
      ctx.beginPath()
      ctx.rect(ox, oy, TILE_PX, TILE_PX)
      ctx.clip()
      // Draw wrapped copies so the camo tiles seamlessly.
      for (const wx of [-TILE_PX, 0, TILE_PX]) {
        for (const wy of [-TILE_PX, 0, TILE_PX]) {
          ctx.beginPath()
          for (let k = 0; k < pts; k++) {
            const a = (k / pts) * Math.PI * 2
            const x = cx + wx + Math.cos(a) * radii[k]! * 1.5
            const y = cy + wy + Math.sin(a) * radii[k]! * 0.8
            if (k === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.closePath()
          ctx.fill()
        }
      }
      ctx.restore()
    }
  }
}

function weave(ctx: CanvasRenderingContext2D, ox: number, oy: number, rnd: () => number, strength = 0.12) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(ox, oy, TILE_PX, TILE_PX)
  ctx.clip()
  // Fine weave lines.
  ctx.fillStyle = `rgba(0,0,0,${strength * 0.6})`
  for (let y = 0; y < TILE_PX; y += 3) ctx.fillRect(ox, oy + y, TILE_PX, 1)
  ctx.fillStyle = `rgba(255,255,255,${strength * 0.35})`
  for (let x = 0; x < TILE_PX; x += 3) ctx.fillRect(ox + x, oy, 1, TILE_PX)
  // Speckle / dirt.
  for (let i = 0; i < 1400; i++) {
    const v = rnd()
    ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.04 + rnd() * 0.08})` : `rgba(255,240,210,${0.03 + rnd() * 0.06})`
    ctx.fillRect(ox + rnd() * TILE_PX, oy + rnd() * TILE_PX, 1 + rnd() * 2, 1 + rnd() * 2)
  }
  // Creases / wear streaks.
  ctx.strokeStyle = 'rgba(0,0,0,0.07)'
  ctx.lineWidth = 2
  for (let i = 0; i < 9; i++) {
    ctx.beginPath()
    const x = ox + rnd() * TILE_PX
    ctx.moveTo(x, oy)
    ctx.bezierCurveTo(x + rnd() * 30 - 15, oy + 80, x + rnd() * 30 - 15, oy + 170, x + rnd() * 20 - 10, oy + TILE_PX)
    ctx.stroke()
  }
  ctx.restore()
}

function plain(ctx: CanvasRenderingContext2D, ox: number, oy: number, color: string, rnd: () => number, strength = 0.12) {
  ctx.fillStyle = color
  ctx.fillRect(ox, oy, TILE_PX, TILE_PX)
  weave(ctx, ox, oy, rnd, strength)
}

function checker(ctx: CanvasRenderingContext2D, ox: number, oy: number, base: string, line: string, rnd: () => number) {
  ctx.fillStyle = base
  ctx.fillRect(ox, oy, TILE_PX, TILE_PX)
  ctx.fillStyle = line
  const cell = 32
  for (let y = 0; y < TILE_PX; y += cell) {
    for (let x = 0; x < TILE_PX; x += cell) {
      if (((x + y) / cell) % 2 === 0) {
        ctx.globalAlpha = 0.55
        ctx.fillRect(ox + x, oy + y, cell, cell)
      }
    }
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = line
  for (let i = 0; i < TILE_PX; i += cell) {
    ctx.fillRect(ox + i, oy, 3, TILE_PX)
    ctx.fillRect(ox, oy + i, TILE_PX, 3)
  }
  weave(ctx, ox, oy, rnd, 0.16)
}

export function createSoldierAtlas(): SoldierAtlas {
  if (cached) return cached
  const size = TILE_PX * COLS
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rnd = seeded(0x5017d1e)
  const at = (t: number) => [(t % COLS) * TILE_PX, Math.floor(t / COLS) * TILE_PX] as const

  let [ox, oy] = at(TILE.MULTICAM)
  blobCamo(ctx, ox, oy, '#a69573', ['#7a7650', '#6b563b', '#c3b48e', '#4c4a35'], rnd, 26, 20)
  weave(ctx, ox, oy, rnd)
  ;[ox, oy] = at(TILE.KHAKI)
  plain(ctx, ox, oy, '#9a8760', rnd)
  ;[ox, oy] = at(TILE.OLIVE)
  blobCamo(ctx, ox, oy, '#565c3b', ['#434a2c', '#6b6a47', '#363a24'], rnd, 22, 22)
  weave(ctx, ox, oy, rnd)
  ;[ox, oy] = at(TILE.DARK)
  plain(ctx, ox, oy, '#2f302d', rnd, 0.2)
  ;[ox, oy] = at(TILE.SHEMAGH)
  checker(ctx, ox, oy, '#d8d2c0', '#1c1c1a', rnd)
  ;[ox, oy] = at(TILE.DENIM)
  plain(ctx, ox, oy, '#43566e', rnd, 0.24)
  ;[ox, oy] = at(TILE.LEATHER)
  plain(ctx, ox, oy, '#3b2f26', rnd, 0.2)
  ;[ox, oy] = at(TILE.METAL)
  plain(ctx, ox, oy, '#7b7e80', rnd, 0.06)
  ;[ox, oy] = at(TILE.SKIN)
  plain(ctx, ox, oy, '#d4a883', rnd, 0.05)
  ;[ox, oy] = at(TILE.WHITE)
  plain(ctx, ox, oy, '#e8e4dc', rnd, 0.1)
  ;[ox, oy] = at(TILE.BLACK_NYLON)
  plain(ctx, ox, oy, '#262624', rnd, 0.22)
  ;[ox, oy] = at(TILE.COYOTE)
  plain(ctx, ox, oy, '#8d7650', rnd, 0.2)
  ;[ox, oy] = at(TILE.RANGER)
  plain(ctx, ox, oy, '#4c5233', rnd, 0.18)
  ;[ox, oy] = at(TILE.KNIT)
  plain(ctx, ox, oy, '#202020', rnd, 0.3)
  ;[ox, oy] = at(TILE.SHEMAGH_RED)
  checker(ctx, ox, oy, '#d9d0c0', '#8a2a22', rnd)
  ;[ox, oy] = at(TILE.URBAN)
  blobCamo(ctx, ox, oy, '#6f726f', ['#4d504e', '#8c8f8a', '#34373a'], rnd, 24, 20)
  weave(ctx, ox, oy, rnd)

  // ORM: G = roughness, B = metalness.
  const orm = document.createElement('canvas')
  orm.width = orm.height = 64
  const octx = orm.getContext('2d')!
  const mat: [number, number][] = []
  for (let i = 0; i < 16; i++) mat.push([0.92, 0])
  mat[TILE.LEATHER] = [0.55, 0]
  mat[TILE.METAL] = [0.3, 0.85]
  mat[TILE.SKIN] = [0.58, 0]
  mat[TILE.BLACK_NYLON] = [0.88, 0]
  const tpx = 64 / COLS
  for (let i = 0; i < 16; i++) {
    const [r, m] = mat[i]!
    octx.fillStyle = `rgb(255,${Math.round(r * 255)},${Math.round(m * 255)})`
    octx.fillRect((i % COLS) * tpx, Math.floor(i / COLS) * tpx, tpx, tpx)
  }

  const map = new CanvasTexture(canvas)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 4
  map.generateMipmaps = true
  map.minFilter = LinearMipmapLinearFilter
  map.magFilter = LinearFilter
  map.wrapS = map.wrapT = RepeatWrapping
  const ormTex = new CanvasTexture(orm)
  ormTex.colorSpace = NoColorSpace
  ormTex.minFilter = LinearFilter
  ormTex.magFilter = LinearFilter
  ormTex.generateMipmaps = false
  cached = { map, orm: ormTex }
  return cached
}
