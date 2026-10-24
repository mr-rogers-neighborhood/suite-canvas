# ADR-0043: What a card face says

- **Status:** proposed
- **Date:** 2026-10-24
- **Related:** [ADR-0034](./0034-ice-primary-rendering-engine.md), [ADR-0036](./0036-fractal-lod-and-icon-graph.md), [ADR-0039](./0039-boards-are-containers-views-are-cameras.md), [ADR-0040](./0040-the-type-graph-is-withdrawn.md), [ADR-0041](./0041-links-may-end-on-a-board.md), [`docs/roadmap/ice-parity.md`](../roadmap/ice-parity.md) §9, [`docs/fractal-interface-research.md`](../fractal-interface-research.md) §1.1–1.2

## Context

A card on the ICE desk is a **paper raster with one text flow on it**. `suite.card` reuses the
engine's paper pass, and the projection hands it `faceText` — title, a blank line, body — as plain
characters (`useIceProjection.ts`). Everything the React Flow era drew through `NodeCard` is gone
from the face: bold, links, mentions, inline images, the type chip, tag chips, property chips, the
reference count and the `⋮` menu. The parity matrix files all of that under "G polish", which is why
this ADR exists: a rung-by-rung content contract has to be decided before anyone implements rows of
it piecemeal.

Three engine facts bound the answer, and they are the whole argument:

1. **One raster per card, one face per raster.** `TextRaster.raster(layout, face, box, band, bleed)`
   takes a single `face` name for the whole layout, and `HandLayout` has no per-glyph face. Marks
   therefore cannot be mixed into one sheet.
2. **The ink shelf is shared and finite.** `INK_PAGE` 2048 × `INK_LAYERS` 4 r8, 16 MB for *every*
   card on the desk. `PaperPass.alloc` returns `null` when the shelf is full and the card then draws
   **its paper alone** — no writing at all.
3. **A face can only be a family and a weight.** `FaceSpec` is `{ family, weight, url? }`. Suite's
   faces are `system-ui` (`SUITE_PEN_FACES`), so the desk's second face name (`caveat-bold`) is
   weight 600 and *italic is not expressible* without shipping an italic font file.

Two counterweights:

- `SUITE_CARD_DOM_FACE` is **false**: the sheet *is* the card, deliberately (no overlay to pop in, no
  second renderer). ADR-0034 keeps the DOM editor for the *active* card only, behind an intent dwell
  and an editor budget.
- `docs/fractal-interface-research.md` §1.1 already states the band contract: `full` = body ≥ 11 px
  effective + mounted editor + chrome; `compact` = title + type glyph + counts, **no body**; `icon` =
  glyph only, and "text smaller than 9 px effective at rest is a rendering bug". §1.2 measured that a
  motion frame paints GPU proxies and a settle frame mounts editors at ≤ 6 per frame. Nothing in this
  repo has measured a card face's frame cost; the only measured DOM-over-WebGPU composite is
  ADR-0040's full-viewport shade at **42 → 35 fps**.

### The reference card is 700 × 240 CSS px

That is the box a reader actually reads a card in — a wide, short card. Two numbers follow, and both
are independent of the rung:

- **~5 lines of body.** The hand is `13 × rung` world units at 1.45 pitch with 14 × rung padding; a
  700 × 240 box lands at 26–32 px of type and about five lines of it.
- **~40 characters per line.** The title row is where chrome would go, and forty characters is the
  whole budget. A tag name is ~10 characters: a quarter of the title. A property pair
  (`Status: Blocked`) is ~18: half of it.

That single measurement decides most of this ADR: **anything that is not a number has to share the
title's line, and a strip of chips costs 30 % of the card's body.**

## Decision

### 1. Rich text stays on the sheet, and its marks are not drawn

The sheet keeps the characters; the canvas does not draw weight, links, mentions or inline images.
Formatting is read where it can be read: the **inspector**, and — once the in-place editor lands (the
"B editing" workstream) — the **active card**, which is a real Tiptap document at full LOD.

Cost: zero frame time, zero editor budget, no change to `SUITE_CARD_DOM_FACE`, no second raster. What
a reader loses is the *look* of a bold word on a passive card; what a reader keeps is every character
of it, plus a face that never pops, never unmounts and never costs a shelf carve.

The face does gain **structure** instead of marks (decision 2): the title is its own first line with
its type glyph, the body is body. That is the part of the flow-era face that carried meaning at a
glance, and it is free.

### 2. The chip row is one line of the same raster

There is no chip *row*. The card's first line becomes a **title row**: `glyph · title · counts`, all
characters in the same text flow, so it costs one line of text and no new raster, no DOM, no second
pass. Drawn in world units, it scales with the hand and stays crisp through the engine's banded
re-raster.

What each item is worth, rung by rung:

| Item | Rung 1 (288 × 240) | Rung 2 (576 × 480) | Rung 3 (1152 × 960) |
| --- | --- | --- | --- |
| Type glyph (1 char) | **yes** — the only type cue there is | yes | yes |
| Reference count (`⇄3`, only when > 0) | **yes** — 2–4 chars, says "this card is connected" | yes | yes |
| Tags | **no** — a name is ¼ of the line | **count only** (`#3`), never names | count only |
| Properties | **no** — one pair is ½ the line | **no** | **no** — the room is page, not chrome |

The band still gates the face, unchanged from §1.1 of the research: `icon` (< 56 px) draws no text at
all, `compact` (56–179 px) draws the title row only, `full` (≥ 180 px) adds the body. A card at rung 3
is not a card with more chrome; it is the same card with more page.

Property chips, tag *names*, the meta toggle and the `⋮` menu do **not** return to the face. The
inspector owns properties; the context menu already owns the actions (`IceContextMenu`); the only
thing the flow era had that is missing is a hint that a card *can* be opened, and that is the
in-place editor's job, not a badge's.

### 3. A whiteboard previews its drawing, from rung 1 up

The flow era drew `WhiteboardCardFace`; today a whiteboard is blank paper until it is opened. That is
the one card whose entire content is a picture, so "draw the text, not the picture" leaves it empty.

**A whiteboard card draws a cached thumbnail of its drawing at every rung at or above 0.5** — i.e.
whenever it draws text at all — and the title row sits above it. The paper pass has no image channel
(its "card material" is a second pipeline over the *same* ink pages), so this is a new face, not a
prop: `suite.whiteboard` draws one textured quad from an `ImageBitmap` rasterised out of the existing
`WhiteboardPreview` SVG, once per drawing commit, at ≤ 512² — written on settle, never per frame. That
is the only GPU texture in the product keyed to a card, and it is bounded by the number of visible
whiteboards.

Interim, if that kind is not built in this phase: the whiteboard's title row says `▤ Whiteboard · 42`
(its stroke count, which the drawing binding already knows). A count is not a preview, and this ADR
does not pretend otherwise — it is the honest stopgap, and the texture face is the deliverable.

### 4. A Board's mat says its name at rest

A Board is a container, and a container that is unlabelled at rest is unidentifiable at the only zoom
a reader looks at a *plane* (fit, ≈ 0.12). The mat prints its name in world units, which is a smudge
below ~5×, and `suite.board` already suppresses that print.

So the screen-space face carries the name **at rest**, in the `compact` and `full` bands, with the
colour dot. Selection adds detail — the card count — and never reveals the name. (Implemented; the
face band thresholds are unchanged, so this is a paint rule, not a new band.)

This reverses the previous rule ("an idle canvas carries no overlay at all"). A Board was the one
object for which that rule was wrong: the mat carries its material but cannot say its name, and a
frame's identity outranks its contents exactly where its contents are unreadable.

### 5. Six colours, six mats

`boardColors` has six values. The mat had three vinyls (`sage`, `slate`, `charcoal`), so blue,
violet and slate were the same material, and amber and rose were the same material — two Boards of
different colours could be drawn identically. That is a rendering bug, not a palette opinion.

The mat program does not have three colours: it resolves `props.vinyl` **by name** through
`palette.vinyls`, and a host may define as many names as it likes. So the *rendering* was the narrow
side, and it is the side that changes:

- `SUITE_BOARD_VINYL_BY_COLOR` is now an identity map onto six Suite vinyls (`board-slate`,
  `board-blue`, `board-green`, `board-amber`, `board-rose`, `board-violet`), each a desaturated,
  mat-like tint of its accent;
- the six inks live in `suitePalette` (`SUITE_BOARD_VINYL_INKS`), which is where a palette belongs —
  the same place the card's paper and ink come from;
- the names are prefixed so they never shadow ICE's `slate`/`charcoal`, which stay in the enum so a
  document projected by an older build still resolves.

**The six differ in value as well as hue on purpose.** ICE's night chain is a steep, blue-leaning
tone curve: ADR-0040 measured 0.5 landing at `#2d353c` and 0.78 at `#3f4649`, so a 0.28 spread of
input value reaches the eye as ~0.07. Hue is therefore the primary carrier and lightness the
backstop — a mat pair that differs only in value would be the first to collapse, and a pair that
differs in both has two chances. Six is honest only if that survives measurement: **the acceptance
test is one screenshot per theme with all six mats side by side.** If two collapse, the fallback is
three mats plus the accent dot — recorded here so the fallback is a decision rather than a drift.

The `boardColors` schema does not change. This is the narrower of the two edits and it needs no bump,
no migration and no `packages/graph` change.

## Consequences

- **The card face has a contract** that fits in a sentence and a small table: title row, body,
  nothing else; counts are characters, names are the inspector's.
- **Formatting on a passive card is knowingly absent.** A bold word reads as plain text until the
  card is opened or inspected. This is the price of one raster per card, and it is the price we
  choose to keep paying; the moment formatting becomes product-critical, the lever is the editor
  (already planned) and not the sheet.
- **The face gains a vocabulary it must keep small.** Every future "wouldn't it be nice on the card"
  meets the same budget: ~40 characters on the title line, ~5 lines of body. The type glyph map is
  the one thing that will want to grow.
- **A whiteboard costs a texture.** It is the only card kind with an image face, and it needs a
  rasterise-on-settle path and a cache keyed by card id.
- **Boards are legible at rest**, and two Boards of different colours are no longer the same object.
  The board face stays a screen-space layer with no overlay on the mat itself.
- **The DOM overlay is untouched.** `SUITE_CARD_DOM_FACE` stays false; the only DOM card surface is
  the editor ADR-0034 already budgeted, plus the Board face that already exists.

## Rejected alternatives

- **Banded re-raster carrying weight (and italic).** The marks a sheet *could* carry are fewer than
  they look: `HandLayout` has no per-glyph face, so a bold run means a second raster per card — a
  second carve from a shelf that is already 4 × 2048² for the whole desk, and cards lose their
  writing entirely when it fills. Italic is not expressible at all (`FaceSpec` has no style, and
  Suite's faces are `system-ui` with no file). Halving the number of cards that can show text, to
  bold a word on cards that are not being read closely, is the wrong trade for a reading surface.
- **A DOM overlay for text at close zoom.** It is the flow era's answer, and it contradicts
  `SUITE_CARD_DOM_FACE` directly: a card that is a DOM document above a readable width is a card that
  pops, unmounts, and costs an editor per card in view. The measured cost of a composited DOM layer
  over this surface is 42 → 35 fps (ADR-0040), for *one* layer; a per-card one is not a candidate.
  The editor returns at full LOD for the active card only, which is where marks can be read anyway.
- **Tag names and property chips on the face.** At 700 px wide the title line holds ~40 characters; a
  tag name is a quarter of it and a property pair is half. The reader who wants the tags is inspecting
  the card, and the inspector is already open in that moment.
- **A second source of truth for a Board's colour.** Mapping six palette colours onto three materials
  and calling the accent dot "the colour" was the status quo; it is exactly the kind of silent
  collapse this ADR exists to end.
- **A schema change to three colours.** Additive-first makes removing three enum values a migration
  with a forced recolour of existing Boards; the material could carry six all along, so the schema was
  never the narrow side.

## Work this defines

1. **Title-row face text** (`useIceProjection.ts`, `faceText`): `glyph · title · ⇄n · #n`, with the
   type-glyph map and the reference/tag counts read from the existing `cardMeta`/`cardReferences`
   projections. One line, world units, no new raster. Tests: the composed string per rung/band.
2. **Band contract on the face**: `icon` draws no text; `compact` draws the title row; `full` adds the
   body. Today `faceText` is one string at every band, so the engine's greek is the only rule.
3. **`suite.whiteboard` textured face** plus the rasterise-on-settle cache from `WhiteboardPreview`;
   interim: the whiteboard title row prints its stroke count.
4. **Board mat measurement**: six mats photographed in both themes, recorded in the parity matrix; if
   two collapse in dark, three mats + accent dot becomes the answer.
5. **The `⋮`-less face is final**: no menu badge on the card. If "this card can be opened" turns out
   to be unlearnable, the fix is the in-place editor's hover affordance, not a chip.
