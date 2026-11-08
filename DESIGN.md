---
name: Simpld Public Site
description: '"ASCII pasture" — the Simpld landing and downloads pages: a golden-hills-and-blue-sky photograph rendered live as colored ASCII, on cloud-white paper with a sky-blue field.'
colors:
  paper: "#F7F9FC"
  cloud: "#F6F9FC"
  horizon-sky: "#2E5FC8"
  sky-deep: "#24499B"
  field-gold: "#C99B4E"
  pasture-green: "#4E7A3F"
  ink: "#132A4A"
  ink-soft: "#46608A"
  rule: "#D5DEEC"
  hero-fallback-sky-a: "#2B58B8"
  hero-fallback-sky-b: "#3A67BE"
  hero-fallback-field-a: "#46502C"
  hero-fallback-field-b: "#3F5D33"
typography:
  display:
    fontFamily: '"Hanken Grotesk", "Segoe UI", sans-serif'
    fontSize: "clamp(2.4rem, 7.5vw, 4.6rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  headline:
    fontFamily: '"Hanken Grotesk", "Segoe UI", sans-serif'
    fontSize: "clamp(2rem, 4.5vw, 3.2rem)"
    fontWeight: 800
    letterSpacing: "-0.02em"
  section-title:
    fontFamily: '"Hanken Grotesk", "Segoe UI", sans-serif'
    fontSize: "clamp(1.7rem, 3.4vw, 2.4rem)"
    fontWeight: 800
    letterSpacing: "-0.02em"
  group-title:
    fontFamily: '"Hanken Grotesk", "Segoe UI", sans-serif'
    fontSize: "1.3rem"
    fontWeight: 800
    letterSpacing: "-0.01em"
  body:
    fontFamily: '"Hanken Grotesk", "Segoe UI", sans-serif'
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  lead:
    fontFamily: '"Hanken Grotesk", "Segoe UI", sans-serif'
    fontSize: "1.1rem"
    fontWeight: 400
  label:
    fontFamily: '"Hanken Grotesk", "Segoe UI", sans-serif'
    fontSize: "0.9rem"
    fontWeight: 500
  mono:
    fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace'
    fontSize: "0.85em"
rounded:
  none: "0"
spacing:
  page-inline: "clamp(20px, 4vw, 48px)"
  section-vert: "clamp(4.5rem, 10vh, 7rem)"
  band-vert: "clamp(4rem, 9vh, 6rem)"
  gap-inline: "clamp(16px, 3vw, 32px)"
  gap-cta: "1rem"
  spec-pad: "1.35rem 0"
  cta-pad: "15px 34px"
  row-pad: "16px 10px"
components:
  cta-primary:
    backgroundColor: "{colors.cloud}"
    textColor: "{colors.ink}"
    typography: "700 1.05rem"
    rounded: "{rounded.none}"
    padding: "15px 34px"
  cta-primary-hover:
    backgroundColor: "#ffffff"
  download-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cloud}"
    typography: "700 0.98rem"
    rounded: "{rounded.none}"
    padding: "11px 24px"
  download-button-hover:
    backgroundColor: "{colors.horizon-sky}"
  nav-link:
    typography: "500 0.95rem"
  nav-link-hover:
    textColor: "{colors.cloud}"
---

# Design System: Simpld Public Site

## Overview

**Creative North Star: "The ASCII Pasture"**

The Simpld site is one sustained claim: everything you are looking at was drawn by a machine on someone's desk. The hero is not a picture *of* the product's rendering — it **is** the rendering. A golden-hills photo (Danville, CA, huge blue sky) is sampled and painted onto a canvas as colored ASCII: pastel-filled cells plus brightness-mapped glyphs, quantized to a palette derived from the photograph itself. The headline sits in the calm deep-blue sky region, upper-left, and the visitor's scroll runs paper between one sky and one closing sky.

Substance language is spec-sheet, not marketing: hard edges everywhere, top rules, two-edge lockups, a `dl` for the promise and a link-row table for downloads. Depth comes from tuned translucent ink veils over the ASCII fields, never from elevation or cards.

**Key Characteristics:**

- Witness structure: two live ASCII fields only (hero + closing band); all other surfaces are flat paper
- Sky-quantized palette: saturated horizon blue for fields, cloud white for fields' companion text, ink navy for type on paper, field gold + grass green reserved as accents that surface inside the derived ASCII palette
- Zero radius on everything (no border-radius declared); the only curves are clouds inside the rendered field
- Edge-locked spec-sheet rows: 2px rule above the group, 1px hairline below each row
- Hanken Grotesk set heavy (700/800) and tight (-0.03em / -0.02em) for display; 400/500 for body and labels
- Mono type only where it IS the medium: the ASCII glyphs themselves and inline accelerator names
- One-time diagonal reveal sweep per field; reduced motion = static field

## Colors

A sky-quantized palette: one saturated field color per region (horizon blue), a pair of near-whites for paper and cloud surfaces, ink navy for all type, a hairline rule blue-grey, and two accents (gold, green) that belong to the landscape, not the UI chrome.

### Primary
- **Horizon Blue** (`--sky`, #2E5FC8): the one saturated field — the closing band's ground (`data-ground` / CSS fallback of `.get`), the `::selection` background, the `:focus-visible` outline color, and the `row-get` hover face. Carries cloud text (`--cloud`) at 5.55:1 AA.
- **Sky Deep** (`--sky-deep`, #24499B): deep-sky gradient stop; used as the midpoint of the hero canvas-off gradient. Declared but never consumed via `var()` in either built page — the gradient uses the literal #24499B.

### Secondary
- **Field Gold** (`--gold`, #C99B4E) and **Pasture Green** (`--green`, #4E7A3F): accents belonging to the rendered landscape — they surface inside the k-means-derived ASCII palette and the hero gradient's olive stops, not as UI colors. Declared in `index.html` `:root` but currently consumed by no rule; treat as reserved, do not spend them on buttons or badges.

### Neutral
- **Paper** (`--paper`, #F7F9FC): page ground; `html`/`body` background on both pages, `theme-color` meta.
- **Cloud** (`--cloud`, #F6F9FC): white object color over/inside blue fields — hero and band copy, `cta` face, `row-get` text, selection text color.
- **Ink Navy** (`--ink`, #132A4A): all text on paper, spec-sheet dt accent, download button face. 13.7:1 on paper.
- **Ink Soft** (`--ink-soft`, #46608A): secondary copy (dd text, leads, fine print, footer) on paper. 6.0:1 — passes AA at body sizes.
- **Rule** (`--rule`, #D5DEEC): row hairlines (downloads page declares it; `index.html` hardcodes the same hex in `.spec`).
- **Canvas-off gradient sky** (#2B58B8 → #24499B 46% → #3A67BE 55%): a darker memory of the photo's sky, painted under the hero when the canvas can't render, so cloud-white copy keeps AA contrast with no canvas at all.
- **Canvas-off gradient field** (#46502C 62% → #3F5D33 100%): the olive/grass foot of the same fallback gradient.

### Named Rules
**The One Field Rule.** Each region gets exactly one saturated field. Sky-family blues belong to the hero and the closing band; paper belongs to everything between them. A page carries at most two fields.
**The Ink Is Navy Rule.** Pure black text is not a style on this site. Type is ink navy #132A4A (or ink-soft #46608A); the only blacks are logo marks and the download button face.

## Typography

**Display Font:** Hanken Grotesk (weights 400/500/700/800, Google Fonts; fallback "Segoe UI", sans-serif)
**Body Font:** Hanken Grotesk 400 (same stack, 17px/1.6)
**Mono Font:** `ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace` — only for the ASCII glyph medium and inline `<code>`

**Character:** A workhorse grotesk set news-sheet-heavy and tight: 800 display at -0.03em leads every screen, 400 body breathes at 1.6. The same variable font ships inside the desktop app, so site and app read as the same object in two places.

### Hierarchy
- **Display** (800, clamp(2.4rem, 7.5vw, 4.6rem), lh 1.02, ls -0.03em, ≤13ch): hero h1, cloud-white over the sky region of the ASCII field.
- **Headline** (800, clamp(2rem, 4.5vw, 3.2rem), ls -0.02em): closing-band h2 over the second field. Downloads page h1 uses clamp(2.6rem, 7vw, 4.4rem) on paper.
- **Section Title** (800, clamp(1.7rem, 3.4vw, 2.4rem), ls -0.02em, ≤24ch): mid-page h2 (`Runs on your side of the screen`).
- **Group Title** (800, 1.3rem, ls -0.01em): platform groupings on downloads (Windows / macOS / Linux).
- **Body** (400, 17px/1.6): general copy; dd body 0.97rem/1.6 ≤48rem, leads 1.1rem ≤42–46rem caps the measure.
- **Sub** (400, clamp(1.05rem, 1.6vw, 1.25rem)/1.55): hero subline, 32rem max.
- **Spec Term** (800, 1.05rem, ls -0.01em): dl `dt` labels; row names 800 1.18rem.
- **Label** (500, 0.95rem nav / 0.92rem footer / 0.9rem fine print): quiet UI type.
- **Mono** (0.85em `<code>`): inline accelerator tokens only — the built pages' only `<code>` usage is the `CUDA` / `Vulkan` / `Metal` line in the hero detail.

### Named Rules
**The Heavy Is the Hierarchy Rule.** Weight does the stepping between levels (800 → 700 → 500 → 400); size changes are second. Never fake hierarchy with italic or gray alone.

## Layout

Two container widths carry the whole system: **64rem** (promise band, closing band inner, footer on the landing) and **56rem** (downloads stage, hero content max-width). Inline gutters are always `clamp(20px, 4vw, 48px)`. Vertical rhythm uses viewport-aware clamps: `clamp(4.5rem, 10vh, 7rem)` for the promise section, `clamp(4rem, 9vh, 6rem)` for the closing band.

The underline architecture — **edge-locked spec-sheet rows** — is carried by two grids: the landing's `.spec` is a two-column grid `minmax(7.5rem, 1fr) / 2.2fr` (term left, description right); downloads' `.row` is a name+description left column with a right-locked Download button that vertically spans both. Both share an opening 2px solid `--ink` rule and per-row 1px `--rule` hairline. Row inventory: 5 spec rows on the landing; 3 platform groups / 6 link rows on downloads.

Two breakpoints: **620px** collapses spec rows to one column and tightens nav/cta gaps; **560px** stacks download rows below their download button. The hero is `min-height: 100vh` full-bleed; every other band is document-flow paper.

## Elevation & Depth

Flat system — the only box-shadow in the shipping CSS is a functional legibility device over the fields, not decoration.

### Shadow Vocabulary
- `0 3px 14px rgba(10, 22, 48, .25)` — under `.get .cta` only, lifting the hard-edged cloud button 1px off the blue band at rest.
- Hover translate: `.cta:hover` lifts `translateY(-1px)` against `#fff` (happens over both sky and paper).
- Rows answer hover with tonal fill, not elevation: `.row:hover` background `rgba(46, 95, 200, .07)`.

### Named Rules
**The Flat Rule.** No border-radius, no card shadows. Depth over ASCII fields comes from veil gradients (`.hero::after`, `.get::before`) — translucent ink `radial-gradient`/`linear-gradient` covers tuned to each band's copy position — plus at most one functional button shadow.

## Shapes

Zero-radius on everything: no `border-radius` is declared anywhere in the shipped CSS. The CTA is a true rectangle at 15px 34px; the download button a rectangle at 11px 24px; focus rings are square 3px outlines. The only curved forms in the world are the clouds inside the rendered ASCII image field.

Borders follow the spec-sheet pattern: 2px solid `--ink` opens a group; 1px `--rule` closes each row. Links use deliberate underlines rather than icon language: nav links carry a 2px bottom line (transparent at rest, page-color on hover/focus), footer links are always-underlined (`text-underline-offset: 3px`, decoration tinted `rgba(70,96,138,.45)`).

## Components

### CTA Buttons
- **Shape:** sharp rectangles (0 radius); primary cloud face (`--cloud`) + ink text, `15px 34px`, 700 1.05rem.
- **Hover / Focus:** face brightens to `#fff` with `translateY(-1px)`; inside the `.get` band the resting shadow (see Elevation & Depth) is part of the same lift. `.cta-quiet` is the text-only inverse — a faint `rgba(246,249,252,.55)` underline that saturates to `currentColor` on hover/focus.
- **Download row button:** `row-get` is the dark-face variant — `--ink` face, `--cloud` text, `11px 24px`; hovers/row-focus to `--sky`. On mobile it drops to the row footer with token-size `10px 20px` padding.
- **Focus:** `:focus-visible` is a uniform 3px solid `--sky` ring at 3px offset on both pages, over paper and field alike.

### Spec Rows
- `.specs`: 2px `--ink` cap rule over `dl` of five rows; each `.spec` is a two-column grid `minmax(7.5rem, 1fr) 2.2fr`, 6px/32px gap, `1.35rem 0`; `dt` 800, `dd` `--ink-soft`; `<strong>` inside dd reasserts `--ink` 700 as the row's one highlighted read.
- Mobile (≤620px): grids to single column.

### Nav
- Absolute over the hero (landing, cloud copy on the blue field) or in-flow on paper (downloads, ink copy). Wordmark: a 21px derived logo mark + "Simpld" in 800 1.25rem at -0.02em. Links sit in a right-aligned cluster, 500 0.95rem, 32px gap; hover/focus draws the 2px bottom rule in the page's own text color (cloud on the field, ink on paper).

### Closing get band
- Full width on `--sky` with a second ASCII canvas and an ink veil `.get::before` (leftmost ink, 55% at 14% 42% fading right); copy column `.get-inner` max-width 64rem, `--cloud` h2/p; `.all-releases` is the always-underline quiet link, `rgba(246,249,252,.5)` decoration → `#fff` on hover.

### Footer
- Single-line flex: bold `sign` (700 `--ink`, "Simpld — yours, offline, always", 15px mark inline) beside an underlined link row (GitHub / Releases / Downloads on the landing; Home / Browse all releases on downloads). The downloads footer is closed by a 1px `--rule` top border; the landing footer sits on bare paper.

### Signature Component: the ASCII field (`canvas[data-ascii]`)
- **Markup:** `<canvas class="ascii-field" data-ascii data-src="assets/sky-field.jpg" aria-hidden="true">` (hero) and `<canvas data-ascii data-src="assets/sky-closing.jpg" data-focal="0.5 0.72" data-ground="#2E5FC8" aria-hidden="true">` (closing band), absolutely filling their host sections. Full contract in **The data-ascii Renderer Contract** below.

## Do's and Don'ts

### Do:
- **Do** treat the veils as part of the copy, not decoration: field copy is legible because `.hero::after` / `.get::before` sit under it — never set `--cloud` text over a raw, un-veiled `--sky` field.
- **Do** keep the narrow-view fallbacks (≤620px on the landing, ≤560px on downloads): spec grids drop to one column, the download button joins the row's left flow, and hovers (`row` fill, transform) all give way under `prefers-reduced-motion`.
- **Do** keep mono type only where mono is the medium: the ASCII glyphs themselves and inline accelerator names (`CUDA`, `Vulkan`, `Metal`).
- **Do** keep the release links verbatim: hrefs are the exact `releases/latest/download/...` URLs shipped in the original table, never recreated from memory in either page.
- **Do** keep the provenance discipline: every shipping raster must carry its embedded origin note; a new raster ships unpublished until its note is embedded (see Raster Provenance Policy).

### Don't:
- **Don't** put radius anywhere. No border-radius on any element, including focus rings — the field's clouds are the only curves.
- **Don't** link to `about.html` anywhere; the page was removed at user request (2026-11-07). "About" exists on the site only as a pointer toward the GitHub repo, never as a built page.
- **Don't** invent app screenshots, weight-download destinations, or hardware claim details; site copy stays anchored to `PRODUCT.md` and claims-free otherwise.
- **Don't** rebuild the spec-sheet rows as rounded cards, shadow chips, or boxes — rows are ruled, edge-locked, and flat.
- **Don't** leave a reduced-motion user watching a half-rendered field: under `prefers-reduced-motion` the canvas paints its final frame immediately — never a paused mid-sweep frame waiting on scroll.

## The data-ascii Renderer Contract and Fallbacks

`docs/assets/ascii-field.js` owns every `canvas[data-ascii]`. Recorded contract against the shipped file (2026-11-07):

- **Markup:** any `canvas[data-ascii]` with mandatory `data-src` (photo path). Optional `data-focal` "`fx fy`" cover-crop anchor (default `"0.5 0.5"`, landing uses `"0.5 0.72"` for the closing sky band) and `data-ground` hex to hold under the frame at rest if no frame is ready or when the default `#F7F9FC` PAPER ground is wrong for a band. Canvas carries `aria-hidden="true"` plus a semantic host (`aria-label` on `.hero`; the copy section carries the message).
- **Cover-crop & sampling:** the photo renders as cells at one pixel per cell — `cellW = clamp(round(cssW/190), 6, 10)` px wide, `cellH = cellW × 1.8`, DPR clamped to 1..2.
- **Per-photo palette:** k-means over a strided 2px-step sample of the cell grid, k=14, 7 iterations, seeded deterministically by luminance-spread (no randomness); derived colors are then lifted 8% toward white (`c×0.92 + 255×0.08`) so the field reads as a light-theme object.
- **Pixels → art:** each cell takes one palette fill (`fillRect`) plus one glyph from the `RAMP` `@%#*+=-,. ` (index by luma; dark cells get heavy glyphs, bright cells get sparse dots/space, space cells only paint the fill). Glyph ink is the cell's own hue darkened ~58% (`cell[0]×0.42, cell[1]×0.44, cell[2]×0.46` at 0.85 alpha) — the texture is the photo's own shadow, no second color system.
- **Reveal sweep:** on load, visible fields run a one-time diagonal reveal — top-left → bottom-right in `(x/W + y/H)` order via `clipReveal` — duration **1150ms**, ease-out `1 − (1−t)^2.2`, with the front tracked over `maxFr 2.35` (−0.35 start offset) so every cell is covered. Fields offscreen at load hold `data-ground` until an IntersectionObserver (rootMargin 160px) fires the sweep once.
- **Motion off-ramp:** under `prefers-reduced-motion: reduce` the field never animates: `paintStatic()` renders the final composed frame immediately and the IO is never attached.
- **Canvas-off / JS-off behavior:** the DOM copy is never inside the canvas, so screen readers get everything from HTML. If the image fails (`image.onerror`) the canvas is removed and the section's CSS ground shows: hero = the hard-coded five-stop gradient `#2B58B8 0% → #24499B 46% → #3A67BE 55% → #46502C 62% → #3F5D33 100%` (a darker memory of the same field so cloud-white copy keeps AA contrast with no canvas at all); closing band = flat `--sky`. If JS or the canvas API is unavailable the same CSS grounds own the bands.
- **Resize:** reflow re-runs `prepare()` (re-deriving palette and frame for the new cell grid) after a 180ms debounce; resize never replays the sweep.

## Raster Provenance Policy

Every raster that ships in `docs/assets/` carries an embedded origin note readable from the file bytes (JPEG COM / PNG `tEXt`-layer text). The current scan passes **4/4**:

- **sky-field.jpg** — "Sourced stock photograph, not AI-generated." Unsplash photo id hNWMM2Mvzk4, "green grass field under blue sky during daytime" by Cristina Anne Costello (Danville, CA, USA; NIKON D800); Unsplash License, no attribution required; downloaded 2026-11-07 at 1920px width (q85) for self-hosting.
- **sky-closing.jpg** — "Sourced stock photograph, not AI-generated." Unsplash photo id lmKaZoKK6-g, "Bright blue sky with scattered white clouds" (Arizona, USA; Sony ILCE-6100, published 2026-07-06); Unsplash License, no attribution required; downloaded 2026-11-07 at 1600px width (q85) for self-hosting.
- **logo.png** (black mark, light grounds) and **logo-light.png** (inverted pure white, dark grounds) — "Derived from Logo.png at the repository root (2000x2000 PNG, black mark on opaque white; the same file the desktop app ships). Processing: downscaled to 512x512 (bicubic), white ground converted to transparency via luminance-keyed alpha, recolored pure black (#000) as docs/assets/logo.png for light grounds, and inverted pure white as docs/assets/logo-light.png for dark grounds. Recreated 2026-11-07."

**Policy:** no shipping raster may enter `docs/assets/` without its embedded note. AI-generated imagery is *not prohibited* but must say so in the note ("AI-generated…"), and no raster may imply it shows the real app UI unless it actually does — currently none do; the site ships with zero app screenshots. New derived marks must name their source file and processing.

## Accessibility

- **Contrast pairings (verified):** `--cloud` (#F6F9FC) on `--sky` (#2E5FC8) = **5.55:1** (AA normal text), which covers the band copy, the CTA, and the `row-get` hover state (`--sky` face, `--cloud` text); the hero/band copy additionally sits over ink veils that composite darker, so the standing figure is at least that. `--ink` (#132A4A) on `--paper` = **13.7:1**; `--ink` on `--cloud` (CTA face / `row-get` rest state inverse) = **13.7:1**; `--ink-soft` (#46608A) on `--paper` = **6.0:1** (AA at body sizes). The declared-but-unconsumed `--gold` reads **2.4:1** on paper — decorative only, never text; `--green` reads **4.8:1** on paper (passes AA, though unused as text in the current build).
- **Focus:** single global `:focus-visible` treatment — 3px solid `--sky` outline, 3px offset — on both pages, visible over paper and field alike. Hover/focus are linked: nav underline draws, rows fill, `row-get` recolors on keyboard focus exactly as on pointer hover.
- **Reduced motion:** `prefers-reduced-motion: reduce` kills the renderer's sweep (immediate static frame), all view-transition `transition: none`, and the CTA hover lift; the CSS `@media` blocks in both pages declare this explicitly.
- **Canvas-off:** copy is never trapped in the canvas (canvases are `aria-hidden="true"`, all messaging is HTML); failed image loads or disabled JS/canvas degrade to the CSS gradient grounds with AA contrast retained — the hero fallback gradient was tuned darker than the live field precisely for that reason.
- **Semantics:** one `h1` per page; the promise is a real `<dl>` (each `.spec` row is a `dt`/`dd` pair); downloads are real links (each whole `.row` is an `<a>` to the release URL, with the build name and device text inside); both `nav` elements carry `aria-label`s; decorative logo images use `alt=""` with the adjacent wordmark text carrying the name; canvases are `aria-hidden="true"` under labeled sections.
