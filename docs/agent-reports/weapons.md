# Weapons & Viewmodel report (pass 3)

## Pass 3 changes
- **No more slabs.** Bevels used 2 segments (45° steps), which is wider than the 43° crease threshold, so every bevel shaded as hard facets.
  - `prof()` now uses 3–5 smooth bevel segments.
  - Moulded parts that ask for a real bevel (grips, stocks, handguards) automatically get about 6 mm rounded cross-sections.
  - New `round` option for mags and guards; `xsec()` bevels are smoother too.
- **UMP45:** raised longitudinal ribs and rear reinforcement ridges, tapered fore-end nose. Forward-canted, tapered, rounded mag with feed lips and a visible top round. Rounded side-folding stock.
- **SPAS-12:** perforated heat shield over the barrel with a front clamp, plus a shell elevator in the loading port.
- **New `models-extra.ts`:**
  - **Intervention (M200):** chassis forend with lightening holes, full-length rail, fluted barrel, ported brake, stowed bipod, monopod, adjustable cheek piece, 56 mm scope with knurled turrets and ribbed power ring. The mag is now a real `mag` part, so it animates on reload.
  - **M67:** smooth sphere (the pineapple grid is gone), yellow band, fuze, curved sheet spoon, pin, ring and clip.
  - **Knife:** custom ground blade with spine, grind and edge stations, so the bevel catches light; double guard, wrapped grip, pommel.
- **Mags (M4/ACR/AK):** taper and rounded edges.
- **Menu preview:**
  - Each weapon is fitted by its own length and height (pistols scale up).
  - Rests at a 3/4 hero angle with a slow sway; drag inertia, then eases back. Soft contact shadow.
  - Thumbnails fit 92% of their box, so pistols match rifles.
- **Hands:** knuckle crease rings and stitched side seams on every finger segment; thumbs wrap the grip (thumb curl 0.78).
- **Readability in shade:** physical metal albedos, shared IBL gain (2.6 in first person, 1.0 in the menu), view fill and rim light, shader edge wear.
- `std()` only sets `side` when double-sided, so THREE's "side undefined" warning is gone.

## Verified (Playwright, swiftshader)
- Before/after crops: `i-*` / `ia*` (pass 2) vs `p3-*`, `h3*` (pass 3 menu hero renders).
- First-person hip: `f3a.png`, `f3b.png` (all readable in shade).
- `bunx tsc --noEmit` is clean.

## Known issues
- Hands still read as gloved capsules at extreme close range.
- AK wood grain is a little regular.
- Bot weapon meshes are 20–52k verts (one draw call each).
