# ADR-0039: Boards are containers, Views are cameras

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0010](./0010-workspace-boards-and-cards.md), [ADR-0035](./0035-views-pins-and-portals.md), [ADR-0036](./0036-fractal-lod-and-icon-graph.md), [ADR-0037](./0037-graph-projection-and-ambient-layer.md), [ADR-0034](./0034-ice-primary-rendering-engine.md)

## Context

Three nouns had drifted apart from what they do:

- a **Section** was a titled region on a board: geometry with a label, owning nothing;
- a **Board** was a named set of placements, which made it a *projection* rather than a container —
  the same card could appear on several, which is what ADR-0035's multi-placement was for;
- a **Portal** was a card whose only job was to point at a Board so that one board could be seen from
  another.

Meanwhile the canvas became infinite and fractal. A container that owns its contents is now the
natural primitive: it is what makes nesting meaningful, what makes "enter this thing" a camera move
rather than a special card type, and what the ICE projection already implements (mini mats hold
frame-local children, and mats already nest inside mats).

## Decision

### 1. A Board is a container

A **Board** is a titled, coloured frame that holds cards and other Boards. It is backed by ICE's
`desk.minimat`, so it has a rect, a name, a colour, a z-rank and an optional parent Board. Cards
belong to exactly one Board; a Board's rect is expressed in its parent's frame.

This **deletes multi-placement**, and with it the awkward cases it created: a card could previously
be on two unrelated boards, so "where is this card?" had no single answer and selection could not be
canonical. One position per card is now enforced by containment rather than by convention
(ADR-0036 asserted it; this makes it true).

### 2. The Portal card type is deleted

A portal was a card that pointed at a Board. A Board nested inside a Board *is* that relationship, so:

- `PORTAL_TYPE_ID`, `PORTAL_BOARD_FIELD_ID`, `createPortalCard` and the portal target field are gone;
- entering a Board is `enterContainer`, the same camera navigation a portal mat used;
- the portal **cycle guard** and the portal half of the **depth cap** go with it: containment is a
  tree, and a tree cannot cycle. The depth cap survives only as a projection budget
  (`SUITE_MAX_DEPTH`), not as a correctness guard.

This is why card types get cleaner — a portal was never a kind of note, it was navigation wearing a
card's clothes.

### 3. A View is a camera

A **View** is `{ id, name, camera: { x, y, zoom } }` and nothing else. It is what a tab is: a saved
framing of the same tree of Boards. Closing a tab files its View in the View drawer.

Because a View holds no placements, it **cannot disagree with the canvas**: there is no "the card is
in a different place in this view". That is the property that keeps switching Views from being a mode.

- Views are document-level (shared, listed in the drawer). Per-user Views would be a separate map
  later, the same shape as per-user pins.
- A View's camera is written when the user leaves it, not per frame.

### 4. Share scopes follow the nouns

`workspace | board | card | selection`. A `board` share now means "this Board and what is inside it",
which is what people already assumed. A view share makes no sense — a camera is not content — so no
scope is added for it.

## Migration (one-shot, on load, schema bump)

1. Every `Section` becomes a `Board`: same rect, title and colour (a Section already had all three).
2. Every `Portal` card becomes the Board it pointed at, nested at the portal card's placement, and the
   card is removed.
3. Every Board (the old tab) becomes a `View` holding that tab's last camera.
4. `Placement.boardId` keeps its field name and now references a Board.
5. A placement whose Board is missing falls back to the root plane **and is reported once** in a
   migration report — never silently dropped.

The migration is covered by tests that take an old document and assert the new one: rects, titles and
colours preserved, portals converted, nested areas nested, nothing lost.

## Consequences

- **Structure is fractal for free.** A Board inside a Board is depth, which the projection already
  draws, the camera already enters, and the graph projection already aggregates.
- **A Board's mat gives continuous scale** for its contents: scale the Board and its children lay out
  once, at their own size. The quantized type ladder is then only needed for a card resized on its own.
- **Deleting is scarier.** Removing a Board must decide what happens to its contents; the decision is
  "adopt them into the parent plane" (never delete them), because a Board is a frame, not a folder.
- **Old names are recorded here** so nobody re-introduces a Section or a Portal card thinking it is
  new: if a future feature wants "a card that points at a place", it is a Board reference or a pin,
  not a card type.
- **Vocabulary churn is paid once.** `sectionColors`, `sectionColorSchema` and similar are kept as
  deprecated aliases for one release so imports do not all have to change at once.

## Rejected alternatives

- **Keep Sections and add Boards beside them.** Two nouns for "a titled region" is how the confusion
  started; a Board that is not a Section is just a Section with better branding.
- **Keep portals as cards.** A card whose content is "somewhere else" cannot be rendered, cannot hold
  text, and needs its own cycle and depth guards — three burdens that exist only because containers
  were not first-class.
- **Multi-placement with canonical selection.** ADR-0035 deferred it and it has stayed unsolved
  through two engines; nesting solves the same need (show this grouping elsewhere) without asking
  "which one is the card".
- **A View that owns placements.** That is a second layout: the same card in two places, with the
  camera as a cover story.
