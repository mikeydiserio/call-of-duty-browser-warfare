/**
 * Pooled GPU-instanced particle batches. Two draw calls cover every effect:
 *  - BillboardBatch: camera-facing sprites (smoke, dust, fire, flashes, motes), depth-sorted
 *  - StreakBatch:    world-space ribbons (tracers, sparks, splinters, muzzle cones, wind wisps)
 * Both render with premultiplied alpha; `add` (0..1) lerps between alpha-blend and additive
 * so a single material handles dust and fire together. Nothing allocates per particle.
 */
import {
  AdditiveBlending,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  type PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  type Texture,
  Uint16BufferAttribute,
  CustomBlending,
  DoubleSide,
  OneFactor,
  OneMinusSrcAlphaFactor,
  AddEquation,
  type Vector3,
} from 'three'

export const KIND_PUFF = 0
export const KIND_FIRE = 1
export const KIND_DOT = 2
export const KIND_STAR = 3
export const KIND_GLOW = 4

/** Reusable spec so spawning never allocates. Fill, then batch.emit(spec). */
export class Spec {
  x = 0
  y = 0
  z = 0
  vx = 0
  vy = 0
  vz = 0
  life = 1
  delay = 0
  s0 = 1
  s1 = 1
  rot = 0
  rv = 0
  drag = 0
  grav = 0
  r0 = 1
  g0 = 1
  b0 = 1
  a0 = 1
  r1 = 1
  g1 = 1
  b1 = 1
  a1 = 0
  kind = KIND_PUFF
  frame = 0
  add = 0
  heat0 = 1
  heat1 = 0
  seed = 0
  /** 0 none, 1 collide with world (bounce), 2 collide + stick/die */
  collide = 0
  bounce = 0.35
  /** streak: tail length in seconds of velocity. */
  trail = 0.04
  /** streak: ribbon width (m). */
  width = 0.02
  /** streak/tracer: total travel distance before dying (0 = unlimited). */
  maxDist = 0
  /** pixel-min width/size. */
  fadeIn = 0.05

  reset(): this {
    this.x = this.y = this.z = this.vx = this.vy = this.vz = 0
    this.life = 1
    this.delay = 0
    this.s0 = this.s1 = 1
    this.rot = this.rv = this.drag = this.grav = 0
    this.r0 = this.g0 = this.b0 = this.a0 = 1
    this.r1 = this.g1 = this.b1 = 1
    this.a1 = 0
    this.kind = KIND_PUFF
    this.frame = 0
    this.add = 0
    this.heat0 = 1
    this.heat1 = 0
    this.seed = 0
    this.collide = 0
    this.bounce = 0.35
    this.trail = 0.04
    this.width = 0.02
    this.maxDist = 0
    this.fadeIn = 0.05
    return this
  }

  pos(p: Vector3): this {
    this.x = p.x
    this.y = p.y
    this.z = p.z
    return this
  }
}

export type CollideFn = (
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  dist: number,
  out: Float32Array,
) => boolean

const BILLBOARD_VERT = /* glsl */ `
attribute vec4 aPosSize;   // xyz, size
attribute vec4 aRotKind;   // rot, kind, frame, add
attribute vec4 aCol;
attribute vec4 aParam;     // heat, seed, _, _
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vRK;
varying vec4 vParam;
varying float vNear;
void main(){
  vUv = position.xy + 0.5;
  vCol = aCol;
  vRK = aRotKind;
  vParam = aParam;
  vec4 mv = viewMatrix * vec4(aPosSize.xyz, 1.0);
  float c = cos(aRotKind.x), s = sin(aRotKind.x);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
  mv.xy += q * aPosSize.w;
  vNear = smoothstep(0.12, 1.4, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`

const BILLBOARD_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vRK;
varying vec4 vParam;
varying float vNear;

void main(){
  float kind = vRK.y;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float frame = vRK.z;
  vec2 tuv = (vec2(mod(frame, 2.0), floor(frame / 2.0)) + vUv) * 0.5;
  vec4 tex = texture2D(uAtlas, tuv);
  float add = vRK.w;
  vec3 rgb;
  float a;
  float extraDark = 0.0;

  if (kind < 0.5) {                       // soft puff (smoke / dust)
    a = tex.r * vCol.a;
    float shade = 0.72 + 0.55 * tex.g;
    rgb = vCol.rgb * shade;
  } else if (kind < 1.5) {                // fire
    float h = vParam.x;
    float v = tex.r * (0.50 + 1.0 * tex.g);
    float erode = (1.0 - h) * 0.78;
    a = smoothstep(erode, erode + 0.16, v);
    float t = clamp(v * (0.35 + h * 1.5), 0.0, 1.3);
    vec3 c = mix(vec3(0.20, 0.025, 0.0), vec3(1.0, 0.28, 0.03), smoothstep(0.0, 0.40, t));
    c = mix(c, vec3(1.0, 0.68, 0.22), smoothstep(0.32, 0.78, t));
    c = mix(c, vec3(1.0, 0.95, 0.80), smoothstep(0.75, 1.2, t));
    rgb = c * (1.0 + 2.6 * smoothstep(0.35, 1.2, t)) * vCol.rgb;
    a *= vCol.a;
    extraDark = (1.0 - smoothstep(0.0, 0.45, t)) * 0.35;
    add = 1.0 - extraDark;
  } else if (kind < 2.5) {                // hard dot (grains / chips)
    a = (1.0 - smoothstep(0.62, 0.92, r)) * vCol.a;
    rgb = vCol.rgb;
  } else if (kind < 3.5) {                // muzzle / explosion flash star
    float ang = atan(p.y, p.x);
    float spikes = pow(abs(cos(ang * 2.5 + vParam.y * 6.2831)), 9.0);
    float spikes2 = pow(abs(cos(ang * 3.0 + vParam.y * 11.0 + 1.0)), 14.0);
    float core = exp(-r * r * 22.0);
    float f = core * 1.3 + (spikes * 0.9 + spikes2 * 0.6) * exp(-r * 4.2) * (1.0 - smoothstep(0.55, 1.0, r));
    f *= 1.0 - smoothstep(0.85, 1.0, r);
    rgb = mix(vCol.rgb, vec3(1.0, 0.95, 0.8) * 3.0, core * 0.7) * f;
    a = vCol.a;
    rgb *= 1.0;
    // star carries its own intensity in rgb; a only fades
    rgb *= a;
    a = 0.0;
    add = 1.0;
    gl_FragColor = vec4(rgb * vNear, 0.0);
    return;
  } else {                                // soft glow circle
    float f = exp(-r * r * 5.0) * (1.0 - smoothstep(0.8, 1.0, r));
    a = f * vCol.a;
    rgb = vCol.rgb;
  }
  a *= vNear;
  gl_FragColor = vec4(rgb * a, a * (1.0 - add));
}
`

const STREAK_VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aCol;
attribute vec4 aParam;      // width, kind, add, headBright
uniform float uPixelWorld;  // world size of one pixel at unit view depth
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vParam;
void main(){
  vUv = vec2(position.x * 2.0, position.y + 0.5); // across -1..1, along 0..1
  vCol = aCol;
  vParam = aParam;
  vec4 a = viewMatrix * vec4(aA, 1.0);
  vec4 b = viewMatrix * vec4(aB, 1.0);
  float nz = -0.07;
  if (a.z > nz && b.z > nz) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (a.z > nz) a = mix(a, b, (nz - a.z) / (b.z - a.z));
  if (b.z > nz) b = mix(b, a, (nz - b.z) / (a.z - b.z));
  vec3 mid = (a.xyz + b.xyz) * 0.5;
  vec3 t = b.xyz - a.xyz;
  float len = length(t);
  t = len > 1e-5 ? t / len : vec3(0.0, 1.0, 0.0);
  vec3 side = cross(t, normalize(mid));
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float w = max(aParam.x, 1.6 * uPixelWorld * -mid.z);
  vec3 p = mix(a.xyz, b.xyz, position.y + 0.5) + side * position.x * w;
  // slight extension so very short streaks stay visible
  p += t * (position.y) * w * 0.5;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`

const STREAK_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vParam;
void main(){
  float across = vUv.x;
  float along = vUv.y;
  float kind = vParam.y;
  float add = vParam.z;
  float cov;
  vec3 rgb = vCol.rgb;
  if (kind < 0.5) {            // glow streak: bright head, tapering tail
    float core = exp(-across * across * 5.0);
    float taper = pow(along, 1.4);
    cov = core * taper;
    rgb *= 1.0 + 1.2 * exp(-across * across * 30.0) * smoothstep(0.55, 1.0, along);
  } else if (kind < 1.5) {     // solid shard / splinter
    cov = (1.0 - smoothstep(0.55, 1.0, abs(across))) * smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.9, 1.0, along));
  } else {                     // cone (muzzle flash) – wide at the base, tapering to the tip
    float wd = mix(1.0, 0.0, along);
    float ax = abs(across) / max(wd, 0.001);
    cov = (1.0 - smoothstep(0.35, 1.0, ax)) * (1.0 - along * along) * smoothstep(0.0, 0.05, along);
    rgb = mix(rgb, vec3(1.0, 0.9, 0.6) * 2.5, (1.0 - along) * 0.5);
  }
  float a = vCol.a * cov;
  gl_FragColor = vec4(rgb * a, a * (1.0 - add));
}
`

function quadGeometry(streak: boolean): InstancedBufferGeometry {
  const base = new PlaneGeometry(1, 1)
  const g = new InstancedBufferGeometry()
  g.setAttribute('position', base.getAttribute('position').clone())
  g.setAttribute('uv', base.getAttribute('uv').clone())
  if (base.index) g.setIndex(new Uint16BufferAttribute(Array.from(base.index.array as ArrayLike<number>), 1))
  void streak
  return g
}

function instanced(arr: Float32Array, size: number) {
  const a = new InstancedBufferAttribute(arr, size)
  a.setUsage(35048) // DynamicDrawUsage
  return a
}

// ═════════════════════════════════════════════════════════════════════════════
// Billboards
// ═════════════════════════════════════════════════════════════════════════════

export class BillboardBatch {
  readonly mesh: Mesh
  readonly cap: number
  private geo: InstancedBufferGeometry
  private aPosSize: Float32Array
  private aRotKind: Float32Array
  private aCol: Float32Array
  private aParam: Float32Array
  // sim state
  private alive: Uint8Array
  private px: Float32Array
  private py: Float32Array
  private pz: Float32Array
  private vx: Float32Array
  private vy: Float32Array
  private vz: Float32Array
  private age: Float32Array
  private life: Float32Array
  private s0: Float32Array
  private s1: Float32Array
  private rot: Float32Array
  private rv: Float32Array
  private drag: Float32Array
  private grav: Float32Array
  private c0: Float32Array
  private c1: Float32Array
  private kind: Float32Array
  private frame: Float32Array
  private add: Float32Array
  private h0: Float32Array
  private h1: Float32Array
  private seed: Float32Array
  private collide: Uint8Array
  private bounce: Float32Array
  private fadeIn: Float32Array
  private head = 0
  private order: number[] = []
  private key: Float32Array
  private _hit = new Float32Array(6)
  activeCount = 0

  constructor(cap: number, atlas: Texture, renderOrder: number) {
    this.cap = cap
    const f = (n: number) => new Float32Array(cap * n)
    this.alive = new Uint8Array(cap)
    this.collide = new Uint8Array(cap)
    this.px = f(1)
    this.py = f(1)
    this.pz = f(1)
    this.vx = f(1)
    this.vy = f(1)
    this.vz = f(1)
    this.age = f(1)
    this.life = f(1)
    this.s0 = f(1)
    this.s1 = f(1)
    this.rot = f(1)
    this.rv = f(1)
    this.drag = f(1)
    this.grav = f(1)
    this.c0 = f(4)
    this.c1 = f(4)
    this.kind = f(1)
    this.frame = f(1)
    this.add = f(1)
    this.h0 = f(1)
    this.h1 = f(1)
    this.seed = f(1)
    this.bounce = f(1)
    this.fadeIn = f(1)
    this.key = f(1)
    this.aPosSize = f(4)
    this.aRotKind = f(4)
    this.aCol = f(4)
    this.aParam = f(4)
    this.geo = quadGeometry(false)
    this.geo.setAttribute('aPosSize', instanced(this.aPosSize, 4))
    this.geo.setAttribute('aRotKind', instanced(this.aRotKind, 4))
    this.geo.setAttribute('aCol', instanced(this.aCol, 4))
    this.geo.setAttribute('aParam', instanced(this.aParam, 4))
    this.geo.instanceCount = 0
    const mat = new ShaderMaterial({
      vertexShader: BILLBOARD_VERT,
      fragmentShader: BILLBOARD_FRAG,
      uniforms: { uAtlas: { value: atlas } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
      fog: false,
      toneMapped: false,
    })
    this.mesh = new Mesh(this.geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = renderOrder
    this.mesh.matrixAutoUpdate = false
    void AdditiveBlending
    void Float32BufferAttribute
  }

  emit(s: Spec) {
    const i = this.head
    this.head = (this.head + 1) % this.cap
    this.alive[i] = 1
    this.px[i] = s.x
    this.py[i] = s.y
    this.pz[i] = s.z
    this.vx[i] = s.vx
    this.vy[i] = s.vy
    this.vz[i] = s.vz
    this.age[i] = -s.delay
    this.life[i] = s.life
    this.s0[i] = s.s0
    this.s1[i] = s.s1
    this.rot[i] = s.rot
    this.rv[i] = s.rv
    this.drag[i] = s.drag
    this.grav[i] = s.grav
    const o = i * 4
    this.c0[o] = s.r0
    this.c0[o + 1] = s.g0
    this.c0[o + 2] = s.b0
    this.c0[o + 3] = s.a0
    this.c1[o] = s.r1
    this.c1[o + 1] = s.g1
    this.c1[o + 2] = s.b1
    this.c1[o + 3] = s.a1
    this.kind[i] = s.kind
    this.frame[i] = s.frame
    this.add[i] = s.add
    this.h0[i] = s.heat0
    this.h1[i] = s.heat1
    this.seed[i] = s.seed
    this.collide[i] = s.collide
    this.bounce[i] = s.bounce
    this.fadeIn[i] = s.fadeIn
  }

  clear() {
    this.alive.fill(0)
    this.activeCount = 0
  }

  step(dt: number, collide: CollideFn | null) {
    if (dt <= 0) return
    let n = 0
    let rays = 0
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue
      n++
      const age = (this.age[i] = this.age[i]! + dt)
      if (age < 0) continue
      if (age >= this.life[i]!) {
        this.alive[i] = 0
        continue
      }
      let vx = this.vx[i]!
      let vy = this.vy[i]!
      let vz = this.vz[i]!
      const k = Math.exp(-this.drag[i]! * dt)
      vx *= k
      vz *= k
      vy = vy * k - this.grav[i]! * dt
      const dx = vx * dt
      const dy = vy * dt
      const dz = vz * dt
      let x = this.px[i]!
      let y = this.py[i]!
      let z = this.pz[i]!
      if (this.collide[i] && collide && rays < 40) {
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist > 1e-5) {
          rays++
          if (collide(x, y, z, dx / dist, dy / dist, dz / dist, dist + 0.02, this._hit)) {
            const nx = this._hit[3]!
            const ny = this._hit[4]!
            const nz = this._hit[5]!
            if (this.collide[i] === 2) {
              this.alive[i] = 0
              continue
            }
            const vn = vx * nx + vy * ny + vz * nz
            const b = this.bounce[i]!
            vx = (vx - 2 * vn * nx) * b + (Math.random() - 0.5) * 0.4
            vy = (vy - 2 * vn * ny) * b
            vz = (vz - 2 * vn * nz) * b + (Math.random() - 0.5) * 0.4
            x = this._hit[0]! + nx * 0.02
            y = this._hit[1]! + ny * 0.02
            z = this._hit[2]! + nz * 0.02
            this.vx[i] = vx
            this.vy[i] = vy
            this.vz[i] = vz
            this.px[i] = x
            this.py[i] = y
            this.pz[i] = z
            this.rot[i] = this.rot[i]! + this.rv[i]! * dt
            continue
          }
        }
      }
      this.vx[i] = vx
      this.vy[i] = vy
      this.vz[i] = vz
      this.px[i] = x + dx
      this.py[i] = y + dy
      this.pz[i] = z + dz
      this.rot[i] = this.rot[i]! + this.rv[i]! * dt
    }
    this.activeCount = n
  }

  /** Sort back-to-front and upload instance data. */
  write(camera: PerspectiveCamera) {
    const e = camera.matrixWorld.elements
    // camera forward = -Z column
    const fx = -e[8]!
    const fy = -e[9]!
    const fz = -e[10]!
    const cx = e[12]!
    const cy = e[13]!
    const cz = e[14]!
    const order = this.order
    order.length = 0
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i] || this.age[i]! < 0) continue
      this.key[i] = (this.px[i]! - cx) * fx + (this.py[i]! - cy) * fy + (this.pz[i]! - cz) * fz
      order.push(i)
    }
    const key = this.key
    order.sort((a, b) => key[b]! - key[a]!)
    const n = order.length
    const P = this.aPosSize
    const R = this.aRotKind
    const C = this.aCol
    const Q = this.aParam
    for (let j = 0; j < n; j++) {
      const i = order[j]!
      const t = this.age[i]! / this.life[i]!
      const ease = 1 - (1 - t) * (1 - t)
      const o = j * 4
      P[o] = this.px[i]!
      P[o + 1] = this.py[i]!
      P[o + 2] = this.pz[i]!
      P[o + 3] = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * ease
      R[o] = this.rot[i]!
      R[o + 1] = this.kind[i]!
      R[o + 2] = this.frame[i]!
      R[o + 3] = this.add[i]!
      const ci = i * 4
      const fin = Math.min(1, t / Math.max(this.fadeIn[i]!, 1e-3))
      const fade = fin * fin * (3 - 2 * fin)
      C[o] = this.c0[ci]! + (this.c1[ci]! - this.c0[ci]!) * t
      C[o + 1] = this.c0[ci + 1]! + (this.c1[ci + 1]! - this.c0[ci + 1]!) * t
      C[o + 2] = this.c0[ci + 2]! + (this.c1[ci + 2]! - this.c0[ci + 2]!) * t
      C[o + 3] = (this.c0[ci + 3]! + (this.c1[ci + 3]! - this.c0[ci + 3]!) * t) * fade
      Q[o] = this.h0[i]! + (this.h1[i]! - this.h0[i]!) * t
      Q[o + 1] = this.seed[i]!
      Q[o + 2] = 0
      Q[o + 3] = 0
    }
    this.geo.instanceCount = n
    const at = this.geo.attributes
    for (const name of ['aPosSize', 'aRotKind', 'aCol', 'aParam']) {
      ;(at[name] as InstancedBufferAttribute).needsUpdate = true
    }
    this.mesh.visible = n > 0
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Streaks
// ═════════════════════════════════════════════════════════════════════════════

export class StreakBatch {
  readonly mesh: Mesh
  readonly cap: number
  private geo: InstancedBufferGeometry
  private mat: ShaderMaterial
  private aA: Float32Array
  private aB: Float32Array
  private aCol: Float32Array
  private aParam: Float32Array
  private alive: Uint8Array
  private px: Float32Array
  private py: Float32Array
  private pz: Float32Array
  private vx: Float32Array
  private vy: Float32Array
  private vz: Float32Array
  private sx: Float32Array
  private sy: Float32Array
  private sz: Float32Array
  private age: Float32Array
  private life: Float32Array
  private drag: Float32Array
  private grav: Float32Array
  private c0: Float32Array
  private c1: Float32Array
  private kind: Float32Array
  private add: Float32Array
  private width: Float32Array
  private trail: Float32Array
  private maxDist: Float32Array
  private travel: Float32Array
  private collide: Uint8Array
  private bounce: Float32Array
  private fadeIn: Float32Array
  private head = 0
  private _hit = new Float32Array(6)
  count = 0
  /** 0 = streak kind glow, 1 = shard, 2 = cone. */
  constructor(cap: number, renderOrder: number) {
    this.cap = cap
    const f = (n: number) => new Float32Array(cap * n)
    this.alive = new Uint8Array(cap)
    this.collide = new Uint8Array(cap)
    this.px = f(1)
    this.py = f(1)
    this.pz = f(1)
    this.vx = f(1)
    this.vy = f(1)
    this.vz = f(1)
    this.sx = f(1)
    this.sy = f(1)
    this.sz = f(1)
    this.age = f(1)
    this.life = f(1)
    this.drag = f(1)
    this.grav = f(1)
    this.c0 = f(4)
    this.c1 = f(4)
    this.kind = f(1)
    this.add = f(1)
    this.width = f(1)
    this.trail = f(1)
    this.maxDist = f(1)
    this.travel = f(1)
    this.bounce = f(1)
    this.fadeIn = f(1)
    this.aA = f(3)
    this.aB = f(3)
    this.aCol = f(4)
    this.aParam = f(4)
    this.geo = quadGeometry(true)
    // streak quad: x across (-0.5..0.5), y along (-0.5..0.5) — shader maps to 0..1
    this.geo.setAttribute('aA', instanced(this.aA, 3))
    this.geo.setAttribute('aB', instanced(this.aB, 3))
    this.geo.setAttribute('aCol', instanced(this.aCol, 4))
    this.geo.setAttribute('aParam', instanced(this.aParam, 4))
    this.geo.instanceCount = 0
    this.mat = new ShaderMaterial({
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      uniforms: { uPixelWorld: { value: 0.001 } },
      // ribbon winding flips with travel direction — never cull
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
      fog: false,
      toneMapped: false,
    })
    this.mesh = new Mesh(this.geo, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = renderOrder
    this.mesh.matrixAutoUpdate = false
  }

  emit(s: Spec) {
    const i = this.head
    this.head = (this.head + 1) % this.cap
    this.alive[i] = 1
    this.px[i] = s.x
    this.py[i] = s.y
    this.pz[i] = s.z
    this.sx[i] = s.x
    this.sy[i] = s.y
    this.sz[i] = s.z
    this.vx[i] = s.vx
    this.vy[i] = s.vy
    this.vz[i] = s.vz
    this.age[i] = -s.delay
    this.life[i] = s.life
    this.drag[i] = s.drag
    this.grav[i] = s.grav
    const o = i * 4
    this.c0[o] = s.r0
    this.c0[o + 1] = s.g0
    this.c0[o + 2] = s.b0
    this.c0[o + 3] = s.a0
    this.c1[o] = s.r1
    this.c1[o + 1] = s.g1
    this.c1[o + 2] = s.b1
    this.c1[o + 3] = s.a1
    this.kind[i] = s.kind
    this.add[i] = s.add
    this.width[i] = s.width
    this.trail[i] = s.trail
    this.maxDist[i] = s.maxDist
    this.travel[i] = 0
    this.collide[i] = s.collide
    this.bounce[i] = s.bounce
    this.fadeIn[i] = s.fadeIn
  }

  clear() {
    this.alive.fill(0)
    this.count = 0
  }

  step(dt: number, collide: CollideFn | null) {
    if (dt <= 0) return
    let rays = 0
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue
      const age = (this.age[i] = this.age[i]! + dt)
      if (age < 0) continue
      if (age >= this.life[i]!) {
        this.alive[i] = 0
        continue
      }
      let vx = this.vx[i]!
      let vy = this.vy[i]!
      let vz = this.vz[i]!
      const k = Math.exp(-this.drag[i]! * dt)
      vx *= k
      vz *= k
      vy = vy * k - this.grav[i]! * dt
      const dx = vx * dt
      const dy = vy * dt
      const dz = vz * dt
      const step = Math.sqrt(dx * dx + dy * dy + dz * dz)
      this.travel[i] = this.travel[i]! + step
      const md = this.maxDist[i]!
      if (md > 0 && this.travel[i]! - this.trailLen(i, vx, vy, vz) > md) {
        this.alive[i] = 0
        continue
      }
      let x = this.px[i]!
      let y = this.py[i]!
      let z = this.pz[i]!
      if (this.collide[i] && collide && rays < 40 && step > 1e-5) {
        rays++
        if (collide(x, y, z, dx / step, dy / step, dz / step, step + 0.02, this._hit)) {
          if (this.collide[i] === 2) {
            this.alive[i] = 0
            continue
          }
          const nx = this._hit[3]!
          const ny = this._hit[4]!
          const nz = this._hit[5]!
          const vn = vx * nx + vy * ny + vz * nz
          const b = this.bounce[i]!
          vx = (vx - 2 * vn * nx) * b + (Math.random() - 0.5) * 1.2
          vy = (vy - 2 * vn * ny) * b
          vz = (vz - 2 * vn * nz) * b + (Math.random() - 0.5) * 1.2
          this.vx[i] = vx
          this.vy[i] = vy
          this.vz[i] = vz
          this.px[i] = this._hit[0]! + nx * 0.015
          this.py[i] = this._hit[1]! + ny * 0.015
          this.pz[i] = this._hit[2]! + nz * 0.015
          continue
        }
      }
      this.vx[i] = vx
      this.vy[i] = vy
      this.vz[i] = vz
      this.px[i] = x + dx
      this.py[i] = y + dy
      this.pz[i] = z + dz
    }
  }

  private trailLen(i: number, vx: number, vy: number, vz: number) {
    return Math.sqrt(vx * vx + vy * vy + vz * vz) * this.trail[i]!
  }

  write(camera: PerspectiveCamera, viewportHeight: number) {
    const A = this.aA
    const B = this.aB
    const C = this.aCol
    const Q = this.aParam
    let n = 0
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i] || this.age[i]! < 0) continue
      const t = this.age[i]! / this.life[i]!
      const vx = this.vx[i]!
      const vy = this.vy[i]!
      const vz = this.vz[i]!
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz)
      const tl = sp * this.trail[i]!
      const hx = this.px[i]!
      const hy = this.py[i]!
      const hz = this.pz[i]!
      let tx = hx
      let ty = hy
      let tz = hz
      let ex = hx
      let ey = hy
      let ez = hz
      if (sp > 1e-4) {
        const inv = 1 / sp
        const ux = vx * inv
        const uy = vy * inv
        const uz = vz * inv
        let len = tl
        if (this.maxDist[i]! > 0) {
          // tracer: head clamps at the target, tail clamps at the muzzle
          const head = Math.min(this.travel[i]!, this.maxDist[i]!)
          const tail = Math.max(0, head - tl)
          len = head - tail
          const sx = this.sx[i]!
          const sy = this.sy[i]!
          const sz = this.sz[i]!
          ex = sx + ux * head
          ey = sy + uy * head
          ez = sz + uz * head
          tx = sx + ux * tail
          ty = sy + uy * tail
          tz = sz + uz * tail
        } else {
          tx = hx - ux * len
          ty = hy - uy * len
          tz = hz - uz * len
        }
        void len
      }
      const o3 = n * 3
      const o4 = n * 4
      A[o3] = tx
      A[o3 + 1] = ty
      A[o3 + 2] = tz
      B[o3] = ex
      B[o3 + 1] = ey
      B[o3 + 2] = ez
      const ci = i * 4
      const fin = Math.min(1, t / Math.max(this.fadeIn[i]!, 1e-3))
      C[o4] = this.c0[ci]! + (this.c1[ci]! - this.c0[ci]!) * t
      C[o4 + 1] = this.c0[ci + 1]! + (this.c1[ci + 1]! - this.c0[ci + 1]!) * t
      C[o4 + 2] = this.c0[ci + 2]! + (this.c1[ci + 2]! - this.c0[ci + 2]!) * t
      C[o4 + 3] = (this.c0[ci + 3]! + (this.c1[ci + 3]! - this.c0[ci + 3]!) * t) * fin
      Q[o4] = this.width[i]!
      Q[o4 + 1] = this.kind[i]!
      Q[o4 + 2] = this.add[i]!
      Q[o4 + 3] = 0
      n++
    }
    this.count = n
    this.geo.instanceCount = n
    const at = this.geo.attributes
    for (const name of ['aA', 'aB', 'aCol', 'aParam']) {
      ;(at[name] as InstancedBufferAttribute).needsUpdate = true
    }
    this.mesh.visible = n > 0
    this.mat.uniforms.uPixelWorld!.value = 2 / (camera.projectionMatrix.elements[5]! * Math.max(1, viewportHeight))
  }
}
