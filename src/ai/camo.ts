import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three'
import { seeded } from '../core/math'

/** Soldier texture atlas: 6x6 tiles of 256px. Vertex colours tint each tile. */
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
  /** Head unwraps (sphere UVs: seam at the back, face centred at u = 0.5). */
  FACE_CLEAN: 16,
  FACE_STUBBLE: 17,
  FACE_BEARD: 18,
  BALACLAVA: 19,
  GREY: 20,
  TAN_SHIRT: 21,
  OLIVE_PLAIN: 22,
  SHEMAGH_WRAP: 23,
  SHEMAGH_WRAP_RED: 24,
} as const

const TILE_PX = 256
export const COLS = 6
export const MARGIN = 0.07

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

function checker(ctx: CanvasRenderingContext2D, ox: number, oy: number, base: string, line: string, rnd: () => number, cell = 32) {
  ctx.fillStyle = base
  ctx.fillRect(ox, oy, TILE_PX, TILE_PX)
  ctx.fillStyle = line
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

/** Atlas pixel for a tile-local uv (v up), honouring the margin used by the mesh UVs. */
function px(ox: number, oy: number, u: number, v: number): [number, number] {
  const k = 1 - 2 * MARGIN
  return [ox + (MARGIN + u * k) * TILE_PX, oy + (1 - (MARGIN + v * k)) * TILE_PX]
}

function blob(ctx: CanvasRenderingContext2D, ox: number, oy: number, u: number, v: number, ru: number, rv: number, inner: string, outer: string) {
  const [x, y] = px(ox, oy, u, v)
  const k = (1 - 2 * MARGIN) * TILE_PX
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(ru * k, rv * k)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  g.addColorStop(0, inner)
  g.addColorStop(1, outer)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, 1, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function stroke(ctx: CanvasRenderingContext2D, ox: number, oy: number, pts: [number, number][], width: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  pts.forEach(([u, v], i) => {
    const [x, y] = px(ox, oy, u, v)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
}

/**
 * Head unwrap (sphere UVs, seam at the back): face centred at u = 0.5, the
 * soldier's right ear at u = 0.25, left at 0.75; v = 0 chin … 1 crown.
 * Painted near the base skin tone so the per-bot vertex skin colour tints it.
 * variant: 0 clean-shaven, 1 stubble, 2 full beard.
 */
function paintFace(ctx: CanvasRenderingContext2D, ox: number, oy: number, variant: number, rnd: () => number) {
  // Per-pixel pass: skin tone variation, shading, hair cap, facial hair.
  const img = ctx.getImageData(ox, oy, TILE_PX, TILE_PX)
  const d = img.data
  const k = 1 - 2 * MARGIN
  const sm = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
  }
  const g2 = (x: number, y: number, sx: number, sy: number) => Math.exp(-(x * x) / (2 * sx * sx) - (y * y) / (2 * sy * sy))
  // Cheap value noise.
  const N = 64
  const grid = new Float32Array(N * N).map(() => rnd())
  const noise = (x: number, y: number) => {
    const fx = ((x % 1) + 1) % 1 * N
    const fy = ((y % 1) + 1) % 1 * N
    const ix = Math.floor(fx), iy = Math.floor(fy)
    const tx = fx - ix, ty = fy - iy
    const a = grid[(iy % N) * N + (ix % N)]!, b = grid[(iy % N) * N + ((ix + 1) % N)]!
    const c = grid[((iy + 1) % N) * N + (ix % N)]!, e = grid[((iy + 1) % N) * N + ((ix + 1) % N)]!
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty
  }
  const hair = [58, 42, 30]
  for (let py = 0; py < TILE_PX; py++) {
    for (let pxl = 0; pxl < TILE_PX; pxl++) {
      const u = (pxl / TILE_PX - MARGIN) / k
      const v = (1 - py / TILE_PX - MARGIN) / k
      const phi = (u - 0.5) * Math.PI * 2 // 0 = face centre, ±π = back
      const ap = Math.abs(phi)
      const du = u - 0.5
      // Skin base with blotchy variation.
      const n1 = noise(u * 3, v * 3), n2 = noise(u * 11 + 5, v * 11)
      let r = 214 + (n1 - 0.5) * 18 + (n2 - 0.5) * 8
      let g = 170 + (n1 - 0.5) * 14 + (n2 - 0.5) * 6
      let b = 134 + (n1 - 0.5) * 10 + (n2 - 0.5) * 5
      // Shading: sockets, under brow, nose sides, cheek warmth, jaw/neck shadow, temples.
      let shade = 0
      for (const eu of [-0.062, 0.062]) shade += 0.3 * g2(du - eu, v - 0.535, 0.032, 0.03)
      shade += 0.12 * g2(du, v - 0.565, 0.11, 0.018)
      shade += 0.1 * (g2(du - 0.022, v - 0.46, 0.008, 0.06) + g2(du + 0.022, v - 0.46, 0.008, 0.06))
      shade += 0.25 * (1 - sm(0.02, 0.16, v)) * (1 - sm(1.3, 1.7, ap))
      shade += 0.08 * sm(0.6, 1.3, ap)
      const warm = 0.16 * (g2(du - 0.06, v - 0.4, 0.04, 0.05) + g2(du + 0.06, v - 0.4, 0.04, 0.05)) + 0.08 * g2(du, v - 0.43, 0.012, 0.03)
      r = r * (1 - shade) + warm * 40
      g = g * (1 - shade) - warm * 18
      b = b * (1 - shade) - warm * 16
      // Facial hair coverage (U around the jaw, up the sideburns).
      let fh = 0
      if (variant > 0 && ap < 1.5) {
        const jawTop = 0.345 + 0.04 * sm(0.5, 1.1, ap) + 0.2 * sm(1.0, 1.4, ap)
        fh = 1 - sm(jawTop - 0.035, jawTop + 0.01, v + (noise(u * 30, v * 30) - 0.5) * 0.03)
        // Mouth opening.
        fh *= 1 - g2(du, v - 0.295, 0.03, 0.011) * 0.95
        fh *= 1 - sm(1.35, 1.5, ap)
      }
      if (fh > 0) {
        const dens = variant === 2 ? 0.92 : 0.42
        const speck = variant === 2 ? 0.75 + 0.25 * noise(u * 90, v * 60) : (noise(u * 140, v * 140) > 0.45 ? 1 : 0.35)
        const a = fh * dens * speck
        r = r * (1 - a) + hair[0]! * a
        g = g * (1 - a) + hair[1]! * a
        b = b * (1 - a) + hair[2]! * a
      } else if (variant === 0 && ap < 1.4 && v < 0.36) {
        // Faint shave shadow.
        const a = 0.08 * (1 - sm(0.3, 0.36, v))
        r -= a * 60
        g -= a * 50
        b -= a * 40
      }
      // Hair cap: hairline high at the front, over the ears, down to the nape at the back.
      const hl = 0.735 - 0.1 * sm(0.4, 1.2, ap) + 0.04 * g2(ap - 1.57, 0, 0.25, 1) - 0.36 * sm(1.75, 2.6, ap)
      const ha = sm(hl - 0.012, hl + 0.025, v + (noise(u * 40, v * 25) - 0.5) * 0.025)
      if (ha > 0) {
        const strand = 0.8 + 0.4 * noise(u * 120, v * 30)
        r = r * (1 - ha) + hair[0]! * strand * ha
        g = g * (1 - ha) + hair[1]! * strand * ha
        b = b * (1 - ha) + hair[2]! * strand * ha
      }
      const o = (py * TILE_PX + pxl) * 4
      d[o] = Math.max(0, Math.min(255, r))
      d[o + 1] = Math.max(0, Math.min(255, g))
      d[o + 2] = Math.max(0, Math.min(255, b))
      d[o + 3] = 255
    }
  }
  ctx.putImageData(img, ox, oy)
  // Features.
  for (const eu of [0.438, 0.562]) {
    stroke(ctx, ox, oy, [[eu - 0.026, 0.528], [eu - 0.01, 0.546], [eu + 0.012, 0.546], [eu + 0.026, 0.53]], 2.6, 'rgba(30,18,12,0.9)')
    stroke(ctx, ox, oy, [[eu - 0.022, 0.514], [eu, 0.506], [eu + 0.022, 0.515]], 1.4, 'rgba(110,60,45,0.45)')
  }
  const brow = variant === 2 ? 6 : 5
  stroke(ctx, ox, oy, [[0.398, 0.583], [0.418, 0.598], [0.445, 0.6], [0.474, 0.59]], brow, 'rgba(48,32,22,0.92)')
  stroke(ctx, ox, oy, [[0.602, 0.583], [0.582, 0.598], [0.555, 0.6], [0.526, 0.59]], brow, 'rgba(48,32,22,0.92)')
  blob(ctx, ox, oy, 0.489, 0.418, 0.007, 0.005, 'rgba(50,25,20,0.8)', 'rgba(50,25,20,0)')
  blob(ctx, ox, oy, 0.511, 0.418, 0.007, 0.005, 'rgba(50,25,20,0.8)', 'rgba(50,25,20,0)')
  stroke(ctx, ox, oy, [[0.466, 0.43], [0.458, 0.37], [0.462, 0.315]], 1.8, 'rgba(110,60,45,0.4)')
  stroke(ctx, ox, oy, [[0.534, 0.43], [0.542, 0.37], [0.538, 0.315]], 1.8, 'rgba(110,60,45,0.4)')
  // Lips.
  blob(ctx, ox, oy, 0.5, 0.309, 0.03, 0.011, 'rgba(150,78,64,0.8)', 'rgba(150,78,64,0)')
  blob(ctx, ox, oy, 0.5, 0.287, 0.024, 0.012, 'rgba(170,96,82,0.55)', 'rgba(170,96,82,0)')
  stroke(ctx, ox, oy, [[0.472, 0.302], [0.49, 0.299], [0.5, 0.301], [0.51, 0.299], [0.528, 0.302]], 2, 'rgba(70,32,26,0.9)')
  if (variant === 2) stroke(ctx, ox, oy, [[0.465, 0.322], [0.5, 0.33], [0.535, 0.322]], 6, 'rgba(50,36,26,0.9)')
}

/** Ribbed knit (balaclava / beanie). */
function paintKnit(ctx: CanvasRenderingContext2D, ox: number, oy: number, base: string, rnd: () => number) {
  ctx.fillStyle = base
  ctx.fillRect(ox, oy, TILE_PX, TILE_PX)
  for (let x = 0; x < TILE_PX; x += 4) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)'
    ctx.fillRect(ox + x, oy, 1.5, TILE_PX)
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(ox + x + 2, oy, 1, TILE_PX)
  }
  for (let y = 0; y < TILE_PX; y += 3) {
    ctx.fillStyle = 'rgba(0,0,0,0.07)'
    ctx.fillRect(ox, oy + y, TILE_PX, 1)
  }
  // Eye-slit hem (stitched edge around the opening, centre front at v ≈ 0.53).
  stroke(ctx, ox, oy, [[0.37, 0.6], [0.63, 0.6]], 5, 'rgba(0,0,0,0.35)')
  stroke(ctx, ox, oy, [[0.37, 0.475], [0.63, 0.475]], 5, 'rgba(0,0,0,0.35)')
  weave(ctx, ox, oy, rnd, 0.1)
}

/** Shemagh wrap: woven check with fringe lines, shaded fold bands. */
function paintWrap(ctx: CanvasRenderingContext2D, ox: number, oy: number, base: string, line: string, rnd: () => number) {
  checker(ctx, ox, oy, base, line, rnd, 16)
  // Diagonal fold shadows / highlights.
  for (let i = 0; i < 14; i++) {
    const y = rnd() * TILE_PX
    ctx.strokeStyle = i % 2 ? 'rgba(0,0,0,0.18)' : 'rgba(255,250,235,0.14)'
    ctx.lineWidth = 3 + rnd() * 6
    ctx.beginPath()
    ctx.moveTo(ox, oy + y)
    ctx.bezierCurveTo(ox + 80, oy + y - 30 + rnd() * 60, ox + 170, oy + y - 30 + rnd() * 60, ox + TILE_PX, oy + y + rnd() * 40 - 20)
    ctx.stroke()
  }
}

/** Faded denim: lighter knees/thighs, darker seams. */
function denimFade(ctx: CanvasRenderingContext2D, ox: number, oy: number, rnd: () => number) {
  for (let i = 0; i < 6; i++) {
    const g = ctx.createRadialGradient(ox + rnd() * TILE_PX, oy + rnd() * TILE_PX, 0, ox + 128, oy + 128, 120)
    g.addColorStop(0, 'rgba(200,215,230,0.18)')
    g.addColorStop(1, 'rgba(200,215,230,0)')
    ctx.fillStyle = g
    ctx.fillRect(ox, oy, TILE_PX, TILE_PX)
  }
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
  blobCamo(ctx, ox, oy, '#bcab84', ['#938c62', '#82694a', '#d4c7a2', '#625d43'], rnd, 20, 19)
  weave(ctx, ox, oy, rnd)
  ;[ox, oy] = at(TILE.KHAKI)
  plain(ctx, ox, oy, '#a8946a', rnd)
  ;[ox, oy] = at(TILE.OLIVE)
  blobCamo(ctx, ox, oy, '#727a4c', ['#5b6340', '#8a8a60', '#4a5136'], rnd, 22, 22)
  weave(ctx, ox, oy, rnd)
  ;[ox, oy] = at(TILE.DARK)
  plain(ctx, ox, oy, '#57574f', rnd, 0.2)
  ;[ox, oy] = at(TILE.SHEMAGH)
  checker(ctx, ox, oy, '#d8d2c0', '#3a3a34', rnd, 16)
  ;[ox, oy] = at(TILE.DENIM)
  plain(ctx, ox, oy, '#6a7f99', rnd, 0.24)
  denimFade(ctx, ox, oy, rnd)
  ;[ox, oy] = at(TILE.LEATHER)
  plain(ctx, ox, oy, '#5c4636', rnd, 0.2)
  ;[ox, oy] = at(TILE.METAL)
  plain(ctx, ox, oy, '#7b7e80', rnd, 0.06)
  ;[ox, oy] = at(TILE.SKIN)
  plain(ctx, ox, oy, '#d4a883', rnd, 0.05)
  ;[ox, oy] = at(TILE.WHITE)
  plain(ctx, ox, oy, '#e8e4dc', rnd, 0.1)
  ;[ox, oy] = at(TILE.BLACK_NYLON)
  plain(ctx, ox, oy, '#3a3934', rnd, 0.22)
  ;[ox, oy] = at(TILE.COYOTE)
  plain(ctx, ox, oy, '#9c8459', rnd, 0.2)
  ;[ox, oy] = at(TILE.RANGER)
  plain(ctx, ox, oy, '#626a42', rnd, 0.18)
  ;[ox, oy] = at(TILE.KNIT)
  plain(ctx, ox, oy, '#403f3a', rnd, 0.3)
  ;[ox, oy] = at(TILE.SHEMAGH_RED)
  checker(ctx, ox, oy, '#d9d0c0', '#8a2a22', rnd, 16)
  ;[ox, oy] = at(TILE.URBAN)
  blobCamo(ctx, ox, oy, '#6f726f', ['#4d504e', '#8c8f8a', '#34373a'], rnd, 24, 20)
  weave(ctx, ox, oy, rnd)

  ;[ox, oy] = at(TILE.FACE_CLEAN)
  paintFace(ctx, ox, oy, 0, rnd)
  ;[ox, oy] = at(TILE.FACE_STUBBLE)
  paintFace(ctx, ox, oy, 1, rnd)
  ;[ox, oy] = at(TILE.FACE_BEARD)
  paintFace(ctx, ox, oy, 2, rnd)
  ;[ox, oy] = at(TILE.BALACLAVA)
  paintKnit(ctx, ox, oy, '#4a4944', rnd)
  ;[ox, oy] = at(TILE.GREY)
  plain(ctx, ox, oy, '#8d8e88', rnd, 0.22)
  ;[ox, oy] = at(TILE.TAN_SHIRT)
  plain(ctx, ox, oy, '#b39d74', rnd, 0.18)
  ;[ox, oy] = at(TILE.OLIVE_PLAIN)
  plain(ctx, ox, oy, '#6f7650', rnd, 0.2)
  ;[ox, oy] = at(TILE.SHEMAGH_WRAP)
  paintWrap(ctx, ox, oy, '#dcd5c3', '#26261f', rnd)
  ;[ox, oy] = at(TILE.SHEMAGH_WRAP_RED)
  paintWrap(ctx, ox, oy, '#ddd3c2', '#8e2c22', rnd)

  // ORM: G = roughness, B = metalness.
  const orm = document.createElement('canvas')
  orm.width = orm.height = 16 * COLS
  const octx = orm.getContext('2d')!
  const mat: [number, number][] = []
  for (let i = 0; i < COLS * COLS; i++) mat.push([0.92, 0])
  mat[TILE.LEATHER] = [0.55, 0]
  mat[TILE.METAL] = [0.3, 0.85]
  mat[TILE.SKIN] = [0.58, 0]
  mat[TILE.FACE_CLEAN] = mat[TILE.FACE_STUBBLE] = mat[TILE.FACE_BEARD] = [0.6, 0]
  mat[TILE.BLACK_NYLON] = [0.72, 0]
  mat[TILE.DENIM] = [0.84, 0]
  mat[TILE.WHITE] = [0.8, 0]
  mat[TILE.RANGER] = mat[TILE.COYOTE] = [0.8, 0]
  const tpx = 16
  for (let i = 0; i < COLS * COLS; i++) {
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
