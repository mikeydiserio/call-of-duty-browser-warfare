/**
 * MW2-style minimap: dark desaturated olive ground, lighter footprints with subtle outlines.
 * North-up: canvas covers exactly `bounds`, +X right, −Z up.
 */
import type { Vector3 } from 'three'
import type { Footprint } from './props'
import type { Track } from './terrain'

export function drawMinimap(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, fps: Footprint[], tracks: Track[], pipes: Vector3[][]): HTMLCanvasElement {
  const S = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const g = cv.getContext('2d')!
  const sx = S / (bounds.maxX - bounds.minX)
  const sz = S / (bounds.maxZ - bounds.minZ)
  const X = (x: number) => (x - bounds.minX) * sx
  const Z = (z: number) => (z - bounds.minZ) * sz

  // ground
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.75)
  grd.addColorStop(0, '#4b4d3e')
  grd.addColorStop(1, '#383a2f')
  g.fillStyle = grd
  g.fillRect(0, 0, S, S)
  // grain
  let seed = 7
  for (let i = 0; i < 9000; i++) {
    seed = (seed * 16807) % 2147483647
    const x = seed % S
    seed = (seed * 16807) % 2147483647
    const y = seed % S
    g.fillStyle = seed % 2 ? 'rgba(255,255,240,0.035)' : 'rgba(0,0,0,0.05)'
    g.fillRect(x, y, 2, 2)
  }
  // tracks
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const t of tracks) {
    g.strokeStyle = 'rgba(105,104,86,0.55)'
    g.lineWidth = t.width * sx
    g.beginPath()
    t.pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))))
    g.stroke()
  }
  // pipes
  for (const p of pipes) {
    g.strokeStyle = '#7d7c68'
    g.lineWidth = Math.max(3, 1.2 * sx)
    g.beginPath()
    p.forEach((v, i) => (i ? g.lineTo(X(v.x), Z(v.z)) : g.moveTo(X(v.x), Z(v.z))))
    g.stroke()
  }
  const order: Record<string, number> = { road: 0, pad: 1, low: 2, pipe: 3, tank: 4, container: 5, derrick: 6, building: 7, tower: 8 }
  const style: Record<string, [string, string]> = {
    pad: ['#5e5f4f', '#77786a'],
    low: ['#6c6c5b', '#85857a'],
    pipe: ['#7a7966', '#8f8e7c'],
    tank: ['#8a8a7a', '#a5a596'],
    container: ['#6e6f62', '#9a9a8c'],
    derrick: ['#5d5d50', '#a0a090'],
    building: ['#8e8e7f', '#b4b4a6'],
    tower: ['#9c9b8a', '#cfcebd'],
    road: ['rgba(150,150,130,0.6)', 'rgba(150,150,130,0.6)'],
  }
  const sorted = fps.slice().sort((a, b) => (order[a.kind] ?? 0) - (order[b.kind] ?? 0))
  for (const f of sorted) {
    const [fill, line] = style[f.kind] ?? ['#777', '#999']
    g.save()
    g.translate(X(f.x), Z(f.z))
    // world ry rotates +X towards −Z (CCW seen from above); canvas +y is +Z so negate.
    g.rotate(-f.ry)
    const w = f.w * sx
    const d = Math.max(f.d * sz, f.kind === 'road' ? 1.2 : 2)
    if (f.kind === 'road') {
      g.fillStyle = fill
      g.fillRect(-w / 2, -0.75, w, 1.5)
    } else {
      g.fillStyle = f.fill ? blend(f.fill, fill) : fill
      g.fillRect(-w / 2, -d / 2, w, d)
      g.strokeStyle = line
      g.lineWidth = f.kind === 'tower' || f.kind === 'building' ? 2 : 1
      g.strokeRect(-w / 2 + 0.5, -d / 2 + 0.5, w - 1, d - 1)
      if (f.kind === 'tower') {
        g.strokeStyle = 'rgba(40,40,30,0.6)'
        g.beginPath()
        g.moveTo(-w / 2, -d / 2)
        g.lineTo(w / 2, d / 2)
        g.moveTo(w / 2, -d / 2)
        g.lineTo(-w / 2, d / 2)
        g.stroke()
      }
      if (f.kind === 'derrick') {
        g.strokeStyle = line
        g.beginPath()
        g.moveTo(-w / 2, -d / 2)
        g.lineTo(w / 2, d / 2)
        g.moveTo(w / 2, -d / 2)
        g.lineTo(-w / 2, d / 2)
        g.stroke()
      }
    }
    g.restore()
  }
  // vignette edge
  const v = g.createRadialGradient(S / 2, S / 2, S * 0.45, S / 2, S / 2, S * 0.72)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.35)')
  g.fillStyle = v
  g.fillRect(0, 0, S, S)
  return cv
}

function blend(a: string, b: string) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const r = (((pa >> 16) & 255) * 0.6 + ((pb >> 16) & 255) * 0.4) | 0
  const g = (((pa >> 8) & 255) * 0.6 + ((pb >> 8) & 255) * 0.4) | 0
  const bl = ((pa & 255) * 0.6 + (pb & 255) * 0.4) | 0
  return `rgb(${r},${g},${bl})`
}
