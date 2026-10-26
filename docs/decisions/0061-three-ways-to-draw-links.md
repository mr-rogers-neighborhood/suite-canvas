# ADR-0061: Three ways to draw links — connect, thread, web

- **Status:** accepted — the three modes are built (web mode landed with the armed-origin ring)
- **Date:** 2026-10-25
- **Related:** [ADR-0007](./0007-connector-links.md) (connector links),
  [ADR-0039](./0039-a-link-points-at-an-endpoint-of-a-kind.md) (an endpoint of a kind),
  [ADR-0041](./0041-alpha-core-is-a-closed-feature-set.md) (thread mode in the core list),
  [ADR-0048](./0048-links-paint-beneath-cards.md) (link interaction),
  `apps/canvas/src/canvas/LinkModeControl.tsx`, `apps/canvas/src/canvas/linkThread.ts`

## Context

The product author's note, which came from their father misreading thread mode and landing on something
better:

> A third mode, same ui element, same entry points and logic, only difference is you hold ctrl to enter
> it, or enter the third mode by clicking the third item in the ui. We can use a literal web icon for it.
> What this is, is instead of daisy chaining (what threading mode is), you keep connecting from your
> starting point to other connectors, rather than "threading" between them, you are "webbing".

The two existing modes answer two shapes of drawing:

- **Connect** — drag one link at a time; the line follows the pointer and lands on release.
- **Thread** — click connector after connector; each click commits a link from the *previous* endpoint, so
  a chain grows end to end.

Thread mode is right for a path ("A leads to B leads to C") and wrong for a hub ("A relates to B, C, D,
E"). Today that hub is drawn as four drags, or as a thread which — wrongly — makes B→C and C→D look
like part of the same statement. The distinction is not cosmetic: a thread writes `A→B, B→C`; webbing
writes `A→B, A→C, A→D`.

## Decision

**A third link mode: web. One control, three modes, one origin.**

1. **Web mode fixes an origin and links from it.** The first click (or the connector a drag started on)
   becomes the origin; every later click commits a link *from that origin* to the clicked endpoint. The
   origin stays armed until it is cleared, so a hub is one click per spoke.
2. **The origin is visible.** The armed origin keeps its dot ring (the same affordance thread mode gives
   its endpoint), so the user can always see what they are webbing from. Without it, the third mode is
   indistinguishable from thread and the mistake that produced this ADR repeats.
3. **Same control, three entries.** `LinkModeControl` becomes three states rather than a toggle:
   connect → thread → web → connect. `Ctrl` (and `Cmd`) held while pressing a connector enters web mode
   for that gesture, mirroring how `Shift` already means "thread". Holding the modifier is a *gesture*
   modifier, so it never writes the stored mode.
4. **A web is a set of independent links.** Nothing about the drawn edges differs: they are ordinary
   links with their own kinds, ends and descriptions. There is no "web" record and no group. Deleting the
   origin's dot does not delete the links.
5. **The stored mode is the tool, the modifier is the gesture.** Exactly as thread mode already works:
   picking web from the control persists; holding `Ctrl` engages it for one press and reverts.
6. **Escape clears the origin**, and so does clicking empty canvas — the same two exits thread mode has,
   because a mode whose exit is undiscoverable is a trap.
7. **Self-links stay legal** where they already are. An origin may web to another dot of its own card; the
   existing rule (any dot pair except the identical one) is unchanged.

### Why the icon and the name

"Web" earns its own glyph because the shape it draws is radial, and the existing arrow ("connect") and
chain ("thread") glyphs already communicate the other two shapes. The user-facing labels stay
`Connect`, `Thread`, `Web`.

**Considered and declined: renaming Connect to "Attach".** The argument for it is real — in a menu of
three, "Connect" can read as "the one that makes connections", which is true of all three. It is still
declined, for three reasons:

1. **The family is shape-verbs.** Thread draws a chain, web draws a star, connect draws a single line. All
   three name the *gesture's shape*; "attach" names the *result*, which every mode produces.
2. **The object is a connector.** Users click a connector to make a connection; the UI verb and the object
   should agree. "Attach" would make the sentence "attach this connector" while the dot's own label says
   "Draw a link from this connector".
3. **The code says connect everywhere** — `onConnect`, `ConnectState`, `nodesConnectable`, `connector`.
   A UI-only rename splits the vocabulary for no gain in meaning.

If the three-state control turns out to confuse testers — which the tooltip and the origin ring are meant
to prevent — "Attach" is the first alternative to try, and this paragraph is the record of why.

## Consequences

- **One idea, three shapes.** The three modes are the same mechanism with a different rule for what the
  next click means: pointer (connect), previous endpoint (thread), fixed origin (web).
- **`linkThread` grows a mode rather than a second store.** Its armed state already holds an endpoint; web
  keeps the same armed endpoint across commits instead of replacing it.
- **A hub no longer requires a fake chain.** This is the user-visible win, and it is also a data-correctness
  win: the graph now records what the author meant.
- **The control is a three-way cycle, not a toggle.** Its `aria-pressed` becomes a three-state
  `aria-label`/`data-mode`, and the shift-hint behaviour (a modifier previewing a mode) extends to Ctrl.
- **Discoverability is the risk.** A third state hides behind two clicks or a modifier; the tooltip must
  name all three and the origin ring must be unmistakable.

### What implementing it settled

- **The reveal rule names the family, not one mode.** `threadMode` became `chaining` on every node face,
  section layer and reveal input, and `useChainingMode()` is `linkMode !== "connect"`. Web needs exactly
  what thread needed — every dot on screen as a candidate — so a rule named after one mode would have had
  to be renamed the moment the second one shipped, which is what happened.
- **The armed origin is marked per dot, not per layer.** `data-armed` is set on the one connector the arm
  names (cards and sections alike). A layer-level boolean cannot say *which* dot a web will link from, and
  the section dot had carried a CSS rule for it since ADR-0052 with nothing setting the attribute.
- **The cycle lives in one place.** `nextLinkMode()` and `LINK_MODE_NAMES` sit next to `LinkMode` itself,
  so the widget-bar button and the connector context menu walk the same connect → thread → web order. They
  had already drifted once with a two-state toggle.
- **Control and Shift are the same kind of thing.** `gestureMode()` reads Control first: a web from a fixed
  origin is the more specific gesture, and both are press-time (they never write the stored mode).
- **Neither modifier reveals the dots on its own.** Only a committed first click arms, exactly as Shift has
  always worked; the indicator previews the mode while the key is held, and the dots follow the arm.

## Amendment — 2026-10-25: the family is not link-specific

The three readings were recorded as a *link* tool. They are now one **mode slot** shared with placement
([ADR-0063](./0063-placement-is-a-mode-too.md)), because a click cannot mean two things and a second arm
would need a precedence rule:

1. **`CanvasMode` is `place · thread · web · pattern`** — `connect` became `place` at the level of the
   family, since a slot that also lays cards out needs the general verb. The arrow glyph and the sentence
   "drag one link at a time" still describe the link reading, and every link-specific label keeps the word
   *link*.
2. **`pattern` is the fourth shape**: a chain that branches (a mindmap), used only by placement today. It
   sits in the same cycle, so the control reads `place → thread → web → pattern → place` whichever gesture
   the user is about to make.
3. **What this ADR decided is unchanged**: a web keeps a fixed origin, the origin stays visible, the modes
   are gestures rather than documents, and Control is the press-time shortcut. Only the name of the first
   mode and the size of the cycle changed.
4. **The store field follows the reading.** `linkMode` is `mode`, `setLinkMode` is `setMode`; the rename is
   mechanical and lives in one commit so no two features disagree about the name mid-flight.

## Rejected alternatives

- **A "hub" tool that creates a node for the hub.** It invents an object to express "A relates to B and
  C", which the links already say.
- **Web as a modifier on thread instead of its own mode.** Modifiers compose badly (Shift + Ctrl would
  mean two things), and a mode the user cannot see in the control is one they will not find.
- **Auto-grouping webbed links into a web record.** It duplicates what the edges say and creates a second
  selection semantics for the same lines.
- **Keeping the origin forever.** An origin with no exit turns a mode into a mode you are stuck in.

## Amendment — 2026-10-25: `web` is `fan`

The fourth family member is still the one that links every click from a fixed origin; only its name
changed, because the name promised something the feature does not do.

**"Web" implies a mesh** — many cards wired to many — which is precisely what this mode is not. It
creates spokes from one hub: A→B, A→C, A→D, with nothing between B and C. A reader who hears "web" and
gets a star has been misled about the shape, and the mode that *would* imply interconnections is not one
we offer at all.

**"Branch" was the obvious alternative and it is already taken.** `pattern`'s own label reads "each
placement branches from the one before it", and ADR-0049 defines a pattern as the recipe that branches.
Naming the hub "branch" would have left two of four modes claiming to branch, with the distinction the
names exist to carry — *fan from one* versus *branch from the last* — collapsed into a synonym.

So: **`fan`**, kept as the family's third value, with its existing ✻ glyph (which already draws a fan)
and a verb that works in the cursor's status text — "fanning out", where "branching" belongs to pattern
and "starring" reads as staring.

The rename is thorough rather than cosmetic: the stored value (`canvasModes`, `MODE_NAMES`), the step
function (`stepFan`), the CSS class (`is-fan`), every label, test and the e2e spec. Mode is UI state and
is not persisted, so no stored session can carry the old value. If `pattern` is ever renamed, **`branch`
is the word for it** — with ⋔ as the glyph, because that is what a pattern does.
