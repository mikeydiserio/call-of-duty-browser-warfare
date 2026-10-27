/**
 * Procedural rifle / SMG models: ACR, M4A1, AK-47, UMP45.
 * Local frame: +X right, +Y up, barrel along -Z (profiles are in (f, y), z = -f).
 */
import { box, Builder, crossPin, flat, cyl, frameXY, halfSec, lathe, pin, prof, rail1913, rbox, ring, rod, screwHead, serrations, strip, tube, xsec, type P } from './geo'
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

// ─── ACR ─────────────────────────────────────────────────────────────────────
// Masada pattern: monolithic aluminium upper with continuous top rail,
// forward non-reciprocating charging handle (left), polymer lower with angular
// magwell + big integrated guard, tapered vented handguard, folding stock,
// Aimpoint-style red dot on a riser mount.

export const ACR_SIGHT_Y = 0.149

export function buildACR(): ModelSpec {
  const b = new Builder()
  const BY = 0.065
  const SY = ACR_SIGHT_Y
  // ── Upper receiver (aluminium)
  const upSec = halfSec([
    [0.0155, 0.044],
    [0.0172, 0.048],
    [0.0172, 0.079],
    [0.0145, 0.0858],
    [0.0105, 0.0885],
  ])
  b.add('body', 'metal', xsec(upSec, -0.128, 0.205, 0.0012, 0.002))
  rail1913(b, 'body', 'metal', -0.126, 0.47, 0.098, 0, 0.0212)
  // ejection port + brass deflector bump (right)
  b.add('body', 'void', box(0.0, 0.085, 0.056, 0.08, 0.0168, 0.0175))
  b.add('body', 'metal', rbox(0.0, 0.085, 0.0545, 0.056, 0.0352, 0, 0.0006, 0.0003))
  b.add('body', 'metal', prof([[-0.018, 0.072], [0.0, 0.072], [0.0, 0.086], [-0.01, 0.086]], 0.006, { x: 0.0185, r: 0.002, bevel: 0.0008 }))
  // charging handle channel (left) — handle itself is the 'charge' part
  b.add('body', 'void', box(0.06, 0.205, 0.072, 0.0745, -0.0176, -0.0168))
  screwHead(b, 'body', 'steel', -0.0174, 0.062, 0.18, 0.0024)
  screwHead(b, 'body', 'steel', 0.0174, 0.062, 0.18, 0.0024)
  // barrel clamp screws ahead of the receiver
  // ── Lower receiver (polymer)
  b.add(
    'body',
    'poly',
    prof(
      [
        [-0.128, 0.046],
        [0.196, 0.046],
        [0.196, 0.034, 0.004],
        [0.178, 0.008, 0.004],
        [0.16, -0.046, 0.003],
        [0.064, -0.05, 0.003],
        [0.06, 0.002, 0.004],
        [-0.026, 0.002],
        [-0.066, 0.002],
        [-0.1, 0.012, 0.012],
        [-0.128, 0.03, 0.006],
      ],
      0.033,
      { r: 0.003, bevel: 0.0016 },
    ),
  )
  // magwell flare at the bottom
  b.add('body', 'poly', prof([[0.06, -0.034], [0.166, -0.034], [0.161, -0.054, 0.003], [0.062, -0.054, 0.003]], 0.037, { r: 0.002, bevel: 0.0014 }))
  // integrated trigger guard (big, angular, gloved-hand friendly)
  b.add('body', 'poly', prof([[-0.016, 0.004], [0.062, 0.004], [0.062, -0.034], [0.04, -0.054, 0.006], [-0.004, -0.054, 0.006], [-0.016, -0.036, 0.006]], 0.008, { r: 0.002, bevel: 0.0008, holes: [[[-0.008, -0.002], [0.054, -0.002], [0.054, -0.03], [0.036, -0.046, 0.005], [0.0, -0.046, 0.005], [-0.008, -0.032, 0.005]]] }))
  b.add('body', 'blued', prof(strip((t) => [0.024 - 0.008 * t * t, 0.003 - 0.03 * t], () => 0.0052, 6), 0.0058, { r: 0.0012, bevel: 0.0004 }))
  // ambi bolt release paddle in front of the guard, mag release button
  b.add('body', 'blued', prof([[0.052, -0.006], [0.064, -0.002], [0.066, -0.016, 0.002], [0.056, -0.018, 0.002]], 0.02, { r: 0.002, bevel: 0.0006 }))
  b.add('body', 'blued', pin('x', 0.0045, 0.003, 0.0172, 0.014, 0.05, 14))
  // ambi selector
  b.add('body', 'blued', pin('x', 0.0042, 0.036, 0, 0.026, -0.036, 14))
  b.add('body', 'blued', prof([[-0.05, 0.022], [-0.036, 0.022, 0.003], [-0.036, 0.03, 0.003], [-0.048, 0.03]], 0.002, { x: -0.0186, r: 0.002, bevel: 0.0004 }))
  b.add('body', 'blued', prof([[-0.05, 0.022], [-0.036, 0.022, 0.003], [-0.036, 0.03, 0.003], [-0.048, 0.03]], 0.002, { x: 0.0186, r: 0.002, bevel: 0.0004 }))
  crossPin(b, 'body', 'steel', 0.0165, 0.03, 0.188, 0.0022)
  crossPin(b, 'body', 'steel', 0.0165, 0.03, -0.112, 0.0022)
  crossPin(b, 'body', 'steel', 0.0165, 0.018, 0.008, 0.0016)
  crossPin(b, 'body', 'steel', 0.0165, 0.018, -0.012, 0.0016)
  // grip (MIAD-like, slim, rubber panels)
  b.add(
    'body',
    'poly',
    prof(
      [
        [-0.066, 0.004],
        [-0.014, 0.004],
        [-0.018, -0.024, 0.008],
        [-0.03, -0.1, 0.01],
        [-0.038, -0.112, 0.004],
        [-0.075, -0.11, 0.006],
        [-0.074, -0.066, 0.014],
        [-0.064, -0.024, 0.012],
        [-0.072, -0.006, 0.004],
      ],
      0.029,
      { r: 0.004, bevel: 0.003 },
    ),
  )
  b.add('body', 'rubber', prof([[-0.064, -0.03], [-0.026, -0.03], [-0.032, -0.096], [-0.07, -0.096]], 0.0305, { r: 0.006, bevel: 0.0016 }))
  // ── Handguard (polymer): tapered section, vent slots, hand-stop flare at the front
  const hgSec = halfSec([
    [0.008, 0.03],
    [0.018, 0.036],
    [0.0235, 0.05],
    [0.0235, 0.08],
    [0.017, 0.0885],
  ])
  b.add('body', 'poly', xsec(hgSec, 0.2, 0.43, 0.0018, 0.003))
  b.add('body', 'poly', xsec(halfSec([[0.009, 0.024], [0.02, 0.031], [0.026, 0.048], [0.026, 0.08], [0.018, 0.0885]]), 0.405, 0.435, 0.0016, 0.003))
  for (let i = 0; i < 6; i++) {
    const f = 0.222 + i * 0.03
    for (const y of [0.054, 0.07]) {
      b.add('body', 'void', box(f, f + 0.018, y, y + 0.0055, 0.0232, 0.0239))
      b.add('body', 'void', box(f, f + 0.018, y, y + 0.0055, -0.0239, -0.0232))
    }
  }
  b.add('body', 'void', box(0.215, 0.4, 0.0298, 0.0306, -0.004, 0.004))
  // QD sling sockets
  b.add('body', 'blued', pin('x', 0.0052, 0.05, 0, 0.042, 0.39, 14))
  b.add('body', 'void', pin('x', 0.0028, 0.0512, 0, 0.042, 0.39, 10))
  // ── Barrel, gas block, birdcage
  b.add('body', 'blued', lathe([[0.0, 0.43], [0.0094, 0.43], [0.0094, 0.5], [0.0086, 0.505], [0.0086, 0.56], [0.0, 0.56]], 0, BY, 18))
  b.add('body', 'blued', lathe([[0.0, 0.558], [0.0108, 0.558], [0.0112, 0.564], [0.0112, 0.606], [0.0102, 0.61], [0.0, 0.61]], 0, BY, 22))
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26
    b.add('body', 'void', box(0.574, 0.603, 0.0106, 0.0118, -0.0017, 0.0017).rotateZ(a).translate(0, BY, 0))
  }
  b.add('body', 'void', cyl(0.0058, 0.0058, 0.6095, 0.6105, 0, BY, 14))
  // ── Folding adjustable stock with cheek riser and cut-out
  b.add('body', 'poly', prof([[-0.128, 0.088], [-0.146, 0.088], [-0.146, 0.012], [-0.128, 0.012]], 0.036, { r: 0.003, bevel: 0.0012 })) // hinge block
  b.add('body', 'blued', pin('y', 0.0042, 0.08, 0.0145, 0.05, -0.137, 12)) // hinge pin
  const stockOuter: P[] = [
    [-0.146, 0.086],
    [-0.31, 0.092, 0.01],
    [-0.372, 0.09, 0.012],
    [-0.386, 0.078, 0.006],
    [-0.39, -0.03, 0.006],
    [-0.378, -0.042, 0.006],
    [-0.34, -0.042, 0.01],
    [-0.21, 0.004, 0.03],
    [-0.146, 0.014, 0.006],
  ]
  const stockHole: P[] = [
    [-0.215, 0.07],
    [-0.33, 0.072, 0.012],
    [-0.35, 0.05, 0.012],
    [-0.35, -0.012, 0.012],
    [-0.33, -0.022, 0.012],
    [-0.26, 0.012, 0.02],
    [-0.215, 0.028, 0.012],
  ]
  b.add('body', 'poly', prof(stockOuter, 0.034, { r: 0.004, bevel: 0.003, holes: [stockHole] }))
  b.add('body', 'poly', prof([[-0.2, 0.09], [-0.33, 0.094, 0.008], [-0.336, 0.104, 0.004], [-0.21, 0.102, 0.008]], 0.03, { r: 0.004, bevel: 0.002 })) // cheek riser
  b.add('body', 'rubber', prof([[-0.388, 0.09], [-0.404, 0.086], [-0.406, -0.034], [-0.39, -0.044]], 0.04, { r: 0.004, bevel: 0.002 }))
  b.add('body', 'blued', prof([[-0.27, 0.0], [-0.24, 0.016], [-0.236, 0.01], [-0.266, -0.006]], 0.014, { r: 0.002 })) // adjust latch
  // ── Aimpoint-style red dot on a riser mount
  b.add('body', 'metal', rbox(0.004, 0.072, 0.0985, 0.108, 0.03, 0, 0.002, 0.0008))
  screwHead(b, 'body', 'steel', 0.0152, 0.103, 0.024, 0.0026)
  screwHead(b, 'body', 'steel', 0.0152, 0.103, 0.052, 0.0026)
  b.add('body', 'metal', prof([[0.012, 0.108], [0.064, 0.108], [0.058, 0.128, 0.004], [0.018, 0.128, 0.004]], 0.02, { r: 0.002, bevel: 0.001 }))
  b.add('body', 'blued', lathe([[0.0, 0.0], [0.0176, 0.0], [0.0186, 0.006], [0.0186, 0.11], [0.0176, 0.116], [0.0, 0.116]].map(([r, f]) => [r!, f!] as [number, number]), 0, SY, 28).translate(0, 0, 0.0))
  b.add('body', 'blued', tube(0.0205, 0.0172, -0.004, 0.012, 0, SY, 28)) // rear bell
  b.add('body', 'blued', tube(0.0205, 0.0172, 0.104, 0.12, 0, SY, 28)) // front bell
  b.add('body', 'blued', pin('y', 0.0092, 0.014, 0, SY + 0.0235, 0.06, 18)) // elevation turret
  b.add('body', 'blued', pin('x', 0.0092, 0.014, 0.0235, SY, 0.06, 18)) // windage turret
  for (let i = 0; i < 12; i++) b.add('body', 'void', box(-0.0006, 0.0006, SY + 0.018, SY + 0.029, 0.0089, 0.0095).rotateY((i / 12) * Math.PI * 2).translate(0, 0, -0.06)) // knurl
  b.add('body', 'lens', cyl(0.0172, 0.0172, 0.0, 0.0008, 0, SY, 28))
  b.add('body', 'lens', cyl(0.0172, 0.0172, 0.1152, 0.116, 0, SY, 28))
  b.add('body', 'dot', new SphereDot(0, SY, -0.112))
  // ── Magazine (polymer PMAG-style)
  const magC = (t: number): [number, number] => [0.1 + 0.026 * t * t, 0.0 - 0.17 * t]
  b.add('mag', 'poly', prof(strip(magC, (t) => 0.062 - 0.004 * t, 12), 0.0235, { r: 0.003, round: 0.0042 }))
  for (let i = 0; i < 4; i++) {
    const [f, y] = magC(0.42 + i * 0.07)
    b.add('mag', 'poly', rbox(f - 0.03, f + 0.03, y - 0.0016, y + 0.0016, 0.0248, 0, 0.0012, 0.0005))
  }
  b.add('mag', 'poly', prof([[0.093, -0.168], [0.163, -0.168], [0.166, -0.184, 0.004], [0.093, -0.184, 0.004]], 0.0282, { r: 0.003, bevel: 0.001 }))
  // ── Charging handle (left, folding knob)
  b.add('charge', 'metal', rbox(0.17, 0.2, 0.068, 0.078, 0.008, -0.0195, 0.0015, 0.0005))
  b.add('charge', 'blued', prof([[0.172, 0.064], [0.2, 0.066, 0.004], [0.2, 0.082, 0.004], [0.172, 0.082]], 0.012, { x: -0.029, r: 0.003, bevel: 0.0012 }))

  const meta: RigMeta = {
    type: 'rifle',
    grip: [0, -0.05, 0.055],
    muzzle: [0, BY, -0.61],
    eject: [0.018, 0.068, -0.045],
    ejectDir: [1, 0.45, 0.35],
    sight: [0, SY, -0.06],
    relief: 0.3,
    hipPos: [0.12, -0.205, -0.43],
    hipRot: [0.02, 0.1, 0.06],
    rh: { p: [0.027, -0.045, 0.058], r: [-0.2, 0, -1.5708], grip: [0.78, 0.45, 0.86, 0.88, 0.86] },
    lh: { p: [-0.012, 0.008, -0.33], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, -0.02, -0.1],
    magDir: [0, -1, -0.17],
    magHold: { p: [-0.032, -0.1, -0.11], r: [0.0, -1.3, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [-0.046, 0.074, -0.19], r: [0.0, 0.0, 1.5], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
    chargeTravel: 0.055,
    flashScale: 1.0,
  }
  return { b, meta }
}

// ─── M4A1 ───────────────────────────────────────────────────────────────────
// Real proportions: bore 33 mm under the flat-top rail, 66 mm sight height,
// KAC RAS quad rail, A2 front sight base, A2 birdcage, 6-position stock.

export function buildM4A1(): ModelSpec {
  const b = new Builder()
  const BY = 0.065
  const SY = 0.131 // sight line
  // ── Upper receiver
  const upSec = halfSec([
    [0.0158, 0.042],
    [0.0172, 0.046],
    [0.0172, 0.079],
    [0.0148, 0.0855],
    [0.0105, 0.0885],
  ])
  b.add('body', 'metal', xsec(upSec, -0.078, 0.168, 0.0012, 0.002))
  rail1913(b, 'body', 'metal', -0.078, 0.166, 0.098, 0, 0.0212)
  // ejection port + closed dust cover with hinge rod
  b.add('body', 'metal', rbox(0.004, 0.086, 0.056, 0.083, 0.0362, 0, 0.002, 0.0005))
  b.add('body', 'void', box(0.004, 0.086, 0.0828, 0.0834, 0.0172, 0.0184))
  b.add('body', 'void', box(0.0855, 0.0862, 0.056, 0.083, 0.0172, 0.0184))
  b.add('body', 'blued', lathe([[0.0013, 0.0], [0.0013, 0.088]], 0.0182, 0.0545, 8))
  b.add('body', 'metal', rbox(0.035, 0.05, 0.059, 0.065, 0.0372, 0, 0.0015, 0.0004)) // cover latch bump
  // brass deflector
  b.add('body', 'metal', prof([[-0.014, 0.07], [0.004, 0.07], [0.004, 0.09], [-0.008, 0.09]], 0.0075, { x: 0.0195, r: 0.002, bevel: 0.0008 }))
  // forward assist
  b.add('body', 'metal', lathe([[0.0, -0.075], [0.0098, -0.075], [0.0098, -0.026], [0.0072, -0.02], [0.0, -0.02]], 0.0195, 0.075, 16))
  b.add('body', 'blued', lathe([[0.0, -0.088], [0.0072, -0.088], [0.0074, -0.074], [0.0, -0.074]], 0.0195, 0.075, 14))
  for (let i = 0; i < 4; i++) b.add('body', 'void', ring(0.0074, 0.0005, 0.0195, 0.075, -0.086 + i * 0.003, 12))
  // ── Lower receiver
  b.add(
    'body',
    'metal',
    prof(
      [
        [-0.078, 0.042],
        [0.152, 0.042],
        [0.152, 0.022, 0.006],
        [0.143, 0.004],
        [0.143, -0.046, 0.002],
        [0.062, -0.046, 0.002],
        [0.06, 0.004, 0.003],
        [-0.026, 0.004],
        [-0.062, 0.004],
        [-0.088, 0.012, 0.01],
        [-0.096, 0.04, 0.004],
        [-0.096, 0.083, 0.006],
        [-0.078, 0.086],
      ],
      0.031,
      { r: 0.003, bevel: 0.0012 },
    ),
  )
  // magwell flare + panel line
  b.add('body', 'metal', rbox(0.058, 0.147, -0.05, -0.034, 0.0336, 0, 0.003, 0.001))
  b.add('body', 'void', box(0.066, 0.14, -0.0335, -0.0329, -0.0158, 0.0158))
  // pins, controls
  crossPin(b, 'body', 'steel', 0.0156, 0.034, 0.142, 0.0024) // pivot pin
  crossPin(b, 'body', 'steel', 0.0156, 0.034, -0.084, 0.0024) // takedown pin
  crossPin(b, 'body', 'steel', 0.0156, 0.012, 0.006, 0.0017) // trigger pin
  crossPin(b, 'body', 'steel', 0.0156, 0.012, -0.012, 0.0017) // hammer pin
  b.add('body', 'blued', pin('x', 0.0048, 0.004, 0.0172, 0.016, 0.052, 14)) // mag release
  // selector (left)
  b.add('body', 'blued', pin('x', 0.0045, 0.003, -0.0172, 0.024, -0.03, 14))
  b.add('body', 'blued', prof([[-0.032, 0.02], [-0.012, 0.022, 0.003], [-0.012, 0.03, 0.003], [-0.03, 0.028]], 0.0022, { x: -0.0185, r: 0.002, bevel: 0.0004 }))
  // bolt catch (left)
  b.add('body', 'blued', prof([[0.108, 0.012], [0.122, 0.012], [0.122, 0.034], [0.112, 0.034]], 0.0025, { x: -0.0168, r: 0.002, bevel: 0.0004 }))
  // trigger guard + trigger
  triggerGuard(b, 'body', 'metal', -0.004, 0.06, 0.004, -0.044, 0.0058)
  b.add('body', 'blued', prof(strip((t) => [0.022 - 0.008 * t * t, 0.004 - 0.03 * t], () => 0.0052, 6), 0.0058, { r: 0.0012, bevel: 0.0004 }))
  // A2 grip with finger nub and texture lines
  b.add(
    'body',
    'poly',
    prof(
      [
        [-0.06, 0.004],
        [-0.012, 0.004],
        [-0.016, -0.026, 0.008],
        [-0.022, -0.046, 0.006],
        [-0.017, -0.054, 0.004],
        [-0.025, -0.064, 0.006],
        [-0.033, -0.104, 0.006],
        [-0.04, -0.113, 0.004],
        [-0.073, -0.111, 0.006],
        [-0.072, -0.07, 0.012],
        [-0.064, -0.03, 0.012],
        [-0.066, -0.006, 0.004],
      ],
      0.029,
      { r: 0.004, bevel: 0.003 },
    ),
  )
  for (let i = 0; i < 9; i++) {
    const y = -0.03 - i * 0.0075
    const f = -0.064 - i * 0.0012
    b.add('body', 'void', box(f + 0.004, f + 0.03, y, y + 0.0012, 0.0143, 0.0148))
    b.add('body', 'void', box(f + 0.004, f + 0.03, y, y + 0.0012, -0.0148, -0.0143))
  }
  // ── Buffer tube, castle nut, 6-position stock
  b.add('body', 'metal', lathe([[0.0, -0.322], [0.0128, -0.322], [0.0148, -0.318], [0.0148, -0.096], [0.0, -0.096]], 0, 0.063, 18))
  b.add('body', 'blued', lathe([[0.0, -0.106], [0.0175, -0.106], [0.0175, -0.096], [0.0, -0.096]], 0, 0.063, 18))
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    b.add('body', 'void', box(-0.106, -0.096, 0.0168, 0.0178, -0.0022, 0.0022).translate(0, -0.0, 0).rotateZ(a).translate(0, 0.063, 0))
  }
  b.add('body', 'metal', rbox(-0.3, -0.13, 0.044, 0.05, 0.007, 0, 0.002, 0.0006)) // tube key (underside)
  for (let i = 0; i < 6; i++) b.add('body', 'void', pin('y', 0.0016, 0.002, 0, 0.0435, -0.15 - i * 0.022, 8).translate(0, 0, 0))
  const stockSide: P[] = [
    [-0.212, 0.074],
    [-0.236, 0.083, 0.01],
    [-0.33, 0.085, 0.006],
    [-0.336, 0.078, 0.004],
    [-0.336, -0.022, 0.004],
    [-0.326, -0.028, 0.004],
    [-0.304, -0.028, 0.008],
    [-0.236, 0.034, 0.02],
    [-0.214, 0.044, 0.006],
  ]
  b.add('body', 'poly', prof(stockSide, 0.036, { r: 0.004, bevel: 0.0025 }))
  // waffle recesses
  for (const [f0, f1, y0, y1] of [
    [-0.32, -0.284, 0.052, 0.074],
    [-0.278, -0.25, 0.052, 0.074],
    [-0.32, -0.296, 0.008, 0.044],
  ] as const) {
    b.add('body', 'rubber', rbox(f0, f1, y0, y1, 0.0372, 0, 0.003, 0.0012))
  }
  b.add('body', 'rubber', prof([[-0.334, 0.086], [-0.35, 0.082], [-0.352, -0.024], [-0.334, -0.03]], 0.039, { r: 0.004, bevel: 0.002 }))
  b.add('body', 'blued', prof([[-0.236, 0.034], [-0.218, 0.04], [-0.214, 0.032], [-0.232, 0.026]], 0.012, { r: 0.002 })) // adjust lever
  b.add('body', 'blued', loop(0.0075, 0.0016, 0, -0.034, 0.31)) // sling loop
  // ── KAC RAS handguard
  const hgSec = halfSec([
    [0.012, 0.042],
    [0.0215, 0.046],
    [0.0255, 0.052],
    [0.0255, 0.078],
    [0.0215, 0.0845],
    [0.012, 0.0885],
  ])
  b.add('body', 'metal', xsec(hgSec, 0.168, 0.352, 0.0015, 0.002))
  rail1913(b, 'body', 'metal', 0.172, 0.35, 0.098, 0, 0.0212, 'top')
  rail1913(b, 'body', 'metal', 0.18, 0.344, 0.0325, 0, 0.0212, 'bottom')
  rail1913(b, 'body', 'metal', 0.18, 0.344, BY, 0.0255 + 0.0095, 0.0212, 'right')
  rail1913(b, 'body', 'metal', 0.18, 0.344, BY, -0.0255 - 0.0095, 0.0212, 'left')
  for (let i = 0; i < 4; i++) {
    const f = 0.19 + i * 0.042
    b.add('body', 'void', box(f, f + 0.02, 0.0535, 0.0565, 0.0252, 0.0258))
    b.add('body', 'void', box(f, f + 0.02, 0.0535, 0.0565, -0.0258, -0.0252))
  }
  b.add('body', 'blued', lathe([[0.0, 0.352], [0.0175, 0.352], [0.0175, 0.358], [0.0, 0.358]], 0, BY, 20)) // front cap
  // ── Barrel, A2 front sight base, birdcage
  b.add('body', 'blued', lathe([[0.0, 0.35], [0.0098, 0.35], [0.0098, 0.415], [0.0087, 0.42], [0.0087, 0.49], [0.0, 0.49]], 0, BY, 18))
  b.add('body', 'metal', lathe([[0.0, 0.362], [0.0128, 0.362], [0.0128, 0.392], [0.0, 0.392]], 0, BY, 18)) // FSB collar
  b.add('body', 'metal', prof([[0.36, 0.07], [0.394, 0.07], [0.383, 0.115, 0.003], [0.372, 0.115, 0.003]], 0.0145, { r: 0.002, bevel: 0.001 })) // triangle
  b.add('body', 'void', box(0.37, 0.386, 0.078, 0.092, -0.0076, 0.0076).translate(0, 0, 0)) // lightening hole
  b.add('body', 'metal', prof([[0.368, 0.108], [0.387, 0.108], [0.385, 0.137, 0.002], [0.371, 0.137, 0.002]], 0.0026, { x: 0.0072, r: 0.0015, bevel: 0.0004 })) // ears
  b.add('body', 'metal', prof([[0.368, 0.108], [0.387, 0.108], [0.385, 0.137, 0.002], [0.371, 0.137, 0.002]], 0.0026, { x: -0.0072, r: 0.0015, bevel: 0.0004 }))
  b.add('body', 'steel', rbox(0.3765, 0.3795, 0.108, SY, 0.0024, 0, 0.0004, 0.0002)) // post (tip on the sight line)
  b.add('body', 'metal', rbox(0.364, 0.39, 0.042, 0.053, 0.012, 0, 0.002, 0.0008)) // bayonet lug / sling base
  b.add('body', 'blued', loop(0.008, 0.0016, 0, 0.032, -0.378))
  b.add('body', 'blued', lathe([[0.0, 0.488], [0.0108, 0.488], [0.0112, 0.494], [0.0112, 0.536], [0.0102, 0.54], [0.0, 0.54]], 0, BY, 22))
  for (let i = 0; i < 5; i++) {
    const a = (-0.5 + i * 0.25) * Math.PI // slots on top and sides, closed bottom (A2)
    b.add('body', 'void', box(0.505, 0.532, 0.0106, 0.0118, -0.0017, 0.0017).rotateZ(a).translate(0, BY, 0))
  }
  b.add('body', 'void', cyl(0.0058, 0.0058, 0.5395, 0.5405, 0, BY, 14))
  // ── Folding rear BUIS (aperture on the sight line)
  b.add('body', 'metal', rbox(-0.075, -0.035, 0.0985, 0.106, 0.026, 0, 0.002, 0.0006))
  screwHead(b, 'body', 'steel', 0.0132, 0.102, -0.055, 0.0026)
  b.add('body', 'blued', prof([[-0.062, 0.106], [-0.05, 0.106], [-0.052, 0.14, 0.003], [-0.06, 0.14, 0.003]], 0.017, { r: 0.002, bevel: 0.0006 }))
  b.add('body', 'void', cyl(0.0019, 0.0019, -0.063, -0.051, 0, SY, 12))
  b.add('body', 'blued', prof([[-0.064, 0.106], [-0.048, 0.106], [-0.05, 0.142, 0.002], [-0.062, 0.142, 0.002]], 0.0022, { x: 0.0105, r: 0.0015, bevel: 0.0004 }))
  b.add('body', 'blued', prof([[-0.064, 0.106], [-0.048, 0.106], [-0.05, 0.142, 0.002], [-0.062, 0.142, 0.002]], 0.0022, { x: -0.0105, r: 0.0015, bevel: 0.0004 }))
  b.add('body', 'steel', pin('x', 0.004, 0.005, 0.0145, 0.116, -0.056, 12))
  // ── STANAG magazine (ribbed aluminium, curved)
  const magC = (t: number): [number, number] => [0.098 + 0.026 * t * t, -0.004 - 0.165 * t]
  b.add('mag', 'metal', prof(strip(magC, (t) => 0.061 - 0.003 * t, 12), 0.0235, { r: 0.002, round: 0.0028 }))
  for (let i = 0; i < 2; i++) {
    const y = -0.07 - i * 0.045
    b.add('mag', 'void', box(0.078 + i * 0.006, 0.124 + i * 0.008, y, y + 0.0016, 0.0115, 0.0122))
    b.add('mag', 'void', box(0.078 + i * 0.006, 0.124 + i * 0.008, y, y + 0.0016, -0.0122, -0.0115))
  }
  b.add('mag', 'blued', prof([[0.09, -0.165], [0.16, -0.165], [0.162, -0.179, 0.003], [0.09, -0.179, 0.003]], 0.0272, { r: 0.002, bevel: 0.0008 }))
  // ── Charging handle (T-handle, rear top)
  b.add('charge', 'metal', rbox(-0.108, -0.078, 0.079, 0.0875, 0.011, 0, 0.0015, 0.0004))
  b.add('charge', 'metal', prof([[-0.112, 0.078], [-0.104, 0.078], [-0.102, 0.0885], [-0.112, 0.0885]], 0.044, { r: 0.002, bevel: 0.0008 }))
  b.add('charge', 'blued', prof([[-0.11, 0.0885], [-0.1, 0.0885], [-0.1, 0.092], [-0.108, 0.092]], 0.008, { x: -0.016, r: 0.0012, bevel: 0.0003 }))

  const meta: RigMeta = {
    type: 'rifle',
    grip: [0, -0.05, 0.055],
    muzzle: [0, BY, -0.54],
    eject: [0.018, 0.07, -0.045],
    ejectDir: [1, 0.45, 0.35],
    sight: [0, SY, 0.056],
    relief: 0.25,
    hipPos: [0.12, -0.205, -0.43],
    hipRot: [0.02, 0.1, 0.06],
    rh: { p: [0.027, -0.045, 0.06], r: [-0.2, 0, -1.5708], grip: [0.78, 0.45, 0.86, 0.88, 0.86] },
    lh: { p: [-0.012, 0.012, -0.3], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, -0.02, -0.098],
    magDir: [0, -1, -0.17],
    magHold: { p: [-0.032, -0.1, -0.11], r: [0.0, -1.3, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [-0.01, 0.112, 0.125], r: [0.3, 0.0, 0.0], grip: [0.6, 0.6, 0.8, 0.8, 0.8] },
    chargeTravel: 0.05,
    flashScale: 1.0,
  }
  return { b, meta }
}

// ─── AK-47 ───────────────────────────────────────────────────────────────────
// AKM pattern: stamped receiver with ribbed top cover, trunnion rivets, long
// right-side selector, tangent rear sight, hooded front post, slant brake,
// laminated wood furniture, ribbed steel 30-round magazine.

export function buildAK47(): ModelSpec {
  const b = new Builder()
  const BY = 0.065
  const SY = 0.112
  // ── Receiver
  const rx = 0.0158
  b.add('body', 'blued', xsec(halfSec([[rx - 0.002, 0.0], [rx, 0.003], [rx, 0.07]]).concat(), -0.15, 0.172, 0.001, 0.0015))
  // top cover: rounded, ribbed (AKM)
  b.add('body', 'blued', xsec(halfSec([[rx + 0.0004, 0.068], [rx + 0.0004, 0.084], [0.013, 0.0955], [0.006, 0.1]]), -0.142, 0.1, 0.001, 0.002))
  for (let i = 0; i < 5; i++) {
    const f = -0.115 + i * 0.012
    b.add('body', 'void', box(f, f + 0.004, 0.0985, 0.1005, -0.0068, 0.0068))
  }
  b.add('body', 'steel', rbox(-0.158, -0.142, 0.08, 0.094, 0.012, 0, 0.003, 0.001)) // cover latch button
  // ejection port (right) + bolt carrier with charging handle
  b.add('body', 'void', box(0.01, 0.1, 0.05, 0.068, rx - 0.0004, rx + 0.0003))
  // front trunnion rivets, rear trunnion rivets, trigger pins
  for (const [f, y] of [[0.135, 0.012], [0.155, 0.012], [0.135, 0.035], [0.155, 0.035], [-0.128, 0.012], [-0.128, 0.04], [-0.01, 0.028], [0.03, 0.028], [0.064, 0.04]] as const) {
    b.add('body', 'steel', pin('x', 0.0021, rx * 2 + 0.0012, 0, y, f, 10))
  }
  // AKM magwell dimple
  b.add('body', 'void', cyl(0.0068, 0.0068, -0.0003, 0.0003, 0, 0, 14).rotateY(Math.PI / 2).scale(1, 0.55, 1.6).translate(rx + 0.0002, 0.054, -0.088))
  b.add('body', 'void', cyl(0.0068, 0.0068, -0.0003, 0.0003, 0, 0, 14).rotateY(Math.PI / 2).scale(1, 0.55, 1.6).translate(-rx - 0.0002, 0.054, -0.088))
  // selector lever (right): long stamped plate with finger tab
  b.add('body', 'steel', prof([[-0.12, 0.06], [0.07, 0.06], [0.078, 0.066, 0.002], [-0.12, 0.068]], 0.0016, { x: rx + 0.0012, r: 0.002, bevel: 0.0003 }))
  b.add('body', 'steel', prof([[-0.128, 0.042], [-0.112, 0.06], [-0.118, 0.064], [-0.134, 0.046]], 0.002, { x: rx + 0.0014, r: 0.003, bevel: 0.0004 }))
  b.add('body', 'steel', pin('x', 0.0042, 0.003, rx + 0.0015, 0.044, -0.128, 14))
  // ── Trigger guard (stamped) with mag release paddle, trigger
  b.add('body', 'blued', prof([[-0.012, 0.002], [0.074, 0.002], [0.074, -0.004], [0.06, -0.006], [0.058, -0.03, 0.006], [0.04, -0.046, 0.012], [0.0, -0.046, 0.008], [-0.012, -0.03, 0.008]], 0.0062, { r: 0.002, bevel: 0.0006, holes: [[[0.002, -0.004], [0.052, -0.004], [0.05, -0.028, 0.008], [0.036, -0.04, 0.008], [0.004, -0.04, 0.006]]] }))
  b.add('body', 'blued', prof([[0.064, -0.003], [0.08, 0.004], [0.08, -0.016, 0.003], [0.07, -0.02, 0.003]], 0.012, { r: 0.002, bevel: 0.0006 }))
  b.add('body', 'blued', prof(strip((t) => [0.026 - 0.01 * t * t, 0.002 - 0.03 * t], () => 0.0055, 6), 0.006, { r: 0.0012, bevel: 0.0004 }))
  // ── Pistol grip (wood) with a nut at the base
  b.add('body', 'wood', prof([[-0.072, 0.002], [-0.026, 0.002], [-0.032, -0.03, 0.01], [-0.05, -0.1, 0.01], [-0.06, -0.122, 0.006], [-0.096, -0.124, 0.006], [-0.094, -0.07, 0.012], [-0.082, -0.02, 0.01]], 0.031, { r: 0.004, bevel: 0.003 }))
  b.add('body', 'blued', cyl(0.004, 0.004, 0.0, 0.003, 0, 0, 10).rotateX(Math.PI / 2).translate(0, -0.1245, 0.078))
  // ── Stock (wood) + steel buttplate with trap door
  b.add('body', 'blued', prof([[-0.166, 0.004], [-0.146, 0.004], [-0.146, 0.072], [-0.166, 0.072]], 0.034, { r: 0.002, bevel: 0.001 })) // rear tang
  b.add('body', 'wood', prof([[-0.162, 0.074], [-0.26, 0.067, 0.03], [-0.41, 0.056, 0.01], [-0.418, 0.05, 0.004], [-0.418, -0.075, 0.004], [-0.41, -0.082, 0.01], [-0.3, -0.045, 0.06], [-0.162, 0.006, 0.01]], 0.037, { r: 0.004, bevel: 0.004 }))
  b.add('body', 'blued', prof([[-0.418, 0.057], [-0.43, 0.052], [-0.43, -0.08], [-0.418, -0.084]], 0.04, { r: 0.004, bevel: 0.0012 }))
  b.add('body', 'void', box(-0.4305, -0.4295, -0.04, 0.02, -0.011, 0.011))
  screwHead(b, 'body', 'steel', 0.0188, 0.04, -0.34, 0.0024)
  b.add('body', 'blued', loop(0.007, 0.0015, 0, -0.07, 0.34))
  // ── Handguards (laminated wood): lower with finger grooves, upper over gas tube
  const lowerSec = halfSec([[0.012, 0.026], [0.022, 0.032], [0.0255, 0.045], [0.0255, 0.074], [0.02, 0.08]])
  b.add('body', 'wood', xsec(lowerSec, 0.178, 0.388, 0.003, 0.004))
  for (let i = 0; i < 2; i++) b.add('body', 'void', box(0.24 + i * 0.07, 0.25 + i * 0.07, 0.035, 0.07, 0.0256, 0.0262))
  for (let i = 0; i < 2; i++) b.add('body', 'void', box(0.24 + i * 0.07, 0.25 + i * 0.07, 0.035, 0.07, -0.0262, -0.0256))
  b.add('body', 'blued', xsec(halfSec([[0.013, 0.026], [0.027, 0.034], [0.027, 0.07], [0.016, 0.08]]), 0.168, 0.182, 0.0006, 0.002)) // retainer
  b.add('body', 'blued', xsec(halfSec([[0.013, 0.028], [0.0262, 0.034], [0.0262, 0.07], [0.016, 0.078]]), 0.388, 0.402, 0.0006, 0.002)) // front ferrule
  b.add('body', 'wood', xsec(halfSec([[0.0145, 0.088], [0.0155, 0.1], [0.011, 0.112], [0.004, 0.115]]), 0.2, 0.372, 0.003, 0.004))
  // ── Gas tube, gas block, barrel, cleaning rod, front sight, slant brake
  const GY = 0.1
  b.add('body', 'blued', lathe([[0.0, 0.18], [0.0112, 0.18], [0.0112, 0.44], [0.0, 0.44]], 0, GY, 16))
  for (let i = 0; i < 3; i++) {
    const f = 0.38 + i * 0.016
    b.add('body', 'void', pin('x', 0.0024, 0.0234, 0, GY, f, 8))
  }
  b.add('body', 'blued', prof([[0.432, BY - 0.012], [0.47, BY - 0.012], [0.47, GY + 0.012, 0.006], [0.444, GY + 0.012, 0.004], [0.432, GY - 0.004]], 0.026, { r: 0.003, bevel: 0.0012 })) // gas block
  b.add('body', 'blued', loop(0.0065, 0.0014, 0, BY - 0.022, -0.455))
  b.add('body', 'blued', lathe([[0.0, 0.172], [0.0098, 0.172], [0.0098, 0.44], [0.0086, 0.45], [0.0086, 0.636], [0.0, 0.636]], 0, BY, 18))
  b.add('body', 'steel', lathe([[0.0, 0.17], [0.0029, 0.17], [0.0029, 0.61], [0.0, 0.61]], 0, BY - 0.021, 8)) // cleaning rod
  b.add('body', 'blued', prof([[0.585, BY - 0.026], [0.622, BY - 0.026], [0.622, BY + 0.016, 0.004], [0.608, 0.103, 0.004], [0.596, 0.103, 0.004], [0.585, BY + 0.016]], 0.02, { r: 0.002, bevel: 0.001 })) // front sight base
  b.add('body', 'blued', tube(0.0122, 0.0102, 0.594, 0.614, 0, SY - 0.004, 18).scale(1, 1, 1)) // hood
  b.add('body', 'void', box(0.594, 0.614, SY - 0.017, SY - 0.006, -0.013, 0.013)) // open bottom of hood
  b.add('body', 'steel', rbox(0.6025, 0.6055, 0.1, SY, 0.0028, 0, 0.0005, 0.0002)) // post, tip on the sight line
  b.add('body', 'blued', lathe([[0.0, 0.634], [0.0128, 0.634], [0.0128, 0.67], [0.0, 0.67]], 0, BY, 20)) // slant brake
  b.add('body', 'void', prof([[0.648, BY + 0.006], [0.664, BY + 0.01], [0.664, BY + 0.0135], [0.648, BY + 0.0135]], 0.012, { r: 0.001, bevel: 0 }))
  b.add('body', 'void', cyl(0.0062, 0.0062, 0.6695, 0.6705, 0, BY, 14))
  // ── Rear tangent sight (notch on the sight line)
  b.add('body', 'blued', prof([[0.172, 0.07], [0.172, 0.096, 0.004], [0.232, 0.1, 0.004], [0.244, 0.088], [0.244, 0.07]], 0.03, { r: 0.002, bevel: 0.001 }))
  b.add('body', 'blued', prof([[0.17, 0.097], [0.218, 0.1], [0.22, 0.106], [0.17, 0.104]], 0.019, { r: 0.0015, bevel: 0.0005 })) // leaf
  b.add('body', 'blued', prof([[0.198, 0.104], [0.212, 0.104], [0.212, 0.108], [0.198, 0.108]], 0.022, { r: 0.0012, bevel: 0.0004 })) // slider
  b.add('body', 'blued', rbox(0.2, 0.206, 0.104, SY + 0.004, 0.006, -0.0055, 0.0008, 0.0003))
  b.add('body', 'blued', rbox(0.2, 0.206, 0.104, SY + 0.004, 0.006, 0.0055, 0.0008, 0.0003))
  // ── 30-round steel magazine: strong curve, ribs, floorplate
  const magC = (t: number): [number, number] => [0.08 + 0.13 * Math.pow(t, 1.7), 0.0 - 0.215 * t + 0.03 * t * t]
  b.add('mag', 'blued', prof(strip(magC, (t) => 0.066 - 0.006 * t, 14), 0.0262, { r: 0.002, round: 0.003 }))
  for (const k of [0.3, 0.55, 0.78]) {
    const [f, y] = magC(k)
    b.add('mag', 'blued', rbox(f - 0.024, f + 0.024, y - 0.003, y + 0.003, 0.0274, 0, 0.002, 0.0008).rotateZ(0))
  }
  b.add('mag', 'blued', prof([[0.172, -0.187], [0.245, -0.172], [0.25, -0.18, 0.003], [0.176, -0.197, 0.003]], 0.03, { r: 0.002, bevel: 0.0008 }))
  b.add('mag', 'blued', rbox(0.038, 0.05, -0.006, 0.006, 0.02, 0, 0.002, 0.0006)) // rear lug
  // ── Charging handle on the carrier (right side)
  b.add('charge', 'steel', rbox(0.02, 0.1, 0.054, 0.066, 0.004, rx + 0.002, 0.0015, 0.0005))
  b.add('charge', 'steel', lathe([[0.0, 0.0], [0.0042, 0.0], [0.0052, 0.012], [0.0046, 0.018], [0.0, 0.018]], 0, 0, 12).rotateY(-Math.PI / 2).translate(rx + 0.004, 0.06, -0.09))

  const meta: RigMeta = {
    type: 'rifle',
    grip: [0, -0.055, 0.075],
    muzzle: [0, BY, -0.67],
    eject: [0.018, 0.062, -0.055],
    ejectDir: [1, 0.5, 0.35],
    sight: [0, SY, -0.203],
    relief: 0.36,
    hipPos: [0.12, -0.205, -0.43],
    hipRot: [0.02, 0.1, 0.06],
    rh: { p: [0.027, -0.05, 0.075], r: [-0.25, 0, -1.5708], grip: [0.5, 0.45, 0.86, 0.86, 0.84] },
    lh: { p: [-0.012, 0.01, -0.31], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, -0.02, -0.08],
    magDir: [0, -1, -0.45],
    magHold: { p: [-0.032, -0.11, -0.12], r: [0.0, -1.3, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [0.045, 0.062, -0.09], r: [0.0, 0.0, -1.57], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
    chargeTravel: 0.07,
    flashScale: 1.1,
  }
  return { b, meta }
}

// ─── UMP45 ───────────────────────────────────────────────────────────────────
// H&K UMP: wide glass-filled polymer receiver, short top rail, H&K drum
// diopter + hooded front post, forward cocking handle (left), railed fore-end,
// integral grip/guard, straight 25-round magazine, side-folding stock.

export function buildUMP45(): ModelSpec {
  const b = new Builder()
  const BY = 0.064
  const SY = 0.124
  // ── Receiver
  const recSec = halfSec([
    [0.0195, 0.03],
    [0.0228, 0.036],
    [0.0228, 0.078],
    [0.019, 0.09],
    [0.012, 0.096],
  ])
  b.add('body', 'poly', xsec(recSec, -0.168, 0.222, 0.002, 0.003))
  rail1913(b, 'body', 'metal', -0.09, 0.12, 0.1035, 0, 0.0212)
  b.add('body', 'void', box(0.0, 0.088, 0.054, 0.08, 0.0224, 0.0231)) // ejection port (right)
  // moulded longitudinal ribs + rear reinforcement ridges (glass-filled polymer shell)
  for (const s of [1, -1]) {
    b.add('body', 'poly', prof([[-0.155, 0.046], [0.205, 0.046], [0.21, 0.05], [-0.15, 0.05]], 0.0028, { x: s * 0.0232, r: 0.0012, bevel: 0.0006 }))
    b.add('body', 'poly', prof([[-0.155, 0.069], [-0.01, 0.069], [-0.006, 0.073], [-0.15, 0.073]], 0.0028, { x: s * 0.0232, r: 0.0012, bevel: 0.0006 }))
    for (let i = 0; i < 4; i++) {
      const f = -0.15 + i * 0.016
      b.add('body', 'poly', prof([[f, 0.05], [f + 0.006, 0.05], [f + 0.006, 0.069], [f, 0.069]], 0.0024, { x: s * 0.0232, r: 0.001, bevel: 0.0005 }))
    }
  }
  b.add('body', 'void', box(-0.16, 0.215, 0.0405, 0.0412, 0.0225, 0.0231))
  b.add('body', 'void', box(-0.16, 0.215, 0.0405, 0.0412, -0.0231, -0.0225))
  for (let i = 0; i < 3; i++) crossPin(b, 'body', 'steel', 0.0228, 0.044, -0.14 + i * 0.13, 0.0026)
  // tapered nose of the fore-end
  b.add('body', 'poly', prof([[0.336, 0.03], [0.348, 0.04, 0.004], [0.35, 0.084, 0.004], [0.336, 0.094]], 0.036, { r: 0.003, bevel: 0.002 }))
  // ── Fore-end with side/bottom rails and vents
  const feSec = halfSec([
    [0.016, 0.03],
    [0.0215, 0.036],
    [0.0215, 0.08],
    [0.016, 0.09],
    [0.008, 0.094],
  ])
  b.add('body', 'poly', xsec(feSec, 0.222, 0.34, 0.002, 0.003))
  rail1913(b, 'body', 'metal', 0.236, 0.326, 0.0302, 0, 0.0212, 'bottom')
  rail1913(b, 'body', 'metal', 0.25, 0.32, BY, 0.0215 + 0.0095, 0.0212, 'right')
  rail1913(b, 'body', 'metal', 0.25, 0.32, BY, -0.0215 - 0.0095, 0.0212, 'left')
  for (let i = 0; i < 3; i++) {
    const f = 0.235 + i * 0.03
    b.add('body', 'void', box(f, f + 0.012, 0.082, 0.087, 0.0172, 0.0179))
    b.add('body', 'void', box(f, f + 0.012, 0.082, 0.087, -0.0179, -0.0172))
  }
  // cocking tube + cocking handle slot (left, forward)
  b.add('body', 'poly', lathe([[0.0, 0.14], [0.0122, 0.14], [0.0122, 0.33], [0.0, 0.33]], -0.002, 0.086, 18))
  b.add('body', 'void', box(0.16, 0.31, 0.0835, 0.0865, -0.0145, -0.0115))
  // ── Front sight: hooded post on a tower
  b.add('body', 'poly', prof([[0.296, 0.09], [0.33, 0.09], [0.326, 0.106, 0.004], [0.302, 0.106, 0.004]], 0.024, { r: 0.003, bevel: 0.0012 }))
  b.add('body', 'poly', tube(0.0128, 0.0108, 0.304, 0.324, 0, SY - 0.004, 20))
  b.add('body', 'blued', rbox(0.3125, 0.3155, 0.104, SY, 0.0026, 0, 0.0005, 0.0002))
  // ── Rear drum diopter
  b.add('body', 'poly', prof([[-0.15, 0.096], [-0.1, 0.096], [-0.104, 0.108, 0.004], [-0.146, 0.108, 0.004]], 0.03, { r: 0.003, bevel: 0.0012 }))
  b.add('body', 'blued', pin('x', 0.0125, 0.026, 0, SY, -0.124, 22))
  b.add('body', 'void', pin('z', 0.0018, 0.0255, 0, SY, -0.124, 10))
  b.add('body', 'blued', prof([[-0.136, 0.104], [-0.112, 0.104], [-0.114, SY + 0.016, 0.002], [-0.134, SY + 0.016, 0.002]], 0.0025, { x: 0.0145, r: 0.0015, bevel: 0.0004 }))
  b.add('body', 'blued', prof([[-0.136, 0.104], [-0.112, 0.104], [-0.114, SY + 0.016, 0.002], [-0.134, SY + 0.016, 0.002]], 0.0025, { x: -0.0145, r: 0.0015, bevel: 0.0004 }))
  // ── Barrel + thread protector
  b.add('body', 'blued', lathe([[0.0, 0.33], [0.0105, 0.33], [0.0105, 0.37], [0.0, 0.37]], 0, BY, 18))
  b.add('body', 'blued', lathe([[0.0, 0.368], [0.0122, 0.368], [0.0126, 0.374], [0.0126, 0.396], [0.0116, 0.4], [0.0, 0.4]], 0, BY, 20))
  for (let i = 0; i < 8; i++) b.add('body', 'void', box(0.376, 0.394, 0.0122, 0.013, -0.001, 0.001).rotateZ((i / 8) * Math.PI * 2).translate(0, BY, 0))
  b.add('body', 'void', cyl(0.0062, 0.0062, 0.3995, 0.4005, 0, BY, 14))
  // ── Lower: trigger housing, integral grip + oversized guard
  b.add(
    'body',
    'poly',
    prof(
      [
        [-0.13, 0.032],
        [0.14, 0.032],
        [0.14, 0.012, 0.004],
        [0.13, 0.0],
        [0.13, -0.04, 0.002],
        [0.052, -0.04, 0.002],
        [0.05, 0.004],
        [-0.03, 0.004],
        [-0.13, 0.012, 0.006],
      ],
      0.04,
      { r: 0.003, bevel: 0.0018 },
    ),
  )
  b.add('body', 'poly', prof([[-0.075, 0.004], [-0.014, 0.004], [-0.02, -0.03, 0.01], [-0.032, -0.108, 0.01], [-0.04, -0.118, 0.004], [-0.082, -0.116, 0.006], [-0.08, -0.06, 0.014], [-0.07, -0.02, 0.012]], 0.031, { r: 0.004, bevel: 0.003 }))
  for (let i = 0; i < 7; i++) {
    const y = -0.034 - i * 0.01
    b.add('body', 'void', box(-0.076 + i * 0.0015, -0.064 + i * 0.0015, y, y + 0.0035, 0.0154, 0.016))
    b.add('body', 'void', box(-0.076 + i * 0.0015, -0.064 + i * 0.0015, y, y + 0.0035, -0.016, -0.0154))
  }
  b.add('body', 'poly', prof([[-0.016, 0.004], [0.05, 0.004], [0.05, -0.034], [0.03, -0.056, 0.008], [-0.012, -0.056, 0.008], [-0.026, -0.04, 0.006]], 0.008, { r: 0.002, bevel: 0.0008, holes: [[[-0.008, -0.002], [0.042, -0.002], [0.042, -0.03], [0.026, -0.048, 0.006], [-0.006, -0.048, 0.006], [-0.016, -0.036, 0.006]]] }))
  b.add('body', 'blued', prof(strip((t) => [0.022 - 0.008 * t * t, 0.003 - 0.03 * t], () => 0.0055, 6), 0.006, { r: 0.0012, bevel: 0.0004 }))
  b.add('body', 'blued', pin('x', 0.0052, 0.044, 0, 0.018, -0.045, 14)) // ambi selector axle
  b.add('body', 'blued', prof([[-0.06, 0.012], [-0.044, 0.014, 0.003], [-0.044, 0.024, 0.003], [-0.058, 0.022]], 0.0022, { x: -0.0222, r: 0.002, bevel: 0.0004 }))
  b.add('body', 'blued', prof([[0.122, -0.008], [0.14, -0.006], [0.142, -0.026, 0.002], [0.126, -0.028, 0.002]], 0.024, { r: 0.002, bevel: 0.0006 })) // paddle mag release
  // ── Side-folding stock (extended)
  b.add('body', 'poly', prof([[-0.168, 0.094], [-0.186, 0.094], [-0.186, 0.032], [-0.168, 0.032]], 0.04, { r: 0.004, bevel: 0.0014 }))
  b.add('body', 'blued', pin('y', 0.0045, 0.07, 0.0215, 0.063, -0.176, 12))
  b.add('body', 'poly', prof([[-0.186, 0.09], [-0.33, 0.094, 0.006], [-0.338, 0.084, 0.004], [-0.338, -0.02, 0.006], [-0.326, -0.028, 0.006], [-0.31, -0.02, 0.006], [-0.31, 0.072, 0.006], [-0.2, 0.068, 0.006], [-0.186, 0.05, 0.006]], 0.026, { r: 0.004, round: 0.006 }))
  b.add('body', 'poly', prof([[-0.2, 0.055], [-0.31, 0.06], [-0.31, 0.044], [-0.2, 0.04]], 0.018, { r: 0.004, round: 0.005 })) // lower strut
  b.add('body', 'rubber', prof([[-0.336, 0.094], [-0.35, 0.09], [-0.352, -0.024], [-0.338, -0.03]], 0.042, { r: 0.004, bevel: 0.002 }))
  // ── Straight 25-round magazine (polymer, ribbed sides)
  // slight forward cant, taper toward the floorplate, rounded edges
  const umpMag = (t: number): [number, number] => [0.09 + 0.014 * t, 0.026 - 0.194 * t]
  b.add('mag', 'poly', prof(strip(umpMag, (t) => 0.066 - 0.006 * t, 10), 0.0248, { r: 0.003, round: 0.0045 }))
  for (let i = 0; i < 6; i++) {
    const [f, y] = umpMag(0.42 + i * 0.085)
    b.add('mag', 'poly', prof([[f - 0.027, y], [f + 0.027, y], [f + 0.027, y + 0.0055], [f - 0.027, y + 0.0055]], 0.0262, { r: 0.002, round: 0.002 }))
  }
  b.add('mag', 'poly', prof([[0.064, -0.166], [0.136, -0.166], [0.138, -0.18, 0.004], [0.066, -0.182, 0.004]], 0.03, { r: 0.003, round: 0.004 }))
  b.add('mag', 'blued', prof([[0.064, 0.024], [0.112, 0.024], [0.11, 0.03, 0.002], [0.07, 0.03, 0.002]], 0.004, { x: 0.009, r: 0.0015, bevel: 0.0004 })) // feed lips
  b.add('mag', 'blued', prof([[0.064, 0.024], [0.112, 0.024], [0.11, 0.03, 0.002], [0.07, 0.03, 0.002]], 0.004, { x: -0.009, r: 0.0015, bevel: 0.0004 }))
  b.add('mag', 'brass', lathe([[0.0, 0.07], [0.0058, 0.07], [0.0058, 0.092], [0.0045, 0.098], [0.0, 0.098]], 0, 0.031, 14)) // top round
  // ── Cocking handle (left)
  b.add('charge', 'blued', rbox(0.27, 0.284, 0.078, 0.094, 0.01, -0.018, 0.002, 0.0006))
  b.add('charge', 'poly', prof([[0.266, 0.074], [0.288, 0.076, 0.004], [0.288, 0.096, 0.004], [0.266, 0.096]], 0.012, { x: -0.028, r: 0.004, bevel: 0.0012 }))

  const meta: RigMeta = {
    type: 'rifle',
    grip: [0, -0.05, 0.06],
    muzzle: [0, BY, -0.4],
    eject: [0.0235, 0.068, -0.045],
    ejectDir: [1, 0.5, 0.3],
    sight: [0, SY, 0.124],
    relief: 0.22,
    hipPos: [0.12, -0.205, -0.43],
    hipRot: [0.02, 0.1, 0.06],
    rh: { p: [0.032, -0.045, 0.062], r: [-0.2, 0, -1.5708], grip: [0.78, 0.45, 0.86, 0.88, 0.86] },
    lh: { p: [-0.012, 0.004, -0.29], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, -0.02, -0.09],
    magDir: [0, -1, -0.02],
    magHold: { p: [-0.034, -0.1, -0.09], r: [0.0, -1.3, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [-0.05, 0.086, -0.278], r: [0.0, 0.0, 1.5], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
    chargeTravel: 0.06,
    flashScale: 0.9,
  }
  return { b, meta }
}

/** Sling loop / swivel ring hanging in the YZ plane (axis X), centred at x, y, z. */
export function loop(r: number, t: number, x: number, y: number, z: number) {
  return flat(new TorusGeometry(r, t, 6, 14).rotateY(Math.PI / 2).translate(x, y, z))
}

// A tiny sphere for red-dot reticles (kept out of geo.ts so the dependency stays local).
import { SphereGeometry, TorusGeometry } from 'three'
export class SphereDot extends SphereGeometry {
  constructor(x: number, y: number, z: number) {
    super(0.0011, 8, 6)
    this.translate(x, y, z)
  }
}
