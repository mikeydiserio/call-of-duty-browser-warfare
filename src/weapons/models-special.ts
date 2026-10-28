/**
 * Procedural models for the support / special weapons: RPD, RPG-7, AA-12, G18.
 * Local frame: +X right, +Y up, barrel along -Z (profiles are in (f, y), z = -f).
 */
import { SphereGeometry, TorusGeometry } from 'three'
import { box, Builder, crossPin, cyl, flat, halfSec, lathe, pin, prof, rail1913, rbox, rod, screwHead, strip, tube, xsec } from './geo'
import { loop, triggerGuard, type ModelSpec } from './models-rifles'
import type { RigMeta } from './rig'

// ─── RPD ─────────────────────────────────────────────────────────────────────
// Soviet belt-fed LMG: milled receiver with a hinged feed cover, belt entering
// from the left out of a 100-round drum container hung under the receiver,
// club-like wooden stock, short wooden handguard around the gas cylinder,
// long barrel with a folded bipod and winged front post.

export function buildRPD(): ModelSpec {
  const b = new Builder()
  const BY = 0.07
  const SY = 0.124
  const GY = 0.044 // gas cylinder axis (below the barrel)
  const rx = 0.0185
  // ── Receiver + barrel trunnion
  b.add('body', 'blued', xsec(halfSec([[rx - 0.002, 0.0], [rx, 0.003], [rx, 0.086], [rx - 0.003, 0.09]]), -0.15, 0.15, 0.001, 0.0015))
  b.add('body', 'blued', xsec(halfSec([[0.0165, 0.04], [0.0175, 0.046], [0.0175, 0.088], [0.012, 0.095]]), 0.14, 0.21, 0.001, 0.002))
  // feed cover: hinged at the front, latch at the rear, stiffening ribs on top
  b.add('body', 'blued', xsec(halfSec([[rx + 0.001, 0.084], [rx + 0.001, 0.098], [0.016, 0.106], [0.008, 0.108]]), -0.125, 0.135, 0.001, 0.002))
  for (let i = 0; i < 3; i++) {
    const f = -0.07 + i * 0.065
    b.add('body', 'blued', rbox(f, f + 0.008, 0.104, 0.11, 0.024, 0, 0.001, 0.0004))
  }
  b.add('body', 'steel', rbox(-0.142, -0.124, 0.088, 0.104, 0.03, 0, 0.003, 0.001)) // cover latch
  b.add('body', 'steel', pin('x', 0.0042, 0.042, 0, 0.096, 0.132, 14)) // cover hinge
  // belt feed opening + tray lip (left), side rivets
  b.add('body', 'void', box(0.0, 0.07, 0.062, 0.084, -rx - 0.0004, -rx + 0.0004))
  b.add('body', 'blued', prof([[-0.004, 0.056], [0.074, 0.056], [0.074, 0.061], [-0.004, 0.061]], 0.012, { x: -rx - 0.005, r: 0.0015, bevel: 0.0005 }))
  for (const [f, y] of [[-0.13, 0.02], [-0.13, 0.06], [0.11, 0.02], [0.17, 0.06], [0.19, 0.06], [-0.05, 0.03]] as const) {
    b.add('body', 'steel', pin('x', 0.0021, rx * 2 + 0.0012, 0, y, f, 10))
  }
  // charging handle slot (right, low)
  b.add('body', 'void', box(0.05, 0.135, 0.031, 0.039, rx - 0.0004, rx + 0.0003))
  // ── Trigger group, compact guard, trigger
  b.add('body', 'blued', prof([[-0.115, 0.004], [0.022, 0.004], [0.022, -0.006, 0.002], [-0.115, -0.004]], 0.03, { r: 0.002, bevel: 0.001 }))
  triggerGuard(b, 'body', 'blued', -0.03, 0.022, -0.004, -0.046, 0.0065)
  b.add('body', 'blued', prof(strip((t) => [0.0 - 0.008 * t * t, -0.004 - 0.028 * t], () => 0.0055, 6), 0.006, { r: 0.0012, bevel: 0.0004 }))
  b.add('body', 'steel', pin('x', 0.0042, 0.034, 0, -0.0, -0.06, 14)) // cross-bolt safety
  // ── Wooden pistol grip
  b.add('body', 'wood', prof([[-0.072, 0.0], [-0.03, 0.0], [-0.036, -0.03, 0.01], [-0.052, -0.1, 0.01], [-0.062, -0.12, 0.006], [-0.096, -0.122, 0.006], [-0.094, -0.07, 0.012], [-0.082, -0.02, 0.01]], 0.031, { r: 0.004, bevel: 0.003 }))
  // ── Club-like wooden stock, steel tang + buttplate with trap door
  b.add('body', 'blued', prof([[-0.168, 0.004], [-0.148, 0.004], [-0.148, 0.086], [-0.168, 0.086]], 0.038, { r: 0.002, bevel: 0.001 }))
  b.add('body', 'wood', prof([[-0.164, 0.086], [-0.25, 0.078, 0.03], [-0.42, 0.064, 0.01], [-0.43, 0.058, 0.004], [-0.43, -0.07, 0.004], [-0.42, -0.08, 0.01], [-0.33, -0.064, 0.04], [-0.22, -0.026, 0.05], [-0.164, 0.006, 0.01]], 0.042, { r: 0.004, bevel: 0.004 }))
  b.add('body', 'blued', prof([[-0.43, 0.065], [-0.442, 0.06], [-0.442, -0.076], [-0.43, -0.082]], 0.045, { r: 0.004, bevel: 0.0012 }))
  b.add('body', 'void', box(-0.4425, -0.4415, -0.042, 0.022, -0.012, 0.012))
  screwHead(b, 'body', 'steel', 0.0212, 0.03, -0.36, 0.0024)
  b.add('body', 'blued', loop(0.007, 0.0015, 0, -0.064, 0.34))
  // ── Barrel, gas cylinder + block, muzzle thread protector
  b.add('body', 'blued', lathe([[0.0, 0.2], [0.0118, 0.2], [0.0118, 0.23], [0.0098, 0.24], [0.0092, 0.785], [0.0, 0.785]], 0, BY, 18))
  b.add('body', 'blued', lathe([[0.0, 0.77], [0.0112, 0.77], [0.0112, 0.798], [0.0104, 0.802], [0.0, 0.802]], 0, BY, 18))
  b.add('body', 'void', cyl(0.0052, 0.0052, 0.8015, 0.8025, 0, BY, 12))
  b.add('body', 'blued', lathe([[0.0, 0.2], [0.0085, 0.2], [0.0085, 0.5], [0.0, 0.5]], 0, GY, 14))
  b.add('body', 'blued', prof([[0.49, GY - 0.011], [0.53, GY - 0.011], [0.53, BY + 0.012, 0.004], [0.49, BY + 0.012, 0.004]], 0.024, { r: 0.003, bevel: 0.0012 }))
  b.add('body', 'steel', pin('x', 0.0052, 0.03, 0, GY, 0.51, 14)) // gas regulator
  // ── Wooden handguard wrapping the gas cylinder, steel retaining bands
  const hgSec = halfSec([[0.008, 0.014], [0.018, 0.02], [0.021, 0.034], [0.021, 0.054], [0.015, 0.062]])
  b.add('body', 'wood', xsec(hgSec, 0.215, 0.39, 0.003, 0.004))
  for (let i = 0; i < 3; i++) {
    const f = 0.25 + i * 0.045
    b.add('body', 'void', box(f, f + 0.012, 0.026, 0.046, 0.0208, 0.0214))
    b.add('body', 'void', box(f, f + 0.012, 0.026, 0.046, -0.0214, -0.0208))
  }
  for (const f of [0.205, 0.39]) b.add('body', 'blued', xsec(halfSec([[0.009, 0.012], [0.022, 0.018], [0.022, 0.058], [0.016, 0.066]]), f, f + 0.012, 0.0006, 0.002))
  // ── Bipod: clamp near the muzzle, legs folded back under the barrel
  b.add('body', 'blued', tube(0.0135, 0.0092, 0.61, 0.636, 0, BY, 20))
  b.add('body', 'blued', rbox(0.612, 0.634, BY - 0.028, BY - 0.01, 0.03, 0, 0.002, 0.0008))
  for (const s of [1, -1]) {
    b.add('body', 'blued', rod([s * 0.012, BY - 0.022, -0.62], [s * 0.012, BY - 0.02, -0.405], 0.0042))
    b.add('body', 'blued', flat(new SphereGeometry(0.006, 10, 8).scale(1, 0.7, 1.6).translate(s * 0.012, BY - 0.02, -0.4)))
  }
  b.add('body', 'blued', rbox(0.42, 0.432, BY - 0.028, BY - 0.012, 0.032, 0, 0.0015, 0.0006)) // leg catch
  // ── Front sight: post between protective wings
  b.add('body', 'blued', prof([[0.705, BY - 0.012], [0.735, BY - 0.012], [0.735, BY + 0.014, 0.004], [0.705, BY + 0.014, 0.004]], 0.022, { r: 0.002, bevel: 0.001 }))
  b.add('body', 'steel', rbox(0.718, 0.722, BY + 0.012, SY, 0.0028, 0, 0.0005, 0.0002))
  for (const s of [1, -1]) {
    b.add('body', 'blued', prof([[0.708, BY + 0.01], [0.732, BY + 0.01], [0.728, SY + 0.006, 0.003], [0.712, SY + 0.006, 0.003]], 0.0028, { x: s * 0.011, r: 0.0015, bevel: 0.0004 }))
  }
  // ── Rear tangent sight on the trunnion (U notch on the sight line)
  b.add('body', 'blued', prof([[0.14, 0.088], [0.14, 0.1, 0.003], [0.2, 0.104, 0.003], [0.21, 0.094], [0.21, 0.088]], 0.03, { r: 0.002, bevel: 0.001 }))
  b.add('body', 'blued', prof([[0.138, 0.101], [0.19, 0.104], [0.192, 0.11], [0.138, 0.108]], 0.019, { r: 0.0015, bevel: 0.0005 })) // leaf
  b.add('body', 'blued', prof([[0.172, 0.108], [0.184, 0.108], [0.184, 0.112], [0.172, 0.112]], 0.022, { r: 0.0012, bevel: 0.0004 })) // slider
  b.add('body', 'blued', rbox(0.16, 0.166, 0.106, SY - 0.0045, 0.017, 0, 0.0008, 0.0003))
  b.add('body', 'blued', rbox(0.16, 0.166, 0.106, SY + 0.0005, 0.006, -0.0055, 0.0008, 0.0003))
  b.add('body', 'blued', rbox(0.16, 0.166, 0.106, SY + 0.0005, 0.006, 0.0055, 0.0008, 0.0003))
  // ── Drum belt container + the belt running up into the feed (all one 'mag' part)
  const DF = 0.1
  const DY = -0.072
  const DR = 0.068
  b.add('mag', 'metal', pin('x', DR, 0.062, 0, DY, DF, 40))
  for (const s of [1, -1]) {
    b.add('mag', 'metal', pin('x', DR + 0.0015, 0.004, s * 0.03, DY, DF, 40)) // rolled rims
    b.add('mag', 'blued', pin('x', 0.018, 0.004, s * 0.032, DY, DF, 20)) // centre boss
    b.add('mag', 'metal', flat(new TorusGeometry(0.046, 0.0018, 6, 40).rotateY(Math.PI / 2).translate(s * 0.031, DY, -DF))) // pressed ring
  }
  b.add('mag', 'metal', rbox(DF - 0.048, DF - 0.004, DY + DR - 0.012, -0.002, 0.05, 0, 0.003, 0.001)) // feed neck
  b.add('mag', 'blued', rbox(DF + 0.058, DF + 0.072, -0.03, 0.002, 0.02, 0, 0.002, 0.0006)) // mounting hook
  b.add('mag', 'steel', pin('x', 0.006, 0.006, -0.034, DY + 0.034, DF + 0.03, 12)) // lid latch
  for (let i = 0; i < 5; i++) {
    const t = i / 4
    const x = -0.03 + t * 0.006
    const y = 0.0 + t * 0.068
    const f = 0.03 - t * 0.012
    b.add('mag', 'brass', lathe([[0.0, f], [0.0055, f], [0.0055, f + 0.032], [0.0045, f + 0.038], [0.004, f + 0.042], [0.0015, f + 0.056], [0.0, f + 0.057]], x, y, 10))
    b.add('mag', 'blued', tube(0.0064, 0.0055, f + 0.008, f + 0.02, x, y, 10)) // link
  }

  // ── Charging handle (right)
  b.add('charge', 'steel', rbox(0.06, 0.13, 0.031, 0.039, 0.004, rx + 0.002, 0.0015, 0.0005))
  b.add('charge', 'steel', lathe([[0.0, 0.0], [0.0045, 0.0], [0.0055, 0.014], [0.005, 0.02], [0.0, 0.02]], 0, 0, 12).rotateY(-Math.PI / 2).translate(rx + 0.004, 0.035, -0.12))

  const meta: RigMeta = {
    type: 'rifle',
    grip: [0, -0.055, 0.075],
    muzzle: [0, BY, -0.802],
    eject: [0.004, -0.004, -0.026],
    ejectDir: [0.35, -1, 0.15],
    sight: [0, SY, -0.163],
    relief: 0.34,
    hipPos: [0.12, -0.205, -0.43],
    hipRot: [0.02, 0.1, 0.06],
    rh: { p: [0.027, -0.05, 0.075], r: [-0.25, 0, -1.5708], grip: [0.5, 0.45, 0.86, 0.86, 0.84] },
    lh: { p: [-0.012, -0.002, -0.3], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, 0.0, -DF],
    magDir: [0, -1, 0],
    magHold: { p: [-0.046, DY - 0.01, -DF], r: [0.0, -1.3, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [0.045, 0.035, -0.12], r: [0.0, 0.0, -1.57], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
    chargeTravel: 0.075,
    flashScale: 1.15,
  }
  return { b, meta }
}

// ─── RPG-7 ───────────────────────────────────────────────────────────────────
// Steel launch tube with two-piece wooden heat shields, trigger group + grip
// under the middle, flared venturi / blast cone at the rear, folding iron
// sights and optic mount on the left, PG-7V warhead loaded in the muzzle.
// The warhead is the 'mag' part: it is spent on firing and re-inserted forward.

export function buildRPG7(): ModelSpec {
  const b = new Builder()
  const TY = 0.032 // tube axis
  const TR = 0.0205 // tube radius (40 mm)
  const SX = -0.03 // sights sit up and to the left of the tube
  const SY = TY + 0.058
  // ── Launch tube, muzzle reinforcement ring
  b.add('body', 'metal', lathe([[0.0, -0.42], [TR, -0.42], [TR, 0.33], [0.0, 0.33]], 0, TY, 28))
  b.add('body', 'blued', tube(0.0235, 0.0175, 0.298, 0.333, 0, TY, 28))
  b.add('body', 'void', cyl(0.0175, 0.0175, 0.3325, 0.3335, 0, TY, 24))
  // ── Venturi chamber + flared blast cone
  b.add('body', 'blued', lathe([[0.0, -0.5], [0.022, -0.5], [0.027, -0.488], [0.027, -0.432], [TR, -0.42], [0.0, -0.42]], 0, TY, 28))
  b.add('body', 'blued', lathe([[0.042, -0.64], [0.0465, -0.64], [0.024, -0.5], [0.019, -0.5], [0.042, -0.64]], 0, TY, 32))
  b.add('body', 'void', cyl(0.019, 0.019, -0.501, -0.5, 0, TY, 24))
  b.add('body', 'blued', tube(0.0475, 0.0435, -0.645, -0.632, 0, TY, 32)) // rim
  // ── Wooden heat shields (rear + front of the grip), steel bands
  b.add('body', 'wood', lathe([[0.0, -0.245], [0.026, -0.245], [0.031, -0.235], [0.031, -0.07], [0.026, -0.064], [0.0, -0.064]], 0, TY, 28))
  b.add('body', 'wood', lathe([[0.0, -0.05], [0.026, -0.05], [0.031, -0.044], [0.031, 0.1], [0.026, 0.11], [0.0, 0.11]], 0, TY, 28))
  for (const f of [-0.25, -0.057, 0.112]) b.add('body', 'blued', cyl(0.0325, 0.0325, f - 0.006, f + 0.006, 0, TY, 28))
  for (const f of [-0.2, -0.11, 0.0, 0.07]) {
    screwHead(b, 'body', 'steel', 0.031, TY, f, 0.0022, false)
    screwHead(b, 'body', 'steel', -0.031, TY, f, 0.0022, false)
  }
  // ── Trigger group housing, guard, trigger, hammer, safety
  b.add('body', 'blued', prof([[-0.112, 0.006], [0.062, 0.006], [0.062, -0.004, 0.003], [0.05, -0.008], [-0.112, -0.006, 0.003]], 0.028, { r: 0.002, bevel: 0.001 }))
  triggerGuard(b, 'body', 'blued', -0.012, 0.05, -0.004, -0.046, 0.0065)
  b.add('body', 'blued', prof(strip((t) => [0.022 - 0.008 * t * t, -0.004 - 0.028 * t], () => 0.0055, 6), 0.006, { r: 0.0012, bevel: 0.0004 }))
  b.add('body', 'steel', pin('x', 0.0038, 0.034, 0, -0.0, -0.02, 14)) // safety button
  b.add('body', 'blued', prof([[-0.122, 0.0], [-0.108, 0.002], [-0.108, 0.014], [-0.118, 0.018, 0.003], [-0.126, 0.008, 0.003]], 0.01, { r: 0.002, bevel: 0.0006 })) // hammer
  // ── Bakelite pistol grip
  b.add('body', 'poly', prof([[-0.072, 0.0], [-0.026, 0.0], [-0.032, -0.03, 0.01], [-0.05, -0.1, 0.01], [-0.06, -0.122, 0.006], [-0.096, -0.124, 0.006], [-0.094, -0.07, 0.012], [-0.082, -0.02, 0.01]], 0.031, { r: 0.004, bevel: 0.003 }))
  for (let i = 0; i < 6; i++) {
    const y = -0.03 - i * 0.013
    b.add('body', 'void', box(-0.088 + i * 0.002, -0.05 + i * 0.002, y, y + 0.0035, 0.0154, 0.016))
    b.add('body', 'void', box(-0.088 + i * 0.002, -0.05 + i * 0.002, y, y + 0.0035, -0.016, -0.0154))
  }
  // ── Optic mounting plate (left), sling swivels
  b.add('body', 'blued', prof([[-0.11, TY - 0.012], [-0.06, TY - 0.012], [-0.06, TY + 0.014], [-0.11, TY + 0.014]], 0.004, { x: -0.033, r: 0.002, bevel: 0.0006 }))
  for (const f of [-0.1, -0.07]) screwHead(b, 'body', 'steel', -0.035, TY, f, 0.0026)
  b.add('body', 'blued', loop(0.008, 0.0016, 0, TY - TR - 0.008, -0.25))
  b.add('body', 'blued', loop(0.008, 0.0016, 0, TY - 0.027 - 0.008, 0.46))
  // ── Front sight: folding post between wings on a left bracket
  b.add('body', 'blued', rbox(0.19, 0.212, TY + 0.008, TY + 0.03, 0.026, -0.019, 0.002, 0.0008))
  b.add('body', 'steel', prof([[0.197, TY + 0.028], [0.205, TY + 0.028], [0.204, SY, 0.001], [0.198, SY, 0.001]], 0.003, { x: SX, r: 0.0008, bevel: 0.0003 }))
  for (const s of [1, -1]) {
    b.add('body', 'blued', prof([[0.193, TY + 0.028], [0.209, TY + 0.028], [0.206, SY + 0.005, 0.002], [0.196, SY + 0.005, 0.002]], 0.0026, { x: SX + s * 0.0072, r: 0.0012, bevel: 0.0004 }))
  }
  // ── Rear sight: leaf with U notch + range drum on a left bracket
  b.add('body', 'blued', rbox(-0.042, 0.008, TY + 0.008, TY + 0.03, 0.026, -0.019, 0.002, 0.0008))
  b.add('body', 'blued', rbox(-0.018, -0.012, TY + 0.028, SY - 0.0045, 0.016, SX, 0.0008, 0.0003))
  b.add('body', 'blued', rbox(-0.018, -0.012, TY + 0.028, SY + 0.0005, 0.005, SX - 0.0052, 0.0008, 0.0003))
  b.add('body', 'blued', rbox(-0.018, -0.012, TY + 0.028, SY + 0.0005, 0.005, SX + 0.0052, 0.0008, 0.0003))
  b.add('body', 'steel', pin('x', 0.0065, 0.008, SX - 0.014, TY + 0.022, -0.03, 16))
  // ── PG-7V warhead (loaded): rocket neck, olive body, ogive, piezo fuze
  b.add('mag', 'steel', lathe([[0.0, 0.31], [0.0192, 0.31], [0.0192, 0.358], [0.0, 0.358]], 0, TY, 24))
  b.add('mag', 'grenade', lathe([[0.0, 0.355], [0.0195, 0.355], [0.0425, 0.415], [0.0425, 0.458], [0.036, 0.5], [0.013, 0.62], [0.0, 0.62]], 0, TY, 32))
  b.add('mag', 'blued', cyl(0.0429, 0.0429, 0.438, 0.446, 0, TY, 32)) // marking band
  b.add('mag', 'metal', lathe([[0.0, 0.618], [0.0128, 0.618], [0.0116, 0.652], [0.0082, 0.664], [0.0, 0.668]], 0, TY, 20))
  b.pivot('mag', 0, TY, -0.33)

  const meta: RigMeta = {
    type: 'launcher',
    grip: [0, -0.055, 0.075],
    muzzle: [0, TY, -0.335],
    eject: [0, TY, 0.6],
    ejectDir: [0, 0, 1],
    sight: [SX, SY, 0.015],
    relief: 0.28,
    hipPos: [0.12, -0.205, -0.43],
    hipRot: [0.02, 0.1, 0.06],
    rh: { p: [0.027, -0.05, 0.075], r: [-0.25, 0, -1.5708], grip: [0.5, 0.45, 0.86, 0.86, 0.84] },
    lh: { p: [-0.012, TY - TR - 0.016, -0.2], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, TY, -0.33],
    magDir: [0, -0.15, -1],
    magHold: { p: [-0.012, TY - 0.0425 - 0.016, -0.43], r: [0.0, -1.2, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    magSpent: true,
    flashScale: 1.8,
  }
  return { b, meta }
}

// ─── AA-12 ───────────────────────────────────────────────────────────────────
// Automatic box-fed 12 ga: tall steel receiver with an in-line fixed stock,
// raised top rail bridged over the receiver on two posts (charging handle
// lives under it on the left), vented barrel shroud, chunky 8-round box mag.

export function buildAA12(): ModelSpec {
  const b = new Builder()
  const BY = 0.074
  const SY = 0.158
  // ── Receiver
  b.add('body', 'metal', xsec(halfSec([[0.021, 0.012], [0.023, 0.018], [0.023, 0.092], [0.019, 0.1], [0.012, 0.103]]), -0.13, 0.255, 0.0014, 0.002))
  b.add('body', 'void', box(0.06, 0.145, 0.062, 0.088, 0.0228, 0.0236)) // ejection port (right)
  b.add('body', 'steel', rbox(0.065, 0.14, 0.066, 0.084, 0.044, 0, 0.002, 0.0005)) // bolt face
  b.add('body', 'void', box(0.05, 0.19, 0.096, 0.1, -0.02, -0.008)) // charging handle slot (top left)
  for (const s of [1, -1]) b.add('body', 'void', box(-0.12, 0.245, 0.04, 0.0408, s > 0 ? 0.0226 : -0.0232, s > 0 ? 0.0232 : -0.0226))
  for (const f of [-0.11, 0.0, 0.2]) crossPin(b, 'body', 'steel', 0.023, 0.03, f, 0.0024)
  // ── Bridged top rail: rear + front posts, flat bar, rail on top
  b.add('body', 'metal', prof([[-0.09, 0.1], [-0.035, 0.1], [-0.04, 0.124], [-0.095, 0.124]], 0.03, { r: 0.003, bevel: 0.0012 }))
  b.add('body', 'metal', prof([[0.255, 0.094], [0.31, 0.094], [0.315, 0.124], [0.262, 0.124]], 0.03, { r: 0.003, bevel: 0.0012 }))
  b.add('body', 'metal', prof([[-0.098, 0.122], [0.322, 0.122], [0.322, 0.13], [-0.098, 0.13]], 0.03, { r: 0.002, bevel: 0.001 }))
  rail1913(b, 'body', 'metal', -0.096, 0.32, 0.1395, 0, 0.0212)
  // ── Sights on the rail: rear aperture, front post between wings
  b.add('body', 'metal', rbox(-0.082, -0.052, 0.138, 0.146, 0.024, 0, 0.002, 0.0008))
  b.add('body', 'blued', tube(0.0068, 0.0035, -0.072, -0.062, 0, SY, 20))
  b.add('body', 'blued', rbox(-0.072, -0.062, 0.145, SY - 0.006, 0.01, 0, 0.001, 0.0004))
  for (const s of [1, -1]) b.add('body', 'blued', prof([[-0.078, 0.144], [-0.056, 0.144], [-0.058, SY + 0.012, 0.002], [-0.076, SY + 0.012, 0.002]], 0.0025, { x: s * 0.0125, r: 0.0015, bevel: 0.0004 }))
  b.add('body', 'metal', rbox(0.29, 0.316, 0.138, 0.146, 0.02, 0, 0.002, 0.0008))
  b.add('body', 'steel', rbox(0.3015, 0.3045, 0.144, SY, 0.0026, 0, 0.0005, 0.0002))
  for (const s of [1, -1]) b.add('body', 'blued', prof([[0.292, 0.144], [0.314, 0.144], [0.31, SY + 0.006, 0.002], [0.296, SY + 0.006, 0.002]], 0.0025, { x: s * 0.01, r: 0.0015, bevel: 0.0004 }))
  // ── Lower: trigger housing, magwell, integral guard, trigger, selector
  b.add('body', 'poly', prof([[-0.13, 0.016], [0.15, 0.016], [0.15, -0.014, 0.004], [0.05, -0.014], [0.046, 0.002], [-0.13, 0.004]], 0.05, { r: 0.003, bevel: 0.0016 }))
  b.add('body', 'poly', prof([[-0.016, 0.004], [0.05, 0.004], [0.05, -0.034], [0.03, -0.056, 0.008], [-0.012, -0.056, 0.008], [-0.026, -0.04, 0.006]], 0.008, { r: 0.002, bevel: 0.0008, holes: [[[-0.008, -0.002], [0.042, -0.002], [0.042, -0.03], [0.026, -0.048, 0.006], [-0.006, -0.048, 0.006], [-0.016, -0.036, 0.006]]] }))
  b.add('body', 'blued', prof(strip((t) => [0.022 - 0.008 * t * t, 0.003 - 0.03 * t], () => 0.0055, 6), 0.006, { r: 0.0012, bevel: 0.0004 }))
  b.add('body', 'blued', pin('x', 0.0052, 0.052, 0, 0.026, -0.045, 14))
  b.add('body', 'blued', prof([[-0.06, 0.018], [-0.044, 0.02, 0.003], [-0.044, 0.03, 0.003], [-0.058, 0.028]], 0.0022, { x: -0.0244, r: 0.002, bevel: 0.0004 }))
  b.add('body', 'blued', prof([[0.142, -0.01], [0.158, -0.008], [0.16, -0.026, 0.002], [0.146, -0.028, 0.002]], 0.026, { r: 0.002, bevel: 0.0006 })) // mag release
  b.add('body', 'poly', prof([[-0.075, 0.004], [-0.014, 0.004], [-0.02, -0.03, 0.01], [-0.032, -0.108, 0.01], [-0.04, -0.118, 0.004], [-0.082, -0.116, 0.006], [-0.08, -0.06, 0.014], [-0.07, -0.02, 0.012]], 0.032, { r: 0.004, bevel: 0.003 }))
  for (let i = 0; i < 7; i++) {
    const y = -0.034 - i * 0.01
    b.add('body', 'void', box(-0.076 + i * 0.0015, -0.064 + i * 0.0015, y, y + 0.0035, 0.0159, 0.0165))
    b.add('body', 'void', box(-0.076 + i * 0.0015, -0.064 + i * 0.0015, y, y + 0.0035, -0.0165, -0.0159))
  }
  // ── In-line fixed stock with cheek rest + recoil pad
  b.add('body', 'poly', prof([[-0.13, 0.102], [-0.4, 0.1, 0.01], [-0.41, 0.09], [-0.41, -0.05, 0.01], [-0.396, -0.058], [-0.27, -0.022, 0.02], [-0.17, 0.0, 0.01], [-0.13, 0.012]], 0.04, { r: 0.004, bevel: 0.003, holes: [[[-0.21, 0.07], [-0.35, 0.068, 0.008], [-0.36, 0.03, 0.008], [-0.3, 0.012, 0.01], [-0.22, 0.04, 0.01]]] }))
  b.add('body', 'poly', prof([[-0.18, 0.1], [-0.36, 0.098], [-0.36, 0.11, 0.006], [-0.19, 0.112, 0.006]], 0.034, { r: 0.004, round: 0.005 }))
  b.add('body', 'rubber', prof([[-0.408, 0.1], [-0.428, 0.096], [-0.43, -0.048], [-0.408, -0.06]], 0.044, { r: 0.004, bevel: 0.002 }))
  b.add('body', 'blued', loop(0.007, 0.0015, 0, -0.064, 0.38))
  // ── Vented barrel shroud, barrel, muzzle device
  b.add('body', 'metal', tube(0.0245, 0.02, 0.25, 0.5, 0, BY, 32))
  for (let i = 0; i < 6; i++) {
    const f = 0.27 + i * 0.037
    for (const a of [-1.0, -0.35, 0.35, 1.0]) b.add('body', 'void', box(f, f + 0.024, 0.024, 0.0252, -0.0035, 0.0035).rotateZ(a).translate(0, BY, 0))
  }
  b.add('body', 'blued', lathe([[0.0, 0.494], [0.0255, 0.494], [0.0255, 0.508], [0.016, 0.514], [0.0, 0.514]], 0, BY, 28))
  b.add('body', 'blued', lathe([[0.0, 0.25], [0.0125, 0.25], [0.0125, 0.55], [0.0, 0.55]], 0, BY, 20))
  b.add('body', 'blued', lathe([[0.0, 0.545], [0.0155, 0.545], [0.0155, 0.584], [0.014, 0.59], [0.0, 0.59]], 0, BY, 22))
  for (let i = 0; i < 6; i++) b.add('body', 'void', box(0.556, 0.58, 0.015, 0.016, -0.0018, 0.0018).rotateZ((i / 6) * Math.PI * 2).translate(0, BY, 0))
  b.add('body', 'void', cyl(0.0098, 0.0098, 0.5895, 0.5905, 0, BY, 18))
  // ── Fore-end under the shroud with finger ridges
  b.add('body', 'poly', prof([[0.25, 0.058], [0.45, 0.058], [0.456, 0.04, 0.006], [0.45, 0.014, 0.006], [0.43, 0.006], [0.27, 0.006], [0.25, 0.014]], 0.05, { r: 0.004, bevel: 0.003 }))
  for (let i = 0; i < 4; i++) {
    const f = 0.29 + i * 0.035
    b.add('body', 'void', box(f, f + 0.01, 0.014, 0.046, 0.0248, 0.0254))
    b.add('body', 'void', box(f, f + 0.01, 0.014, 0.046, -0.0254, -0.0248))
  }
  // ── 8-round box magazine with the top shell showing
  const magC = (t: number): [number, number] => [0.09 + 0.008 * t, 0.004 - 0.152 * t]
  b.add('mag', 'poly', prof(strip(magC, () => 0.082, 10), 0.044, { r: 0.004, round: 0.005 }))
  for (let i = 0; i < 4; i++) {
    const [f, y] = magC(0.3 + i * 0.16)
    b.add('mag', 'poly', prof([[f - 0.04, y], [f + 0.04, y], [f + 0.04, y + 0.006], [f - 0.04, y + 0.006]], 0.046, { r: 0.002, round: 0.002 }))
  }
  b.add('mag', 'poly', prof([[0.05, -0.144], [0.142, -0.144], [0.144, -0.16, 0.004], [0.048, -0.16, 0.004]], 0.05, { r: 0.003, round: 0.004 }))
  b.add('mag', 'polyTan', lathe([[0.0, 0.062], [0.0105, 0.062], [0.0105, 0.124], [0.0085, 0.128], [0.0, 0.128]], 0, 0.012, 16)) // hull
  b.add('mag', 'brass', lathe([[0.0, 0.05], [0.0112, 0.05], [0.0112, 0.054], [0.0106, 0.055], [0.0106, 0.064], [0.0, 0.064]], 0, 0.012, 16)) // head
  // ── Charging handle (top left, under the rail)
  b.add('charge', 'steel', rbox(0.15, 0.17, 0.098, 0.108, 0.01, -0.014, 0.0015, 0.0005))
  b.add('charge', 'poly', prof([[0.148, 0.098], [0.172, 0.098, 0.004], [0.172, 0.116, 0.004], [0.148, 0.116]], 0.012, { x: -0.028, r: 0.004, bevel: 0.0012 }))

  const meta: RigMeta = {
    type: 'rifle',
    grip: [0, -0.05, 0.06],
    muzzle: [0, BY, -0.59],
    eject: [0.024, 0.075, -0.1],
    ejectDir: [1, 0.4, 0.3],
    sight: [0, SY, 0.066],
    relief: 0.24,
    hipPos: [0.12, -0.205, -0.43],
    hipRot: [0.02, 0.1, 0.06],
    rh: { p: [0.032, -0.045, 0.062], r: [-0.2, 0, -1.5708], grip: [0.78, 0.45, 0.86, 0.88, 0.86] },
    lh: { p: [-0.012, -0.01, -0.35], r: [0.0, -1.2, 3.14], grip: [0.45, 0.72, 0.78, 0.8, 0.8] },
    magWell: [0, -0.014, -0.094],
    magDir: [0, -1, -0.05],
    magHold: { p: [-0.038, -0.09, -0.094], r: [0.0, -1.3, 3.14], grip: [0.4, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [-0.05, 0.107, -0.16], r: [0.0, 0.0, 1.5], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
    chargeTravel: 0.09,
    flashScale: 1.5,
  }
  return { b, meta }
}

// ─── G18 ─────────────────────────────────────────────────────────────────────
// Glock 18C: boxy slab-sided slide with a chamfered nose, compensator cuts on
// top, fire selector on the rear-left of the slide, polymer frame with a
// railed dust cover, finger-grooved grip, square guard, +2 extended magazine.

export function buildG18(): ModelSpec {
  const b = new Builder()
  const SY = 0.0715
  const BY = 0.047
  // ── Slide (moves)
  b.add('slide', 'blued', xsec(halfSec([[0.0124, 0.032], [0.0127, 0.035], [0.0127, 0.06], [0.0116, 0.0638], [0.009, 0.0645]]), -0.1, 0.07, 0.0012, 0.0012))
  b.add('slide', 'blued', xsec(halfSec([[0.011, 0.032], [0.0117, 0.035], [0.0117, 0.0585], [0.0104, 0.0625], [0.008, 0.0634]]), 0.069, 0.086, 0.001, 0.0012))
  for (let i = 0; i < 7; i++) {
    const f = -0.095 + i * 0.0046
    b.add('slide', 'void', box(f, f + 0.0018, 0.036, 0.059, 0.0121, 0.0129))
    b.add('slide', 'void', box(f, f + 0.0018, 0.036, 0.059, -0.0129, -0.0121))
  }
  b.add('slide', 'void', box(-0.022, 0.03, 0.048, 0.0645, 0.0112, 0.0129)) // ejection port
  b.add('slide', 'metal', rbox(-0.02, 0.028, 0.05, 0.0635, 0.019, 0, 0.002, 0.0006)) // barrel hood in the port
  b.add('slide', 'steel', prof([[-0.034, 0.053], [-0.014, 0.053], [-0.014, 0.0575], [-0.032, 0.0575]], 0.0014, { x: 0.0131, r: 0.0008, bevel: 0.0002 })) // extractor
  for (let i = 0; i < 4; i++) b.add('slide', 'void', box(0.036 + i * 0.0085, 0.041 + i * 0.0085, 0.0625, 0.0655, -0.0028, 0.0028)) // comp cuts
  // sights: U-notch rear (two ears), front post with a white dot
  b.add('slide', 'blued', prof([[-0.095, 0.0635], [-0.081, 0.0635], [-0.082, SY - 0.0035, 0.001], [-0.094, SY - 0.0035, 0.001]], 0.017, { r: 0.0008, bevel: 0.0004 }))
  for (const s of [1, -1]) b.add('slide', 'blued', prof([[-0.095, SY - 0.004], [-0.082, SY - 0.004], [-0.083, SY + 0.0005, 0.001], [-0.094, SY + 0.0005, 0.001]], 0.0064, { x: s * 0.0054, r: 0.0008, bevel: 0.0003 }))
  b.add('slide', 'chrome', pin('z', 0.0011, 0.0006, -0.0054, SY - 0.0016, -0.0948, 8))
  b.add('slide', 'chrome', pin('z', 0.0011, 0.0006, 0.0054, SY - 0.0016, -0.0948, 8))
  b.add('slide', 'blued', prof([[0.073, 0.0635], [0.081, 0.0635], [0.0805, SY, 0.001], [0.0735, SY, 0.001]], 0.0034, { r: 0.0008, bevel: 0.0003 }))
  b.add('slide', 'chrome', pin('z', 0.0011, 0.0006, 0, SY - 0.0026, 0.0727, 8))
  // fire selector (rear left of the slide)
  b.add('slide', 'metal', pin('x', 0.0034, 0.0024, -0.0136, 0.047, -0.088, 12))
  b.add('slide', 'metal', prof([[-0.097, 0.043], [-0.084, 0.045, 0.002], [-0.084, 0.05, 0.002], [-0.096, 0.05]], 0.0018, { x: -0.0144, r: 0.0015, bevel: 0.0003 }))
  // ── Barrel (fixed for the slide blowback) + bore
  b.add('body', 'metal', lathe([[0.0, 0.07], [0.0072, 0.07], [0.0072, 0.0866], [0.0, 0.0866]], 0, BY, 16))
  b.add('body', 'void', cyl(0.0048, 0.0048, 0.0862, 0.0872, 0, BY, 12))
  // ── Polymer frame: dust cover with accessory rail grooves, square guard
  b.add('body', 'poly', prof([[-0.104, 0.033], [0.086, 0.033], [0.086, 0.016, 0.004], [0.05, 0.013], [0.04, 0.009], [-0.104, 0.009]], 0.0215, { r: 0.003, bevel: 0.0012 }))
  for (const s of [1, -1]) b.add('body', 'void', box(0.044, 0.084, 0.0205, 0.0215, s > 0 ? 0.0102 : -0.0108, s > 0 ? 0.0108 : -0.0102))
  b.add('body', 'void', box(0.06, 0.066, 0.0128, 0.0136, -0.0109, 0.0109)) // rail cross-slot
  b.add('body', 'poly', prof([[-0.03, 0.012], [0.046, 0.012], [0.05, -0.012, 0.003], [0.046, -0.034, 0.004], [0.0, -0.034, 0.006], [-0.03, -0.018, 0.006]], 0.0105, { r: 0.002, bevel: 0.001, holes: [[[-0.022, 0.006], [0.039, 0.006], [0.042, -0.012, 0.003], [0.038, -0.027, 0.004], [-0.002, -0.027, 0.004], [-0.022, -0.015, 0.005]]] }))
  b.add('body', 'blued', prof(strip((t) => [0.012 - 0.006 * t * t, 0.01 - 0.026 * t], () => 0.0055, 6), 0.0058, { r: 0.0012, bevel: 0.0004 }))
  b.add('body', 'metal', rbox(0.006, 0.01, -0.012, 0.006, 0.0016, 0, 0.0006, 0.0002)) // trigger safety blade
  // ── Grip with finger grooves on the front strap + pebble texture
  b.add('body', 'poly', prof([[-0.1, 0.01], [-0.032, 0.01], [-0.036, -0.016, 0.004], [-0.043, -0.03, 0.006], [-0.04, -0.044, 0.004], [-0.049, -0.058, 0.006], [-0.046, -0.072, 0.004], [-0.054, -0.086, 0.006], [-0.056, -0.106, 0.004], [-0.062, -0.112, 0.003], [-0.098, -0.11, 0.006], [-0.102, -0.05, 0.016], [-0.1, -0.004, 0.006], [-0.106, 0.004, 0.004]], 0.0262, { r: 0.004, bevel: 0.0028 }))
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 4; c++) {
      const y = -0.02 - r * 0.0085
      const f = -0.092 + c * 0.0092 + r * 0.0012
      b.add('body', 'void', box(f, f + 0.0026, y, y + 0.0026, 0.0137, 0.0141))
      b.add('body', 'void', box(f, f + 0.0026, y, y + 0.0026, -0.0141, -0.0137))
    }
  }
  // controls: slide stop (left), takedown lever, mag catch
  b.add('body', 'metal', prof([[-0.026, 0.024], [0.0, 0.026, 0.002], [0.0, 0.03, 0.002], [-0.024, 0.03]], 0.0018, { x: -0.0118, r: 0.0015, bevel: 0.0003 }))
  for (const s of [1, -1]) b.add('body', 'metal', rbox(0.014, 0.02, 0.022, 0.03, 0.0018, s * 0.0114, 0.0006, 0.0002))
  b.add('body', 'metal', pin('x', 0.0034, 0.025, 0, -0.004, -0.036, 10))
  // ── Magazine (polymer-jacketed) + extended base pad
  b.add('mag', 'poly', rbox(-0.095, -0.056, -0.11, 0.03, 0.0205, 0, 0.004, 0.0008))
  b.add('mag', 'poly', prof([[-0.1, -0.108], [-0.052, -0.108], [-0.053, -0.136, 0.004], [-0.06, -0.142, 0.003], [-0.1, -0.14, 0.004]], 0.0262, { r: 0.002, bevel: 0.001 }))
  b.add('mag', 'brass', lathe([[0.0, 0.058], [0.0047, 0.058], [0.0047, 0.074], [0.0035, 0.08], [0.0, 0.081]], 0, 0.028, 12)) // top round

  const meta: RigMeta = {
    type: 'pistol',
    grip: [0, -0.05, 0.075],
    muzzle: [0, BY, -0.087],
    eject: [0.0132, 0.057, -0.004],
    ejectDir: [1, 0.7, 0.2],
    sight: [0, SY, 0.088],
    relief: 0.3,
    hipPos: [0.11, -0.085, -0.4],
    hipRot: [0.05, 0.08, 0.0],
    rh: { p: [0.024, -0.035, 0.078], r: [-0.25, 0, -1.5708], grip: [0.5, 0.35, 0.9, 0.9, 0.85] },
    lh: { p: [-0.026, -0.042, 0.07], r: [0.0, 1.5708, 0.0], grip: [0.55, 0.85, 0.85, 0.85, 0.85] },
    magWell: [0, -0.02, 0.076],
    magDir: [-0.2, -1, 0],
    magHold: { p: [-0.026, -0.1, 0.083], r: [0.0, 1.5708, 0.0], grip: [0.5, 0.8, 0.85, 0.85, 0.8] },
    chargeHold: { p: [-0.02, 0.07, 0.07], r: [0.0, 1.5708, 0.0], grip: [0.5, 0.5, 0.7, 0.7, 0.7] },
    travel: 0.032,
    flashScale: 0.8,
  }
  return { b, meta }
}
