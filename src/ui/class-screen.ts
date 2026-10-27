import type { Loadout, PerkId, WeaponId } from '../core/types'
import { PRIMARIES, SECONDARIES, WEAPONS } from '../weapons/defs'
import { CLASS_LABEL, PERK_TIERS, PERKS, WEAPON_BLURB, weaponStats, type WeaponStats } from './data'
import { el, setClass } from './dom'
import { perkSvg, weaponSvg } from './icons'
import { keyHints, type Screen, type UiCtx } from './screen'

const LOADOUT_KEY = 'mw-rust-loadout'

type Slot = { kind: 'primary' } | { kind: 'secondary' } | { kind: 'perk'; tier: 0 | 1 | 2 }

const SLOTS: { slot: Slot; label: string }[] = [
  { slot: { kind: 'primary' }, label: 'PRIMARY WEAPON' },
  { slot: { kind: 'secondary' }, label: 'SECONDARY WEAPON' },
  { slot: { kind: 'perk', tier: 0 }, label: 'PERK 1' },
  { slot: { kind: 'perk', tier: 1 }, label: 'PERK 2' },
  { slot: { kind: 'perk', tier: 2 }, label: 'PERK 3' },
]

const STAT_ROWS: [keyof WeaponStats, string][] = [
  ['damage', 'DAMAGE'],
  ['accuracy', 'ACCURACY'],
  ['range', 'RANGE'],
  ['fireRate', 'FIRE RATE'],
  ['mobility', 'MOBILITY'],
]

export class ClassScreen implements Screen {
  readonly id = 'class' as const
  readonly el = el('section', 'screen s-class')
  private slotEls: HTMLElement[] = []
  private optsEl: HTMLElement
  private pvArt: HTMLElement
  private pvName: HTMLElement
  private pvType: HTMLElement
  private pvDesc: HTMLElement
  private pvStats: HTMLElement
  private statFill = new Map<keyof WeaponStats, { fill: HTMLElement; mark: HTMLElement; val: HTMLElement }>()
  private slotIdx = 0
  private optIdx = 0
  private focus: 'slots' | 'opts' = 'slots'
  private optIds: string[] = []

  constructor(private ctx: UiCtx) {
    const root = this.el
    const head = el('div', 'screen-head', root)
    el('div', 'menu-header', head, 'CREATE A CLASS')
    el('div', 'menu-sub', head, 'CUSTOM CLASS 1')
    el('div', 'menu-header-line', head)

    const cols = el('div', 'cac-cols', root)
    const left = el('div', 'cac-slots', cols)
    SLOTS.forEach((s, i) => {
      const b = el('button', 'cac-slot', left)
      b.type = 'button'
      b.innerHTML = `<span class="cs-label">${s.label}</span><span class="cs-name"></span><span class="cs-ico"></span>`
      b.addEventListener('mouseenter', () => this.selectSlot(i, true))
      b.addEventListener('click', () => {
        this.ctx.sfx('select')
        this.selectSlot(i, true)
        this.setFocus('opts')
      })
      this.slotEls.push(b)
    })

    const mid = el('div', 'cac-preview panel', cols)
    this.pvArt = el('div', 'pv-art', mid)
    this.pvType = el('div', 'pv-type', mid)
    this.pvName = el('div', 'pv-name', mid)
    this.pvDesc = el('p', 'pv-desc', mid)
    this.pvStats = el('div', 'pv-stats', mid)
    for (const [key, label] of STAT_ROWS) {
      const r = el('div', 'stat', this.pvStats)
      el('span', 'stat-l', r, label)
      const bar = el('div', 'stat-bar', r)
      const fill = el('i', 'stat-fill', bar)
      const mark = el('b', 'stat-mark', bar)
      const val = el('span', 'stat-v', r)
      this.statFill.set(key, { fill, mark, val })
    }

    this.optsEl = el('div', 'cac-opts panel', cols)

    keyHints(root, [
      ['↑ ↓', 'SELECT'],
      ['→ / ENTER', 'CHOOSE'],
      ['←', 'BACK TO SLOTS'],
      ['ESC', 'DONE'],
    ])
    const back = el('button', 'btn-back', root, 'BACK')
    back.type = 'button'
    back.addEventListener('mouseenter', () => this.ctx.sfx('hover'))
    back.addEventListener('click', () => {
      this.ctx.sfx('back')
      this.ctx.pop()
    })
  }

  private get loadout(): Loadout {
    return this.ctx.game.loadout
  }

  private slotValue(i: number): string {
    const s = SLOTS[i]!.slot
    const l = this.loadout
    if (s.kind === 'primary') return l.primary
    if (s.kind === 'secondary') return l.secondary
    return l.perks[s.tier] ?? PERK_TIERS[s.tier]![0]!
  }

  private optionsFor(i: number): string[] {
    const s = SLOTS[i]!.slot
    if (s.kind === 'primary') return PRIMARIES
    if (s.kind === 'secondary') return SECONDARIES
    return PERK_TIERS[s.tier]!
  }

  enter() {
    this.focus = 'slots'
    this.slotIdx = 0
    this.refreshSlots()
    this.selectSlot(0, false)
  }

  leave() {
    try {
      localStorage.setItem(LOADOUT_KEY, JSON.stringify(this.loadout))
    } catch {
      /* ignore */
    }
  }

  private setFocus(f: 'slots' | 'opts') {
    this.focus = f
    setClass(this.el, 'focus-opts', f === 'opts')
    this.paintOpts()
  }

  private refreshSlots() {
    SLOTS.forEach((s, i) => {
      const v = this.slotValue(i)
      const e = this.slotEls[i]!
      const name = e.querySelector('.cs-name')!
      const ico = e.querySelector('.cs-ico')!
      if (s.slot.kind === 'perk') {
        name.textContent = PERKS[v as PerkId].name.toUpperCase()
        ico.innerHTML = perkSvg(v as PerkId)
      } else {
        name.textContent = WEAPONS[v as WeaponId].name.toUpperCase()
        ico.innerHTML = weaponSvg(v as WeaponId)
      }
      setClass(e, 'sel', i === this.slotIdx)
    })
  }

  private selectSlot(i: number, sound: boolean) {
    if (sound && i !== this.slotIdx) this.ctx.sfx('hover')
    this.slotIdx = i
    this.optIds = this.optionsFor(i)
    this.optIdx = Math.max(0, this.optIds.indexOf(this.slotValue(i)))
    this.slotEls.forEach((e, k) => setClass(e, 'sel', k === i))
    this.buildOpts()
    this.preview(this.optIds[this.optIdx]!)
  }

  private buildOpts() {
    const o = this.optsEl
    o.textContent = ''
    const s = SLOTS[this.slotIdx]!
    el('div', 'panel-title', o, s.slot.kind === 'perk' ? `TIER ${s.slot.tier + 1} PERK` : s.label)
    this.optIds.forEach((id, i) => {
      const b = el('button', 'opt', o)
      b.type = 'button'
      if (s.slot.kind === 'perk') {
        const p = PERKS[id as PerkId]
        b.innerHTML = `<span class="o-ico">${perkSvg(p.id)}</span><span class="o-txt"><span class="o-name">${p.name.toUpperCase()}</span><span class="o-sub">${p.desc}</span></span><span class="o-tick"></span>`
      } else {
        const w = WEAPONS[id as WeaponId]
        b.innerHTML = `<span class="o-ico wide">${weaponSvg(w.id)}</span><span class="o-txt"><span class="o-name">${w.name.toUpperCase()}</span><span class="o-sub">${CLASS_LABEL[w.class] ?? ''}</span></span><span class="o-tick"></span>`
      }
      b.addEventListener('mouseenter', () => {
        if (this.optIdx !== i) this.ctx.sfx('hover')
        this.optIdx = i
        this.setFocus('opts')
        this.preview(id)
      })
      b.addEventListener('click', () => this.equip(i))
    })
    this.paintOpts()
  }

  private paintOpts() {
    const cur = this.slotValue(this.slotIdx)
    const opts = this.optsEl.querySelectorAll('.opt')
    opts.forEach((b, i) => {
      setClass(b, 'sel', this.focus === 'opts' && i === this.optIdx)
      setClass(b, 'equipped', this.optIds[i] === cur)
    })
  }

  private equip(i: number) {
    const id = this.optIds[i]
    if (!id) return
    this.ctx.sfx('select')
    const s = SLOTS[this.slotIdx]!.slot
    const l = this.loadout
    if (s.kind === 'primary') l.primary = id as WeaponId
    else if (s.kind === 'secondary') l.secondary = id as WeaponId
    else {
      const perks = l.perks.slice()
      perks[s.tier] = id as PerkId
      l.perks = perks
    }
    this.optIdx = i
    this.refreshSlots()
    this.paintOpts()
    this.preview(id)
  }

  private preview(id: string) {
    const isPerk = id in PERKS
    setClass(this.el, 'perk-view', isPerk)
    if (isPerk) {
      const p = PERKS[id as PerkId]
      this.pvArt.innerHTML = perkSvg(p.id, 'big')
      this.pvType.textContent = `TIER ${p.tier} PERK`
      this.pvName.textContent = p.name.toUpperCase()
      this.pvDesc.textContent = p.desc
      return
    }
    const w = WEAPONS[id as WeaponId]
    this.pvArt.innerHTML = weaponSvg(w.id, 'big')
    this.pvType.textContent = CLASS_LABEL[w.class] ?? ''
    this.pvName.textContent = w.name.toUpperCase()
    this.pvDesc.textContent = WEAPON_BLURB[w.id] ?? ''
    const st = weaponStats(w)
    const eq = weaponStats(WEAPONS[this.slotValue(this.slotIdx) as WeaponId] ?? w)
    for (const [key] of STAT_ROWS) {
      const r = this.statFill.get(key)!
      r.fill.style.transform = `scaleX(${st[key] / 100})`
      r.mark.style.left = `${eq[key]}%`
      r.val.textContent = String(Math.round(st[key]))
    }
  }

  key(e: KeyboardEvent) {
    const down = e.code === 'ArrowDown' || e.code === 'KeyS'
    const up = e.code === 'ArrowUp' || e.code === 'KeyW'
    if (this.focus === 'slots') {
      if (down) this.selectSlot((this.slotIdx + 1) % SLOTS.length, true)
      else if (up) this.selectSlot((this.slotIdx + SLOTS.length - 1) % SLOTS.length, true)
      else if (e.code === 'ArrowRight' || e.code === 'Enter' || e.code === 'Space') {
        this.ctx.sfx('select')
        this.setFocus('opts')
        this.preview(this.optIds[this.optIdx]!)
      } else if (e.code === 'Escape' || e.code === 'Backspace') {
        this.ctx.sfx('back')
        this.ctx.pop()
      }
      return
    }
    const n = this.optIds.length
    if (down || up) {
      this.optIdx = (this.optIdx + (down ? 1 : n - 1)) % n
      this.ctx.sfx('hover')
      this.paintOpts()
      this.preview(this.optIds[this.optIdx]!)
    } else if (e.code === 'Enter' || e.code === 'Space') {
      this.equip(this.optIdx)
      this.setFocus('slots')
      this.selectSlot(this.slotIdx, false)
    } else if (e.code === 'ArrowLeft' || e.code === 'Escape' || e.code === 'Backspace') {
      this.ctx.sfx('back')
      this.setFocus('slots')
      this.selectSlot(this.slotIdx, false)
    }
  }
}
