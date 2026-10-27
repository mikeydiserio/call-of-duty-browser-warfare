/**
 * Game-mode objectives for Rust: Domination flags A/B/C, Search & Destroy bomb sites A/B and
 * the S&D bomb spawn. The flag and bomb-site props are separate named groups under the map root
 * so the game mode / UI / render can find, tint or hide them:
 *   map.root.getObjectByName('domflag_A' | 'domflag_B' | 'domflag_C')   → Group { pole, cloth }
 *   map.root.getObjectByName('bombsite_A' | 'bombsite_B')                → Group { sign_* meshes }
 * Each flag's `cloth` mesh has its own material (neutral off-white; tint `material.color`).
 */
import {
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ObjectiveId, Team } from '../../core/types'
import { ibeam, type Ctx } from './props'
import { groundY } from './terrain'
import { TOWER } from './tower'

export interface ObjectiveDef {
  id: ObjectiveId
  x: number
  z: number
  radius: number
  /** Approximate floor height used while building (refined from collision afterwards). */
  y: number
  ry: number
}

/** Domination: A on the TF141 (Loading Dock) side, B under the Tower, C on the OpFor (Front Gate) side. */
export const DOM_FLAGS: ObjectiveDef[] = [
  { id: 'A', x: -14.5, z: 19.5, radius: 4.5, y: groundY(-14.5, 19.5), ry: 0.4 },
  { id: 'B', x: 0.4, z: 0.6, radius: 5, y: TOWER.f0, ry: 0.2 },
  { id: 'C', x: 17.5, z: -15.5, radius: 4.5, y: groundY(17.5, -15.5), ry: -2.6 },
]

/** S&D: OpFor attack first from the Front Gate; TF141 defend from the Loading Dock side. */
export const SD_ATTACKERS_FIRST: Team = 'opfor'
const SHED_FLOOR = groundY(-26.5, -5.0) + 0.1
export const BOMB_SITES: ObjectiveDef[] = [
  // A: open yard east of the Control Room, cover from the generators' sandbags
  { id: 'A', x: 11.8, z: 24.4, radius: 3, y: groundY(11.8, 24.4), ry: 0.15 },
  // B: inside the Maintenance shed
  { id: 'B', x: -25.2, z: -6.4, radius: 3, y: SHED_FLOOR, ry: Math.PI / 2 },
]
/** Where the attackers' bomb starts (just inside the Front Gate, behind the OpFor spawns). */
export const BOMB_SPAWN = { x: 25.6, z: -31.0 }

// ─── textures ────────────────────────────────────────────────────────────

function letterTexture(letter: string, kind: 'flag' | 'sign') {
  const S = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const g = cv.getContext('2d')!
  if (kind === 'flag') {
    // off-white canvas cloth with a darker stitched hem and a large stencilled letter
    g.fillStyle = '#e8e4da'
    g.fillRect(0, 0, S, S)
    let seed = letter.charCodeAt(0) * 97
    for (let i = 0; i < 4000; i++) {
      seed = (seed * 16807) % 2147483647
      const x = seed % S
      seed = (seed * 16807) % 2147483647
      g.fillStyle = seed % 3 ? 'rgba(120,100,70,0.06)' : 'rgba(255,255,255,0.05)'
      g.fillRect(x, seed % S, 3, 2)
    }
    // dust gradient towards the free edge
    const gr = g.createLinearGradient(0, 0, S, 0)
    gr.addColorStop(0, 'rgba(110,90,60,0)')
    gr.addColorStop(1, 'rgba(110,90,60,0.22)')
    g.fillStyle = gr
    g.fillRect(0, 0, S, S)
    g.strokeStyle = 'rgba(70,64,54,0.5)'
    g.lineWidth = 6
    g.strokeRect(6, 6, S - 12, S - 12)
    g.fillStyle = 'rgba(40,38,34,0.85)'
  } else {
    g.clearRect(0, 0, S, S)
    g.fillStyle = 'rgba(232,226,212,0.92)'
  }
  g.font = `bold ${kind === 'flag' ? 170 : 200}px "Arial Black", Impact, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(letter, S / 2, S / 2 + 8)
  if (kind === 'sign') {
    // spray-paint overspray + a ring
    g.strokeStyle = 'rgba(232,226,212,0.85)'
    g.lineWidth = 14
    g.beginPath()
    g.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2)
    g.stroke()
    g.globalCompositeOperation = 'destination-out'
    let seed = letter.charCodeAt(0) * 131
    for (let i = 0; i < 900; i++) {
      seed = (seed * 16807) % 2147483647
      const x = seed % S
      seed = (seed * 16807) % 2147483647
      g.fillRect(x, seed % S, 4, 4)
    }
    g.globalCompositeOperation = 'source-over'
  }
  const t = new CanvasTexture(cv)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

// ─── props ───────────────────────────────────────────────────────────────

const POLE_H = 3.4
/** The tower's F1 deck underside is ~3.2 m over the pad, so flag B gets a shorter pole. */
const POLE_H_TOWER = 2.75

function flag(c: Ctx, root: Group, d: ObjectiveDef) {
  const b = c.b
  const h = d.id === 'B' ? POLE_H_TOWER : POLE_H
  // concrete footing (merged static geometry, collides)
  b.box('concreteDark', 0.5, 0.3, 0.5, d.x, d.y + 0.05, d.z)
  // pole collider
  b.colGeo(new CylinderGeometry(0.06, 0.06, h, 6), d.x, d.y + h / 2, d.z, 'metal')

  const grp = new Group()
  grp.name = `domflag_${d.id}`
  grp.position.set(d.x, d.y, d.z)
  grp.rotation.y = d.ry
  const poleMat = new MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.45, metalness: 0.8 })
  const pole = new Mesh(new CylinderGeometry(0.03, 0.04, h, 10), poleMat)
  pole.name = 'pole'
  pole.position.y = h / 2 + 0.2
  pole.castShadow = true
  grp.add(pole)
  const knob = new Mesh(new SphereGeometry(0.06, 10, 8), poleMat)
  knob.name = 'knob'
  knob.position.y = h + 0.24
  grp.add(knob)
  // cloth: 1.3 x 0.85, hung from the top of the pole, with a frozen wind ripple
  const W = 1.3
  const H = 0.85
  const cg = new PlaneGeometry(W, H, 16, 6)
  const p = cg.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const u = (p.getX(i) + W / 2) / W
    const v = (p.getY(i) + H / 2) / H
    p.setX(i, p.getX(i) + W / 2 + 0.04)
    p.setZ(i, Math.sin(u * 7.0 + v * 1.2) * 0.07 * u)
    p.setY(i, p.getY(i) - u * u * 0.12)
  }
  cg.computeVertexNormals()
  // Two-sided cloth whose back face shows the letter the right way round (DoubleSide would mirror it).
  const back = cg.clone()
  const bi = back.getIndex()!
  for (let i = 0; i < bi.count; i += 3) {
    const a = bi.getX(i + 1)
    bi.setX(i + 1, bi.getX(i + 2))
    bi.setX(i + 2, a)
  }
  const buv = back.getAttribute('uv')
  for (let i = 0; i < buv.count; i++) buv.setX(i, 1 - buv.getX(i))
  const bn = back.getAttribute('normal')
  for (let i = 0; i < bn.count; i++) bn.setXYZ(i, -bn.getX(i), -bn.getY(i), -bn.getZ(i))
  const clothGeo = mergeGeometries([cg, back], false)!
  cg.dispose()
  back.dispose()
  const clothMat = new MeshStandardMaterial({ map: letterTexture(d.id, 'flag'), color: 0xffffff, roughness: 0.95, metalness: 0 })
  const cloth = new Mesh(clothGeo, clothMat)
  cloth.name = 'cloth'
  cloth.position.y = h + 0.2 - H / 2 - 0.04
  cloth.castShadow = true
  grp.add(cloth)
  root.add(grp)
  c.fp.push({ x: d.x, z: d.z, w: 0.6, d: 0.6, ry: 0, kind: 'low' })
}

function bombSite(c: Ctx, root: Group, d: ObjectiveDef) {
  const b = c.b
  const W = 1.7
  const H = 1.35
  const D = 0.95
  // electrical target cabinet on a plinth (merged static geometry, collides)
  b.frame(d.x, d.y, d.z, d.ry, () => {
    b.box('concrete', W + 0.5, 0.2, D + 0.5, 0, 0.0, 0)
    b.box('panel', W, H, D, 0, 0.1 + H / 2, 0)
    b.box('panel', W + 0.08, 0.06, D + 0.08, 0, 0.1 + H + 0.03, 0, { col: false })
    b.box('redwhite', W + 0.02, 0.12, D + 0.02, 0, 0.32, 0, { col: false })
    for (const sx of [-0.42, 0.42]) {
      b.box('black', 0.03, 0.9, 0.02, sx, 0.75, D / 2 + 0.005, { col: false })
      b.box('rustDark', 0.05, 0.14, 0.05, sx * 0.9, 0.95, D / 2 + 0.03, { col: false })
    }
    b.box('lamp', 0.06, 0.06, 0.03, W / 2 - 0.15, H - 0.05, D / 2 + 0.01, { col: false })
    // conduit into the ground
    ibeam(b, 'rustDark', new Vector3(-W / 2 - 0.15, 0, 0), new Vector3(-W / 2 - 0.15, H - 0.1, 0), 0.08, 0.08, { col: false })
  })
  // painted letters on the front, back and top (separate meshes, own texture)
  const grp = new Group()
  grp.name = `bombsite_${d.id}`
  grp.position.set(d.x, d.y, d.z)
  grp.rotation.y = d.ry
  const mat = new MeshStandardMaterial({ map: letterTexture(d.id, 'sign'), transparent: true, alphaTest: 0.25, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 })
  const sign = new PlaneGeometry(0.9, 0.9)
  const front = new Mesh(sign, mat)
  front.name = 'sign_front'
  front.position.set(0, 0.1 + H * 0.55, D / 2 + 0.012)
  const back = new Mesh(sign, mat)
  back.name = 'sign_back'
  back.position.set(0, 0.1 + H * 0.55, -D / 2 - 0.012)
  back.rotation.y = Math.PI
  const top = new Mesh(new PlaneGeometry(0.8, 0.8), mat)
  top.name = 'sign_top'
  top.position.set(0, 0.1 + H + 0.065, 0)
  top.rotation.x = -Math.PI / 2
  for (const m of [front, back, top]) {
    m.receiveShadow = true
    grp.add(m)
  }
  root.add(grp)
  c.fp.push({ x: d.x, z: d.z, w: W, d: D, ry: d.ry, kind: 'low' })
}

export function buildObjectives(c: Ctx, root: Group) {
  for (const d of DOM_FLAGS) flag(c, root, d)
  for (const d of BOMB_SITES) bombSite(c, root, d)
}
