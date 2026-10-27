/** Intervention, SPAS-12, USP .45, Desert Eagle, M67 frag, combat knife. */
import { SphereGeometry, CylinderGeometry, TorusGeometry } from 'three'
import { box, crossPin, cyl, flat, frameXY, halfSec, lathe, pin, prof, rbox, rod, strip, tube, xsec, Builder, type P } from './geo'
import { loop, SphereDot, teeth, triggerGuard, type ModelSpec } from './models-rifles'
import type { RigMeta } from './rig'

// ─── Intervention (M200) ────────────────────────────────────────────────────

export function buildIntervention(): ModelSpec {
  const b = new Builder()
  const AX = 0.075 // bore height
  // Round action
  b.add('body', 'metal', lathe([[0.0265, -0.12], [0.0265, 0.22]], 0, AX, 28))
  b.add('body', 'void', box(-0.035, 0.045, 0.07, 0.092, 0.0262, 0.0275))
  // Chassis stock
  b.add('body', 'poly', prof([[-0.12, 0.05], [-0.12, 0.1], [-0.3, 0.098], [-0.42, 0.094], [-0.474, 0.088], [-0.478, -0.058], [-0.455, -0.07], [-0.4, -0.04], [-0.3, -0.014], [-0.17, 0.0], [-0.12, 0.0]], 0.038, { r: 0.007 }))
  b.add('body', 'poly', prof([[-0.42, 0.094], [-0.38, 0.116], [-0.22, 0.116], [-0.17, 0.099]], 0.034, { r: 0.012 }))
  b.add('body', 'rubber', prof([[-0.476, 0.09], [-0.492, 0.084], [-0.496, -0.056], [-0.478, -0.066]], 0.042, { r: 0.004 }))
  b.add('body', 'poly', prof([[-0.12, 0.052], [0.15, 0.052], [0.15, 0.0], [0.06, -0.01], [-0.12, -0.01]], 0.042, { r: 0.005 }))
  b.add('body', 'poly', prof([[-0.078, 0.034], [-0.022, 0.034], [-0.03, -0.01], [-0.046, -0.108], [-0.104, -0.114], [-0.108, -0.04]], 0.034, { r: 0.008 }))
  b.add('body', 'poly', prof([[0.15, 0.0], [0.15, 0.062], [0.42, 0.056, 0.01], [0.42, 0.016, 0.006]], 0.046, { r: 0.008 }))
  for (let i = 0; i < 6; i++) b.add('body', 'void', box(0.19 + i * 0.04, 0.2 + i * 0.04, 0.026, 0.05, -0.0235, 0.0235))
  triggerGuard(b, 'body', 'metal', -0.004, 0.06, -0.01, -0.06)
  b.add('body', 'steel', rbox(0.02, 0.026, -0.04, -0.01, 0.006, 0, 0.002))
  // Box magazine
  b.add('body', 'metal', rbox(0.05, 0.1, -0.05, 0.0, 0.03, 0, 0.003))
  // Heavy barrel + muzzle brake
  b.add('body', 'blued', lathe([[0.0148, 0.22], [0.0138, 0.5], [0.0128, 0.78]], 0, AX, 24))
  b.add('body', 'blued', lathe([[0, 0.78], [0.0185, 0.78], [0.0185, 0.865], [0.0125, 0.87], [0, 0.87]], 0, AX, 24))
  for (let i = 0; i < 4; i++) {
    b.add('body', 'void', box(0.8 + i * 0.016, 0.806 + i * 0.016, AX - 0.012, AX + 0.012, -0.0192, 0.0192))
  }
  b.add('body', 'void', cyl(0.0068, 0.0068, 0.869, 0.8705, 0, AX, 14))
  // Scope rail + rings + scope
  b.add('body', 'metal', rbox(-0.1, 0.2, 0.098, 0.108, 0.026, 0, 0.001))
  teeth(b, 'body', 'metal', -0.098, 0.198, 0.108, 0.026, 0.0125, 0.004)
  const SY = 0.148
  for (const f0 of [-0.035, 0.115]) {
    b.add('body', 'metal', prof([[f0, 0.108], [f0 + 0.035, 0.108], [f0 + 0.035, SY - 0.018], [f0, SY - 0.018]], 0.028, { r: 0.002 }))
    b.add('body', 'metal', tube(0.0255, 0.0192, f0 + 0.002, f0 + 0.033, 0, SY, 24))
  }
  b.add('body', 'blued', tube(0.0195, 0.0185, -0.09, 0.2, 0, SY, 28))
  b.add('body', 'blued', lathe([[0.0185, 0.18], [0.03, 0.215], [0.0305, 0.34], [0.0295, 0.345], [0.0, 0.345]], 0, SY, 28))
  b.add('body', 'lens', cyl(0.0275, 0.0275, 0.3405, 0.342, 0, SY, 28))
  b.add('body', 'blued', lathe([[0.0185, -0.09], [0.0245, -0.115], [0.0255, -0.14], [0.0235, -0.142], [0.0205, -0.138]], 0, SY, 28))
  b.add('body', 'lens', cyl(0.0198, 0.0198, -0.1385, -0.1375, 0, SY, 24))
  b.add('body', 'metal', pin('y', 0.0125, 0.026, 0, SY + 0.0305, 0.06, 18))
  b.add('body', 'metal', pin('x', 0.0115, 0.024, 0.0295, SY, 0.06, 18))
  b.add('body', 'metal', pin('x', 0.0115, 0.024, -0.0295, SY, 0.06, 18))
  // Bolt body + handle
  b.add('bolt', 'steel', lathe([[0.0118, -0.14], [0.0118, 0.02]], 0, AX, 18))
  b.add('bolt', 'steel', lathe([[0.0128, 0.0], [0.0128, 0.03]], 0, AX, 18))
  b.add('bolt', 'blued', lathe([[0.0125, -0.15], [0.0125, -0.138]], 0, AX, 18))
  b.add('boltHandle', 'steel', rod([0.008, AX - 0.002, 0.07], [0.058, AX - 0.016, 0.07], 0.0045))
  b.add('boltHandle', 'blued', flat(new SphereGeometry(0.0118, 14, 10).translate(0.07, AX - 0.021, 0.07)))
  b.pivot('bolt', 0, AX, 0)
  b.parent('boltHandle', 'bolt')
  b.pivot('boltHandle', 0, AX, 0.07)

  const meta: RigMeta = {
    type: 'bolt',
    grip: [0, -0.05, 0.06],
    muzzle: [0, AX, -0.87],
    eject: [0.027, AX + 0.01, -0.0],
    ejectDir: [1, 0.6, 0.2],
    sight: [0, SY, 0.138],
    relief: 0.12,
    hipPos: [0.12, -0.205, -0.43],
    hipRot: [0.02, 0.1, 0.06],
    rh: { p: [0.032, -0.036, 0.07], r: [0, 0, -1.5708], grip: [0.5, 0.42, 0.9, 0.9, 0.85] },
    lh: { p: [-0.012, 0.018, -0.3], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, -0.02, -0.075],
    magDir: [0, -1, 0],
    chargeHold: { p: [0.06, AX - 0.012, 0.07], r: [0.0, -0.6, 1.5], grip: [0.6, 0.6, 0.8, 0.8, 0.8] },
    chargeTravel: 0.1,
    travel: 0.1,
    hasScope: true,
    flashScale: 1.5,
  }
  return { b, meta }
}

function ring0(x: number, y: number, f: number) {
  return new TorusGeometry(0.004, 0.0012, 6, 10).translate(x, y, -f)
}

// ─── SPAS-12 ────────────────────────────────────────────────────────────────

export function buildSPAS12(): ModelSpec {
  const b = new Builder()
  const BY = 0.078
  const TY = 0.04
  // ── Receiver: tall stepped alloy receiver, loading port underneath, ejection port right
  b.add('body', 'metal', xsec(halfSec([[0.0175, 0.016], [0.0195, 0.022], [0.0195, 0.09], [0.016, 0.1], [0.008, 0.104]]), -0.13, 0.175, 0.0014, 0.002))
  b.add('body', 'metal', xsec(halfSec([[0.0145, 0.1], [0.0145, 0.112], [0.01, 0.12], [0.005, 0.122]]), -0.1, 0.12, 0.0012, 0.002)) // top rib
  b.add('body', 'void', box(0.0, 0.085, 0.052, 0.088, 0.0193, 0.02)) // ejection port
  b.add('body', 'steel', rbox(0.005, 0.08, 0.06, 0.08, 0.0385, 0, 0.002, 0.0005)) // bolt face visible in the port
  b.add('body', 'void', box(0.02, 0.15, 0.0155, 0.017, -0.012, 0.012)) // loading port slot (bottom)
  b.add('body', 'void', box(-0.12, 0.17, 0.0435, 0.0441, 0.0194, 0.02))
  b.add('body', 'void', box(-0.12, 0.17, 0.0435, 0.0441, -0.02, -0.0194))
  b.add('body', 'blued', pin('x', 0.0042, 0.044, 0, 0.03, 0.02, 12)) // cross-bolt safety
  b.add('body', 'blued', rbox(0.11, 0.13, 0.024, 0.034, 0.042, 0, 0.002, 0.0006)) // bolt release
  for (const f of [-0.11, 0.155]) crossPin(b, 'body', 'steel', 0.0195, 0.03, f, 0.0024)
  // ── Lower / trigger group, grip, guard
  b.add('body', 'poly', prof([[-0.13, 0.018], [0.07, 0.018], [0.07, 0.004], [-0.03, 0.002], [-0.13, 0.006]], 0.034, { r: 0.003, bevel: 0.0014 }))
  triggerGuard(b, 'body', 'metal', -0.01, 0.07, 0.004, -0.05, 0.008)
  b.add('body', 'blued', prof(strip((t) => [0.026 - 0.008 * t * t, 0.003 - 0.034 * t], () => 0.0058, 6), 0.0062, { r: 0.0012, bevel: 0.0004 }))
  b.add('body', 'poly', prof([[-0.07, 0.006], [-0.016, 0.006], [-0.022, -0.026, 0.01], [-0.036, -0.104, 0.01], [-0.044, -0.114, 0.004], [-0.086, -0.112, 0.006], [-0.084, -0.06, 0.014], [-0.072, -0.02, 0.012]], 0.031, { r: 0.004, bevel: 0.003 }))
  for (let i = 0; i < 8; i++) {
    const y = -0.03 - i * 0.009
    b.add('body', 'void', box(-0.078 + i * 0.0016, -0.04 + i * 0.0016, y, y + 0.0028, 0.0154, 0.016))
    b.add('body', 'void', box(-0.078 + i * 0.0016, -0.04 + i * 0.0016, y, y + 0.0028, -0.016, -0.0154))
  }
  // ── Barrel, magazine tube, front band, muzzle, sights
  b.add('body', 'blued', lathe([[0.0, 0.17], [0.0118, 0.17], [0.0118, 0.2], [0.0108, 0.205], [0.0108, 0.59], [0.0, 0.59]], 0, BY, 20))
  b.add('body', 'blued', lathe([[0.0, 0.584], [0.0124, 0.584], [0.0124, 0.6], [0.0116, 0.604], [0.0, 0.604]], 0, BY, 20)) // choke
  b.add('body', 'void', cyl(0.0094, 0.0094, 0.6035, 0.6045, 0, BY, 16))
  b.add('body', 'metal', lathe([[0.0, 0.16], [0.0118, 0.16], [0.0118, 0.555], [0.0, 0.555]], 0, TY, 20)) // mag tube
  b.add('body', 'metal', lathe([[0.0, 0.552], [0.0132, 0.552], [0.0136, 0.558], [0.0136, 0.578], [0.0124, 0.584], [0.0, 0.584]], 0, TY, 20)) // tube cap
  for (let i = 0; i < 12; i++) b.add('body', 'void', box(0.56, 0.578, 0.0132, 0.014, -0.0009, 0.0009).rotateZ((i / 12) * Math.PI * 2).translate(0, TY, 0))
  b.add('body', 'metal', xsec(halfSec([[0.008, TY - 0.012], [0.0148, TY - 0.004], [0.0148, BY + 0.004], [0.008, BY + 0.0125]]), 0.53, 0.55, 0.0008, 0.004)) // barrel band
  b.add('body', 'blued', loop(0.007, 0.0016, 0, TY - 0.02, -0.54))
  b.add('body', 'metal', prof([[0.565, BY + 0.008], [0.585, BY + 0.008], [0.582, 0.12, 0.002], [0.572, 0.12, 0.002]], 0.004, { r: 0.0015, bevel: 0.0005 })) // front blade
  b.add('body', 'metal', rbox(0.562, 0.588, BY + 0.006, BY + 0.012, 0.012, 0, 0.002, 0.0006))
  b.add('body', 'metal', prof([[-0.096, 0.122], [-0.066, 0.122], [-0.068, 0.128, 0.002], [-0.094, 0.128, 0.002]], 0.022, { r: 0.002, bevel: 0.0006 }))
  b.add('body', 'blued', tube(0.0095, 0.0032, -0.086, -0.074, 0, 0.12, 18)) // rear aperture
  b.add('body', 'metal', rbox(-0.09, -0.07, 0.12, 0.138, 0.006, 0.0105, 0.001, 0.0004))
  b.add('body', 'metal', rbox(-0.09, -0.07, 0.12, 0.138, 0.006, -0.0105, 0.001, 0.0004))
  // ── Skeleton stock (extended) with butt hook
  b.add('body', 'metal', rbox(-0.15, -0.13, 0.024, 0.098, 0.03, 0, 0.003, 0.001))
  b.add('body', 'metal', rod([0.0145, 0.09, 0.14], [0.0145, 0.085, 0.33], 0.0062))
  b.add('body', 'metal', rod([-0.0145, 0.09, 0.14], [-0.0145, 0.085, 0.33], 0.0062))
  b.add('body', 'metal', rod([0.0145, 0.03, 0.14], [0.0145, -0.012, 0.31], 0.006))
  b.add('body', 'metal', rod([-0.0145, 0.03, 0.14], [-0.0145, -0.012, 0.31], 0.006))
  b.add('body', 'metal', rod([0, 0.088, 0.25], [0, -0.0, 0.25], 0.004))
  b.add('body', 'poly', prof([[-0.312, 0.104], [-0.336, 0.1, 0.004], [-0.346, 0.0, 0.01], [-0.34, -0.052, 0.006], [-0.322, -0.06, 0.004], [-0.31, -0.03], [-0.318, 0.0, 0.01], [-0.312, 0.06]], 0.044, { r: 0.004, bevel: 0.002 }))
  b.add('body', 'rubber', prof([[-0.334, 0.102], [-0.348, 0.098], [-0.354, 0.0], [-0.348, -0.05], [-0.33, -0.062]], 0.046, { r: 0.004, bevel: 0.0016 }))
  b.add('body', 'metal', prof([[-0.33, 0.106], [-0.302, 0.12, 0.006], [-0.276, 0.116, 0.004], [-0.288, 0.108, 0.004], [-0.31, 0.11]], 0.012, { r: 0.002, bevel: 0.0008 })) // hook
  // ── Pump fore-end: ribbed polymer with relief panels
  const pumpProfile: [number, number][] = [[0, 0.215]]
  for (let i = 0; i < 9; i++) {
    const f = 0.215 + i * 0.022
    pumpProfile.push([0.0228, f], [0.024, f + 0.004], [0.024, f + 0.012], [0.0228, f + 0.016])
  }
  pumpProfile.push([0.0228, 0.42], [0.0, 0.42])
  b.add('pump', 'poly', lathe(pumpProfile, 0, TY, 24, 0.5).scale(1, 1.08, 1).translate(0, -TY * 0.08, 0))
  b.add('pump', 'poly', xsec(halfSec([[0.016, TY + 0.012], [0.018, BY - 0.004], [0.012, BY + 0.002]]), 0.22, 0.41, 0.0012, 0.003))
  b.add('pump', 'metal', lathe([[0.0, 0.2], [0.0128, 0.2], [0.0128, 0.215], [0.0, 0.215]], 0, TY, 16))

  const meta: RigMeta = {
    type: 'pump',
    grip: [0, -0.05, 0.06],
    muzzle: [0, BY, -0.604],
    eject: [0.02, 0.07, -0.04],
    ejectDir: [1, 0.5, 0.3],
    sight: [0, 0.12, 0.08],
    relief: 0.3,
    hipPos: [0.12, -0.205, -0.43],
    hipRot: [0.02, 0.1, 0.06],
    rh: { p: [0.032, -0.045, 0.062], r: [-0.2, 0, -1.5708], grip: [0.5, 0.45, 0.85, 0.86, 0.84] },
    lh: { p: [0.0, TY - 0.03, -0.32], r: [0.0, 0.0, 3.14], grip: [0.5, 0.75, 0.8, 0.8, 0.8] },
    loadHold: { p: [0.0, -0.02, -0.12], r: [0.0, 0.0, 3.14], grip: [0.5, 0.6, 0.6, 0.6, 0.6] },
    travel: 0.085,
    flashScale: 1.6,
  }
  return { b, meta }
}

// ─── USP .45 ────────────────────────────────────────────────────────────────
// H&K USP: chamfered slide with rear serrations, 3-dot sights, polymer frame
// with railed dust cover, square HK guard, paddle mag release, control lever.

export function buildUSP(): ModelSpec {
  const b = new Builder()
  const SY = 0.074
  // ── Slide (moves)
  const slideSec = halfSec([
    [0.0112, 0.03],
    [0.0122, 0.033],
    [0.0122, 0.056],
    [0.0098, 0.0645],
    [0.0052, 0.067],
  ])
  b.add('slide', 'blued', xsec(slideSec, -0.098, 0.112, 0.0016, 0.0016))
  for (let i = 0; i < 9; i++) {
    const f = -0.092 + i * 0.0045
    b.add('slide', 'void', box(f, f + 0.0019, 0.036, 0.06, 0.0115, 0.0124))
    b.add('slide', 'void', box(f, f + 0.0019, 0.036, 0.06, -0.0124, -0.0115))
  }
  b.add('slide', 'void', box(-0.02, 0.038, 0.047, 0.0655, 0.0109, 0.0123)) // ejection port
  b.add('slide', 'blued', rbox(-0.018, 0.036, 0.05, 0.064, 0.02, 0, 0.002, 0.0006)) // barrel hood in the port
  b.add('slide', 'steel', prof([[-0.032, 0.054], [-0.012, 0.054], [-0.012, 0.059], [-0.03, 0.059]], 0.0014, { x: 0.0126, r: 0.0008, bevel: 0.0002 })) // extractor
  // sights: rear notch + two dots, front post + dot
  b.add('slide', 'blued', prof([[-0.094, 0.064], [-0.078, 0.064], [-0.08, SY + 0.0035, 0.001], [-0.093, SY + 0.0035, 0.001]], 0.018, { r: 0.0008, bevel: 0.0004 }))
  b.add('slide', 'void', box(-0.095, -0.077, SY - 0.004, SY + 0.004, -0.0018, 0.0018))
  b.add('slide', 'chrome', pin('z', 0.0011, 0.0006, -0.0052, SY - 0.0005, -0.0939, 8))
  b.add('slide', 'chrome', pin('z', 0.0011, 0.0006, 0.0052, SY - 0.0005, -0.0939, 8))
  b.add('slide', 'blued', prof([[0.094, 0.065], [0.104, 0.065], [0.103, SY, 0.001], [0.096, SY, 0.001]], 0.0032, { r: 0.0008, bevel: 0.0003 }))
  b.add('slide', 'chrome', pin('z', 0.0011, 0.0006, 0, SY - 0.0028, 0.0935, 8))
  // muzzle end: barrel + recoil spring guide
  b.add('slide', 'void', cyl(0.0058, 0.0058, 0.1116, 0.1126, 0, 0.047, 14))
  b.add('body', 'blued', lathe([[0.0, 0.1], [0.0074, 0.1], [0.0074, 0.1128], [0.0, 0.1128]], 0, 0.047, 16))
  // ── Frame (polymer)
  b.add('body', 'poly', prof([[-0.104, 0.032], [0.112, 0.032], [0.112, 0.014, 0.004], [0.06, 0.012], [0.042, 0.008], [-0.104, 0.008]], 0.0224, { r: 0.003, bevel: 0.0012 }))
  b.add('body', 'void', box(0.05, 0.108, 0.0205, 0.0215, 0.0109, 0.0114))
  b.add('body', 'void', box(0.05, 0.108, 0.0205, 0.0215, -0.0114, -0.0109))
  b.add('body', 'poly', cyl(0.0042, 0.0042, 0.111, 0.1125, 0, 0.022, 10))
  // square HK trigger guard with hooked front
  b.add('body', 'poly', prof([[-0.032, 0.012], [0.046, 0.012], [0.05, -0.02, 0.004], [0.044, -0.036, 0.008], [0.0, -0.036, 0.004], [-0.032, -0.02, 0.006]], 0.0105, { r: 0.002, bevel: 0.001, holes: [[[-0.024, 0.006], [0.039, 0.006], [0.041, -0.016, 0.004], [0.036, -0.029, 0.006], [-0.002, -0.029, 0.004], [-0.024, -0.016, 0.005]]] }))
  b.add('body', 'blued', prof(strip((t) => [0.012 - 0.006 * t * t, 0.01 - 0.028 * t], () => 0.0055, 6), 0.0058, { r: 0.0012, bevel: 0.0004 }))
  b.add('body', 'blued', prof([[-0.036, -0.03], [-0.026, -0.03], [-0.026, -0.04, 0.002], [-0.036, -0.04, 0.002]], 0.019, { r: 0.002, bevel: 0.0005 })) // paddle release
  // grip with stippled panels + backstrap
  b.add('body', 'poly', prof([[-0.1, 0.01], [-0.034, 0.01], [-0.038, -0.02, 0.008], [-0.054, -0.104, 0.008], [-0.06, -0.112, 0.004], [-0.098, -0.11, 0.006], [-0.103, -0.05, 0.016], [-0.1, -0.004, 0.006]], 0.0262, { r: 0.004, bevel: 0.0028 }))
  b.add('body', 'rubber', prof([[-0.094, -0.012], [-0.044, -0.012], [-0.056, -0.098, 0.004], [-0.094, -0.098, 0.004], [-0.098, -0.05, 0.01]], 0.0276, { r: 0.004, bevel: 0.0012 }))
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 4; c++) {
      const y = -0.02 - r * 0.0085
      const f = -0.09 + c * 0.0095 + r * 0.0018
      b.add('body', 'void', box(f, f + 0.003, y, y + 0.003, 0.0137, 0.0141))
      b.add('body', 'void', box(f, f + 0.003, y, y + 0.003, -0.0141, -0.0137))
    }
  }
  // controls: control lever (left rear), slide stop (left), hammer
  b.add('body', 'blued', pin('x', 0.0042, 0.003, -0.0128, 0.024, -0.086, 12))
  b.add('body', 'blued', prof([[-0.094, 0.018], [-0.078, 0.02, 0.003], [-0.074, 0.03, 0.003], [-0.09, 0.03]], 0.0022, { x: -0.0136, r: 0.002, bevel: 0.0004 }))
  b.add('body', 'blued', prof([[-0.026, 0.024], [0.0, 0.026, 0.002], [0.0, 0.031, 0.002], [-0.024, 0.031]], 0.0018, { x: -0.0125, r: 0.0015, bevel: 0.0003 }))
  b.add('body', 'blued', prof([[-0.112, 0.042], [-0.1, 0.044], [-0.1, 0.06], [-0.11, 0.064, 0.004], [-0.116, 0.056, 0.003]], 0.0085, { r: 0.002, bevel: 0.0006 })) // hammer
  // ── Magazine (steel, polymer base)
  b.add('mag', 'metal', rbox(-0.094, -0.054, -0.11, 0.03, 0.0205, 0, 0.004, 0.0008))
  b.add('mag', 'poly', prof([[-0.1, -0.108], [-0.054, -0.108], [-0.052, -0.12, 0.003], [-0.102, -0.12, 0.003]], 0.0262, { r: 0.002, bevel: 0.001 }))

  const meta: RigMeta = {
    type: 'pistol',
    grip: [0, -0.05, 0.075],
    muzzle: [0, 0.047, -0.113],
    eject: [0.0136, 0.058, -0.01],
    ejectDir: [1, 0.7, 0.2],
    sight: [0, SY, 0.086],
    relief: 0.3,
    hipPos: [0.11, -0.085, -0.4],
    hipRot: [0.05, 0.08, 0.0],
    rh: { p: [0.024, -0.035, 0.078], r: [-0.25, 0, -1.5708], grip: [0.5, 0.35, 0.9, 0.9, 0.85] },
    lh: { p: [-0.026, -0.042, 0.07], r: [0.0, 1.5708, 0.0], grip: [0.55, 0.85, 0.85, 0.85, 0.85] },
    magWell: [0, -0.02, 0.078],
    magDir: [-0.2, -1, 0],
    magHold: { p: [-0.026, -0.1, 0.085], r: [0.0, 1.5708, 0.0], grip: [0.5, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [-0.02, 0.07, 0.07], r: [0.0, 1.5708, 0.0], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
    travel: 0.035,
    flashScale: 0.75,
  }
  return { b, meta }
}

// ─── Desert Eagle ───────────────────────────────────────────────────────────
// Mark XIX: stainless slide behind a fixed polygonal barrel with an integral
// top rail, ambidextrous slide-mounted safeties, big hammer, wraparound grip.

export function buildDeagle(): ModelSpec {
  const b = new Builder()
  const SY = 0.104
  const BY = 0.064
  // ── Slide (moves)
  b.add('slide', 'steel', xsec(halfSec([[0.014, 0.046], [0.0156, 0.05], [0.0156, 0.08], [0.012, 0.09], [0.006, 0.093]]), -0.128, 0.03, 0.0016, 0.002))
  for (let i = 0; i < 9; i++) {
    const f = -0.12 + i * 0.0058
    b.add('slide', 'void', box(f, f + 0.0024, 0.052, 0.084, 0.0148, 0.0158))
    b.add('slide', 'void', box(f, f + 0.0024, 0.052, 0.084, -0.0158, -0.0148))
  }
  b.add('slide', 'void', box(-0.04, 0.02, 0.058, 0.084, 0.015, 0.0158)) // ejection port
  b.add('slide', 'steel', rbox(-0.038, 0.018, 0.062, 0.082, 0.026, 0, 0.002, 0.0006))
  b.add('slide', 'blued', prof([[-0.124, 0.09], [-0.106, 0.09], [-0.108, SY + 0.003, 0.001], [-0.122, SY + 0.003, 0.001]], 0.022, { r: 0.0008, bevel: 0.0004 })) // rear sight
  b.add('slide', 'void', box(-0.125, -0.105, SY - 0.006, SY + 0.004, -0.0022, 0.0022))
  // ambi safeties on the slide
  for (const s of [1, -1]) {
    b.add('slide', 'blued', pin('x', 0.0062, 0.004, s * 0.0174, 0.076, -0.106, 14))
    b.add('slide', 'blued', prof([[-0.112, 0.07], [-0.09, 0.072, 0.003], [-0.09, 0.08, 0.003], [-0.11, 0.082]], 0.0024, { x: s * 0.0192, r: 0.002, bevel: 0.0004 }))
  }
  // ── Fixed polygonal barrel with integral rail
  const barSec = halfSec([
    [0.0156, 0.036],
    [0.0156, 0.064],
    [0.0108, 0.088],
    [0.0082, 0.092],
  ])
  b.add('body', 'steel', xsec(barSec, 0.03, 0.16, 0.0016, 0.002))
  b.add('body', 'steel', rbox(0.04, 0.158, 0.092, 0.098, 0.016, 0, 0.0012, 0.0005))
  for (let i = 0; i < 9; i++) b.add('body', 'void', box(0.05 + i * 0.012, 0.055 + i * 0.012, 0.094, 0.0985, -0.0081, 0.0081))
  b.add('body', 'void', box(0.04, 0.15, 0.06, 0.0606, 0.0156, 0.0162)) // flute line
  b.add('body', 'void', box(0.04, 0.15, 0.06, 0.0606, -0.0162, -0.0156))
  b.add('body', 'blued', prof([[0.14, 0.098], [0.154, 0.098], [0.153, SY, 0.001], [0.142, SY, 0.001]], 0.0036, { r: 0.0008, bevel: 0.0003 })) // front blade
  b.add('body', 'void', cyl(0.0068, 0.0068, 0.1595, 0.1605, 0, BY, 16))
  // ── Frame (steel), trigger guard, grip
  b.add('body', 'steel', prof([[-0.128, 0.046], [0.16, 0.046], [0.16, 0.036], [0.11, 0.028], [0.07, 0.012], [0.044, 0.004], [-0.128, 0.006]], 0.03, { r: 0.004, bevel: 0.0014 }))
  b.add('body', 'steel', prof([[-0.038, 0.006], [0.052, 0.006], [0.06, -0.012, 0.006], [0.05, -0.044, 0.012], [0.004, -0.044, 0.006], [-0.038, -0.026, 0.008]], 0.012, { r: 0.002, bevel: 0.001, holes: [[[-0.03, 0.0], [0.046, 0.0], [0.051, -0.014, 0.004], [0.044, -0.036, 0.01], [0.002, -0.036, 0.005], [-0.03, -0.022, 0.006]]] }))
  b.add('body', 'blued', prof(strip((t) => [0.014 - 0.006 * t * t, 0.004 - 0.03 * t], () => 0.006, 6), 0.0062, { r: 0.0012, bevel: 0.0004 }))
  b.add('body', 'steel', prof([[-0.124, 0.008], [-0.036, 0.008], [-0.04, -0.02, 0.008], [-0.064, -0.124, 0.008], [-0.07, -0.132, 0.004], [-0.122, -0.13, 0.006], [-0.126, -0.06, 0.018], [-0.124, -0.004, 0.006]], 0.0292, { r: 0.004, bevel: 0.003 }))
  b.add('body', 'rubber', prof([[-0.124, -0.008], [-0.042, -0.008], [-0.066, -0.122, 0.006], [-0.12, -0.12, 0.006], [-0.124, -0.06, 0.016]], 0.0342, { r: 0.006, bevel: 0.0024 }))
  for (let i = 0; i < 4; i++) {
    const y = -0.03 - i * 0.022
    b.add('body', 'void', box(-0.13 + i * 0.004, -0.05 + i * 0.002, y, y + 0.002, 0.017, 0.0175))
    b.add('body', 'void', box(-0.13 + i * 0.004, -0.05 + i * 0.002, y, y + 0.002, -0.0175, -0.017))
  }
  b.add('body', 'steel', prof([[-0.14, 0.05], [-0.126, 0.052], [-0.126, 0.076], [-0.138, 0.082, 0.005], [-0.146, 0.07, 0.004]], 0.011, { r: 0.002, bevel: 0.0007 })) // hammer
  b.add('body', 'blued', pin('x', 0.005, 0.034, 0, 0.026, 0.03, 14)) // takedown / slide stop
  b.add('body', 'blued', prof([[-0.01, 0.024], [0.03, 0.026, 0.003], [0.03, 0.032, 0.003], [-0.008, 0.032]], 0.0022, { x: -0.0163, r: 0.002, bevel: 0.0004 }))
  // ── Magazine (steel)
  b.add('mag', 'metal', rbox(-0.124, -0.064, -0.13, 0.04, 0.0235, 0, 0.004, 0.0008))
  b.add('mag', 'blued', prof([[-0.13, -0.128], [-0.062, -0.128], [-0.06, -0.14, 0.003], [-0.132, -0.14, 0.003]], 0.03, { r: 0.002, bevel: 0.001 }))

  const meta: RigMeta = {
    type: 'pistol',
    grip: [0, -0.055, 0.09],
    muzzle: [0, BY, -0.16],
    eject: [0.0158, 0.072, 0.01],
    ejectDir: [1, 0.7, 0.2],
    sight: [0, SY, 0.115],
    relief: 0.32,
    hipPos: [0.11, -0.085, -0.4],
    hipRot: [0.05, 0.08, 0.0],
    rh: { p: [0.027, -0.035, 0.094], r: [-0.25, 0, -1.5708], grip: [0.5, 0.35, 0.9, 0.9, 0.85] },
    lh: { p: [-0.03, -0.046, 0.086], r: [0.0, 1.5708, 0.0], grip: [0.55, 0.85, 0.85, 0.85, 0.85] },
    magWell: [0, -0.02, 0.094],
    magDir: [-0.2, -1, 0],
    magHold: { p: [-0.03, -0.11, 0.1], r: [0.0, 1.5708, 0.0], grip: [0.5, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [-0.02, 0.09, 0.08], r: [0.0, 1.5708, 0.0], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
    travel: 0.045,
    flashScale: 1.3,
  }
  return { b, meta }
}

// ─── M67 frag grenade (axis = Y, origin at body centre) ─────────────────────

export function buildFrag(): ModelSpec {
  const b = new Builder()
  const body = new SphereGeometry(0.0335, 24, 18)
  body.scale(1, 1.14, 1)
  b.add('body', 'grenade', flat(body))
  b.add('body', 'metal', flat(new CylinderGeometry(0.0125, 0.016, 0.014, 16).translate(0, 0.0405, 0)))
  b.add('body', 'steel', flat(new CylinderGeometry(0.0095, 0.0105, 0.022, 14).translate(0, 0.0525, 0)))
  b.add('body', 'metal', flat(new CylinderGeometry(0.0125, 0.0125, 0.004, 14).translate(0, 0.0645, 0)))
  b.add('body', 'metal', flat(new CylinderGeometry(0.0155, 0.0155, 0.004, 14).translate(0, -0.0395, 0)))
  // Spoon: a strip hugging the body from the fuse down the +X side
  for (let i = 0; i < 9; i++) {
    const a0 = (i / 9) * 2.0 + 0.08
    const a1 = ((i + 1) / 9) * 2.0 + 0.08
    const r = 0.0368
    const p0: [number, number, number] = [Math.sin(a0) * r + 0.004, Math.cos(a0) * r * 1.13 + 0.004, 0]
    const p1: [number, number, number] = [Math.sin(a1) * r + 0.004, Math.cos(a1) * r * 1.13 + 0.004, 0]
    b.add('spoon', 'steel', rod(p0, p1, 0.0072, 0.0072, 6))
  }
  b.add('spoon', 'steel', rod([0.0, 0.0605, 0], [0.026, 0.0545, 0], 0.0062, 0.0062, 6))
  b.pivot('spoon', 0, 0.0605, 0)
  // Safety pin and ring
  b.add('pin', 'chrome', rod([0, 0.0545, -0.016], [0, 0.0545, 0.016], 0.0016, 0.0016, 6))
  b.add('pin', 'chrome', flat(new TorusGeometry(0.0105, 0.0016, 6, 14).translate(0, 0.0545, -0.0235)))
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

export function buildKnife(): ModelSpec {
  const b = new Builder()
  // Blade, clip point
  b.add('body', 'steel', prof([[0.0, -0.015], [0.0, 0.016], [0.1, 0.018, 0.01], [0.15, 0.011, 0.01], [0.192, -0.003, 0.002], [0.13, -0.012, 0.02], [0.05, -0.016]], 0.0034, { r: 0.002, bevel: 0.0007 }))
  b.add('body', 'void', box(0.012, 0.13, 0.004, 0.007, -0.0019, 0.0019))
  b.add('body', 'steel', rbox(-0.004, 0.008, -0.028, 0.026, 0.0155, 0, 0.003))
  // Wrapped handle
  const prof2: [number, number][] = [[0, 0.0]]
  for (let i = 0; i < 9; i++) {
    const f = -0.004 - i * 0.012
    prof2.push([0.0145, f], [0.0158, f - 0.003], [0.0158, f - 0.009], [0.0145, f - 0.012])
  }
  prof2.push([0.0, -0.112])
  b.add('body', 'rubber', lathe(prof2.map(([r, f]) => [r, -f] as [number, number]), 0, 0, 16, 0.5).scale(1, 1, -1))
  b.add('body', 'steel', cyl(0.0175, 0.0165, 0.108, 0.118, 0, 0, 14).scale(1, 1, -1))
  b.add('body', 'steel', flat(new TorusGeometry(0.007, 0.0016, 6, 12).translate(0, -0.016, 0.12)))

  const meta: RigMeta = {
    type: 'knife',
    grip: [0, 0, 0.05],
    muzzle: [0, 0, -0.19],
    eject: [0, 0, 0],
    ejectDir: [0, 1, 0],
    sight: [0, 0, 0],
    relief: 0.3,
    hipPos: [0.16, -0.17, -0.32],
    hipRot: [0.0, 0.0, 0.0],
    rh: { p: [0.0, 0.0, 0.05], r: [-1.5708, 0.0, -1.5708], grip: [0.55, 0.9, 0.95, 0.95, 0.9] },
    lh: { p: [-0.2, -0.3, 0.2], r: [0.0, 0.0, 0.0], grip: [0.3, 0.3, 0.3, 0.3, 0.3] },
    flashScale: 0,
  }
  return { b, meta }
}
