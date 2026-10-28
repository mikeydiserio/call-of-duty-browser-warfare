import { CLASS_COUNT, CLASS_NAME_MAX, defaultClassName, normalizeClassName } from '../core/classes'
import type { AttachmentId, DeathstreakId, Loadout, PerkId, WeaponId } from '../core/types'
import { KILLSTREAK_IDS, KILLSTREAKS, killstreakSvg, normalizeKillstreaks, type KillstreakId } from '../game/killstreaks/defs'
import { attachmentFor, ATTACHMENTS, attachmentsFor, PRIMARIES, SECONDARIES, WEAPONS, weaponWithAttachment } from '../weapons/defs'
import { WeaponPreview, weaponThumbnail } from '../weapons/preview'
import { CLASS_LABEL, DEATHSTREAKS, DEATHSTREAK_IDS, PERK_TIERS, PERKS, WEAPON_BLURB, weaponStats, type WeaponStats } from './data'
import { el, setClass } from './dom'
import { deathstreakSvg, perkSvg } from './icons'
import { keyHints, type Screen, type UiCtx } from './screen'

type Slot =
  | { kind: 'primary' }
  | { kind: 'secondary' }
  | { kind: 'attachment'; target: 'primary' | 'secondary' }
  | { kind: 'perk'; tier: 0 | 1 | 2 }
  | { kind: 'deathstreak' }
  | { kind: 'streak'; idx: 0 | 1 | 2 }

const SLOTS: { slot: Slot; label: string }[] = [
  { slot: { kind: 'primary' }, label: 'PRIMARY WEAPON' },
  { slot: { kind: 'secondary' }, label: 'SECONDARY WEAPON' },
  { slot: { kind: 'attachment', target: 'primary' }, label: 'PRIMARY ATTACHMENT' },
  { slot: { kind: 'attachment', target: 'secondary' }, label: 'SECONDARY ATTACHMENT' },
  { slot: { kind: 'perk', tier: 0 }, label: 'PERK 1' },
  { slot: { kind: 'perk', tier: 1 }, label: 'PERK 2' },
  { slot: { kind: 'perk', tier: 2 }, label: 'PERK 3' },
  { slot: { kind: 'deathstreak' }, label: 'DEATHSTREAK' },
  { slot: { kind: 'streak', idx: 0 }, label: 'KILLSTREAK 1' },
  { slot: { kind: 'streak', idx: 1 }, label: 'KILLSTREAK 2' },
  { slot: { kind: 'streak', idx: 2 }, label: 'KILLSTREAK 3' },
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
  /** Live 3D turntable of the selected weapon (same models as the viewmodel). */
  private pv3d: HTMLElement
  private pvPerk: HTMLElement
  private wpv = new WeaponPreview()
  private pvName: HTMLElement
  private pvType: HTMLElement
  private pvDesc: HTMLElement
  private pvStats: HTMLElement
  private statFill = new Map<keyof WeaponStats, { fill: HTMLElement; mark: HTMLElement; val: HTMLElement }>()
  private slotIdx = 0
  private optIdx = 0
  private focus: 'slots' | 'opts' = 'slots'
  private optIds: string[] = []
  private head: HTMLElement
  private classTabs: HTMLElement[] = []
  private className: HTMLElement
  private nameInput: HTMLInputElement

  constructor(private ctx: UiCtx) {
    const root = this.el
    const head = (this.head = el('div', 'screen-head', root))
    el('div', 'menu-header', head, 'CREATE A CLASS')
    // Active class name, with inline rename.
    const nameRow = el('div', 'cac-name-row', head)
    this.className = el('div', 'menu-sub cac-cname', nameRow)
    const rename = el('button', 'cac-rename', nameRow, 'RENAME')
    rename.type = 'button'
    rename.setAttribute('aria-label', 'Rename class')
    rename.addEventListener('mouseenter', () => this.ctx.sfx('hover'))
    rename.addEventListener('click', () => this.startRename())
    const editRow = el('div', 'cac-name-edit', head)
    this.nameInput = el('input', 'cac-name-input', editRow)
    this.nameInput.type = 'text'
    this.nameInput.maxLength = CLASS_NAME_MAX
    this.nameInput.spellcheck = false
    this.nameInput.setAttribute('autocomplete', 'off')
    this.nameInput.setAttribute('aria-label', `Class name, up to ${CLASS_NAME_MAX} characters`)
    const save = el('button', 'cac-rename', editRow, 'SAVE')
    save.type = 'button'
    save.addEventListener('click', () => this.commitRename())
    const cancel = el('button', 'cac-rename subtle', editRow, 'CANCEL')
    cancel.type = 'button'
    // mousedown fires before the input's blur, so Cancel wins over blur-commits.
    cancel.addEventListener('mousedown', (e) => e.preventDefault())
    cancel.addEventListener('click', () => this.cancelRename())
    this.nameInput.addEventListener('blur', () => {
      if (this.head.classList.contains('renaming')) this.commitRename()
    })
    el('div', 'menu-header-line', head)

    // The five custom class slots.
    const tabs = el('div', 'cac-classes', root)
    for (let i = 0; i < CLASS_COUNT; i++) {
      const t = el('button', 'cac-class', tabs)
      t.type = 'button'
      t.innerHTML = `<span class="cc-num">CLASS ${i + 1}</span><span class="cc-name"></span><span class="cc-use">IN USE</span>`
      t.title = 'Double-click to rename'
      t.addEventListener('mouseenter', () => this.ctx.sfx('hover'))
      t.addEventListener('click', () => this.selectClass(i, true))
      t.addEventListener('dblclick', () => this.startRename())
      this.classTabs.push(t)
    }

    const cols = el('div', 'cac-cols', root)
    const left = el('div', 'cac-slots', cols)
    const primaryRow = el('div', 'cac-slot-row', left)
    const secondaryRow = el('div', 'cac-slot-row', left)
    SLOTS.forEach((s, i) => {
      const parent = s.slot.kind === 'primary' || (s.slot.kind === 'attachment' && s.slot.target === 'primary')
        ? primaryRow
        : s.slot.kind === 'secondary' || (s.slot.kind === 'attachment' && s.slot.target === 'secondary')
          ? secondaryRow
          : left
      const b = el('button', s.slot.kind === 'attachment' ? 'cac-slot cac-attachment-slot' : 'cac-slot', parent)
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
    this.pv3d = el('div', 'pv-3d', this.pvArt)
    this.pv3d.style.cssText = 'position:absolute;inset:0;'
    this.pvPerk = el('div', 'pv-perk', this.pvArt)
    this.pvPerk.style.cssText = 'display:contents;'
    if (getComputedStyle(this.pvArt).position === 'static') this.pvArt.style.position = 'relative'
    this.wpv.mount(this.pv3d)
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
      ['Q E / 1-5', 'CLASS'],
      ['R', 'RENAME'],
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
    if (s.kind === 'attachment') return l[s.target === 'primary' ? 'primaryAttachment' : 'secondaryAttachment'] ?? 'none'
    if (s.kind === 'deathstreak') return l.deathstreak ?? 'none'
    if (s.kind === 'streak') return normalizeKillstreaks(l.killstreaks)[s.idx]!
    return l.perks[s.tier] ?? PERK_TIERS[s.tier]![0]!
  }

  private optionsFor(i: number): string[] {
    const s = SLOTS[i]!.slot
    if (s.kind === 'primary') return PRIMARIES
    if (s.kind === 'secondary') return SECONDARIES
    if (s.kind === 'attachment') return ['none', ...attachmentsFor(this.loadout[s.target])]
    if (s.kind === 'deathstreak') return ['none', ...DEATHSTREAK_IDS]
    if (s.kind === 'streak') return KILLSTREAK_IDS
    return PERK_TIERS[s.tier]!
  }

  enter() {
    this.wpv.setVisible(true)
    this.cancelRename()
    this.focus = 'slots'
    setClass(this.el, 'focus-opts', false)
    this.slotIdx = 0
    this.refreshClasses()
    this.refreshSlots()
    this.selectSlot(0, false)
  }

  leave() {
    this.wpv.setVisible(false)
    if (this.head.classList.contains('renaming')) this.commitRename()
    this.ctx.game.saveClasses()
  }

  /** Switch which class is being edited; it also becomes the class used on the next spawn. */
  private selectClass(i: number, sound: boolean) {
    const g = this.ctx.game
    const n = ((i % CLASS_COUNT) + CLASS_COUNT) % CLASS_COUNT
    if (this.head.classList.contains('renaming')) this.commitRename()
    if (n === g.activeClass) return
    if (sound) this.ctx.sfx('select')
    g.activeClass = n
    g.saveClasses()
    this.refreshClasses()
    this.refreshSlots()
    this.selectSlot(this.slotIdx, false)
  }

  private refreshClasses() {
    const g = this.ctx.game
    this.className.textContent = g.classes[g.activeClass]!.name.toUpperCase()
    this.classTabs.forEach((t, i) => {
      t.querySelector('.cc-name')!.textContent = g.classes[i]!.name.toUpperCase()
      setClass(t, 'sel', i === g.activeClass)
    })
  }

  private startRename() {
    const g = this.ctx.game
    this.nameInput.value = g.classes[g.activeClass]!.name
    this.head.classList.add('renaming')
    this.nameInput.focus()
    this.nameInput.select()
  }

  private commitRename() {
    const g = this.ctx.game
    const name = normalizeClassName(this.nameInput.value)
    g.classes[g.activeClass]!.name = name || defaultClassName(g.activeClass)
    g.saveClasses()
    this.cancelRename()
    this.refreshClasses()
  }

  private cancelRename() {
    this.head.classList.remove('renaming')
    this.nameInput.blur()
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
      if (s.slot.kind === 'attachment') {
        name.textContent = v === 'none' ? 'NO ATTACHMENT' : ATTACHMENTS[v as AttachmentId].name.toUpperCase()
        ico.textContent = '+'
      } else if (s.slot.kind === 'deathstreak') {
        name.textContent = v === 'none' ? 'NONE' : DEATHSTREAKS[v as DeathstreakId].name.toUpperCase()
        ico.innerHTML = v === 'none' ? '—' : deathstreakSvg(v as DeathstreakId)
      } else if (s.slot.kind === 'perk') {
        name.textContent = PERKS[v as PerkId].name.toUpperCase()
        ico.innerHTML = perkSvg(v as PerkId)
      } else if (s.slot.kind === 'streak') {
        name.textContent = `${KILLSTREAKS[v as KillstreakId].name.toUpperCase()}  (${KILLSTREAKS[v as KillstreakId].kills})`
        ico.innerHTML = killstreakSvg(v as KillstreakId)
      } else {
        name.textContent = WEAPONS[v as WeaponId].name.toUpperCase()
        ico.innerHTML = weaponImg(v as WeaponId)
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
    el('div', 'panel-title', o, s.slot.kind === 'perk' ? `TIER ${s.slot.tier + 1} PERK` : s.slot.kind === 'streak' ? 'KILLSTREAK REWARD' : s.label)
    const taken = s.slot.kind === 'streak' ? normalizeKillstreaks(this.loadout.killstreaks) : []
    this.optIds.forEach((id, i) => {
      const b = el('button', 'opt', o)
      b.type = 'button'
      if (s.slot.kind === 'attachment') {
        const attachment = id === 'none' ? null : ATTACHMENTS[id as AttachmentId]
        b.innerHTML = `<span class="o-ico">${attachment ? '+' : '—'}</span><span class="o-txt"><span class="o-name">${attachment?.name.toUpperCase() ?? 'NO ATTACHMENT'}</span><span class="o-sub">${attachment?.description ?? 'Use the weapon without an attachment.'}</span></span><span class="o-tick"></span>`
      } else if (s.slot.kind === 'perk') {
        const p = PERKS[id as PerkId]
        b.innerHTML = `<span class="o-ico">${perkSvg(p.id)}</span><span class="o-txt"><span class="o-name">${p.name.toUpperCase()}</span><span class="o-sub">${p.desc}</span></span><span class="o-tick"></span>`
      } else if (s.slot.kind === 'deathstreak') {
        const d = id === 'none' ? null : DEATHSTREAKS[id as DeathstreakId]
        b.innerHTML = `<span class="o-ico">${d ? deathstreakSvg(d.id) : '—'}</span><span class="o-txt"><span class="o-name">${d?.name.toUpperCase() ?? 'NONE'}</span><span class="o-sub">${d?.desc ?? 'Do not equip a deathstreak reward.'}</span></span><span class="o-tick"></span>`
      } else if (s.slot.kind === 'streak') {
        const k = KILLSTREAKS[id as KillstreakId]
        const inUse = taken.includes(k.id) && taken[s.slot.idx] !== k.id
        b.innerHTML = `<span class="o-ico">${killstreakSvg(k.id)}</span><span class="o-txt"><span class="o-name">${k.name.toUpperCase()}</span><span class="o-sub">${k.kills} KILLS${inUse ? ' · IN USE' : ''}</span></span><span class="o-tick"></span>`
      } else {
        const w = WEAPONS[id as WeaponId]
        b.innerHTML = `<span class="o-ico wide">${weaponImg(w.id)}</span><span class="o-txt"><span class="o-name">${w.name.toUpperCase()}</span><span class="o-sub">${CLASS_LABEL[w.class] ?? ''}</span></span><span class="o-tick"></span>`
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
    // The killstreak list is longer than the panel: keep the highlighted row in view.
    opts[this.optIdx]?.scrollIntoView({ block: 'nearest' })
  }

  private equip(i: number) {
    const id = this.optIds[i]
    if (!id) return
    this.ctx.sfx('select')
    const s = SLOTS[this.slotIdx]!.slot
    const l = this.loadout
    if (s.kind === 'primary') {
      l.primary = id as WeaponId
      if (l.primaryAttachment && !attachmentsFor(l.primary).includes(l.primaryAttachment)) l.primaryAttachment = undefined
    } else if (s.kind === 'secondary') {
      l.secondary = id as WeaponId
      if (l.secondaryAttachment && !attachmentsFor(l.secondary).includes(l.secondaryAttachment)) l.secondaryAttachment = undefined
    }
    else if (s.kind === 'attachment') {
      const key = s.target === 'primary' ? 'primaryAttachment' : 'secondaryAttachment'
      l[key] = id === 'none' ? undefined : id as AttachmentId
    }
    else if (s.kind === 'streak') {
      // Picking one already in another slot swaps the two (three unique rewards, MW2).
      const ks = normalizeKillstreaks(l.killstreaks)
      const other = ks.indexOf(id as KillstreakId)
      if (other >= 0) ks[other] = ks[s.idx]!
      ks[s.idx] = id as KillstreakId
      l.killstreaks = normalizeKillstreaks(ks)
      this.buildOpts()
      this.optIdx = Math.max(0, this.optIds.indexOf(id))
    } else if (s.kind === 'deathstreak') {
      l.deathstreak = id === 'none' ? undefined : id as DeathstreakId
    } else {
      const perks = l.perks.slice()
      perks[s.tier] = id as PerkId
      l.perks = perks
    }
    this.ctx.game.saveClasses()
    this.optIdx = i
    this.refreshSlots()
    this.paintOpts()
    this.preview(id)
  }

  private preview(id: string) {
    const slot = SLOTS[this.slotIdx]!.slot
    if (slot.kind === 'attachment') {
      const attachment = id === 'none' ? null : id as AttachmentId
      this.previewWeapon(this.loadout[slot.target], attachment)
      this.pvType.textContent = attachment ? 'WEAPON ATTACHMENT' : 'ATTACHMENT SLOT'
      this.pvName.textContent = attachment ? ATTACHMENTS[attachment].name.toUpperCase() : 'NO ATTACHMENT'
      this.pvDesc.textContent = attachment ? ATTACHMENTS[attachment].description : 'Choose an attachment or leave this slot empty.'
      return
    }
    if (slot.kind === 'deathstreak') {
      const deathstreak = id === 'none' ? null : DEATHSTREAKS[id as DeathstreakId]
      setClass(this.el, 'perk-view', true)
      this.pv3d.style.visibility = 'hidden'
      this.pvPerk.innerHTML = deathstreak ? deathstreakSvg(deathstreak.id, 'big') : ''
      this.pvType.textContent = 'DEATHSTREAK'
      this.pvName.textContent = deathstreak?.name.toUpperCase() ?? 'NONE'
      this.pvDesc.textContent = deathstreak?.desc ?? 'Choose a deathstreak reward or leave this slot empty.'
      return
    }
    if (id in KILLSTREAKS) {
      const k = KILLSTREAKS[id as KillstreakId]
      setClass(this.el, 'perk-view', true)
      this.pv3d.style.visibility = 'hidden'
      this.pvPerk.innerHTML = killstreakSvg(k.id, 'big')
      this.pvType.textContent = `${k.kills} KILLSTREAK`
      this.pvName.textContent = k.name.toUpperCase()
      this.pvDesc.textContent = k.desc
      return
    }
    const isPerk = id in PERKS
    setClass(this.el, 'perk-view', isPerk)
    if (isPerk) {
      const p = PERKS[id as PerkId]
      this.pv3d.style.visibility = 'hidden'
      this.pvPerk.innerHTML = perkSvg(p.id, 'big')
      this.pvType.textContent = `TIER ${p.tier} PERK`
      this.pvName.textContent = p.name.toUpperCase()
      this.pvDesc.textContent = p.desc
      return
    }
    this.previewWeapon(id as WeaponId, attachmentFor(this.loadout, id as WeaponId))
  }

  private previewWeapon(id: WeaponId, attachment: AttachmentId | null) {
    const w = weaponWithAttachment(id, attachment)
    setClass(this.el, 'perk-view', false)
    this.pvPerk.textContent = ''
    this.pv3d.style.visibility = 'visible'
    this.wpv.setWeapon(w.id)
    this.pvType.textContent = CLASS_LABEL[w.class] ?? ''
    this.pvName.textContent = w.name.toUpperCase()
    this.pvDesc.textContent = WEAPON_BLURB[w.id] ?? ''
    const st = weaponStats(w)
    const slot = SLOTS[this.slotIdx]!.slot
    const equipped = slot.kind === 'attachment'
      ? this.loadout[slot.target]
      : slot.kind === 'primary' || slot.kind === 'secondary'
        ? this.loadout[slot.kind]
        : id
    const eq = weaponStats(weaponWithAttachment(equipped, attachmentFor(this.loadout, equipped)))
    for (const [key] of STAT_ROWS) {
      const r = this.statFill.get(key)!
      r.fill.style.transform = `scaleX(${st[key] / 100})`
      r.mark.style.left = `${eq[key]}%`
      r.val.textContent = String(Math.round(st[key]))
    }
  }

  key(e: KeyboardEvent) {
    if (document.activeElement === this.nameInput) {
      if (e.code === 'Enter') {
        e.preventDefault()
        this.ctx.sfx('select')
        this.commitRename()
      } else if (e.code === 'Escape') {
        e.preventDefault()
        this.ctx.sfx('back')
        this.cancelRename()
      }
      return
    }
    if (e.code === 'KeyQ' || e.code === 'KeyE') {
      this.selectClass(this.ctx.game.activeClass + (e.code === 'KeyE' ? 1 : -1), true)
      return
    }
    const digit = /^Digit([1-9])$/.exec(e.code)
    if (digit && Number(digit[1]) <= CLASS_COUNT) {
      this.selectClass(Number(digit[1]) - 1, true)
      return
    }
    if (e.code === 'KeyR') {
      e.preventDefault() // keep the R out of the input it's about to focus
      this.ctx.sfx('select')
      this.startRename()
      return
    }
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

/** Picker / slot thumbnail rendered once from the real 3D model. */
function weaponImg(id: WeaponId): string {
  return `<img class="wthumb" alt="" draggable="false" src="${weaponThumbnail(id)}" style="width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;">`
}
