# ADR-0058: A tour is one document on three surfaces

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0045](./0045-handbook-articles-are-cards.md) (handbook articles are cards),
  [ADR-0050](./0050-one-inspector.md) (one inspector), [ADR-0054](./0054-a-tutorial-is-a-card.md)
  (a tutorial is a card), [ADR-0055](./0055-hover-peek-names-an-entity.md) (hover-peek names an entity),
  [`useUiStore.ts`](../../apps/canvas/src/store/useUiStore.ts)

## Context

[ADR-0054](./0054-a-tutorial-is-a-card.md) settled that a tutorial is a card and a step is a block in
its body. It did not settle who drives playback. Two answers looked plausible and they are usually
called the same thing:

- give the property inspector a **tour mode**, so the panel that edits the card also plays it;
- let the **handbook panel** drive playback, so "explain this screen" and "walk me through this
  screen" are one gesture.

They are not one gesture. A handbook article answers *what is this thing on my screen?* — contextual
retrieval, no order, no end ([ADR-0045](./0045-handbook-articles-are-cards.md)). A tutorial answers
*how do I do this, in order?* — a sequence with progress and an end. If the handbook drove playback,
any set of highlights would become a tutorial, and the handbook's retrieval-by-what-is-on-screen
would stop distinguishing anything. The panel alone is the other half of the problem: a tour that only
exists inside an editing panel cannot be shared, presented to another person, or read without the
drawer open.

There is a second, quieter force. A step's attributes live inside a card body, so a step that holds one
`target` and later needs several is a content migration across every tutorial ever written. The shape
has to be right before the first tour is authored.

## Decision

**A tour is one document on three surfaces, and none of them owns a second copy of it.**

1. **The tutorial card's inspector is the author's control surface.** Tabs **Details · Steps · Style**.
   Steps lists the step blocks, adds one through the existing target picker
   ([ADR-0044](./0044-one-target-primitive.md)), reorders them, and carries a **Present** control.
   It is the card's own panel, not a new panel kind ([ADR-0050](./0050-one-inspector.md)).
2. **Presenting is a mode of that panel.** While presenting, the same panel shows the current step,
   previous/next, a scrubber, and the caption in the real rich-text editor. The author **may edit a
   caption while presenting** — writing a caption while looking at the thing it describes is the point
   of the mode.
3. **The tour overlay is the reader's view.** Spotlight, dimming, a caption bubble, previous/next and
   progress. It works with no inspector open, so a tour can be shared or presented to someone else. A
   reader without edit rights sees it read-only, and a share never exposes the panel's editing surface.
4. **The handbook panel stays contextual and unchanged in kind.** It lists articles by what is on
   screen and offers a **Play** control for any tour whose steps include the article's subject. It does
   not own playback and it does not gain a step list.
5. **A step may point at several things.** `targets: Target[]`, at least one, and the **first is
   primary** — "these three cards form a group", "the connector and the section it lands in". The
   primary is what a single-target consumer (a badge, an outline, a dead-target tombstone) reads.
6. **Content is the card, control is the store, completion is the workspace.** See the split below.
7. **The overlay measures the DOM.** It reads `data-node-id` on cards and
   `data-testid="section-region-<id>"` on sections, not React Flow internals, which is why the tour
   feature needs no edit to `CanvasBoard.tsx` and why the anchor test in ADR-0054 §10 has something
   stable to check.

### The three surfaces

| Surface | Whose | What it does |
| --- | --- | --- |
| Tutorial inspector — Details · Steps · Style | author | lists and reorders steps, adds one through the target picker, presents, edits the caption |
| Tour overlay | reader | spotlights the targets, dims the rest, caption bubble, previous/next, progress |
| Handbook panel | reader | lists articles by what is on screen; starts a matching tour |

### The state split

| Thing | Where | Why |
| --- | --- | --- |
| steps, captions, `targets[]` | card body in the CRDT | content: collaborative, versioned, exported, linkable |
| which step is showing, panel open, presenting | `useUiStore`, same shape as `containerInspector` | per-viewer: one person presenting must not move another person's panel |
| completion | a workspace record on the tutorial card | a collaborator sees "read" ([ADR-0054](./0054-a-tutorial-is-a-card.md) §9) |
| the camera a step asks for | `viewportRequest` in `useUiStore` | the existing channel; no second camera API |

## Amendment — 2026-10-25: recording is a purpose, and the step verbs author it

Recording got a state (`purpose: record`, ADR-0064) and it did not need a new canvas language: a step
already holds `targets[]`, so the three gesture verbs describe how an author adds targets.

| Gesture | In `purpose: record` |
| --- | --- |
| `place` | one step per click, with the clicked entity as its only target |
| `thread` | one step per click *in sequence* — each click appends, the tour reads top to bottom |
| `web` | one step that **accumulates** targets from one origin — several entities spotlighted together |

1. **A tour's order is its step list, never links.** Recording writes step blocks; it draws no edges,
   so a tour cannot drift out of order because someone tidied the board's links.
2. **`purpose: record` places the tutorial card first.** Choosing record and placing on an empty board
   creates the tutorial card (the thing the steps belong to), then arms the step verbs.
3. **The panel is still the editor.** A recorded step is a step block like any other, so the author can
   rename it, reorder it, add a caption or drop a target in the Steps tab while recording — the same
   "author may edit while presenting" rule the third surface already allows.
4. **Leaving record stops recording and keeps the card.** The tutorial card is a card: it can be
   unplaced, re-placed and edited exactly as before.

## Consequences

- **No presentation engine and no fourth panel kind.** The overlay is chrome over the canvas the step
  already describes, and the control surface is the drawer that already exists.
- **One document inherits everything** — tags, links, backlinks, sharing, export, lenses — because a
  tour is still a tutorial card (ADR-0054).
- **Editing while presenting is a real constraint.** The caption editor must take keystrokes without
  stealing the camera or the reading position, and a collaborator editing the same caption sees the
  same CRDT merge as anywhere else.
- **Presenting state is not shared.** Two people looking at one tutorial can be on different steps,
  which is correct: the reader's position is theirs. Only completion is written.
- **A share has one surface to gate.** The overlay renders read-only for a reader without edit rights;
  the panel never appears in a share projection at all.
- **`targets[]` is enforced at the schema boundary.** "At least one" is validation; "first is primary"
  is convention, so every consumer that needs exactly one target reads `targets[0]` rather than
  searching for a match.
- **The overlay is testable from the DOM.** Anchors are attributes, so a shipped tour can fail CI when
  a target disappears, and the e2e test does not depend on the renderer underneath.

## Rejected alternatives

- **The handbook driving playback.** It collapses "what is this?" into "how do I?", so any highlight
  becomes a tour and the panel's contextual matching stops meaning anything. It also makes the reader
  open the handbook to be shown something.
- **The inspector as the only surface (no overlay).** A tour could then only be read by whoever has the
  drawer open with write access: nothing to share, nothing to present, and the caption sits next to a
  step list that is not part of the reading.
- **A separate tour record or root map.** A second document shape that cannot be tagged, mentioned,
  shared or embedded, duplicating what the card already is (ADR-0054 rejects the same thing).
- **A second panel for tours.** The drift ADR-0050 exists to prevent: another open flag, another
  Escape, another read-only rule, another chrome to keep in line.
- **Dynamic captions derived from the target** (its title, its type, its fields). A caption says what
  the step *means* and why it matters, which the target does not know; derived text also silently
  changes when the target is edited, so a tour would rewrite itself under the author.
- **One `target` per step, widened later.** The widening is a content migration across every authored
  tutorial, for a shape we can get right now.

This ADR records direction; nothing here is built yet.
