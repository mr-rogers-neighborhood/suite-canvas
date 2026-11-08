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

## Amendment — 2026-10-25: one palette, eight values, named by role

The first cut gave purposes a colour and gestures none, so `fan` and `branch` were the same grey and the
`--state-*` tokens named *states* (`idle`, `active`, `recording`, `presenting`) rather than values. The
author's assignment fixes that by giving both families one palette:

| Gesture | | Purpose | |
| --- | --- | --- | --- |
| `place` | **resting** — the bar's own surface, ink glyph | `explore` | **resting** — the same |
| `thread` | **inverted** — an ink chip, surface glyph | `run` | **inverted** — the same |
| `fan` | blue | `record` | red |
| `branch` | green | `explain` | purple *(reserved)* |

**"Black" and "white" are a resting/inverted pair, not two fixed colours.** The first
implementation filled the resting value with ink, which in a dark theme turned the bottom of the pill
into two white blocks bolted onto a dark bar. The correction, from a screenshot: the resting value
**blends with the bar it sits in**, and the second value is that same pairing **inverted**. In a dark
theme the inverted chip reads white and the resting value reads dark; in a light theme they swap. That
is why the author's words "black and white respectively" hold in both themes even though no colour is
hardcoded.

Three properties are what make it a language rather than a list of colours.

1. **The axes run parallel, then diverge.** The first value is ink, the second is that ink inverted, and
   only then do the families part: gesture warms toward blue and green, purpose toward red and purple. So a
   hue answers two questions at once — which family, and which value — which a single shared sequence could
   not.
2. **Resting versus inverted, resolved per theme.** `--value-*-fill` and `--value-*-ink` are what carry
   it: resting values fill with the surface and draw the glyph in ink, so they are part of the bar;
   inverted values do the opposite. Literal `#000`/`#fff` would make `thread` invisible on a light pill and
   `place` vanish in dark mode. The rule the first amendment stated survives verbatim: a theme may change
   what a role resolves to; it may not change which role a value is.
3. **`present` takes no hue at all.** It is a tour's state rather than one of the four choices, so a colour
   would imply a fifth mode — and the one it had (success green) now belongs to `branch`. Its ring is the
   theme's ink and its *shape* (the halo) carries the meaning, which is the same reasoning that already
   makes every state carry a glyph.

**One source, four surfaces.** `[data-mode]` and `[data-purpose]` select the value in `global.css`; every
control reads `--value-hue`, `--value-fill` and `--value-ink` and none holds a colour. That is what lets the
held-modifier preview re-point the palette instead of naming a colour, so the preview of `run` *is* the
committed `run` — the inconsistency that started this. The same tokens paint the widget bar, the connector
menu, the library's run verbs, the status cursor's ring and a peer's cursor, so "fan is blue" is true
everywhere or nowhere.

`--state-*` is retired. `modePalette.test.ts` asserts the palette stays whole: every value has all three
tokens, every attribute has a mapping, `present` names no hue, the retired tokens are gone, and no mode
stylesheet contains a hex.

**Hover is a pointer, not a state.** Both segments of the bar hover the same way: the branch's own hue
mixed 10% into the value's fill, plus a hairline in that hue. `purpose.css` was still mixing the *ink* in
and still naming `--purpose-state`, a token the retirement above deleted — an undefined custom property
makes its declaration invalid at computed-value time, so `background: var(--purpose-state)` resolved to
transparent and the chip **lost its fill** on hover while its glyph kept the surface ink. In a dark theme
that is a chip that darkens and a glyph that disappears, which is what the author reported seeing on the
bottom segment and not the top. Mixing a value's own hue fixes the class of bug as well as the instance:
`run`'s fill *is* its hue, so an engaged purpose looks untouched by the pointer, which is the state
outranking it without a second rule to say so.

## Resolved — the cursor speaks for peers only

The author's note, verbatim: *"the presence cursor has all of the elements we want to indicate, but it is
indeed cluttered/ugly. Lets consider ways to simplify its appearance… I'm also skeptical on giving the
local user the full cursor indication, as it may overwhelm the interface especially with the advanced
mode switchers/toggle ui we have built making it largely redundant for the local user."*

That is a fair hit. The status cursor was designed to make the two axes **visible** — which mattered
while the axes were new and the widget was smaller. Now the pill states both axes continuously, in the
same colours, at rest, so a ring that repeats them under the pointer is saying the same sentence twice.
It is redundant for the reader who owns it and load-bearing only for **peers**, who cannot see the pill.

**Decision (author, 2026-10-25): option 1, peers only.** What follows is the options as they stood
when the question was asked, then what the decision changed.

1. **Peers only.** The local reader keeps the pointer they already have; the ring is published, not
   drawn locally. Smallest change, and it removes the redundancy outright — at the cost of the local
   reader losing the one place that names the *current* mode in words.
2. **Local, on demand.** Draw the ring while a modifier is held (the preview is exactly the moment the
   reader needs confirmation) and hide it at rest. Keeps the confirmation where it is load-bearing.
3. **Local, reduced.** Keep the ring but drop the purpose glyph and the gesture slot, leaving shape and
   colour — one glance, no reading.
4. **Keep it as it is** and reduce the clutter by drawing it smaller and fading it after a gesture.

**What the decision changed.**

- `StatusCursorLayer` draws **only peers'** bubbles. The reader's own pointer stays a plain arrow in every
  mode. Presence publishing is untouched, so what a peer sees is identical before and after: this changed
  what we draw for ourselves, never what we tell each other.
- The local bubble's three passengers went to surfaces that already answer them:
  - *Run progress* → the placement bar (`3 / 7`), which was always drawn too and is where a run is
    steered from.
  - *Off-screen peers* → **edge ticks**: one button per peer who is off this view, clamped to the canvas
    edge in their colour with their initial, because the *direction* is the information the bubble could
    not give. Pressing a tick centres the camera on them, which is what the stack's button did.
  - *Unread chat* → nowhere yet: the chat lane is not built (ADR-0064 §4), so the prop was removed rather
    than left wired to nothing. When chat lands, the badge belongs on the dock, not on a cursor.
- **What the reader loses**: the bubble was the one place that named the current mode in words. The pill
  says it on hover and to a screen reader (`Thread mode: click connector after connector to chain links`),
  so the words are one interaction away instead of permanently under the pointer. That is the trade.
- `StatusCursor` keeps `isSelf` because it decides tab order, and a peer's bubble must stay out of the
  reader's tab order; the layer now always passes `false`.

## Amendment — the board strip is a navigation, not a tablist

Found while making `pnpm test:stories` green, and unrelated to the axes: `BoardTabs` used
`role="tablist"` and `role="tab"`, with a per-board close button and a rename field as siblings inside
it. Axe reports `aria-required-children` — a tablist's children must be tabs — and had been failing two
stories for some time, which is why the story suite could not be used as evidence.

**The fix is the semantic, not the markup.** The planned approach was a strict tablist with closing moved
out of the strip, but that trades away an affordance every reader expects in order to satisfy a role that
was wrong in the first place. Switching a board **replaces the canvas**; it does not reveal a tab panel on
the same page, which is what the Tabs pattern describes. So the strip is a `<nav aria-label="Boards">` of
buttons, and the selected one carries `aria-current="page"` — literally "you are here" — which is both
true and free of child constraints.

- Closing stays where it is, a button beside its board's tab, and it is in the tab order: a board's close
  control is reachable with the keyboard, which the strict-tablist version would not have guaranteed.
- The rename field stays allowed, because a `nav` may hold one.
- Tests moved from `[role="tab"]` / `aria-selected` to `[data-testid^="board-tab"]` / `aria-current`,
  across eleven e2e files: the selector change is the record of the semantic change.
- `BoardTabs.stories` passes `toHaveNoViolations` again, so `pnpm verify` can include the story suite as
  evidence rather than a known red.

**Measured, not eyeballed.** The palette shipped with a guard test but no acceptance evidence. The
verification half is now `e2e/tests/palette-contrast.spec.ts`, which resolves every value's fill and ink
through the browser in **both themes** — `color-mix`, `var()` chains and the per-theme block all sit
between the token and the pixel, so a unit test reading hexes would test something nobody sees — and
asserts a **4.5:1** floor for the glyph on its fill. A pair that cannot be parsed fails too, because a
token resolving to something unpaintable is worse than a low ratio.

It found three values under the floor in the light theme, all of them chip fills borrowed from stroke
tokens that were never asked to carry a glyph:

| value | as a chip | now | fill |
| --- | --- | --- | --- |
| `branch` | 2.54:1 | **5.48:1** | `#047857` |
| `fan` | 3.68:1 | **5.17:1** | `#2563eb` |
| `explain` | 4.23:1 | **5.70:1** | `#7c3aed` |
| `record` | 4.57:1 | unchanged | `--danger` |

Only the *fill* moved, and only in the light theme: `--value-*-hue` and `--section-*` keep the lighter
colours they were chosen for, so a section's border and a chip's body are allowed to differ. The dark
theme needed nothing — its section hues are brighter and its ink is the dark surface, so the same pairs
measure 7.2, 9.5 and 6.7 against the floor.

`e2e/tests/modifier-matrix.spec.ts` now runs its whole grid in both themes as well, so "the preview paints
like the committed value" is asserted per theme rather than only in the one the runner happens to open.

## Amendment — one status in the chrome, and everything about this device under it

The author's note: *"Synced indicates 'This is how many people you are syncing/live with now'. But it
simply has three modes — Synced, Offline (grey), Syncing. Anything else necessary for the user to know
regarding their local storage and connection to peers can be contained under there, so no big 'Saved on
this device' pill necessary."*

The chrome had two controls answering one question. `Live` reported the room; a pill reported the
browser. To a reader they are the same question — *is my work safe, and is anyone else in it* — and the
pill was the larger of the two while being the less certain one.

1. **Three words, and no more.** `Synced` (connected), `Syncing` (connecting or catching up), `Offline`
   (grey). The count rides the same control — `Synced · 3 here` — because "how many people" is part of
   the claim rather than a separate readout.
2. **A role is not a connection state.** `Editor` / `Viewer` used to replace the label, which meant a
   share could never say whether it was synced. The role moved into the panel, as a sentence.
3. **The indicator is a disclosure.** One press opens a panel with the room in a sentence, the count,
   the role, and the whole storage surface (the ladder's status line, the detail, the estimate, the
   sign-in and export actions, the durability gesture, the offline scope, the crash opt-in). It closes
   on Escape, on a press outside, and on a second press of the button.
4. **The pill is gone, not hidden.** A second status surface outside this one would be the same mistake
   again: two places to look for one answer, differing by a word when they disagree.
5. **It is still a status, never a warning.** The rung decides the words, and only `blocking` paints
   amber. Moving it behind a press does not license nagging: nothing about the panel opens itself.

Storage is a reader preference and a browser promise, so it stays a *panel* rather than a mode on either
axis (§ the two axes are what the canvas is for). The ladder's own amendment lives on ADR-0025.
