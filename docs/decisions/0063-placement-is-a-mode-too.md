# ADR-0063: Placement is a mode too — a run of cards, in a shape

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0061](./0061-three-ways-to-draw-links.md) (the same family, for links),
  [ADR-0011](./0011-library-dock-and-card-chrome.md) (the library, and the selection amendment),
  [ADR-0040](./0040-a-board-and-a-section-are-identities.md) (a behaviour is a card),
  [ADR-0052](./0052-a-link-is-a-route.md) (a link is a route), [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md)
  (a view is a query), [ADR-0051](./0051-one-style-vocabulary-over-edges.md) (sections grow to fit),
  [ADR-0060](./0060-shape-strip-and-rollup.md) (a section is a frame),
  `apps/canvas/src/canvas/arrangeCommand.ts` (the pure-plan precedent),
  `apps/canvas/src/canvas/linkGesture.ts`, `apps/canvas/src/canvas/LinkModeControl.tsx`

## Context

Placing a card is the most repeated action on the canvas, and it is still one card, one drop point,
one undo step at a time. Three problems follow from that:

1. **Getting a dozen cards out of the library is a dozen gestures.** A user who has decided what a board
   looks like — "these six interview notes in a row", "this hub with eight spokes" — has to express the
   *shape* by hand, one drag at a time, or not at all.
2. **The shape of a placement is usually the shape of a relationship.** Cards placed in a chain are
   related in sequence; cards placed around one card are related to it. Today the user does the layout and
   then draws the links, which is the same information twice.
3. **Link drawing already has this.** ADR-0061's `thread` and `web` are *one mode, three readings of the
   next click*. A placement that produced the same shapes would reuse a language the user already knows
   instead of inventing a second one.

Meanwhile the library cannot express "these rows": it has no selection at all (bulk editing is queued as
A13), so there is nowhere for a multi-card placement to start from even if the canvas could accept one.

## Decision

**A placement is a run: an ordered queue of cards placed one at a time in a chosen shape, in one mode
family shared with link drawing.**

1. **One mode slot, four readings: `place · thread · web · pattern`.** The same state that decides what a
   connector click means decides what the next placement means, because they cannot both own the next
   click. The slot is `CanvasMode`; the control is the one already under the zoom widget. `place` is the
   plain reading — one card, one drop — and is the rename of `connect` at the level of the *family*
   (ADR-0061 kept "Connect" for links; a slot shared with placement needs the general word, and the glyph
   still shows the shape).
2. **A run is gesture state, never document data.** A queue, what has been placed, an origin, an anchor and
   an optional wrapping section live in the UI store. Nothing about a run is written to the CRDT, so there
   is no schema change, no migration, and a run cannot be "half-synced" to a collaborator. What lands in
   the document is exactly what a hand gesture would have landed: placements, links, one section.
3. **The shape rules:**

   | Mode | Where the next card goes | Does it link? |
   | --- | --- | --- |
   | `place` | grid fill from the anchor (or the drop point), `gap` apart, nudged off any occupied card | no — a dump is a dump |
   | `thread` | right of the previous card, vertically centred on it: a chain | previous → next |
   | `web` | on a ring around the origin, at the golden angle: spokes that read as a hub at 3 or at 12 | origin → next |
   | `pattern` | a child of the previous card, alternating right and left, one row down: a tree | parent → child |

4. **The links a run draws are ordinary links.** Same kind, same ends, same description, deletable and
   re-routeable, drawn with the same determinism a hand-drawn link has. A run does not record that it
   happened, and deleting the origin's dot does not delete a web.
5. **Placement plus its link is one commit.** A step runs inside `WorkspaceDocument.batch()`, so one undo
   removes the card *and* the line it came with. A run of `n` cards is `n` undo steps, because a run that
   can only be undone whole is a run users are afraid to start; **Place all now** is the deliberate
   exception and is one step.
6. **A run's sources are all the places a set of cards can come from:** a library selection, a saved view's
   sorted result, dock type picks, and the one-at-a-time loop that reopens the library after each
   placement. Every source hands the engine an ordered list of ids and nothing else, so a new source is an
   adapter, not a fifth mode.
7. **Order is meaningful and visible.** The queue is the order the user can see: library list order, or the
   view's own sorts. A run that threaded a different order than the one on screen would look like a bug.
8. **Section wrapping is opt-in, per run, and sized to fit.** A run may create a section around what it
   places (padding from Card Settings) and grow it as it goes. It is off by default: an unwanted section is
   an object the user then has to delete, whereas an unwanted gap is free.
9. **A run always ends.** On `Escape`, on Stop, when the queue empties, and when the active board changes.
   A mode whose exit is undiscoverable is a trap; so is a run that keeps placing into a board the user has
   navigated away from.
10. **Layout presets are deferred.** Only the four built-in shapes ship. A saved layout is a new record with
    an editor and a preview, and the stated needs are covered by the built-ins; deferring keeps this phase
    migration-free.
11. **The family is expected to govern the tour and timeline editor.** A tour is already a list of steps
    (ADR-0058) and a timeline is already an ordered scene list: `thread` (each step follows the last),
    `web` (steps that branch from one hub) and `pattern` (nested scenes) describe how an author is *adding*
    steps there too. This is recorded as an expectation, not a decision — when the tour editor is built it
    may take the family, and if it does not, that is its own ADR.

## Amendment — 2026-10-25: a step can be a set, and a set can change the mode

The queue above is written as a list of cards, which is the common case and the first thing to build. The
author's refinement: **a step may be a set**, and a step may read the shape differently from its neighbours.

1. **A step is `{ ids[], mode? }`.** One card is a step of one; an existing section with its cards, or four
   cards that belong together, is a step of several. The set is placed as one unit — its members keep their
   relative geometry when they have one (a section and its cards), and are arranged in a small grid when they
   do not. The unit behaves as one placement for the purpose of the run: one position, one link from the
   previous step's anchor, one undo.
2. **A step may name its own mode.** "Thread this one from the last, then web a section beside it" is a
   single run: the step's mode wins for that step, the run's live mode is the default. This is what makes a
   run an *outline* of intent rather than a repetition of one gesture — and it is why the mode is stored per
   step rather than read once at the start.
3. **A step's set is a group, not a new object.** Nothing is grouped in the document by running: a set that
   needs to stay together is a section, and a section is created explicitly (by the run's wrap or by the
   user). A run that invented a container would be inventing structure the user cannot see the edges of.
4. **This is advanced, and it is additive.** The first cut produces single-card steps from every source; the
   state model, the planner and the engine all carry steps and per-step modes from the start, so a source
   that offers sets (a section row, a multi-selection inside a run) is an adapter rather than a redesign.

## Amendment — 2026-10-25: a run may nest, and returns to where it was

The second refinement is the harder one, and it is the same idea one level up: **a step can be a run**.

1. **A run is a stack.** Starting a run while one is live *suspends* the outer one rather than replacing
   it, and finishing the inner one resumes the outer exactly where it stopped — same queue, same origin,
   same anchor. "Take these six interview notes, and for each one thread the three quotes that came from
   it" is two runs, and the second is entered *from* the first.
2. **A sub-run's source can be a query.** The case that motivates nesting is a **sub-query**: place the
   result of "cards tagged *quote* linked to this interview", then return to "the rest of this week's
   notes". Nothing about the query is stored — it is read when the inner run starts, exactly as a saved
   view is read when it is opened (ADR-0043), so a sub-run is as cheap as a run.
3. **Suspended runs cannot place.** Only the top of the stack is live; the canvas, the control and Escape
   all address the top. A suspended run is visible as a count ("1 more queued run") and can be resumed or
   dropped from it, but it does not compete for the next click — one live run is the same rule as one mode.
4. **The stack is bounded and shown.** A stack more than a few deep is a sign that a saved view or a
   section was the right tool; the control shows the depth, and the third nested run is where the
   interaction stops being cheap enough to be useful.
5. **Nothing here changes the document.** A stack of runs is still gesture state: no records, no schema,
   no merge story, and a collaborator sees only the placements each step commits.

## Consequences

- **One vocabulary for two gestures.** The control under the zoom widget means "how the next click lands"
  whether the click is on a connector or a placement, so there is one thing to learn and one place to be
  wrong.
- **The library becomes the selection surface.** A run needs "these rows" and the library has none today,
  so row selection (A13's bulk editing) lands first and serves both: bulk trash, bulk place, bulk thread.
- **The planner is pure, so it is cheap to trust.** `placeRun.ts` joins `arrangeCommand.ts` as a module that
  takes geometry in and returns a plan out with no Loro and no React: a run's shape can be unit-tested and
  later previewed without a canvas.
- **A bulk action is now a menu, not a wizard.** The library already offers per-row actions through one
  context menu (ADR-0011 §6); the run verbs join that menu for a selection rather than opening a panel.
- **A run can be entered from a run.** Nesting is what makes "for each of these, that set" expressible
  without a spreadsheet: the inner run is the sub-query, and the outer one resumes when it ends.
- **`pattern` is one mode with many possible rules.** Only the alternating-tree ships; a "ring", "cone" or
  "staircase" is a new rule in the same planner, not a new mode.
- **Nothing is stored, so nothing can disagree.** Two collaborators can run the same placement at the same
  time; the results are ordinary placements and ordinary links, merging like any other edit.
- **The risk is a mode nobody finds.** The control names all four, the run reports progress, and every
  entry point is a menu item that says the verb ("Thread cards") rather than an icon.

## Rejected alternatives

- **A separate placement panel or wizard.** The library already holds the cards; a wizard duplicates the
  list and then has to stay in sync with it, and its modal shape makes "place two of these, then stop" hard.
- **A second mode arm (`placementMode`) beside the link mode.** Two modes that can both be armed need a
  precedence rule and an explanation. One slot cannot disagree with itself.
- **A run recorded in the document.** It would be a live object to keep consistent across peers, and its
  only use is the gesture — which is over by the time it would sync.
- **Saved layout records now.** A record plus an editor plus a preview is a feature of its own; the four
  shapes cover the need, and the built-ins stay useful if presets ever arrive.
- **Linking placements in `place`.** A dump that also drew a dozen lines would be an arrangement the user
  did not ask for and would have to undo. Links come with the modes whose *shape is a relationship*.
- **Undo per run.** One undo for twelve cards is a step users avoid taking; per-card undo makes
  interrupting a run safe, and "Place all now" is the explicit whole-run step.
- **Inferring the shape from the selection.** "It looked like a chain" is not a reason to draw eight links;
  the user chooses the verb, and the verb names the shape.
