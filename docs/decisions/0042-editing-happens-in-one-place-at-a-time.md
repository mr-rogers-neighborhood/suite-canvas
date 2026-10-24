# ADR-0042: Editing happens in one place at a time

- **Status:** proposed
- **Date:** 2026-10-24
- **Related:** [ADR-0034](./0034-ice-primary-rendering-engine.md), [ADR-0039](./0039-boards-are-containers-views-are-cameras.md), [ADR-0040](./0040-the-type-graph-is-withdrawn.md), [ADR-0043](./0043-what-a-card-face-says.md), [`docs/roadmap/ice-parity.md`](../roadmap/ice-parity.md) §9

## Context

The ICE desk draws every card — paper, hand, type, chip row — as one GPU face
(ADR-0043). It is a *reading* surface: a card on the desk is a paper raster with one text
flow on it, and there is no caret anywhere on it. Double-clicking a note was therefore a
no-op: the only editors in the product were the inspector's panel and the full-canvas focus
surface, so writing to a card always meant leaving the canvas, finding the card again in a
list, and coming back.

The machinery for the missing half already exists and is tested:

- `NodeCard` is the real card: a Tiptap title and body bound to the workspace's live Loro
  containers, the same component the inspector mounts.
- `suiteCardOverlay` lays a DOM face over a card's box in world units and scales it with the
  camera. It is kept as a comparison path behind `SUITE_CARD_DOM_FACE = false`, which stays
  false. That flag is the whole question this ADR answers, and two recorded numbers decide it:
  ADR-0034 makes the *readable-width gate, editor budget, culling and one-editor-per-card*
  product requirements rather than optimizations, and ADR-0040 measured a **full-viewport
  composited DOM layer over the desk at 42 → 35 fps** — a shade, for pure decoration. A DOM
  face on every card is a Tiptap document per visible card; nothing in this repo has measured
  that, and every number it does have points the other way.

So the question is not "should there be a canvas editor" but "how few editors can express
writing", and the answer has to survive the desk being a camera over an unbounded plane.

## Decision

### 1. The sheet is for reading; one DOM editor is for writing

At most **one** `NodeCard` exists on the desk at any time, over the card the reader is writing
in. Every other card stays a GPU sheet. That is the whole budget: one mounted Tiptap document,
one caret, one caret-presence record, for the entire canvas.

The editor is mounted inside the ICE surface's own tree, above the desk and above the
presence layer, not in the `aria-hidden` overlay host: it is real content with a real focus
ring and a real keyboard, so it must not be hidden from assistive technology.

### 2. It opens on intent, and the intent is a gesture

Three openings, and no others:

| Gesture | Path |
| --- | --- |
| **Double-click a card** | the desk's own pick → the card's identity → the gate → `startEditing(cardId, field)` |
| **Enter with exactly one card selected** | the same gate, on the selection; the key is claimed from ICE's keymap in the capture phase, because ICE binds Enter to lift/enter the selected object |
| **A card the shell just created** | `App.createCard` already calls `startEditing(cardId, "title")`; the surface now consumes it |

Hover is not an opening. Resting a pointer on a card is not consent to mount an editor —
the same rule the whiteboard stage follows (ADR-0034's amendment).

The **field** is decided by the card: an untitled card opens its title, anything else opens
its body. Both fields live in the same card face, so switching between them re-points the
caret without remounting the card.

### 3. The gate is capability, scope, and readability

Nothing opens unless all of these hold (`planCardEditor`):

- **Content authority.** `caps.canEditContent` from `iceShareCaps` — a viewer, a selection
  share, or a seat without content authority opens nothing at all, not a read-only editor.
  The inspector stays the place a viewer reads a card.
- **In the share's scope.** `withinShareScope({cardId, boardId}, session.share)`: a board
  share cannot write a card on another board, a card share only its own card.
- **The card exists and is not trashed.**
- **Not a whiteboard.** A whiteboard's double click is its drawing stage (`SuiteWhiteboardStage`),
  and that is unchanged. The two DOM editors close each other: opening the stage closes the
  text editor and opening the text editor closes the stage, so the desk can never hold both.
- **Big enough to read: `SUITE_CARD_EDITOR_MIN_SCREEN_WIDTH = 320` CSS px of card width.**

That last number is derived, not picked. A rung's hand is `13 × rung` world units in a
`288 × rung` world box (ADR-0043), so the body type on screen is
`screenWidth / 288 × 13` px whatever rung the card settled on — ~14 px at 320, and ~8 px at
the `full` band's 180 px. 320 px is the smallest width at which the type the editor lays out
is the size the research's band contract calls readable (body ≥ 11 px effective), and it is
always inside `full`.

The readable-width rule is a **gesture** rule. A double click or Enter is the reader pointing
at a card, so the card has to be readable for the click to mean "write here". The shell naming
a card — `App.createCard` asking for the title of the card it just made — is not a gesture on
something the reader had to see first, and it skips the measurement: a fresh 288-unit card at
fit zoom is 144 px, and refusing it would put back the exact parity row this ADR closes ("a
card made from the Dock arrives without a title cursor"). Every other rule — capability,
scope, trashed, whiteboard — applies to both.

The gate is checked when the editor *opens*. Zooming out while writing does not close it:
the editor is glued to the card and shrinks with it, because throwing away a caret mid-word
to enforce a readability rule is worse than the small type. Zooming back in returns to a
readable size. A reader who double-clicks a card below the gate gets nothing — the honest
next step (opening the inspector on a too-small card) is deliberately not taken here: it
would make one gesture mean two different surfaces depending on the camera.

### 4. Placement: the card's box, in the frame the camera is inside

The editor is positioned from the entity ICE drew — `geometryOf(entity)` for the drawn box
and its angle, the widget's own `Position`/`Size` as the fallback — and from the camera of
the frame the card lives in. ICE reports both in the current frame's units, so inside an
entered Board the same arithmetic glues the editor to the sheet without a second coordinate
system.

The page inside the slot is laid out at the card's **world** size and scaled by the camera,
so the editor's type is the same size as the sheet's type: opening a card does not change how
big the words are, and closing it does not pop. The ground is opaque, which is what hides the
sheet's own text while the editor is open: there is never a double image of the same words.

Follow-through is a per-frame comparison, not a per-frame write: a still camera costs one
equality check per frame and no style change, and a zoom or a pan writes four styles only on
the frames where the box actually moved.

### 5. One write route, and one debounced canvas commit

Typing goes through `NodeCard`'s Tiptap ↔ Loro binding (`loro-prosemirror`), which is the
app's **only** rich-text path — the inspector, the focus surface and this editor all use it.
The editor never writes text itself and never touches raw Loro for graph data (rule 1): the
`@suite/graph` document exposes the parts, not a "set the body" call, and creating a part
(`getTitle` / `getContent`) is the same call the inspector makes on mount.

Two different commits exist while writing, and only the second is this ADR's to schedule:

- **Text commits** land in the CRDT per keystroke, as they do in every Suite editor.
  `LoroCollaboration`'s undo manager merges a typing burst into one history step
  (`mergeInterval: 1000`), so one Ctrl+Z still undoes a word, and Loro's incremental encoding
  is what syncs — there is nothing to batch that would not be a second write route.
- **The canvas commit** is the projection pass that re-projects the sheet's text and re-fits
  its rung. It is coalesced to **one per 250 ms settle** (`ICE_CARD_EDITOR_COMMIT_MS`) and
  **flushed on close**. Without it, every keystroke would replace a card entity and re-raster
  its sheet; with it, a typing burst costs one.

### 6. Presence: the caret chip, and nothing else

While the editor is open the seat publishes the existing `focus` presence
(`{ nodeId, field }`), so peers draw the editing chip ADR-0043's face already renders. It is
cleared when the editor closes, and deliberately **not** cleared when the same card's caret
moves to another surface (the inspector opened for it): that surface publishes its own focus,
and a clear here would blink the chip off under a peer's eyes.

### 7. It closes on every way out

Blur, Escape, a selection that no longer holds the card, entering a Board (the units change
with the frame), the card being trashed or purged by anyone, the whiteboard stage opening,
and the desk tearing down. Every close flushes the pending canvas commit first, so the sheet
catches up exactly once, on the way out. The state is the UI store's `editingNodeId` /
`editingField` / `editingSurface`, not the hook's, which is what makes "never two editors"
structural: `editingSurface: "canvas"` is a slot the inspector's `"panel"` and the focus
surface's `"focus"` can never occupy at the same time.

## What it costs, measured

Measured on the dev desk (1440 × 900, software Vulkan in the lab's virtual display), reading
`requestAnimationFrame` deltas in the page:

| State | median frame | worst frame | frames / 4 s |
| --- | --- | --- | --- |
| sheet only | 16.7 ms | 16.8 ms | 241 |
| editor open, idle | 16.7 ms | 16.8 ms | 241 |
| editor open, typing | 16.7 ms | **183.4 ms** | 222 |
| after close | 16.7 ms | 16.8 ms | 241 |

Read honestly: a mounted, idle editor is **free** — it is one DOM subtree that repaints when
the text changes and not otherwise. Typing costs one long frame per settle window, when the
sheet re-rasters with the new text (and, if the writing outgrew the box, on the next rung).
That frame is the debounce's whole reason to exist: without it every keystroke would pay it.
On this software rasteriser the hitch is ~180 ms; the desk's own re-raster of one card on a
hardware GPU is the smaller part of that, and the number should be re-measured on the target
machine before it is quoted as a product claim.

## What still cannot be written on the canvas

- **A card below 320 px on screen.** The sheet reads; the inspector is the writing surface.
- **A viewer, or a card outside the share's scope.** Nothing opens, not even read-only.
- **A whiteboard's drawing.** It keeps its own stage (ADR-0034's amendment), not this editor.
- **Everything that is not title or body.** Properties, tags, type membership and the `⋮`
  menu's actions stay in the inspector and the context menu; the editor's card face is
  deliberately given `canEditLayout: false` and `canManageTrash: false` so its menu cannot
  become a second write surface for placement or trash. Formatting (bold, links, mentions)
  *is* editable here — it is a real Tiptap document — even though the passive sheet does not
  draw marks (ADR-0043 §1).
- **Board names and Section/Board renames.** Shell surfaces, untouched.

## Rejected alternatives

- **A DOM face on every card (`SUITE_CARD_DOM_FACE = true`).** Every visible card would mount
  a Tiptap document: the measured 42 → 35 fps composite of ADR-0040 was a shade, and this is
  a text editor per card on top of it. It also breaks ADR-0034's one-editor budget and makes
  every card a second renderer of itself, which is exactly what the sheet was built to stop.
- **A DOM face on hover, or an intent dwell (~200 ms) before mounting.** The whiteboard stage
  needs a dwell because Excalidraw is the most expensive surface in the product; a `NodeCard`
  is not. Dwell would also make "double-click to write" wait for a timer the reader cannot
  see, and hover would mount editors the reader never asked for as the pointer crosses a
  plane — the exact thing the whiteboard amendment legislated against.
- **Edit against a detached draft and commit the whole text on a debounce.** The
  `@suite/graph` document exposes rich-text *parts*, not a "replace this card's body" write,
  so a whole-text commit would mean writing raw Loro from the app (rule 1) or a second,
  lossier model of the text. The live part is also what gives collaborative carets; a draft
  would show peers nothing until the reader stopped typing.
- **Route text through `CanonicalWriter` / `applyCanonicalWrite`.** The bridge's canonical
  writes are placement, structure, edges and trash — each one gesture, one commit. Text is
  the opposite shape: continuous, collaborative, and already owned by the CRDT binding. Adding
  a text variant would be a second text route, not a safer one.
- **Put the editor's open state in the hook instead of the UI store.** Then the canvas editor
  and the inspector could both believe they own the caret, and Escape would have to guess
  which one to close. The store's `editingSurface` is the one fact that keeps them exclusive.

## Consequences

- `NodeCard` and `CardSurface` are unchanged in contract; the canvas editor mounts `NodeCard`
  directly, because a `CardSurface` twin would bring the focus surface and the inspector
  actions with it.
- The face and the editor must agree about size: the editor is laid out at the card's world
  box and scaled, so any future change to how the sheet lays its hand out has to be mirrored
  by `NodeCard`'s px metrics (title 13, body 14) — the same coupling the overlay already has.
- The whiteboard stage gained a `close()` and the surface closes it when a text editor opens;
  the reverse holds through the same wrapper. Two DOM editors on the desk is now an invariant
  with a test, not a hope.
- Lab evidence: `scripts/ice-scenarios/editing.mjs` double-clicks a note, types into it,
  presses Escape, reloads, and asserts the words come back — the reload is what makes the
  claim "this reached Loro" rather than "this reached the DOM".
