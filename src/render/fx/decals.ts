/**
 * Pooled world decals: bullet holes per surface, blood splats, grenade scorches. One
 * InstancedMesh (one draw call) over a procedural 4×4 atlas, lit like the world
 * (MeshStandardMaterial patched for per-instance atlas frame / opacity / heat glow).
 * The oldest decals fade out as the ring buffer wraps; nothing is allocated per shot.
 */
import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type WebGLRenderer,
} from 'three'

/** Atlas frames (4×4). */
export const DECAL = {
  concrete: [0, 1],
  metal: [2, 3],
  wood: [4, 5],
  sand: [6, 7],
  glass: [8],
  blood: [9, 10, 11],
  scorch: [12, 13],
  bloodPool: [14],
  chip: [15],
} as const

const FADE_TAIL = 24
const _m = new Matrix4()
const _q = new Quaternion()
const _qr = new Quaternion()
const _s = new Vector3()
const _p = new Vector3()
const Z = new Vector3(0, 0, 1)

export class DecalPool {
  readonly mesh: InstancedMesh
  readonly cap: number
  private aDecal: Float32Array
  private attr: InstancedBufferAttribute
  private seq: Int32Array
  /** remaining heat seconds per decal (metal holes glow briefly). */
  private heat: Float32Array
  private counter = 0
  private head = 0
  private used = 0
  private hot = 0

  constructor(cap: number, renderer: WebGLRenderer) {
    this.cap = cap
    const tex = new CanvasTexture(drawAtlas())
    tex.colorSpace = SRGBColorSpace
    tex.minFilter = LinearMipmapLinearFilter
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    const mat = new MeshStandardMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      roughness: 0.92,
      metalness: 0,
      alphaTest: 0.01,
    })
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec4 aDecal;\nvarying float vDecalA;\nvarying float vDecalHeat;',
        )
        .replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\nvMapUv = (uv + aDecal.xy) * 0.25;\nvDecalA = aDecal.z;\nvDecalHeat = aDecal.w;',
        )
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDecalA;\nvarying float vDecalHeat;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vDecalA;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.36, 0.07) * vDecalHeat * vDecalHeat * smoothstep(0.35, 0.8, sampledDiffuseColor.r) * 9.0;',
        )
    }
    const geo = new PlaneGeometry(1, 1)
    this.aDecal = new Float32Array(cap * 4)
    this.attr = new InstancedBufferAttribute(this.aDecal, 4)
    this.attr.setUsage(DynamicDrawUsage)
    geo.setAttribute('aDecal', this.attr)
    this.mesh = new InstancedMesh(geo, mat, cap)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.receiveShadow = true
    this.mesh.castShadow = false
    this.mesh.renderOrder = 2
    this.seq = new Int32Array(cap)
    this.heat = new Float32Array(cap)
  }

  /** Place a decal at `point` facing `normal`. size in metres. heat 0..1 = glowing rim (metal). */
  add(point: Vector3, normal: Vector3, frame: number, size: number, heat = 0, roll = Math.random() * Math.PI * 2) {
    const i = this.head
    this.head = (this.head + 1) % this.cap
    if (this.used < this.cap) this.used++
    _q.setFromUnitVectors(Z, normal)
    _qr.setFromAxisAngle(Z, roll)
    _q.multiply(_qr)
    _p.copy(point).addScaledVector(normal, 0.004 + Math.random() * 0.004)
    _s.set(size, size, size)
    _m.compose(_p, _q, _s)
    this.mesh.setMatrixAt(i, _m)
    this.mesh.instanceMatrix.needsUpdate = true
    const o = i * 4
    this.aDecal[o] = frame % 4
    this.aDecal[o + 1] = 3 - Math.floor(frame / 4)
    this.aDecal[o + 2] = 1
    this.aDecal[o + 3] = heat
    this.heat[i] = heat
    if (heat > 0) this.hot++
    this.seq[i] = this.counter++
    this.mesh.count = this.used
    this.refade()
  }

  private refade() {
    // The FADE_TAIL oldest decals (only once the ring is full) fade toward zero.
    if (this.used < this.cap) {
      this.attr.needsUpdate = true
      return
    }
    for (let i = 0; i < this.cap; i++) {
      const rank = this.counter - 1 - this.seq[i]! // 0 newest .. cap-1 oldest
      const left = this.cap - 1 - rank
      this.aDecal[i * 4 + 2] = left < FADE_TAIL ? left / FADE_TAIL : 1
    }
    this.attr.needsUpdate = true
  }

  update(dt: number) {
    if (dt <= 0 || this.hot === 0) return
    let hot = 0
    for (let i = 0; i < this.used; i++) {
      const h = this.heat[i]!
      if (h <= 0) continue
      const nh = Math.max(0, h - dt * 0.9)
      this.heat[i] = nh
      this.aDecal[i * 4 + 3] = nh
      if (nh > 0) hot++
    }
    this.hot = hot
    this.attr.needsUpdate = true
  }

  clear() {
    this.used = 0
    this.head = 0
    this.hot = 0
    this.mesh.count = 0
  }
}

// ─── procedural atlas ─────────────────────────────────────────────────────────

function drawAtlas(): HTMLCanvasElement {
  const T = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = T * 4
  const ctx = cv.getContext('2d')!
  let seed = 9187
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const cell = (f: number, draw: () => void) => {
    ctx.save()
    ctx.translate((f % 4) * T + T / 2, Math.floor(f / 4) * T + T / 2)
    ctx.beginPath()
    ctx.rect(-T / 2, -T / 2, T, T)
    ctx.clip()
    draw()
    ctx.restore()
  }
  const radial = (r: number, stops: [number, string][]) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    for (const [o, c] of stops) g.addColorStop(o, c)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
  }
  /** Irregular blob path. */
  const blob = (r: number, jag: number, n = 18) => {
    ctx.beginPath()
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const rr = r * (1 - jag + rnd() * jag * 2)
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr)
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
    }
    ctx.closePath()
  }

  // concrete: chipped crater, grey dust ring, dark core
  for (const f of DECAL.concrete) {
    cell(f, () => {
      radial(110, [
        [0, 'rgba(70,66,60,0.55)'],
        [0.5, 'rgba(110,104,96,0.35)'],
        [1, 'rgba(120,115,105,0)'],
      ])
      ctx.fillStyle = 'rgba(150,145,135,0.85)'
      blob(46, 0.35, 14)
      ctx.fill()
      ctx.fillStyle = 'rgba(85,80,74,0.95)'
      blob(30, 0.3, 12)
      ctx.fill()
      radial(18, [
        [0, 'rgba(8,8,8,1)'],
        [0.7, 'rgba(20,19,18,1)'],
        [1, 'rgba(40,38,36,0.9)'],
      ])
      // radial cracks
      ctx.strokeStyle = 'rgba(40,38,35,0.7)'
      ctx.lineWidth = 2
      for (let i = 0; i < 6; i++) {
        const a = rnd() * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * 20, Math.sin(a) * 20)
        let x = Math.cos(a) * 20
        let y = Math.sin(a) * 20
        for (let k = 0; k < 4; k++) {
          const aa = a + (rnd() - 0.5) * 0.8
          x += Math.cos(aa) * (8 + rnd() * 12)
          y += Math.sin(aa) * (8 + rnd() * 12)
          ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    })
  }
  // metal: punched hole with bright bare-steel rim + soot ring
  for (const f of DECAL.metal) {
    cell(f, () => {
      radial(90, [
        [0, 'rgba(20,16,12,0.75)'],
        [0.45, 'rgba(40,30,22,0.4)'],
        [1, 'rgba(40,30,22,0)'],
      ])
      radial(34, [
        [0, 'rgba(255,250,235,1)'],
        [0.6, 'rgba(225,215,195,1)'],
        [1, 'rgba(160,150,135,0)'],
      ])
      // petals of torn metal
      ctx.fillStyle = 'rgba(200,192,175,0.95)'
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rnd() * 0.5
        ctx.beginPath()
        ctx.moveTo(Math.cos(a - 0.25) * 16, Math.sin(a - 0.25) * 16)
        ctx.lineTo(Math.cos(a) * (28 + rnd() * 10), Math.sin(a) * (28 + rnd() * 10))
        ctx.lineTo(Math.cos(a + 0.25) * 16, Math.sin(a + 0.25) * 16)
        ctx.fill()
      }
      radial(17, [
        [0, 'rgba(0,0,0,1)'],
        [0.85, 'rgba(10,8,6,1)'],
        [1, 'rgba(60,55,50,1)'],
      ])
    })
  }
  // wood: dark hole, light splintered fibres along the grain
  for (const f of DECAL.wood) {
    cell(f, () => {
      radial(80, [
        [0, 'rgba(60,40,22,0.5)'],
        [1, 'rgba(60,40,22,0)'],
      ])
      ctx.strokeStyle = 'rgba(225,190,140,0.95)'
      for (let i = 0; i < 26; i++) {
        ctx.lineWidth = 1.5 + rnd() * 3
        const y = (rnd() - 0.5) * 50
        const len = 20 + rnd() * 50
        const x0 = (rnd() - 0.5) * 20
        ctx.beginPath()
        ctx.moveTo(x0 - len * 0.5, y)
        ctx.lineTo(x0 + len * 0.5, y + (rnd() - 0.5) * 6)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(30,18,10,1)'
      blob(18, 0.25, 10)
      ctx.fill()
      radial(12, [
        [0, 'rgba(0,0,0,1)'],
        [1, 'rgba(20,12,6,1)'],
      ])
    })
  }
  // sand / dirt: soft dark crater + scattered darker grains
  for (const f of DECAL.sand) {
    cell(f, () => {
      radial(100, [
        [0, 'rgba(60,42,25,0.75)'],
        [0.4, 'rgba(85,65,42,0.45)'],
        [1, 'rgba(110,88,60,0)'],
      ])
      for (let i = 0; i < 70; i++) {
        const a = rnd() * Math.PI * 2
        const d = 20 + rnd() * 80
        ctx.fillStyle = `rgba(${70 + rnd() * 40},${52 + rnd() * 30},${30 + rnd() * 20},${0.5 + rnd() * 0.4})`
        ctx.beginPath()
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 1 + rnd() * 3, 0, Math.PI * 2)
        ctx.fill()
      }
      radial(22, [
        [0, 'rgba(30,20,12,0.95)'],
        [1, 'rgba(30,20,12,0)'],
      ])
    })
  }
  // glass: white crack star with concentric fractures
  for (const f of DECAL.glass) {
    cell(f, () => {
      ctx.strokeStyle = 'rgba(235,240,245,0.9)'
      const rays = 9
      const ends: [number, number][] = []
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2 + rnd() * 0.4
        ctx.lineWidth = 1.2 + rnd()
        let x = 0
        let y = 0
        ctx.beginPath()
        ctx.moveTo(0, 0)
        const len = 60 + rnd() * 60
        for (let k = 1; k <= 5; k++) {
          const aa = a + (rnd() - 0.5) * 0.25
          x = Math.cos(aa) * (len * k) / 5
          y = Math.sin(aa) * (len * k) / 5
          ctx.lineTo(x, y)
          if (k === 2) ends.push([x, y])
        }
        ctx.stroke()
      }
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i < ends.length; i++) {
        const [x, y] = ends[i]!
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.stroke()
      radial(16, [
        [0, 'rgba(255,255,255,0.95)'],
        [0.5, 'rgba(220,228,235,0.8)'],
        [1, 'rgba(220,228,235,0)'],
      ])
    })
  }
  // blood spatter (wall)
  for (const f of DECAL.blood) {
    cell(f, () => {
      const dark = () => `rgba(${70 + rnd() * 30},${4 + rnd() * 6},${4 + rnd() * 4},${0.85 + rnd() * 0.15})`
      ctx.fillStyle = dark()
      blob(40 + rnd() * 15, 0.4, 16)
      ctx.fill()
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2
        const d = 30 + rnd() * 85
        ctx.fillStyle = dark()
        ctx.beginPath()
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 1.5 + rnd() * 7 * (1 - d / 130), 0, Math.PI * 2)
        ctx.fill()
      }
      // drips
      for (let i = 0; i < 3; i++) {
        const x = (rnd() - 0.5) * 50
        ctx.strokeStyle = dark()
        ctx.lineWidth = 2 + rnd() * 4
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x, 10)
        ctx.lineTo(x + (rnd() - 0.5) * 4, 40 + rnd() * 70)
        ctx.stroke()
      }
    })
  }
  // grenade scorch
  for (const f of DECAL.scorch) {
    cell(f, () => {
      radial(126, [
        [0, 'rgba(8,6,5,0.95)'],
        [0.35, 'rgba(18,14,11,0.85)'],
        [0.7, 'rgba(35,28,22,0.45)'],
        [1, 'rgba(40,32,25,0)'],
      ])
      ctx.strokeStyle = 'rgba(10,8,6,0.6)'
      for (let i = 0; i < 40; i++) {
        const a = rnd() * Math.PI * 2
        const r0 = 30 + rnd() * 30
        const r1 = r0 + 30 + rnd() * 60
        ctx.lineWidth = 1 + rnd() * 4
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
        ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
        ctx.stroke()
      }
    })
  }
  // floor blood pool
  for (const f of DECAL.bloodPool) {
    cell(f, () => {
      ctx.fillStyle = 'rgba(62,3,3,0.92)'
      blob(55, 0.3, 20)
      ctx.fill()
      ctx.fillStyle = 'rgba(40,2,2,0.9)'
      blob(30, 0.3, 14)
      ctx.fill()
    })
  }
  // small chip (concrete without hole)
  for (const f of DECAL.chip) {
    cell(f, () => {
      radial(60, [
        [0, 'rgba(160,155,145,0.9)'],
        [0.6, 'rgba(120,115,105,0.5)'],
        [1, 'rgba(120,115,105,0)'],
      ])
    })
  }
  return cv
}
