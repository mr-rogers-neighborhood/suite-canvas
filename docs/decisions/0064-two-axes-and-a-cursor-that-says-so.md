# ADR-0064: Two axes — what the canvas is for, and what the next click does

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0061](./0061-three-ways-to-draw-links.md) (the link shapes),
  [ADR-0063](./0063-placement-is-a-mode-too.md) (placement as a run),
  [ADR-0049](./0049-a-mind-map-mode-and-patterns.md) (patterns, and what a mind-map mode is),
  [ADR-0058](./0058-a-tour-is-one-document-on-three-surfaces.md) (a tour on three surfaces),
  [ADR-0044](./0044-one-target-primitive.md) (one target primitive),
  [ADR-0046](./0046-the-shell-derives-its-colour.md) (the shell derives its colour),
  [ADR-0005](./0005-flow-space-presence.md), [ADR-0009](./0009-live-drag-presence.md) (presence),
  `apps/canvas/src/canvas/ModeControl.tsx`, `apps/canvas/src/collab/presence.ts`

## Context

One control has been carrying the whole state of the canvas. `place · thread · web · pattern` says
what the *next click* does — and it works, because a click genuinely cannot mean two things. But the
author's notes name a second question that control cannot answer: **what is the canvas for right
now?** Exploring, running a sequence of placements, recording a tour, presenting one. Those are not
gestures. Folding them into the same cycle would give one control seven values and no readable state.

Three pressures make this concrete:

1. **A run is invisible until it ends.** ADR-0063 gave a run a held stack and a progress count in the
   control under the zoom widget, but nothing in the interface says "you are in run mode"; a reader
   who looked away and came back sees a link tool with a number in it.
2. **Recording does not exist as a state.** A tutorial card can be authored in its panel and presented
   in an overlay (ADR-0058), but "I am now recording what I click" has no flag, no cursor, no header.
3. **Presence says where people are, not what they are doing.** Twelve ephemeral channels carry
   pointer, focus, dragging, resizing, connectors, link drags, library drags, marquees and a gesture
   beat — and not one of them says which *tool* a collaborator is holding. Two people dragging cards
   look identical whether one is arranging and the other is recording a tour.

The cursor is the obvious place to answer all three, because it is the one thing that is already
local, already personal, already drawn for peers, and already at the exact point of attention.

## Decision

**Two axes, two controls, one status holder: the cursor.**

1. **`purpose` is the first axis** — `explore | run | record | present`. It answers "what is the canvas
   for", it is UI state (never document data), and it is exclusive: the widget cycles, so exactly one
   is on. `present` mirrors the existing `tour.presenting` flag rather than duplicating it.
2. **`gesture` is the second axis** — `place | thread | web | pattern` (ADR-0061, ADR-0063). It answers
   "what does the next click do", and it is only meaningful while the purpose is `explore` or `run`.
   In `record` it means which step-verb a click applies (ADR-0058's amendment); in `present` it is
   ignored rather than reset, so leaving `present` returns the reader to the tool they had.
3. **Two controls, never one segmented row.** A purpose button and a gesture button, stacked under the
   zoom widget, each cycling on click, each naming itself in `aria-label`/`title`. The bar stays two
   26px buttons; the states that do not fit are carried by the cursor instead of by a third row.
4. **The cursor is the status holder.** One component, drawn at the local pointer and reused for peers:
   a rounded **bubble** with a **corner pointer** (so it reads as a cursor, not an avatar), carrying the
   user's initial in their presence colour, a **status ring** for the purpose, and a fixed order of
   optional **slots** — gesture glyph (only when not `place`), run progress (`3/6`, only while running),
   unread chat count, and a collapsed **peer stack** for cursors outside the viewport.
5. **Colour is meaning by hue and state by contrast.** A purpose has a hue (idle / active / recording /
   presenting); whether it is *on* is a contrast step, not a different hue. Every value resolves from a
   token (`--state-idle`, `--state-active`, `--state-recording`, `--state-presenting`), so a dark theme
   flips contrast instead of changing what a colour means. **Hue alone is never the signal**: every
   state carries a glyph and a label, because a red-only difference is invisible to a colour-blind
   reader and in a screenshot.
6. **The cursor is local and ephemeral.** It is drawn from local state for the local user and from the
   `EphemeralStore` for peers; `purpose` and `gesture` join the presence payload so a collaborator's
   cursor can say "threading" or "recording" too. Nothing about a cursor is written to the document.
7. **Interaction rules.** The cursor is `pointer-events: none` except its bubble and its peer stack,
   which are buttons; it never covers the click point (the bubble sits below-right of the pointer); it
   is suppressed in a read-only share where presence is not present; and it is the *only* place these
   states are read, so no other surface has to grow a badge.
8. **`purpose: run` opens the library in selection mode.** Choosing run means "I am about to place a
   set", and the set comes from the library; making the user find the Select toggle is the missing
   half of the run story (ADR-0063's sources already assume a selection).
9. **`purpose: record` places a tutorial card and arms step recording.** The next card placed is the
   tour itself, and the gesture axis becomes the step verb (ADR-0058 amendment). Recording and running
   are mutually exclusive purposes precisely because both consume clicks.
10. **Leaving a purpose ends what it started.** Leaving `run` ends the run; leaving `record` stops
    recording (the tutorial card stays, as a card); leaving `present` closes the overlay. A purpose
    whose exit is undiscoverable is the trap ADR-0063 §9 already refuses for runs.

### The colours, as intent

The author proposed a literal map, and it survives as *intent* rather than as hex: white = at rest,
ink/black = engaged, accent/red = recording, green = presenting; on the gesture axis white = place,
ink = thread, blue = web. Recorded as: **`--state-idle` and `--state-active` are a contrast pair**
(so `run` reads as "engaged" in either theme), **`--state-recording` is the danger-adjacent hue**
(recording is a live capture: it should feel like one), and **`--state-presenting` is the success hue**
(the reader is in something, not doing something). A future theme may change the hues; it may not
change the rule.

## Consequences

- **One place to read the state.** A reader who looks at their cursor knows the purpose, the gesture,
  whether a run is live, and who else is here — without moving their eyes to a corner of the window.
- **Presence gets two small fields**, not a new channel: `purpose` and `gesture` ride the existing
  beat. A peer's cursor becomes legible at a glance, which is the first time presence answers "what are
  they doing" rather than "where are they".
- **The two controls are cheap to extend.** A fifth purpose is a glyph and a token, and it does not
  touch the gesture axis; that separation is the whole reason for two widgets.
- **The cursor is a shared component**, so a peer's cursor and the local one cannot drift: one renderer,
  two sources (local state, ephemeral store).
- **A share stays honest.** A viewer with no presence sees no cursor, and their own cursor still shows
  their purpose — presence and identity are separate questions and this ADR keeps them separate.
- **Risk: the cursor becomes noisy.** Four slots is the ceiling; a fifth state goes into the bubble's
  `title`, not into another dot. This is stated so the next feature does not negotiate it again.

## Rejected alternatives

- **One control with seven values.** A run is not a link shape, and a cycle of seven is a cycle nobody
  learns; the two questions are genuinely orthogonal.
- **A third axis for the editor surfaces** (tour panel, pattern editor). They are destinations, not
  modes: opening one is navigation, and `present` already covers the one that takes over the screen.
- **Literal per-mode colours stored in components.** `run = black` is `--ink` in light and near-white in
  dark; a hex map breaks in one of the two themes and encodes meaning in hue alone.
- **Hue-only state.** A ring that differs only in hue is invisible to some readers and unreadable in a
  monochrome screenshot; the glyph and the label are not decoration, they are the state.
- **Putting the run's progress only in the widget bar.** The reader is looking at the pointer while
  placing; the count belongs where the eye already is (the widget bar keeps it too, as the reset point).
- **A cursor that is pure presence** (a pointer and a name, as today). It answers "who" and leaves "what"
  to twelve separate channels that the reader has to interpret.

## Amendment — 2026-10-25: a presentation belongs to its tour, and run is not playback

Two corrections from use, both about the same thing: the widget was describing states it could not
actually mean.

1. **`present` is not a value the reader can choose.** The cycle is `explore → run → record → explore`.
   Item 1's "the widget cycles, so exactly one is on" still holds for the axis, but `present` is not one
   of the values the cycle visits. A mode button that offered "present" would be offering to present
   nothing, and then asking *which* tour — a dialog in the middle of a one-click control, and a worse way
   to pick a tour than opening the tour itself. The axis still *carries* `present`, because the widget, the
   cursor and presence all have to say it; it just cannot be walked into.
2. **The tour writes the axis; the widget only leaves it.** Starting a presentation (`presentTour`, or
   double-clicking the tour card) sets `purpose: present`. From there the widget is the exit, and its label
   says so: *"Stop presenting and return to the canvas"*. `setPurpose("present")` is refused
   unconditionally — not merely when no tour exists, as the first cut had it. Leaving stops the takeover and
   returns to `explore` **keeping the tour open**, so the reader lands back on its steps; Escape is the way
   to close it entirely. This supersedes item 10's "leaving `present` closes the overlay".
3. **Double-clicking a tour card presents it.** A tour has nothing to edit by double-clicking: the gesture
   means "show me this", so on a tutorial card it presents instead of starting body editing. That is the
   entry point a reader is most likely to try, and it is the only one that names a tour by pointing at it.
   The Steps panel's Present button remains, because previewing while authoring is a different job.
4. **`run` gets a queue, not a play triangle.** A triangle beside a record dot reads as media transport —
   "play this tour back" — and a run is the *opposite* of playback: a list of cards placed one click at a
   time. The glyph is three stacked lines (`≡`), on the widget and on the cursor's ring, and the rule from
   item 5 is unchanged: hue is never the only signal, and neither is a shape borrowed from another medium.
5. **The two controls are one pill.** Item 3 said "stacked under the zoom widget", and the first cut drew
   the purpose button as a second floating pill below the link mode: two rounded shapes meeting, which reads
   as a button stuck under a widget. It is now the pill's **bottom segment** — same width, same left edge,
   no seam, the pill's own bottom corners, and the link mode above it as a middle segment. The pill's
   shadow comes from its bottom-most segment, so the column casts one shadow instead of three.
