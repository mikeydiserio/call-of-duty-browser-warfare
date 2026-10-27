/**
 * First-person arms: gloved, articulated hands (3-joint fingers + thumb) and
 * forearms with rolled desert-multicam sleeves, bare skin and a field watch.
 *
 * Hand frame (right hand; the left hand is the same rig mirrored in X):
 *   origin = palm centre, fingers extend along -Z, palm faces -Y, thumb on -X.
 *   Wrist sits at +Z. Finger curl rotates each joint about X (tips go to -Y).
 *
 * Forearm frame: wrist at origin, elbow along +Z.
 */
import { BufferGeometry, CapsuleGeometry, CircleGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Vector3 } from 'three'
import { boxUV, flat, lathe, prof, rbox } from './geo'
import { mat, type MatKey } from './materials'
import { makeWatchFace } from './textures'

/** Finger segment lengths (proximal, middle, distal) — gloved adult hand. */
const FINGERS = [
  { x: -0.0255, len: [0.044, 0.026, 0.021], r: 0.0094, splay: -0.06, back: 0.0 }, // index
  { x: -0.0085, len: [0.048, 0.03, 0.023], r: 0.0097, splay: -0.015, back: -0.003 }, // middle
  { x: 0.0085, len: [0.045, 0.028, 0.021], r: 0.0092, splay: 0.03, back: 0.0 }, // ring
  { x: 0.0245, len: [0.036, 0.022, 0.019], r: 0.0083, splay: 0.08, back: 0.009 }, // pinky
] as const
/** Joint curl (radians) at grip = 1 for proximal, middle, distal. */
const CURL = [1.45, 1.6, 1.0] as const

const geoCache = new Map<string, BufferGeometry>()
function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = geoCache.get(key)
  if (!g) geoCache.set(key, (g = make()))
  return g
}

/** Capsule segment lying along -Z starting at the joint (z = 0) and ending at z = -len. */
function segment(len: number, r0: number, r1: number): BufferGeometry {
  return cached(`seg${len}_${r0}_${r1}`, () => {
    const g = new CapsuleGeometry((r0 + r1) / 2, Math.max(0.001, len - (r0 + r1) / 2), 4, 10)
    // taper: scale vertices by their position along the capsule
    const p = g.attributes.position!
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i)
      const t = (y + len / 2) / len // 0 base .. 1 tip
      const s = (r0 + (r1 - r0) * Math.min(1, Math.max(0, t))) / ((r0 + r1) / 2)
      p.setX(i, p.getX(i) * s)
      p.setZ(i, p.getZ(i) * s * 0.88) // slightly flattened (palm-back) like a real finger
    }
    g.rotateX(-Math.PI / 2) // +Y -> -Z
    g.translate(0, 0, -len / 2 + (r0 + r1) / 4)
    g.computeVertexNormals()
    boxUV(g, 6)
    return g
  })
}

function meshOf(g: BufferGeometry, k: MatKey): Mesh {
  const m = new Mesh(g, mat(k))
  m.castShadow = true
  m.receiveShadow = true
  m.frustumCulled = false
  return m
}

export class Hand {
  readonly root = new Group()
  /** Mirror container (scale.x = -1 for the left hand). */
  readonly inner = new Group()
  /** [finger][joint] — fingers 0..3 index..pinky, 4 = thumb. */
  readonly joints: Group[][] = []
  /** Point between thumb and index where small held objects (shell, mag) sit. Hand space. */
  readonly holdPoint = new Object3D()
  /** Current curls (thumb, index, middle, ring, pinky). */
  readonly curl = [0.3, 0.3, 0.3, 0.3, 0.3]

  constructor(readonly left: boolean) {
    this.root.add(this.inner)
    if (left) this.inner.scale.x = -1
    const glove: MatKey = 'glove'

    // Palm/back of hand: domed side profile (f forward = -z), extruded across X.
    const palm = cached('palm', () => {
      const g = prof(
        [
          [-0.052, -0.012, 0.01],
          [0.04, -0.0135, 0.008],
          [0.05, -0.004, 0.008],
          [0.046, 0.011, 0.01],
          [0.0, 0.0165, 0.02],
          [-0.052, 0.0135, 0.012],
        ],
        0.078,
        { bevel: 0.0075, r: 0.008 },
      )
      boxUV(g, 6)
      return g
    })
    this.inner.add(meshOf(palm, glove))
    // Thenar pad (meaty base of the thumb) on the thumb side of the palm.
    const thenar = cached('thenar', () => {
      const g = new SphereGeometry(0.024, 12, 10)
      g.scale(0.9, 0.62, 1.35)
      g.translate(-0.026, -0.008, 0.012)
      boxUV(g, 6)
      return g
    })
    this.inner.add(meshOf(thenar, glove))
    // Knuckle armour strip (hard-knuckle glove)
    const knuckle = cached('knuckle', () => {
      const g = rbox(0.022, 0.047, 0.009, 0.0185, 0.07, 0, 0.006, 0.003)
      boxUV(g, 6)
      return g
    })
    this.inner.add(meshOf(knuckle, 'rubber'))
    // Velcro wrist strap
    const strap = cached('wstrap', () => {
      const g = rbox(-0.06, -0.034, -0.0145, 0.0175, 0.084, 0, 0.012, 0.004)
      boxUV(g, 6)
      return g
    })
    this.inner.add(meshOf(strap, 'strap'))

    for (const f of FINGERS) {
      const chain: Group[] = []
      let parent: Object3D = this.inner
      for (let j = 0; j < 3; j++) {
        const jg = new Group()
        if (j === 0) {
          jg.position.set(f.x, -0.0005, -0.043 - f.back)
          jg.rotation.y = f.splay
        } else {
          jg.position.set(0, 0, -f.len[j - 1]!)
        }
        const r0 = f.r * (1 - j * 0.07)
        const r1 = f.r * (1 - (j + 1) * 0.07)
        jg.add(meshOf(segment(f.len[j]!, r0, r1), glove))
        parent.add(jg)
        parent = jg
        chain.push(jg)
      }
      this.joints.push(chain)
    }

    // Thumb: metacarpal + 2 phalanges, rotated out of the palm plane.
    const thumb: Group[] = []
    const t0 = new Group()
    t0.position.set(-0.03, -0.006, 0.02)
    t0.rotation.order = 'YXZ'
    t0.rotation.set(-0.05, 0.62, 0.95)
    t0.add(meshOf(segment(0.04, 0.0125, 0.011), glove))
    this.inner.add(t0)
    const t1 = new Group()
    t1.position.set(0, 0, -0.04)
    t1.add(meshOf(segment(0.032, 0.0108, 0.0102), glove))
    t0.add(t1)
    const t2 = new Group()
    t2.position.set(0, 0, -0.032)
    t2.add(meshOf(segment(0.026, 0.0102, 0.0094), glove))
    t1.add(t2)
    thumb.push(t0, t1, t2)
    this.joints.push(thumb)

    this.holdPoint.position.set(-0.02, -0.03, -0.02)
    this.inner.add(this.holdPoint)
    this.setGrip(this.curl)
  }

  /** Curls: [thumb, index, middle, ring, pinky], 0 = flat, 1 = tight fist. */
  setGrip(c: ArrayLike<number>) {
    for (let i = 0; i < 4; i++) {
      const g = c[i + 1]!
      const ch = this.joints[i]!
      ch[0]!.rotation.x = -g * CURL[0]
      ch[1]!.rotation.x = -g * CURL[1]
      ch[2]!.rotation.x = -g * CURL[2]
      this.curl[i + 1] = g
    }
    const t = c[0]!
    const th = this.joints[4]!
    th[0]!.rotation.x = -0.05 - t * 0.35
    th[1]!.rotation.x = -t * 0.7
    th[2]!.rotation.x = -t * 0.85
    this.curl[0] = t
  }
}

/** Forearm: glove cuff → bare skin (with watch on the left) → rolled multicam sleeve → sleeve. */
export class Forearm {
  readonly root = new Group()
  constructor(left: boolean) {
    // Oval cross-section, so build round then squash in X (local), lathe axis along +Z.
    const L = (pts: [number, number][], seg = 22) => forearmLathe(pts, seg)
    const cuff = cached('cuff', () =>
      L([
        [0.0, -0.012],
        [0.024, -0.012],
        [0.0305, 0.0],
        [0.0315, 0.045],
        [0.0292, 0.052],
        [0.0, 0.052],
      ]),
    )
    const skin = cached('fskin', () =>
      L([
        [0.0, 0.04],
        [0.0262, 0.04],
        [0.0285, 0.08],
        [0.0335, 0.13],
        [0.037, 0.165],
        [0.0, 0.165],
      ]),
    )
    // Rolled cuff: lumpy folds
    const roll = cached('roll', () => {
      const pts: [number, number][] = [[0.0, 0.152]]
      for (let i = 0; i <= 8; i++) {
        const z = 0.152 + i * 0.008
        const r = 0.045 + Math.sin(i * 1.2) * 0.0025 + (i === 0 || i === 8 ? -0.004 : 0)
        pts.push([r, z])
      }
      pts.push([0.0, 0.216])
      return L(pts, 24)
    })
    const sleeve = cached('sleeve', () =>
      L([
        [0.0, 0.21],
        [0.043, 0.21],
        [0.0465, 0.3],
        [0.05, 0.42],
        [0.0, 0.42],
      ]),
    )
    this.root.add(meshOf(cuff, 'glove'))
    this.root.add(meshOf(skin, 'skin'))
    this.root.add(meshOf(roll, 'camo'))
    this.root.add(meshOf(sleeve, 'camo'))
    if (left) {
      // Field watch on the inside/top of the left wrist.
      const band = cached('band', () =>
        forearmLathe([
          [0.0, 0.056],
          [0.0292, 0.056],
          [0.0304, 0.06],
          [0.0304, 0.07],
          [0.0292, 0.074],
          [0.0, 0.074],
        ]),
      )
      this.root.add(meshOf(band, 'strap'))
      const caseG = cached('wcase', () => {
        const g = lathe(
          [
            [0.0, 0.0],
            [0.0118, 0.0],
            [0.0128, 0.003],
            [0.012, 0.007],
            [0.0, 0.007],
          ].map(([r, z]) => [r!, z!] as [number, number]),
          0,
          0,
          18,
          0.6,
        )
        g.rotateX(Math.PI / 2)
        g.translate(0, 0.0245, 0.065)
        return flat(g)
      })
      const c = meshOf(caseG, 'metal')
      this.root.add(c)
      const face = new Mesh(
        new CircleGeometry(0.0098, 20).rotateX(-Math.PI / 2).translate(0, 0.0318, 0.065),
        new MeshStandardMaterial({ map: makeWatchFace(), roughness: 0.25, metalness: 0, emissive: 0x0c1a0e, emissiveIntensity: 0.4 }),
      )
      face.frustumCulled = false
      this.root.add(face)
    }
  }
}

/** Revolve [radius, z] (z along +Z from the wrist), oval cross-section. */
function forearmLathe(pts: [number, number][], seg = 22): BufferGeometry {
  const g = lathe(pts, 0, 0, seg, 0.7) // runs along -Z (f = z)
  g.rotateY(Math.PI) // -> +Z, winding preserved
  g.scale(1, 0.86, 1)
  boxUV(g, 5)
  return g
}

/** A hand + forearm pair. The forearm is oriented every frame from the wrist toward an elbow anchor. */
export class Arm {
  readonly hand: Hand
  readonly forearm: Forearm
  /** Elbow anchor in viewmodel (camera) space. */
  readonly elbow = new Vector3()
  constructor(readonly left: boolean) {
    this.hand = new Hand(left)
    this.forearm = new Forearm(left)
    this.elbow.set(left ? -0.06 : 0.32, -0.56, left ? -0.4 : -0.02)
  }

  /** Call after the hand's root transform is set (both in the same parent space). */
  solve() {
    const h = this.hand.root
    h.updateMatrix()
    // Wrist: hand-space (0, 0.0, 0.05) -> parent space
    _w.set(0, 0.0, 0.052).applyMatrix4(h.matrix)
    // Hand's own "back" axis (+Z) in parent space
    _b.set(0, 0, 1).applyQuaternion(h.quaternion)
    _d.copy(this.elbow).sub(_w).normalize()
    _b.multiplyScalar(0.3).addScaledVector(_d, 0.7).normalize()
    const f = this.forearm.root
    f.position.copy(_w)
    _t.copy(_w).add(_b)
    // Keep the forearm's "up" close to the hand's up so the watch/roll read correctly.
    _u.set(0, 1, 0).applyQuaternion(h.quaternion)
    f.up.copy(_u)
    f.lookAt(_t)
  }
}

const _w = new Vector3()
const _b = new Vector3()
const _d = new Vector3()
const _t = new Vector3()
const _u = new Vector3()
