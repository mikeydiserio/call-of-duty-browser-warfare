/**
 * Pass-3 models: CheyTac M200 "Intervention", M67 fragmentation grenade and
 * a fixed-blade combat knife with a real ground (bevelled) blade.
 */
import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, SphereGeometry, TorusGeometry } from 'three'
import { box, Builder, crossPin, cyl, finish, flat, halfSec, lathe, pin, prof, rail1913, rbox, rod, screwHead, strip, tube, xsec } from './geo'
import { loop, triggerGuard, type ModelSpec } from './models-rifles'
import type { RigMeta } from './rig'

// ─── Intervention (CheyTac M200) ─────────────────────────────────────────────

export function buildIntervention(): ModelSpec {
  const b = new Builder()
  const AX = 0.075 // bore height
  const SY = 0.148 // scope axis
  // ── Round action + recoil lug + bolt shroud
  b.add('body', 'metal', lathe([[0.0, -0.12], [0.0235, -0.12], [0.0265, -0.112], [0.0265, 0.21], [0.0245, 0.22], [0.0, 0.22]], 0, AX, 28))
  b.add('body', 'void', box(-0.035, 0.045, 0.07, 0.092, 0.0255, 0.0272)) // ejection port (right)
  b.add('body', 'metal', rbox(0.17, 0.2, 0.034, 0.052, 0.03, 0, 0.002, 0.0008)) // recoil lug
  // ── Chassis: lower receiver block, magwell, grip, guard
  b.add('body', 'metal', prof([[-0.13, 0.054], [0.17, 0.054], [0.17, 0.004, 0.004], [0.108, -0.006], [0.042, -0.006], [-0.13, 0.002]], 0.044, { r: 0.004, bevel: 0.0016 }))
  for (const f of [-0.1, 0.0, 0.14]) {
    screwHead(b, 'body', 'steel', 0.0222, 0.03, f, 0.0032)
    screwHead(b, 'body', 'steel', -0.0222, 0.03, f, 0.0032)
  }
  triggerGuard(b, 'body', 'metal', -0.006, 0.064, -0.006, -0.058, 0.0068)
  b.add('body', 'blued', prof(strip((t) => [0.024 - 0.008 * t * t, -0.006 - 0.03 * t], () => 0.0055, 6), 0.006, { r: 0.0012, bevel: 0.0004 }))
  b.add('body', 'poly', prof([[-0.076, -0.004], [-0.018, -0.004], [-0.024, -0.034, 0.01], [-0.042, -0.112, 0.01], [-0.05, -0.122, 0.004], [-0.094, -0.12, 0.006], [-0.094, -0.06, 0.016], [-0.082, -0.02, 0.012]], 0.031, { r: 0.004, bevel: 0.003 }))
  for (let i = 0; i < 6; i++) {
    const y = -0.036 - i * 0.012
    b.add('body', 'void', box(-0.088 + i * 0.002, -0.05 + i * 0.002, y, y + 0.0035, 0.0154, 0.016))
    b.add('body', 'void', box(-0.088 + i * 0.002, -0.05 + i * 0.002, y, y + 0.0035, -0.016, -0.0154))
  }
  // ── Forend tube with lightening holes + continuous top rail
  const feSec = halfSec([
    [0.016, 0.024],
    [0.0235, 0.032],
    [0.0255, 0.046],
    [0.0255, 0.09],
    [0.02, 0.0975],
  ])
  b.add('body', 'metal', xsec(feSec, 0.17, 0.62, 0.0016, 0.003))
  for (let i = 0; i < 6; i++) {
    const f = 0.215 + i * 0.065
    b.add('body', 'void', pin('x', 0.0115, 0.0516, 0, 0.062, f, 20))
  }
  for (let i = 0; i < 5; i++) {
    const f = 0.245 + i * 0.065
    b.add('body', 'void', pin('x', 0.006, 0.0516, 0, 0.041, f, 14))
  }
  rail1913(b, 'body', 'metal', -0.11, 0.6, 0.107, 0, 0.0212)
  b.add('body', 'metal', rbox(-0.11, 0.6, 0.0975, 0.1, 0.024, 0, 0.001, 0.0004))
  // ── Fluted heavy barrel + ported muzzle brake
  b.add('body', 'blued', lathe([[0.0, 0.2], [0.0158, 0.2], [0.0148, 0.62], [0.0138, 0.8], [0.0, 0.8]], 0, AX, 24))
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    b.add('body', 'void', box(0.63, 0.78, 0.0136, 0.0146, -0.0022, 0.0022).rotateZ(a).translate(0, AX, 0))
  }
  b.add('body', 'blued', lathe([[0.0, 0.79], [0.0205, 0.79], [0.0215, 0.798], [0.0215, 0.888], [0.0198, 0.896], [0.0, 0.896]], 0, AX, 28))
  for (let i = 0; i < 5; i++) {
    const f = 0.806 + i * 0.016
    b.add('body', 'void', box(f, f + 0.0085, AX - 0.012, AX + 0.012, 0.0204, 0.0218))
    b.add('body', 'void', box(f, f + 0.0085, AX - 0.012, AX + 0.012, -0.0218, -0.0204))
  }
  b.add('body', 'void', cyl(0.0072, 0.0072, 0.8955, 0.8965, 0, AX, 16))
  // ── Folding bipod (stowed along the forend bottom)
  b.add('body', 'blued', rbox(0.57, 0.61, 0.012, 0.026, 0.034, 0, 0.003, 0.001))
  b.add('body', 'blued', pin('x', 0.0042, 0.04, 0, 0.018, 0.59, 12))
  for (const s of [1, -1]) {
    b.add('body', 'blued', rod([s * 0.011, 0.016, -0.585], [s * 0.011, 0.012, -0.38], 0.0055))
    b.add('body', 'steel', rod([s * 0.011, 0.012, -0.43], [s * 0.011, 0.011, -0.33], 0.0036))
    b.add('body', 'rubber', flat(new SphereGeometry(0.0072, 12, 8).scale(1, 0.8, 1.3).translate(s * 0.011, 0.011, -0.326)))
  }
  // ── Adjustable skeleton stock, cheek piece, monopod, buttpad
  b.add('body', 'metal', prof([[-0.12, 0.096], [-0.15, 0.1], [-0.15, 0.004], [-0.12, 0.004]], 0.04, { r: 0.003, bevel: 0.0016 }))
  b.add('body', 'metal', lathe([[0.0, -0.44], [0.0115, -0.44], [0.0115, -0.15], [0.0, -0.15]], 0, 0.072, 18)) // stock tube
  b.add('body', 'metal', lathe([[0.0, -0.44], [0.0085, -0.44], [0.0085, -0.15], [0.0, -0.15]], 0, 0.016, 14)) // lower rod
  b.add('body', 'poly', prof([[-0.2, 0.084], [-0.21, 0.122, 0.008], [-0.38, 0.124, 0.012], [-0.4, 0.11, 0.008], [-0.392, 0.084]], 0.034, { r: 0.004, bevel: 0.004 })) // cheek piece
  b.add('body', 'blued', pin('y', 0.0042, 0.03, 0.0, 0.098, -0.24, 12))
  b.add('body', 'blued', pin('y', 0.0042, 0.03, 0.0, 0.098, -0.35, 12))
  b.add('body', 'metal', prof([[-0.43, 0.1], [-0.46, 0.104, 0.006], [-0.47, 0.094], [-0.47, -0.055, 0.006], [-0.46, -0.062], [-0.43, -0.058]], 0.04, { r: 0.004, bevel: 0.003 }))
  b.add('body', 'rubber', prof([[-0.468, 0.1], [-0.488, 0.094], [-0.492, -0.052], [-0.47, -0.062]], 0.044, { r: 0.006, bevel: 0.003 }))
  b.add('body', 'blued', lathe([[0.0, 0.0], [0.0068, 0.0], [0.0068, 0.06], [0.0045, 0.068], [0.0, 0.068]], 0, 0, 12).rotateX(Math.PI / 2).translate(0, -0.058, 0.4)) // monopod
  b.add('body', 'blued', loop(0.008, 0.0016, 0, -0.07, 0.44))
  // ── Scope: 56 mm objective, 30 mm tube, big turrets, rings
  b.add('body', 'metal', rbox(-0.06, 0.16, 0.107, 0.114, 0.026, 0, 0.0015, 0.0006))
  for (const f0 of [-0.035, 0.105]) {
    b.add('body', 'metal', prof([[f0, 0.113], [f0 + 0.032, 0.113], [f0 + 0.032, SY - 0.018], [f0, SY - 0.018]], 0.03, { r: 0.002, bevel: 0.0008 }))
    b.add('body', 'metal', tube(0.0228, 0.0192, f0 + 0.002, f0 + 0.03, 0, SY, 28))
    screwHead(b, 'body', 'steel', 0.0152, SY - 0.02, f0 + 0.016, 0.0024)
    screwHead(b, 'body', 'steel', -0.0152, SY - 0.02, f0 + 0.016, 0.0024)
  }
  b.add('body', 'blued', tube(0.0195, 0.0182, -0.1, 0.205, 0, SY, 32))
  b.add('body', 'blued', lathe([[0.0182, 0.2], [0.0195, 0.2], [0.0335, 0.25], [0.0345, 0.35], [0.0335, 0.358], [0.0, 0.358]], 0, SY, 36))
  b.add('body', 'lens', cyl(0.0318, 0.0318, 0.3565, 0.3575, 0, SY, 32))
  b.add('body', 'blued', lathe([[0.0, -0.152], [0.0215, -0.152], [0.0255, -0.148], [0.0262, -0.115], [0.0195, -0.098], [0.0182, -0.098]], 0, SY, 32))
  b.add('body', 'rubber', tube(0.0262, 0.0215, -0.16, -0.148, 0, SY, 28)) // eyecup
  b.add('body', 'lens', cyl(0.0208, 0.0208, -0.1505, -0.1495, 0, SY, 28))
  const pr: [number, number][] = [[0.0, -0.096]]
  for (let i = 0; i < 6; i++) pr.push([0.0205, -0.096 + i * 0.0025], [0.0212, -0.0948 + i * 0.0025])
  pr.push([0.0205, -0.081], [0.0, -0.081])
  b.add('body', 'rubber', lathe(pr, 0, SY, 28, 0.5)) // ribbed power ring
  // turrets (elevation on top, windage right, parallax left) with knurled caps
  b.add('body', 'blued', pin('y', 0.0118, 0.012, 0, SY + 0.023, 0.06, 20))
  b.add('body', 'blued', pin('y', 0.0142, 0.016, 0, SY + 0.036, 0.06, 24))
  b.add('body', 'blued', pin('x', 0.0118, 0.012, 0.023, SY, 0.06, 20))
  b.add('body', 'blued', pin('x', 0.0142, 0.014, 0.034, SY, 0.06, 24))
  b.add('body', 'blued', pin('x', 0.0118, 0.012, -0.023, SY, 0.06, 20))
  b.add('body', 'blued', pin('x', 0.015, 0.008, -0.031, SY, 0.06, 24))
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    // elevation cap ticks (axis Y)
    b.add('body', 'void', box(-0.0006, 0.0006, SY + 0.029, SY + 0.043, 0.0137, 0.0146).rotateY(a).translate(0, 0, -0.06))
    // windage cap ticks (axis X, right side)
    const y = SY + Math.cos(a) * 0.0146
    const f = 0.06 - Math.sin(a) * 0.0146
    b.add('body', 'void', box(f - 0.0006, f + 0.0006, y - 0.0006, y + 0.0006, 0.027, 0.041))
  }
  // ── Bolt (moves) + handle
  b.add('bolt', 'steel', lathe([[0.0, -0.14], [0.0118, -0.14], [0.0118, 0.02], [0.0, 0.02]], 0, AX, 20))
  b.add('bolt', 'steel', lathe([[0.0, 0.0], [0.0128, 0.0], [0.0128, 0.03], [0.0, 0.03]], 0, AX, 20))
  b.add('bolt', 'blued', lathe([[0.0, -0.158], [0.0134, -0.158], [0.0134, -0.138], [0.0, -0.138]], 0, AX, 20))
  b.add('boltHandle', 'steel', rod([0.008, AX - 0.002, 0.07], [0.058, AX - 0.018, 0.07], 0.0045))
  b.add('boltHandle', 'blued', flat(new SphereGeometry(0.0125, 16, 12).scale(1, 1, 1.25).translate(0.07, AX - 0.023, 0.07)))
  b.pivot('bolt', 0, AX, 0)
  b.parent('boltHandle', 'bolt')
  b.pivot('boltHandle', 0, AX, 0.07)
  // ── Detachable box magazine
  b.add('mag', 'metal', prof([[0.044, -0.004], [0.112, -0.004], [0.11, -0.07, 0.004], [0.046, -0.07, 0.004]], 0.034, { r: 0.003, round: 0.004 }))
  b.add('mag', 'blued', prof([[0.04, -0.066], [0.116, -0.066], [0.114, -0.078, 0.004], [0.042, -0.078, 0.004]], 0.038, { r: 0.003, round: 0.003 }))
  crossPin(b, 'body', 'steel', 0.022, 0.04, 0.124, 0.0026)

  const meta: RigMeta = {
    type: 'bolt',
    grip: [0, -0.05, 0.06],
    muzzle: [0, AX, -0.896],
    eject: [0.027, AX + 0.01, -0.0],
    ejectDir: [1, 0.6, 0.2],
    sight: [0, SY, 0.138],
    relief: 0.12,
    hipPos: [0.12, -0.205, -0.43],
    hipRot: [0.02, 0.1, 0.06],
    rh: { p: [0.027, -0.045, 0.06], r: [-0.25, 0, -1.5708], grip: [0.5, 0.42, 0.88, 0.88, 0.84] },
    lh: { p: [-0.012, 0.005, -0.33], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, -0.02, -0.078],
    magDir: [0, -1, 0],
    magHold: { p: [-0.034, -0.09, -0.078], r: [0.0, -1.3, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [0.06, AX - 0.012, 0.07], r: [0.0, -0.6, 1.5], grip: [0.6, 0.6, 0.8, 0.8, 0.8] },
    chargeTravel: 0.1,
    travel: 0.1,
    hasScope: true,
    flashScale: 1.5,
  }
  return { b, meta }
}

// ─── M67 fragmentation grenade (axis = Y, origin at body centre) ────────────

export function buildFrag(): ModelSpec {
  const b = new Builder()
  // Smooth steel sphere body (M67 is not a "pineapple"), seam ring, base plug
  const body = new SphereGeometry(0.0318, 32, 24)
  body.scale(1, 1.06, 1)
  b.add('body', 'grenade', flat(body))
  b.add('body', 'grenade', flat(new TorusGeometry(0.0318, 0.0007, 6, 40).rotateX(Math.PI / 2).translate(0, 0.004, 0)))
  b.add('body', 'metal', flat(new CylinderGeometry(0.0095, 0.0112, 0.004, 18).translate(0, -0.0336, 0)))
  // Fuze: threaded neck, body, striker housing
  b.add('body', 'metal', flat(new CylinderGeometry(0.0118, 0.0152, 0.008, 20).translate(0, 0.036, 0)))
  b.add('body', 'steel', flat(new CylinderGeometry(0.0098, 0.0108, 0.02, 20).translate(0, 0.0495, 0)))
  b.add('body', 'metal', flat(new CylinderGeometry(0.0104, 0.0104, 0.004, 20).translate(0, 0.061, 0)))
  b.add('body', 'steel', flat(new CylinderGeometry(0.0042, 0.0042, 0.016, 10).rotateX(Math.PI / 2).translate(0.0, 0.0545, 0)))
  // Spoon: thin curved strip hugging the body down the +X side, lever top over the fuze
  const spoonC = (t: number): [number, number] => {
    const a = 0.12 + t * 1.75
    const r = 0.0345
    const x = Math.sin(a) * r + 0.002
    const y = Math.cos(a) * r * 1.06 + 0.006
    return [-x, y] // prof f = -x (rotated below)
  }
  const sp = prof(strip(spoonC, () => 0.0016, 14), 0.0135, { r: 0.0006, bevel: 0.0004 })
  sp.rotateY(Math.PI / 2)
  b.add('spoon', 'steel', sp)
  const top = prof(
    [
      [0.003, 0.0636],
      [-0.006, 0.066],
      [-0.03, 0.054, 0.004],
      [-0.031, 0.051],
      [-0.006, 0.062],
      [0.003, 0.0618],
    ],
    0.0135,
    { r: 0.002, bevel: 0.0004 },
  )
  top.rotateY(Math.PI / 2)
  b.add('spoon', 'steel', top)
  b.pivot('spoon', 0, 0.0605, 0)
  // Safety pin (through the fuze) and pull ring + safety clip
  b.add('pin', 'chrome', rod([0, 0.0545, -0.016], [0, 0.0545, 0.014], 0.0012, 0.0012, 8))
  b.add('pin', 'chrome', flat(new TorusGeometry(0.0115, 0.0013, 8, 24).rotateY(0.25).translate(0.002, 0.0545, -0.0275)))
  b.add('pin', 'steel', flat(new TorusGeometry(0.0042, 0.0007, 6, 12).rotateX(Math.PI / 2).translate(0, 0.0545, 0.015)))
  b.pivot('pin', 0, 0.0545, 0)

  const meta: RigMeta = {
    type: 'grenade',
    grip: [0, 0, 0],
    muzzle: [0, 0.07, 0],
    eject: [0, 0, 0],
    ejectDir: [0, 1, 0],
    sight: [0, 0, 0],
    relief: 0.3,
    hipPos: [0.13, -0.17, -0.32],
    hipRot: [0.2, 0.0, 0.0],
    rh: { p: [0.042, 0.0, 0.012], r: [0.25, 0.0, -1.5708], grip: [0.55, 0.62, 0.66, 0.68, 0.7] },
    lh: { p: [-0.02, 0.09, 0.02], r: [0.35, 0.3, 0.35], grip: [0.75, 0.75, 0.55, 0.6, 0.7] },
    flashScale: 0,
  }
  return { b, meta }
}

// ─── Combat knife ───────────────────────────────────────────────────────────

/**
 * Ground blade: stations along the blade (f) with spine height, grind-line
 * height and edge height; the flat above the grind has spine thickness and
 * the grind tapers to a zero-thickness edge — so light catches the bevel.
 */
function bladeGeometry(st: { f: number; spine: number; grind: number; edge: number; t: number }[]): BufferGeometry {
  const pos: number[] = []
  const quad = (a: number[], b2: number[], c: number[], d: number[]) => {
    pos.push(...a, ...b2, ...c, ...a, ...c, ...d)
  }
  for (let i = 0; i < st.length - 1; i++) {
    const s0 = st[i]!
    const s1 = st[i + 1]!
    const h0 = s0.t / 2
    const h1 = s1.t / 2
    for (const sx of [1, -1]) {
      const z0 = -s0.f
      const z1 = -s1.f
      // flat (spine -> grind)
      const A = [sx * h0, s0.spine, z0]
      const B = [sx * h0, s0.grind, z0]
      const C = [sx * h1, s1.grind, z1]
      const D = [sx * h1, s1.spine, z1]
      // grind bevel (grind -> edge)
      const E = [0, s0.edge, z0]
      const F = [0, s1.edge, z1]
      if (sx > 0) {
        quad(A, B, C, D)
        quad(B, E, F, C)
      } else {
        quad(D, C, B, A)
        quad(C, F, E, B)
      }
    }
    // spine top
    quad([-h0, s0.spine, -s0.f], [h0, s0.spine, -s0.f], [h1, s1.spine, -s1.f], [-h1, s1.spine, -s1.f])
  }
  // butt cap at the first station
  const s = st[0]!
  const h = s.t / 2
  quad([h, s.spine, -s.f], [-h, s.spine, -s.f], [-h, s.grind, -s.f], [h, s.grind, -s.f])
  pos.push(h, s.grind, -s.f, -h, s.grind, -s.f, 0, s.edge, -s.f)
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return finish(g, 0.5)
}

export function buildKnife(): ModelSpec {
  const b = new Builder()
  // Clip-point blade, 17 cm, 4.5 mm spine, saber grind, swedge near the tip
  const stations: { f: number; spine: number; grind: number; edge: number; t: number }[] = []
  const N = 16
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const f = 0.006 + u * 0.172
    const clip = Math.max(0, (u - 0.62) / 0.38)
    const belly = Math.max(0, (u - 0.72) / 0.28)
    const spine = 0.0165 - clip * clip * 0.0175 - u * 0.001
    const edge = -0.0145 + belly * belly * 0.0145 + Math.sin(u * Math.PI) * 0.0006
    const grind = edge + (spine - edge) * (0.52 - clip * 0.2)
    stations.push({ f, spine: Math.max(spine, edge + 0.0006), grind: Math.min(grind, spine - 0.0003), edge, t: 0.0045 * (1 - clip * 0.75) })
  }
  b.add('body', 'steel', bladeGeometry(stations))
  b.add('body', 'void', box(0.02, 0.11, 0.0085, 0.0098, -0.0024, 0.0024)) // fuller
  // Guard (double quillon), ferrule, wrapped grip, pommel with lanyard hole
  b.add('body', 'blued', prof([[-0.006, -0.026, 0.004], [0.004, -0.026, 0.004], [0.004, 0.026, 0.004], [-0.006, 0.026, 0.004]], 0.016, { r: 0.003, round: 0.0035 }))
  b.add('body', 'blued', cyl(0.0125, 0.0118, -0.012, -0.006, 0, 0, 18))
  const gr: [number, number][] = [[0.0, -0.118]]
  for (let i = 0; i < 9; i++) {
    const f = -0.112 + i * 0.0115
    gr.push([0.0138, f], [0.0151, f + 0.003], [0.0151, f + 0.0085], [0.0138, f + 0.0115])
  }
  gr.push([0.0, -0.0084])
  b.add('body', 'rubber', lathe(gr, 0, 0, 20, 0.5).scale(1, 1.18, 1))
  b.add('body', 'blued', lathe([[0.0, -0.132], [0.0118, -0.132], [0.0148, -0.124], [0.0142, -0.116], [0.0, -0.116]], 0, 0, 20).scale(1, 1.15, 1))
  b.add('body', 'void', pin('x', 0.0032, 0.0306, 0, 0, -0.125, 12))

  const meta: RigMeta = {
    type: 'knife',
    grip: [0, 0, 0.05],
    muzzle: [0, 0, -0.18],
    eject: [0, 0, 0],
    ejectDir: [0, 1, 0],
    sight: [0, 0, 0],
    relief: 0.3,
    hipPos: [0.16, -0.17, -0.32],
    hipRot: [0.0, 0.0, 0.0],
    rh: { p: [0.0, 0.0, 0.06], r: [-1.5708, 0.0, -1.5708], grip: [0.55, 0.9, 0.95, 0.95, 0.9] },
    lh: { p: [-0.2, -0.3, 0.2], r: [0.0, 0.0, 0.0], grip: [0.3, 0.3, 0.3, 0.3, 0.3] },
    flashScale: 0,
  }
  return { b, meta }
}
