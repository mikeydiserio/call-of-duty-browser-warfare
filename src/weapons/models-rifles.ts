/**
 * Procedural rifle / SMG models: ACR, M4A1, AK-47, UMP45.
 * Local frame: +X right, +Y up, barrel along -Z (profiles are in (f, y), z = -f).
 */
import { box, Builder, cyl, frameXY, lathe, pin, prof, rbox, rod, strip, tube, type P } from './geo'
import type { RigMeta } from './rig'
import type { MatKey } from './materials'

export interface ModelSpec {
  b: Builder
  meta: RigMeta
}

/** Picatinny-ish rail teeth. */
export function teeth(b: Builder, part: string, m: MatKey, f0: number, f1: number, ytop: number, w: number, pitch = 0.0125, h = 0.004, t = 0.006): void {
  for (let f = f0; f < f1; f += pitch) b.add(part, m, box(f, f + t, ytop, ytop + h, -w / 2, w / 2))
}

/** Trigger guard with hole, centred at f0..f1. */
export function triggerGuard(b: Builder, part: string, m: MatKey, f0: number, f1: number, ytop: number, ybot: number, w = 0.006): void {
  const t = 0.0065
  const outer: P[] = [
    [f0, ytop],
    [f1, ytop],
    [f1, ybot + (ytop - ybot) * 0.35],
    [f1 - (f1 - f0) * 0.3, ybot],
    [f0 + (f1 - f0) * 0.25, ybot],
    [f0, ybot + (ytop - ybot) * 0.4],
  ]
  const inner: P[] = [
    [f0 + t, ytop - t * 0.8],
    [f1 - t, ytop - t * 0.8],
    [f1 - t, ybot + (ytop - ybot) * 0.4],
    [f1 - (f1 - f0) * 0.3 - t * 0.2, ybot + t],
    [f0 + (f1 - f0) * 0.25 + t * 0.2, ybot + t],
    [f0 + t, ybot + (ytop - ybot) * 0.45],
  ]
  b.add(part, m, prof(outer, w, { holes: [inner], r: 0.003, bevel: 0.0008 }))
}

// ─── ACR ────────────────────────────────────────────────────────────────────

export function buildACR(): ModelSpec {
  const b = new Builder()
  // Upper receiver + integral top rail
  b.add('body', 'metal', prof([[-0.16, 0.04], [-0.16, 0.098, 0.01], [-0.15, 0.108], [0.24, 0.108], [0.25, 0.098], [0.25, 0.04]], 0.046, { r: 0.005 }))
  b.add('body', 'void', box(0.015, 0.105, 0.06, 0.092, 0.0228, 0.0238))
  b.add('body', 'metal', rbox(-0.16, 0.475, 0.108, 0.113, 0.022, 0, 0.001))
  teeth(b, 'body', 'metal', -0.15, 0.47, 0.113, 0.022, 0.0125)
  // Lower receiver, magwell, grip, guard
  b.add('body', 'poly', prof([[-0.16, 0.043], [0.158, 0.043], [0.158, 0.0], [0.12, -0.012], [0.04, -0.012], [0.0, -0.004], [-0.16, -0.004]], 0.04, { r: 0.004 }))
  b.add('body', 'poly', prof([[0.034, 0.002], [0.12, 0.002], [0.124, -0.05], [0.03, -0.05]], 0.043, { r: 0.004 }))
  b.add('body', 'poly', prof([[-0.062, 0.042], [-0.004, 0.042], [-0.01, 0.0], [-0.022, -0.06], [-0.032, -0.122], [-0.088, -0.126], [-0.094, -0.06], [-0.082, -0.02]], 0.034, { r: 0.008 }))
  b.add('body', 'rubber', prof([[-0.075, -0.07], [-0.036, -0.07], [-0.034, -0.12], [-0.088, -0.122]], 0.0365, { r: 0.004 }))
  triggerGuard(b, 'body', 'poly', -0.003, 0.034, -0.004, -0.052)
  b.add('body', 'steel', rbox(0.012, 0.018, -0.034, -0.006, 0.006, 0, 0.002))
  // Handguard: slim polymer with M-LOK-ish slots
  b.add('body', 'poly', prof([[0.25, 0.036], [0.25, 0.114, 0.006], [0.482, 0.104, 0.006], [0.482, 0.04]], 0.05, { r: 0.008 }))
  for (let i = 0; i < 6; i++) {
    const f = 0.29 + i * 0.033
    b.add('body', 'void', box(f, f + 0.022, 0.056, 0.064, -0.0262, 0.0262))
    b.add('body', 'void', box(f, f + 0.022, 0.082, 0.09, -0.0262, 0.0262))
  }
  teeth(b, 'body', 'metal', 0.25, 0.48, 0.114, 0.022, 0.0125)
  // Barrel, gas block, flash hider
  b.add('body', 'blued', lathe([[0.0085, 0.48], [0.0085, 0.585]], 0, 0.065, 16))
  b.add('body', 'metal', rbox(0.484, 0.508, 0.048, 0.096, 0.026, 0, 0.004))
  b.add('body', 'blued', lathe([[0, 0.585], [0.0105, 0.585], [0.0125, 0.59], [0.0125, 0.64], [0.0105, 0.648], [0, 0.648]], 0, 0.065, 20))
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI
    b.add('body', 'void', pin('x', 0.0017, 0.027, 0, 0, 0.62, 6).rotateZ(a).translate(0, 0.065, 0))
  }
  b.add('body', 'void', cyl(0.0058, 0.0058, 0.646, 0.6485, 0, 0.065, 12))
  // Stock + buttpad
  b.add('body', 'poly', prof([[-0.16, 0.1], [-0.28, 0.097], [-0.304, 0.088], [-0.31, -0.04], [-0.286, -0.052], [-0.25, -0.016], [-0.16, 0.0]], 0.04, { r: 0.007 }))
  b.add('body', 'rubber', prof([[-0.306, 0.088], [-0.322, 0.082], [-0.326, -0.04], [-0.31, -0.05]], 0.043, { r: 0.004 }))
  b.add('body', 'metal', rbox(-0.2, -0.16, 0.04, 0.098, 0.03, 0, 0.003))
  // Red dot sight
  b.add('body', 'metal', prof([[0.0, 0.113], [0.085, 0.113], [0.078, 0.141], [0.01, 0.141]], 0.022, { r: 0.003 }))
  b.add('body', 'blued', tube(0.0178, 0.0158, -0.004, 0.092, 0, 0.158, 28))
  b.add('body', 'blued', rbox(-0.004, 0.092, 0.172, 0.178, 0.012, 0, 0.002))
  b.add('body', 'metal', pin('y', 0.005, 0.014, 0, 0.19, 0.04, 10))
  b.add('body', 'glass', cyl(0.0158, 0.0158, 0.087, 0.0875, 0, 0.158, 24))
  b.add('body', 'dot', new (SphereDot)(0, 0.158, -0.03))
  // Magazine (STANAG-style, curved)
  b.add('mag', 'poly', prof(strip((t) => [0.0775 + 0.03 * t * t, -0.03 - 0.17 * t], () => 0.06, 10), 0.024, { r: 0.003 }))
  b.add('mag', 'metal', rbox(0.072, 0.146, -0.209, -0.198, 0.028, 0, 0.002))
  for (let i = 0; i < 3; i++) b.add('mag', 'void', box(0.06 + i * 0.006, 0.063 + i * 0.006, -0.16 + i * 0.001, -0.07, -0.0123, 0.0123))
  // Charging handle (left side)
  b.add('charge', 'metal', box(0.095, 0.128, 0.086, 0.098, -0.04, -0.0225))
  b.add('charge', 'metal', rbox(0.1, 0.122, 0.078, 0.108, 0.01, -0.043, 0.003))

  const meta: RigMeta = {
    type: 'rifle',
    grip: [0, -0.05, 0.055],
    muzzle: [0, 0.065, -0.65],
    eject: [0.024, 0.078, -0.06],
    ejectDir: [1, 0.45, 0.35],
    sight: [0, 0.158, 0.0],
    relief: 0.3,
    hipPos: [0.17, -0.2, -0.3],
    hipRot: [0.0, 0.03, 0.0],
    rh: { p: [0.034, -0.04, 0.062], r: [0, 0, -1.5708], grip: [0.5, 0.45, 0.88, 0.88, 0.85] },
    lh: { p: [-0.012, 0.012, -0.32], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, -0.02, -0.0775],
    magDir: [0, -1, -0.2],
    magHold: { p: [-0.032, -0.1, -0.095], r: [0.0, -1.3, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [-0.052, 0.07, -0.11], r: [0.0, 0.0, 1.5], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
    chargeTravel: 0.055,
    flashScale: 1.0,
  }
  return { b, meta }
}

// ─── M4A1 ───────────────────────────────────────────────────────────────────

export function buildM4A1(): ModelSpec {
  const b = new Builder()
  // Flat-top upper + lower
  b.add('body', 'metal', prof([[-0.1, 0.038], [-0.1, 0.1, 0.008], [-0.092, 0.108], [0.205, 0.108], [0.205, 0.038]], 0.04, { r: 0.004 }))
  b.add('body', 'metal', rbox(-0.1, 0.205, 0.108, 0.112, 0.021, 0, 0.001))
  teeth(b, 'body', 'metal', -0.098, 0.2, 0.112, 0.021, 0.0125)
  b.add('body', 'void', box(0.0, 0.082, 0.065, 0.093, 0.0198, 0.0207))
  b.add('body', 'metal', prof([[0.0, 0.07], [0.08, 0.075], [0.08, 0.09], [0.0, 0.098]], 0.0425, { r: 0.004 })) // ejection cover
  b.add('body', 'metal', rbox(-0.06, -0.025, 0.065, 0.098, 0.0432, 0, 0.004)) // forward assist boss
  b.add('body', 'blued', prof([[-0.102, 0.04], [0.15, 0.04], [0.15, -0.002], [0.115, -0.012], [0.03, -0.012], [-0.0, -0.004], [-0.102, -0.004]], 0.038, { r: 0.004 }))
  b.add('body', 'blued', prof([[0.03, 0.002], [0.116, 0.002], [0.122, -0.048], [0.026, -0.048]], 0.043, { r: 0.004 }))
  b.add('body', 'poly', prof([[-0.06, 0.04], [-0.002, 0.04], [-0.01, -0.01], [-0.02, -0.06], [-0.03, -0.122], [-0.088, -0.126], [-0.092, -0.06], [-0.08, -0.02]], 0.033, { r: 0.008 }))
  triggerGuard(b, 'body', 'metal', -0.003, 0.034, -0.004, -0.052)
  b.add('body', 'steel', rbox(0.012, 0.018, -0.034, -0.006, 0.006, 0, 0.002))
  // Buffer tube + CAR stock
  b.add('body', 'metal', lathe([[0.0165, -0.1], [0.0165, -0.285]], 0, 0.064, 16))
  b.add('body', 'poly', prof([[-0.13, 0.083], [-0.3, 0.09], [-0.31, 0.03], [-0.297, -0.05], [-0.268, -0.05], [-0.2, 0.006], [-0.13, 0.0]], 0.038, { r: 0.007 }))
  b.add('body', 'rubber', prof([[-0.302, 0.088], [-0.318, 0.082], [-0.322, -0.045], [-0.3, -0.052]], 0.04, { r: 0.004 }))
  // RIS handguard
  b.add('body', 'metal', prof([[0.205, 0.038], [0.205, 0.108], [0.43, 0.108], [0.43, 0.038]], 0.048, { r: 0.006 }))
  for (let i = 0; i < 7; i++) b.add('body', 'void', box(0.225 + i * 0.03, 0.245 + i * 0.03, 0.06, 0.066, -0.0245, 0.0245))
  b.add('body', 'metal', rbox(0.205, 0.43, 0.108, 0.112, 0.021, 0, 0.001))
  teeth(b, 'body', 'metal', 0.21, 0.428, 0.112, 0.021, 0.0125)
  // Barrel, gas block with front sight tower, A2 hider
  b.add('body', 'blued', lathe([[0.0085, 0.43], [0.0085, 0.505]], 0, 0.065, 16))
  b.add('body', 'metal', prof([[0.4, 0.07], [0.4, 0.14], [0.445, 0.14], [0.445, 0.07]], 0.014, { r: 0.002 }))
  b.add('body', 'metal', rbox(0.4, 0.445, 0.1, 0.108, 0.026, 0, 0.002))
  b.add('body', 'steel', rbox(0.416, 0.426, 0.14, 0.158, 0.0025, 0, 0.0005)) // post, tip at y=0.158
  b.add('body', 'metal', tube(0.0105, 0.0085, 0.4, 0.43, 0, 0.065, 16))
  b.add('body', 'blued', lathe([[0, 0.505], [0.0105, 0.505], [0.0115, 0.512], [0.0115, 0.55], [0.0098, 0.556], [0, 0.556]], 0, 0.065, 20))
  for (let i = 0; i < 3; i++) {
    b.add('body', 'void', pin('x', 0.0016, 0.03, 0, 0.065, 0.524 + i * 0.01, 6))
  }
  b.add('body', 'void', cyl(0.0055, 0.0055, 0.555, 0.5565, 0, 0.065, 12))
  // Flip-up rear aperture sight (tip aligned with the front post at y=0.158)
  b.add('body', 'metal', prof([[-0.062, 0.112], [-0.062, 0.145, 0.003], [-0.034, 0.145, 0.003], [-0.034, 0.112]], 0.016, { r: 0.002 }))
  b.add('body', 'blued', tube(0.0105, 0.0042, -0.054, -0.044, 0, 0.158, 20))
  b.add('body', 'metal', rbox(-0.056, -0.04, 0.142, 0.168, 0.003, -0.0122, 0.0005))
  b.add('body', 'metal', rbox(-0.056, -0.04, 0.142, 0.168, 0.003, 0.0122, 0.0005))
  // Magazine
  b.add('mag', 'metal', prof(strip((t) => [0.074 + 0.03 * t * t, -0.03 - 0.17 * t], () => 0.06, 10), 0.023, { r: 0.002 }))
  b.add('mag', 'poly', rbox(0.07, 0.142, -0.21, -0.2, 0.027, 0, 0.002))
  // Charging handle (T-handle, rear top)
  b.add('charge', 'metal', rbox(-0.15, -0.1, 0.1, 0.108, 0.009, 0, 0.002))
  b.add('charge', 'metal', rbox(-0.152, -0.138, 0.098, 0.112, 0.034, 0, 0.003))
  b.add('charge', 'poly', rbox(-0.152, -0.138, 0.096, 0.114, 0.012, 0, 0.003))

  const meta: RigMeta = {
    type: 'rifle',
    grip: [0, -0.05, 0.055],
    muzzle: [0, 0.065, -0.556],
    eject: [0.0207, 0.08, -0.04],
    ejectDir: [1, 0.45, 0.35],
    sight: [0, 0.158, 0.05],
    relief: 0.26,
    hipPos: [0.17, -0.2, -0.3],
    hipRot: [0.0, 0.03, 0.0],
    rh: { p: [0.032, -0.04, 0.062], r: [0, 0, -1.5708], grip: [0.5, 0.45, 0.88, 0.88, 0.85] },
    lh: { p: [-0.012, 0.014, -0.3], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, -0.02, -0.074],
    magDir: [0, -1, -0.17],
    magHold: { p: [-0.032, -0.1, -0.09], r: [0.0, -1.3, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [0.0, 0.12, 0.14], r: [0.0, 0.0, 0.0], grip: [0.6, 0.6, 0.8, 0.8, 0.8] },
    chargeTravel: 0.05,
    flashScale: 1.0,
  }
  return { b, meta }
}

// ─── AK-47 ──────────────────────────────────────────────────────────────────

export function buildAK47(): ModelSpec {
  const b = new Builder()
  // Stamped receiver + dust cover
  b.add('body', 'metal', prof([[-0.14, 0.036], [-0.14, 0.092, 0.01], [-0.12, 0.103, 0.014], [0.12, 0.103, 0.01], [0.2, 0.088], [0.2, 0.036]], 0.042, { r: 0.004 }))
  b.add('body', 'blued', prof([[-0.11, 0.05], [-0.11, 0.098, 0.01], [0.115, 0.1, 0.006], [0.115, 0.05]], 0.0435, { r: 0.004 }))
  b.add('body', 'void', box(0.02, 0.1, 0.06, 0.085, 0.0212, 0.0222))
  b.add('body', 'metal', prof([[-0.14, 0.04], [0.19, 0.04], [0.19, 0.0], [0.04, -0.012], [-0.04, -0.012], [-0.14, 0.0]], 0.04, { r: 0.004 }))
  triggerGuard(b, 'body', 'metal', -0.01, 0.045, -0.005, -0.056)
  b.add('body', 'steel', rbox(0.012, 0.018, -0.036, -0.006, 0.006, 0, 0.002))
  // Pistol grip (bakelite/wood)
  b.add('body', 'wood', prof([[-0.075, 0.04], [-0.03, 0.04], [-0.033, -0.01], [-0.052, -0.1], [-0.07, -0.128], [-0.115, -0.13], [-0.105, -0.07], [-0.092, -0.01]], 0.034, { r: 0.008 }))
  // Wooden stock
  b.add('body', 'wood', prof([[-0.14, 0.092], [-0.36, 0.1], [-0.39, 0.092], [-0.402, 0.08], [-0.402, -0.045], [-0.388, -0.056], [-0.3, -0.012], [-0.14, 0.01]], 0.036, { r: 0.006 }))
  b.add('body', 'rubber', prof([[-0.394, 0.09], [-0.408, 0.08], [-0.408, -0.046], [-0.393, -0.057]], 0.039, { r: 0.004 }))
  b.add('body', 'metal', rbox(-0.152, -0.138, 0.035, 0.098, 0.034, 0, 0.003))
  // Handguards
  b.add('body', 'wood', prof([[0.19, 0.012], [0.19, 0.062], [0.42, 0.058], [0.42, 0.02]], 0.05, { r: 0.012 }))
  b.add('body', 'wood', prof([[0.22, 0.064], [0.22, 0.096], [0.38, 0.096], [0.38, 0.064]], 0.034, { r: 0.008 }))
  for (let i = 0; i < 5; i++) b.add('body', 'void', box(0.215 + i * 0.03, 0.22 + i * 0.03, 0.05, 0.062, -0.0255, 0.0255))
  b.add('body', 'metal', rbox(0.19, 0.225, 0.014, 0.052, 0.052, 0, 0.003))
  // Gas tube, gas block, barrel
  b.add('body', 'blued', lathe([[0.0108, 0.2], [0.0108, 0.43]], 0, 0.1, 14))
  b.add('body', 'blued', lathe([[0.0092, 0.4], [0.0092, 0.64]], 0, 0.065, 16))
  b.add('body', 'metal', rbox(0.4, 0.46, 0.056, 0.112, 0.022, 0, 0.004))
  // Front sight tower with hood
  b.add('body', 'metal', prof([[0.44, 0.105], [0.44, 0.15], [0.462, 0.15], [0.462, 0.105]], 0.014, { r: 0.002 }))
  b.add('body', 'blued', tube(0.0125, 0.0108, 0.432, 0.472, 0, 0.138, 18))
  b.add('body', 'steel', rbox(0.447, 0.453, 0.108, 0.135, 0.003, 0, 0.0005))
  // Muzzle brake
  b.add('body', 'blued', lathe([[0, 0.605], [0.0125, 0.605], [0.0135, 0.612], [0.0135, 0.655], [0.0115, 0.662], [0, 0.662]], 0, 0.065, 22))
  for (let i = 0; i < 3; i++) b.add('body', 'void', pin('x', 0.0018, 0.032, 0, 0.065, 0.628 + i * 0.01, 6))
  b.add('body', 'void', cyl(0.006, 0.006, 0.661, 0.6625, 0, 0.065, 12))
  // Tangent rear sight (notch at y=0.135 -> use post tip 0.135 as sight line)
  b.add('body', 'metal', prof([[0.115, 0.103], [0.115, 0.122], [0.2, 0.122], [0.21, 0.108]], 0.022, { r: 0.002 }))
  b.add('body', 'steel', rbox(0.15, 0.17, 0.122, 0.133, 0.006, -0.0095, 0.001))
  b.add('body', 'steel', rbox(0.15, 0.17, 0.122, 0.133, 0.006, 0.0095, 0.001))
  // Curved banana magazine
  b.add('mag', 'blued', prof(strip((t) => [0.07 + 0.12 * Math.pow(t, 1.9), -0.012 - 0.2 * t], () => 0.07, 12), 0.027, { r: 0.003 }))
  b.add('mag', 'metal', rbox(0.15, 0.234, -0.224, -0.212, 0.03, 0, 0.002))
  for (let i = 0; i < 4; i++) b.add('mag', 'void', box(0.07 + i * 0.03, 0.073 + i * 0.03, -0.11, -0.05, -0.0138, 0.0138))
  // Charging handle (right side)
  b.add('charge', 'metal', box(0.07, 0.092, 0.07, 0.082, 0.022, 0.04))
  b.add('charge', 'metal', rbox(0.067, 0.088, 0.066, 0.092, 0.01, 0.045, 0.003))

  const meta: RigMeta = {
    type: 'rifle',
    grip: [0, -0.055, 0.075],
    muzzle: [0, 0.065, -0.662],
    eject: [0.0222, 0.075, -0.06],
    ejectDir: [1, 0.5, 0.35],
    sight: [0, 0.138, -0.162],
    relief: 0.34,
    hipPos: [0.17, -0.2, -0.28],
    hipRot: [0.0, 0.03, 0.0],
    rh: { p: [0.032, -0.05, 0.08], r: [0, 0, -1.5708], grip: [0.5, 0.45, 0.88, 0.88, 0.85] },
    lh: { p: [-0.012, 0.014, -0.31], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, -0.02, -0.075],
    magDir: [0, -1, -0.45],
    magHold: { p: [-0.032, -0.11, -0.12], r: [0.0, -1.3, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [0.045, 0.075, -0.08], r: [0.0, 0.0, -1.57], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
    chargeTravel: 0.07,
    flashScale: 1.1,
  }
  return { b, meta }
}

// ─── UMP45 ──────────────────────────────────────────────────────────────────

export function buildUMP45(): ModelSpec {
  const b = new Builder()
  // Main polymer body
  b.add('body', 'poly', prof([[-0.17, 0.034], [-0.17, 0.1, 0.01], [-0.155, 0.108], [0.27, 0.108], [0.27, 0.034]], 0.046, { r: 0.006 }))
  b.add('body', 'poly', prof([[-0.17, 0.04], [0.16, 0.04], [0.16, 0.0], [0.115, -0.014], [0.03, -0.014], [0.0, -0.006], [-0.17, -0.006]], 0.042, { r: 0.004 }))
  b.add('body', 'poly', prof([[0.035, 0.002], [0.122, 0.002], [0.126, -0.05], [0.03, -0.05]], 0.044, { r: 0.004 }))
  b.add('body', 'poly', prof([[-0.065, 0.04], [-0.005, 0.04], [-0.012, 0.0], [-0.024, -0.062], [-0.034, -0.12], [-0.088, -0.124], [-0.096, -0.06], [-0.084, -0.02]], 0.035, { r: 0.008 }))
  b.add('body', 'rubber', prof([[-0.078, -0.07], [-0.037, -0.07], [-0.034, -0.12], [-0.09, -0.122]], 0.0375, { r: 0.004 }))
  triggerGuard(b, 'body', 'poly', -0.003, 0.034, -0.006, -0.054)
  b.add('body', 'steel', rbox(0.012, 0.018, -0.036, -0.006, 0.006, 0, 0.002))
  b.add('body', 'void', box(0.02, 0.11, 0.062, 0.094, 0.0228, 0.0238))
  // Top Picatinny
  b.add('body', 'metal', rbox(-0.16, 0.4, 0.108, 0.113, 0.022, 0, 0.001))
  teeth(b, 'body', 'metal', -0.15, 0.398, 0.113, 0.022, 0.0125)
  // Fore-end / barrel shroud with bottom rail and vents
  b.add('body', 'poly', prof([[0.27, 0.04], [0.27, 0.1], [0.4, 0.096, 0.01], [0.4, 0.05, 0.006], [0.37, 0.036]], 0.042, { r: 0.008 }))
  for (let i = 0; i < 5; i++) b.add('body', 'void', box(0.29 + i * 0.022, 0.298 + i * 0.022, 0.056, 0.086, -0.0222, 0.0222))
  teeth(b, 'body', 'metal', 0.285, 0.395, 0.0, 0.022, 0.0125, 0.0)
  b.add('body', 'metal', rbox(0.28, 0.395, 0.026, 0.04, 0.02, 0, 0.002))
  // Barrel + compact muzzle device
  b.add('body', 'blued', lathe([[0.0095, 0.4], [0.0095, 0.45]], 0, 0.072, 16))
  b.add('body', 'blued', lathe([[0, 0.45], [0.012, 0.45], [0.012, 0.485], [0.0105, 0.49], [0, 0.49]], 0, 0.072, 20))
  b.add('body', 'void', cyl(0.0058, 0.0058, 0.489, 0.4905, 0, 0.072, 12))
  // Folding wire stock (extended)
  b.add('body', 'metal', rbox(-0.2, -0.165, 0.03, 0.105, 0.04, 0, 0.004))
  b.add('body', 'metal', rod([0.015, 0.086, 0.2], [0.015, 0.088, 0.31], 0.0052))
  b.add('body', 'metal', rod([-0.015, 0.086, 0.2], [-0.015, 0.088, 0.31], 0.0052))
  b.add('body', 'metal', rod([0.015, 0.04, 0.2], [0.015, 0.025, 0.31], 0.0052))
  b.add('body', 'metal', rod([-0.015, 0.04, 0.2], [-0.015, 0.025, 0.31], 0.0052))
  b.add('body', 'poly', prof([[-0.31, 0.105], [-0.332, 0.1], [-0.338, 0.0], [-0.322, -0.03], [-0.304, 0.0]], 0.044, { r: 0.006 }))
  b.add('body', 'rubber', prof([[-0.332, 0.1], [-0.342, 0.095], [-0.346, -0.002], [-0.338, -0.0]], 0.045, { r: 0.003 }))
  // Holographic sight (open window frame)
  b.add('body', 'metal', prof([[-0.006, 0.113], [0.1, 0.113], [0.096, 0.126], [0.0, 0.126]], 0.032, { r: 0.002 }))
  b.add('body', 'poly', frameXY(0, 0.151, 0.04, 0.056, 0.03, 0.04, -0.006, 0.006))
  b.add('body', 'poly', frameXY(0, 0.151, 0.04, 0.056, 0.03, 0.04, 0.078, 0.092))
  b.add('body', 'poly', rbox(-0.006, 0.092, 0.172, 0.18, 0.04, 0, 0.003))
  b.add('body', 'glass', box(0.0, 0.0005 + 0.088, 0.128, 0.172, -0.0155, -0.0153))
  b.add('body', 'dot', new (SphereDot)(0, 0.151, -0.05))
  // Magazine
  b.add('mag', 'poly', prof(strip((t) => [0.0785 + 0.012 * t, -0.03 - 0.18 * t], () => 0.05, 8), 0.027, { r: 0.003 }))
  b.add('mag', 'poly', rbox(0.056, 0.114, -0.218, -0.208, 0.031, 0, 0.002))
  // Charging handle
  b.add('charge', 'metal', rbox(-0.12, -0.08, 0.108, 0.122, 0.016, 0, 0.003))

  const meta: RigMeta = {
    type: 'rifle',
    grip: [0, -0.05, 0.06],
    muzzle: [0, 0.072, -0.49],
    eject: [0.0238, 0.078, -0.07],
    ejectDir: [1, 0.5, 0.3],
    sight: [0, 0.151, 0.0],
    relief: 0.28,
    hipPos: [0.17, -0.2, -0.3],
    hipRot: [0.0, 0.03, 0.0],
    rh: { p: [0.034, -0.04, 0.065], r: [0, 0, -1.5708], grip: [0.5, 0.45, 0.88, 0.88, 0.85] },
    lh: { p: [-0.01, 0.016, -0.32], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, -0.02, -0.0785],
    magDir: [0, -1, -0.07],
    magHold: { p: [-0.032, -0.1, -0.08], r: [0.0, -1.3, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [0.0, 0.14, 0.1], r: [0.0, 0.0, 0.0], grip: [0.6, 0.6, 0.8, 0.8, 0.8] },
    chargeTravel: 0.05,
    flashScale: 0.9,
  }
  return { b, meta }
}

// A tiny sphere for red-dot reticles (kept out of geo.ts so the dependency stays local).
import { SphereGeometry } from 'three'
export class SphereDot extends SphereGeometry {
  constructor(x: number, y: number, z: number) {
    super(0.0011, 8, 6)
    this.translate(x, y, z)
  }
}
