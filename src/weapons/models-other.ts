/** Intervention, SPAS-12, USP .45, Desert Eagle, M67 frag, combat knife. */
import { SphereGeometry, CylinderGeometry, TorusGeometry } from 'three'
import { box, cyl, flat, frameXY, lathe, pin, prof, rbox, rod, strip, tube, Builder, type P } from './geo'
import { SphereDot, teeth, triggerGuard, type ModelSpec } from './models-rifles'
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
  const TY = 0.038
  // Receiver + carry-handle hump
  b.add('body', 'metal', prof([[-0.14, 0.025], [-0.14, 0.095, 0.006], [-0.12, 0.099], [0.17, 0.099], [0.17, 0.025]], 0.04, { r: 0.005 }))
  b.add('body', 'metal', prof([[-0.1, 0.099], [-0.082, 0.134, 0.01], [0.12, 0.134, 0.006], [0.14, 0.099]], 0.026, { r: 0.006 }))
  b.add('body', 'void', box(-0.02, 0.07, 0.056, 0.085, 0.0198, 0.0208))
  b.add('body', 'blued', prof([[-0.14, 0.03], [0.17, 0.03], [0.17, 0.0], [0.04, -0.012], [-0.14, -0.0]], 0.036, { r: 0.004 }))
  triggerGuard(b, 'body', 'metal', -0.012, 0.075, -0.004, -0.058)
  b.add('body', 'steel', rbox(0.012, 0.018, -0.038, -0.006, 0.006, 0, 0.002))
  b.add('body', 'poly', prof([[-0.08, 0.03], [-0.02, 0.03], [-0.025, -0.01], [-0.04, -0.1], [-0.095, -0.112], [-0.098, -0.04]], 0.035, { r: 0.008 }))
  // Barrel, tube, rib, sights, muzzle
  b.add('body', 'blued', lathe([[0.0108, 0.17], [0.0108, 0.585]], 0, BY, 18))
  b.add('body', 'blued', lathe([[0.0108, 0.1], [0.0108, 0.56]], 0, TY, 18))
  b.add('body', 'metal', lathe([[0.0122, 0.56], [0.0122, 0.575]], 0, TY, 18))
  b.add('body', 'metal', rbox(0.17, 0.57, 0.086, 0.094, 0.01, 0, 0.002))
  b.add('body', 'blued', lathe([[0.0125, 0.54], [0.0125, 0.585]], 0, BY, 18))
  b.add('body', 'void', cyl(0.0078, 0.0078, 0.584, 0.5855, 0, BY, 12))
  b.add('body', 'steel', rbox(0.548, 0.556, 0.092, 0.138, 0.003, 0, 0.0008))
  b.add('body', 'metal', rbox(0.54, 0.564, 0.088, 0.1, 0.012, 0, 0.002))
  b.add('body', 'blued', tube(0.0105, 0.0045, -0.082, -0.07, 0, 0.138, 18))
  b.add('body', 'metal', rbox(-0.086, -0.066, 0.12, 0.138, 0.016, 0, 0.003))
  b.add('body', 'blued', tube(0.0103, 0.0098, -0.086, -0.066, 0, 0.138, 18))
  // Skeleton stock (extended) with hook buttplate
  b.add('body', 'metal', rod([0, 0.09, 0.13], [0, 0.082, 0.33], 0.0075))
  b.add('body', 'metal', rod([0, 0.026, 0.12], [0, -0.02, 0.31], 0.0072))
  b.add('body', 'metal', rod([0, 0.082, 0.33], [0, 0.04, 0.345], 0.007))
  b.add('body', 'poly', prof([[-0.325, 0.108], [-0.34, 0.104], [-0.352, 0.0], [-0.346, -0.062], [-0.33, -0.07], [-0.316, -0.05], [-0.322, 0.0]], 0.044, { r: 0.006 }))
  b.add('body', 'rubber', prof([[-0.338, 0.106], [-0.35, 0.1], [-0.356, 0.0], [-0.35, -0.06], [-0.33, -0.07]], 0.046, { r: 0.004 }))
  // Pump slide with ribs (moves on the tube)
  const pumpProfile: [number, number][] = [[0, 0.215]]
  for (let i = 0; i < 9; i++) {
    const f = 0.215 + i * 0.022
    pumpProfile.push([0.0215, f], [0.0225, f + 0.004], [0.0225, f + 0.011], [0.0215, f + 0.015])
  }
  pumpProfile.push([0.0215, 0.42], [0, 0.42])
  b.add('pump', 'poly', lathe(pumpProfile, 0, TY, 22, 0.5))
  b.add('pump', 'metal', lathe([[0.0125, 0.2], [0.0125, 0.215]], 0, TY, 14))

  const meta: RigMeta = {
    type: 'pump',
    grip: [0, -0.05, 0.06],
    muzzle: [0, BY, -0.585],
    eject: [0.0208, 0.07, -0.025],
    ejectDir: [1, 0.5, 0.3],
    sight: [0, 0.138, 0.078],
    relief: 0.3,
    hipPos: [0.12, -0.205, -0.43],
    hipRot: [0.02, 0.1, 0.06],
    rh: { p: [0.032, -0.04, 0.062], r: [0, 0, -1.5708], grip: [0.5, 0.45, 0.88, 0.88, 0.85] },
    lh: { p: [0.0, TY - 0.002, -0.32], r: [0.0, 0.0, 3.14], grip: [0.5, 0.75, 0.8, 0.8, 0.8] },
    loadHold: { p: [0.0, -0.02, -0.12], r: [0.0, 0.0, 3.14], grip: [0.5, 0.6, 0.6, 0.6, 0.6] },
    travel: 0.085,
    flashScale: 1.6,
  }
  return { b, meta }
}

// ─── USP .45 ────────────────────────────────────────────────────────────────

export function buildUSP(): ModelSpec {
  const b = new Builder()
  // Slide (moves)
  b.add('slide', 'blued', prof([[-0.1, 0.03], [-0.1, 0.064, 0.006], [0.1, 0.066, 0.004], [0.118, 0.058, 0.01], [0.118, 0.03]], 0.026, { r: 0.002 }))
  for (let i = 0; i < 6; i++) {
    const f = -0.094 + i * 0.0065
    b.add('slide', 'void', box(f, f + 0.0028, 0.036, 0.06, -0.0133, -0.0126))
    b.add('slide', 'void', box(f, f + 0.0028, 0.036, 0.06, 0.0126, 0.0133))
  }
  b.add('slide', 'void', box(-0.02, 0.045, 0.044, 0.062, 0.0128, 0.0136))
  b.add('slide', 'steel', rbox(0.095, 0.106, 0.064, 0.074, 0.004, 0, 0.001))
  b.add('slide', 'steel', rbox(-0.093, -0.083, 0.064, 0.074, 0.005, -0.0058, 0.001))
  b.add('slide', 'steel', rbox(-0.093, -0.083, 0.064, 0.074, 0.005, 0.0058, 0.001))
  b.add('slide', 'void', box(0.096, 0.1, 0.066, 0.07, -0.0006, 0.0006))
  b.add('slide', 'blued', lathe([[0.0075, 0.1], [0.0075, 0.124]], 0, 0.047, 14))
  b.add('slide', 'void', cyl(0.0045, 0.0045, 0.123, 0.1245, 0, 0.047, 10))
  // Frame
  b.add('body', 'poly', prof([[-0.108, 0.034], [0.118, 0.034], [0.118, 0.016], [0.07, 0.013], [0.04, 0.01], [-0.108, 0.01]], 0.022, { r: 0.003 }))
  b.add('body', 'poly', prof([[-0.108, 0.036], [-0.04, 0.036], [-0.04, 0.0], [-0.062, -0.112], [-0.128, -0.114], [-0.119, -0.03]], 0.0245, { r: 0.007 }))
  b.add('body', 'rubber', prof([[-0.1, 0.0], [-0.044, 0.0], [-0.062, -0.11], [-0.126, -0.112]], 0.0262, { r: 0.004 }))
  triggerGuard(b, 'body', 'poly', -0.042, 0.044, 0.014, -0.032, 0.012)
  b.add('body', 'steel', rbox(-0.012, -0.006, -0.03, 0.008, 0.005, 0, 0.001))
  b.add('body', 'steel', rbox(-0.06, -0.03, 0.025, 0.031, 0.002, 0.0125, 0.001))
  b.add('body', 'steel', rbox(-0.04, -0.02, 0.0105, 0.017, 0.002, -0.0125, 0.001))
  // Magazine
  b.add('mag', 'metal', rbox(-0.122, -0.068, -0.118, 0.034, 0.0205, 0, 0.004))
  b.add('mag', 'poly', rbox(-0.128, -0.064, -0.126, -0.112, 0.0235, 0, 0.003))

  const meta: RigMeta = {
    type: 'pistol',
    grip: [0, -0.05, 0.085],
    muzzle: [0, 0.047, -0.124],
    eject: [0.0136, 0.056, 0.0],
    ejectDir: [1, 0.7, 0.2],
    sight: [0, 0.071, 0.088],
    relief: 0.3,
    hipPos: [0.11, -0.085, -0.4],
    hipRot: [0.05, 0.08, 0.0],
    rh: { p: [0.024, -0.03, 0.12], r: [0, 0, -1.5708], grip: [0.5, 0.35, 0.9, 0.9, 0.85] },
    lh: { p: [-0.026, -0.038, 0.098], r: [0.0, 1.5708, 0.0], grip: [0.55, 0.85, 0.85, 0.85, 0.85] },
    magWell: [0, -0.02, 0.095],
    magDir: [-0.08, -1, 0],
    magHold: { p: [-0.026, -0.1, 0.095], r: [0.0, 1.5708, 0.0], grip: [0.5, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [-0.02, 0.07, 0.04], r: [0.0, 1.5708, 0.0], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
    travel: 0.035,
    flashScale: 0.75,
  }
  return { b, meta }
}

// ─── Desert Eagle ───────────────────────────────────────────────────────────

export function buildDeagle(): ModelSpec {
  const b = new Builder()
  b.add('slide', 'steel', prof([[-0.115, 0.04], [-0.115, 0.092, 0.006], [0.19, 0.092, 0.006], [0.2, 0.082], [0.2, 0.04]], 0.03, { r: 0.002 }))
  for (let i = 0; i < 8; i++) {
    const f = -0.108 + i * 0.0075
    b.add('slide', 'void', box(f, f + 0.0028, 0.044, 0.086, -0.0153, -0.0146))
    b.add('slide', 'void', box(f, f + 0.0028, 0.044, 0.086, 0.0146, 0.0153))
  }
  b.add('slide', 'void', box(0.0, 0.07, 0.056, 0.082, 0.0148, 0.0156))
  // Top rail slots
  for (let i = 0; i < 12; i++) b.add('slide', 'void', box(0.02 + i * 0.012, 0.026 + i * 0.012, 0.088, 0.094, -0.012, 0.012))
  b.add('slide', 'steel', rbox(0.18, 0.192, 0.09, 0.104, 0.005, 0, 0.001))
  b.add('slide', 'steel', rbox(-0.112, -0.1, 0.09, 0.1, 0.02, 0, 0.002))
  b.add('slide', 'void', box(-0.112, -0.1, 0.092, 0.099, -0.003, 0.003))
  // Frame with massive triangular barrel
  b.add('body', 'blued', prof([[-0.118, 0.042], [0.2, 0.042], [0.2, 0.01], [0.09, 0.002], [0.04, -0.004], [-0.118, 0.006]], 0.028, { r: 0.004 }))
  b.add('body', 'void', cyl(0.0088, 0.0088, 0.198, 0.2005, 0, 0.062, 14))
  b.add('body', 'blued', prof([[-0.122, 0.044], [-0.04, 0.044], [-0.042, 0.0], [-0.062, -0.125], [-0.14, -0.128], [-0.132, -0.03]], 0.031, { r: 0.008 }))
  b.add('body', 'rubber', prof([[-0.12, 0.0], [-0.046, 0.0], [-0.064, -0.124], [-0.138, -0.126]], 0.0345, { r: 0.004 }))
  triggerGuard(b, 'body', 'blued', -0.044, 0.05, 0.004, -0.04, 0.014)
  b.add('body', 'steel', rbox(-0.013, -0.007, -0.034, 0.002, 0.006, 0, 0.001))
  b.add('mag', 'metal', rbox(-0.136, -0.066, -0.14, 0.04, 0.025, 0, 0.004))
  b.add('mag', 'blued', rbox(-0.142, -0.062, -0.14, -0.126, 0.027, 0, 0.003))

  const meta: RigMeta = {
    type: 'pistol',
    grip: [0, -0.055, 0.092],
    muzzle: [0, 0.062, -0.2],
    eject: [0.0156, 0.07, 0.0],
    ejectDir: [1, 0.7, 0.2],
    sight: [0, 0.1, 0.108],
    relief: 0.32,
    hipPos: [0.11, -0.085, -0.4],
    hipRot: [0.05, 0.08, 0.0],
    rh: { p: [0.026, -0.03, 0.125], r: [0, 0, -1.5708], grip: [0.5, 0.35, 0.9, 0.9, 0.85] },
    lh: { p: [-0.03, -0.042, 0.1], r: [0.0, 1.5708, 0.0], grip: [0.55, 0.85, 0.85, 0.85, 0.85] },
    magWell: [0, -0.02, 0.1],
    magDir: [-0.1, -1, 0],
    magHold: { p: [-0.03, -0.11, 0.1], r: [0.0, 1.5708, 0.0], grip: [0.5, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [-0.02, 0.09, 0.06], r: [0.0, 1.5708, 0.0], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
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
