# ADR-0066: One modifier vocabulary, and a fourth purpose that explains a selection

- **Status:** proposed
- **Date:** 2026-10-25
- **Related:** [ADR-0044](./0044-one-target-primitive.md) (one target primitive), [ADR-0045](./0045-handbook-articles-are-cards.md) (handbook articles are cards), [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md) (a view is a lens, a database or a render), [ADR-0061](./0061-three-ways-to-draw-links.md) (three ways to draw links), [ADR-0064](./0064-two-axes-and-a-cursor-that-says-so.md) (two axes and a cursor)

## Context

The gesture control already teaches a modifier vocabulary, quietly: hold **shift** while a link
drag is in flight and it reads `thread`, hold **ctrl** and it reads `web`. `pattern` — the fourth
value of the same family — has no key at all and can only be reached by cycling the button. The
purpose control beside it has three values and no modifiers, so two widgets that answer the same
kind of question behave differently.

At the same time the purpose family looks unfinished next to a four-value gesture family, and there is
a real fourth thing to do with a canvas that has no home: **explain**. [ADR-0045](./0045-handbook-articles-are-cards.md)
gave the handbook a picker that inverts the relationship — "Explain this" turns the next interface
click into a `Target` and opens the matching article. The inverse has no entry point: *select three
cards and a section, and ask what this collection is, what it could be, and what documentation already
covers it.*

Two constraints make the keyboard design the hard part. Modifiers are already overloaded — shift and
ctrl are multi-select on the canvas, ctrl is undo/redo everywhere, and alt is the one key this product
barely uses. And a mode that changes on keydown is a trap: `ctrl+z` would flash a purpose change on
every undo.

## Decision

**One modifier map for both families, previewed rather than committed, and `explain` as the fourth
purpose.**

1. **One map, both families, positional.** No modifier is the resting value, then shift, ctrl, alt take
   the second, third and fourth. Gesture: `place · thread · web · pattern`. Purpose:
   `explore · run · record · explain`. The structure is deliberately positional rather than semantic:
   a reader learns "modifiers pick the value" once and it holds on both widgets, which a per-family
   mnemonic would not.
2. **A modifier previews; it never commits.** Holding one paints the value it would choose, exactly as
   the gesture control already does; releasing restores the stored value. A value is committed by an
   explicit act — clicking the control, or starting the gesture that consumes the hint. This is the
   whole reason the map is safe: shift/ctrl/alt are undo, multi-select and browser shortcuts, and an
   axis that changed underneath a reader on keydown would be a trap no label could undo.
3. **`alt` becomes `pattern`.** The last free modifier goes to the one gesture value with no key, so
   the whole gesture family is reachable without cycling. Cheap, and it is what makes the map complete
   rather than three-quarters of a rule.
4. **The fourth purpose is `explain`.** In it, selection is a question rather than a command: what you
   select is gathered into a scoped, temporary context — the entities, their types, their fields, the
   links between them — and answered from the handbook ([ADR-0045](./0045-handbook-articles-are-cards.md)).
   It is the exact inverse of that ADR's picker: the picker turns one click into a `Target`, explain
   turns a selection into a query over targets. It claims clicks like `run` and `record`, and it
   ignores the gesture axis the way `present` does.
5. **Explain writes nothing until it is told to.** The context is UI state. "Save" turns it into a
   *view* ([ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md)), which is where it becomes persistent,
   shareable and re-openable — so explain becomes the fastest way to *author* a view, not a new kind of
   object. Nothing about entering the purpose touches the document.
6. **The selection vocabulary is shared with views.** "This one datum" and "these as an aggregate" must
   mean the same thing when selecting for explain and when selecting inside a view, so the modes are
   defined once and consumed by both. That definition is its own ADR; this one only fixes that there is
   one.
7. **Overload is resolved by scope, never by a new key.** Shift and ctrl keep meaning multi-select on
   cards — `explain` reads that same selection — and the gesture reads them only while a link drag is
   in flight. A modifier's meaning is decided by what has the pointer, not globally by the keyboard.

## What implementing the map settled

The keyboard half is built; `explain` is not, and its gate is why.

- **One module, two controls.** `apps/canvas/src/canvas/modifierPreview.ts` owns the positional rule
  (`modifierOffset`, `previewedValue`) and `useModifierState.ts` exposes it to a control that re-renders.
  The link tool keeps painting its hint from a ref — a re-render mid-gesture is the one thing that hint
  must not cause — but it now *asks* the same function, so the two widgets cannot disagree.
- **`alt` reaches `pattern` end to end**, which is what makes the map complete rather than
  three-quarters of a rule.
- **A click while previewing commits the previewed value**, so the modifier is a shortcut and not only a
  decoration: shift-click the purpose control means `run`. The label names that value, so the control
  never says one thing and does another.
- **An empty slot is empty.** A family shorter than the key map returns `null` for the extra key rather
  than clamping to the last value; a clamp would make alt a synonym for ctrl, which is worse than a key
  that does nothing. No live family is short a value now that `explain` is cyclable — the rule is kept
  because the map is positional, and `modifierPreview.test.ts` asserts it on a literal list rather than
  on the purposes, so the rule survives the family changing size again.
- **Typing is not a gesture.** Both listeners ignore events whose target is inside a text field, so
  holding shift for a capital letter no longer repaints the tool — a small bug the shared module fixed
  on the way in.
- **`explain` waits for its gate.** Adding a fourth purpose value now would put a mode on the widget
  that does nothing when clicked, which is exactly the shape `record` had before it was wired. The alt
  slot and the value are specified here; the behaviour is A41's work.

## Consequences

- **The gesture family becomes fully keyboard-reachable**, and the purpose family gains a fourth value
  without inventing new chrome: the control still cycles, and the modifier map is the shortcut.
- **The two widgets now behave identically under modifiers**, which is the consistency the author asked
  for and the reason to write this down rather than let each control invent its own keys.
- **`explain` is the cheapest possible on-ramp to the handbook.** It needs no new content and no new
  panel: it is a query over the selection plus the articles that already exist.
- **A fifth purpose would break the map.** Four values fit "resting plus three modifiers". A fifth would
  have to become a menu, or displace a modifier; this is stated so the next one is negotiated rather
  than assumed.
- **Alt is not free on every platform.** Some window managers grab alt-drag, and alt-click often means
  "download" in a browser. The map survives because alt only *previews* and because the value it
  previews (`pattern`, `explain`) is also reachable by clicking; a platform that eats alt loses the
  shortcut, not the feature.
- **Risk: two positional maps read as arbitrary.** "ctrl is the third value" says nothing about what the
  third value *is*. Accepted, because the labels and the glyphs carry the meaning and the position is
  what makes one rule cover both widgets.

## Settled by default

Four things the author raised and had not decided when this was written. They are settled here with
the pragmatic option so implementation is not blocked, and any of them can be overruled by editing this
section — none of them is load-bearing for the others.

1. **The name is `explain`.** Internal id `explain`, label "Explain". "Handbook" describes the *content*
   (ADR-0045) and "inspector" describes a *panel* we already have ([ADR-0050](./0050-one-inspector.md)),
   so both would collide with something that already means a thing. `explain` names the act.
2. **The preview listens window-wide, as the gesture control does.** Consistency is the entire point of
   this ADR, and a hint that only appeared when the pointer happened to be over one widget would be a
   different rule on each control. Two guards keep it honest: a hint is suppressed while a text editor
   has focus (so `ctrl+s` inside a card does not flash a mode), and it is suppressed while `ctrl`/`alt`
   is held with another key, because that is a command rather than a modifier. A preview is still only
   paint — nothing is committed by holding a key.
3. **The map is positional.** Shift = the second value (`thread`, `run`), ctrl = the third (`web`,
   `record`), alt = the fourth (`pattern`, `explain`). One rule for both widgets beats two clever ones,
   and the labels and glyphs already carry the meaning the position does not.
4. **A selection produces both, and "save as view" links them.** The context panel is the reading
   (what this collection is, what documents it), and the save action turns the same context into a
   prefilled query — the authoring path. Building the panel without the save would leave `explain` a
   reader with no output; building the save without the panel would leave it a query builder wearing a
   mode's clothes.

## Rejected alternatives

- **A modifier that commits.** Press-to-switch is one keystroke faster and unshippable: ctrl is undo,
  shift is multi-select, and a purpose that changed while a reader was holding a key to drag would be
  indistinguishable from a bug.
- **A fifth control for explain.** ADR-0064 already refuses a third row of buttons; the purpose family is
  the right place for a fourth thing to do with the canvas.
- **A second, purpose-specific modifier map** (say ctrl+1..4 for purposes). Two maps for two parallel
  families is the drift this ADR exists to prevent.
- **Explain as a panel rather than a purpose.** A panel that opens beside the canvas cannot turn the next
  click into a selection, which is the entire gesture.
- **Saving the context as a new object type.** A saved context *is* a view; a second object would
  duplicate queries, sharing and export for the sake of a different name.

## Amendment — a held modifier is a moment, not a pending click

The rule above says a held modifier previews and a click commits the previewed value. Shipped and
scrutinised, that gave one gesture two endings, and on the link tool the two disagreed outright.

**What was wrong.** The link tool's click cycled from the *stored* mode, not from the one on screen.
With ctrl down from `place` the chip showed `fan`; clicking committed `thread`, because `nextMode`
started at `place`. The button then displayed `fan`'s glyph over a stored `thread`, and releasing the
key repainted to `thread` — a mode the reader never picked. The purpose control committed its preview,
so the two controls behaved differently under the same key, which is the drift this ADR exists to stop.

**The rule now.** A held modifier is a **momentary override**, and it ends only when the key does.

- While a modifier is held, both controls **refuse the click**. The override is already in force and
  the canvas is already behaving accordingly; a click would try to make permanent something whose
  whole design is that it is temporary.
- Releasing returns to **the value the reader last clicked**, never to the preview. A held key cannot
  move the stored value by any route.
- A preview of the *stored* value (`ctrl` while already in `fan`) is not a preview at all. The label
  says "Release Ctrl to switch" rather than promising a switch the click will not perform, and no
  dashed edge is drawn, because there is nothing to distinguish.
- Both controls paint the held state with the same **dashed** edge, so one glance says the key is doing
  this and a click will not.

The cost is a shortcut: `shift` + click no longer means "set run". That is cheaper than the alternative
— a control that says one thing and does another — and the cycle still reaches every value in one to
three clicks, with the modifier naming what each click will pick before it is made.

**Why not the reverse** (honouring the preview on click in *both* controls)? It is coherent, and it was
the other candidate. It loses because these keys are already spoken for: ctrl-click is a context menu,
shift-click extends a selection, and alt-click is a window-manager grab on some Linux desktops. A click
arriving with a modifier down is more often one of those gestures landing on the widget than a request
for a specific mode, so the safe reading is the one that does nothing.

## Amendment — a key hands back what it displaced

Four values, three keys. Once the reader chose the second value in either family, every key pointed at
a value already on screen and the whole map went quiet: `shift` from `thread` previewed `thread`.

**The rule.** A modifier still means its own slot. When the stored value already *is* that slot's
value, the modifier hands back **the value it displaced** — the one before it:

| stored | shift | ctrl | alt |
| --- | --- | --- | --- |
| `place` | `thread` | `fan` | `branch` |
| `thread` | `place` | `fan` | `branch` |
| `fan` | `thread` | `thread` | `branch` |
| `branch` | `thread` | `fan` | `fan` |

Stepping back rather than stepping forward keeps the key's identity: `shift` never stops meaning "the
second value". Because the control is a forward cycle, the value before the current one is also the one
the reader last left, so "previous" reads correctly in both directions.

The cost is that from `branch` no key reaches `place` and from `fan` none reaches `place`; one click on
the cycle does. The gain is that no key is ever a no-op, which is the property that matters for a bar
you glance at mid-gesture.

**Companion fix: preview by attribute, not by class.** The link tool painted its hint by adding
`is-thread` / `is-fan` / `is-branch`. A class can only *add* a look, so previewing the resting `place`
from `thread` removed the class, nothing replaced the stored mode's `[data-mode="thread"]` mapping, and
the chip stayed inverted over a dark glyph while the purpose chip beside it correctly went to the
baseline. Both controls now paint the same way: `data-mode` / `data-purpose` is the committed value,
`data-preview` is the held one, and the tie-break block in `global.css` decides the collision. The link
tool still writes it from a ref rather than a re-render, so nothing about the no-re-render-mid-gesture
rule changes — it writes `node.dataset.preview` instead of `classList.toggle`.

`modePalette.test.ts` now asserts a `[data-preview]` mapping for **all eight** values rather than the
four purposes: the missing `place`/`thread` mappings are exactly what let the stored mode keep winning.

## Amendment — explain is a mode, not only a key

§4 specified `explain` and gate A41 held it back, so the value existed as a colour and a preview
while the cycle stayed at three. The author asked for it as a mode the reader can walk into: "its own
mode that can be cycled instead of only alted into."

**What changed.** `explain` is in `canvasPurposes`, in `choosablePurposes`, and therefore in the cycle:
explore → run → record → explain → explore. `previewablePurposes` is now the same list — the two names
survive because they answer different questions (what the control cycles, what a key can point at),
and the gate that made them differ is closed. The refusal in `PurposeControl` is gone with it.

**Why this is not the dead mode the ADR refused.** The refusal was about a value that does nothing when
clicked. Two things close that gap without pretending the handbook is built:

- **It gathers.** Entering explain mounts a context panel over the canvas: the selected entities, their
  types, the fields they carry, and the links between them. `canvas/explainContext.ts` is that
  gathering as a pure function, and `components/ExplainPanel.tsx` is its surface. It reads
  `selectedNodeIds` and the snapshot and writes nothing.
- **It says what it does not do.** The panel's footer states that the context is read-only and that
  saving it as a view is its own gate, because a panel with no Save button otherwise reads as
  unfinished.

So the purpose now has a verb — *gather this selection* — and the remaining half, answering the
context from the handbook articles ([ADR-0045](./0045-handbook-articles-are-cards.md)), is still A41's
work and still labelled as such.

**What entering it does not do.** It ignores the gesture axis the way `present` does (`initialGestureFor`
returns `null`): the gesture describes what a link would do, and explain draws nothing. It claims clicks
(`purposeClaimsClicks`), because selecting is how the context is assembled — and selection is shared with
everything else, so no key changes meaning.

**Placement of the surface.** Bottom-left, immediately right of the widget column. The bottom-right
corner belongs to the inspector (`z-index: 25`), so a panel there is *behind* the inspector exactly when
explain has something to say; the tour caption owns the gutter itself, and a tour cannot be presenting
while explain is the purpose.

**The modifier matrix survives the fourth value**, and is now exhaustive: four stored purposes × three
keys name all four purposes exactly once, and the e2e matrix (`e2e/tests/modifier-matrix.spec.ts`)
asserts the glyph *and* the painted colour of every cell in both themes. That matrix is what caught
`branch` + ctrl painting fan's glyph in branch's green.

**Correction to the amendment above — the collision answer is the baseline, not the previous
value.** The first implementation stepped a colliding key back one slot. From `thread` that gave
`place`, which satisfied the case the author reported; from `fan` it gave `thread`, which shift was
already showing, leaving `place` reachable from nowhere. The author hit exactly that: "both show thread
mode, leaving a mode unaccounted for/unreachable."

The answer is the **resting value**: it is the one slot no key claims, so "the stored value plus the
three keys name the whole family exactly once" holds from every state. The implementation derives the
missing slot rather than hard-coding index 0, so a family of a different size still closes. Both
matrices assert the property, not the table: `modifierPreview.test.ts` for the values,
`e2e/tests/modifier-matrix.spec.ts` for the values *and* their colours.
