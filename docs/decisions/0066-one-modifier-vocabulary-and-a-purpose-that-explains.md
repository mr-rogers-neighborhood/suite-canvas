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
