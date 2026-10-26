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

## Amendment — 2026-10-25: `pattern` is `branch`, and `pattern` goes back to meaning the recipe

The mode family is now **`place · thread · fan · branch`**. Three of those four names existed before; the
fourth is renamed, and the rename fixes something older than a word.

**The mode was squatting on the word for a concept it is not.** [ADR-0049](./0049-a-mind-map-mode-and-patterns.md)
defines a *pattern* as a versioned **recipe** — a saved way of placing things, a command with memory.
Nothing in the schema implements it yet. So "pattern mode" was using the future record's name for a shape
a click draws, which is why it never felt like it named an action.

After the rename the two are clean:

| Word | Means | Where it lives |
| --- | --- | --- |
| **branch** | the shape one click draws — each placement branching from the one before it | the gesture axis, fourth value |
| **pattern** | a saved recipe that produces shapes; a command with memory | ADR-0049, not yet implemented |

"Branch mode" describes what a click does. "Pattern" is now free for the record when it lands, and the
label stops implying you are *using a pattern* when you are simply *placing a tree*.

**"Connect" is not coming back for the first slot.** It was the previous name, replaced by `place` in
ADR-0063 because that one slot serves two tools: as a *link* tool it drags a single link, and as a
*placement* tool it drops a single card. "Connect" names only the link half, so a run in "connect mode"
would read as "place one card at a time" — the least connected thing in the product. `place` is the word
that survives both readings.

**Merging is noted, not adopted.** Merging or splicing content (by heading level, the way some outliner
plugins do) is a real and interesting idea, and it is **not a fifth mode**: a mode is how one click draws
one relationship, and merge is an operation over a *selection* — it belongs on the command axis with the
palette and the item menu. The mode family stays at four because ADR-0064 caps the widgets at two, and a
fifth value would need a menu where a cycle lives. Recorded here so the next person finds the reasoning
instead of inventing a fifth mode.

## Amendment — 2026-10-25: fan and branch are geometric; thread is chosen

The two families answer a different question, and the difference is the user's, not the implementation's:

| Mode | The dot is decided by | Because |
| --- | --- | --- |
| **fan** | geometry — the dot on the origin facing where the card landed | you are placing spokes, and a spoke should leave toward its spoke |
| **branch** | geometry — same rule, from the previous card | a tree should not cross itself to reach its own child |
| **thread** | **you** — the dot you armed, tracked click after click | a thread is a route through a card, and a route has ports |

So `connectorToward` (coming in with the fan/branch work) applies to *placement runs*, and never to a
thread gesture. `stepThread` already has the right shape: the first click arms a connector, every later
click links *from the armed one* and arms the one just clicked — the thread **tracks** the port rather
than being told it by a bounding box. That is what lets a thread enter a card at the top and leave at the
bottom, which no geometric rule could infer.

**Card-to-itself is therefore a real use case, not a curiosity.** `A.top → A.bottom` is one thread step,
and nothing in the document layer forbids it: `addEdge` accepts it, and the reference index already
counts it ("a self-loop yields one row"). The name people reach for — a card with a line leaving it and
coming back — describes a visible loop.

**The gap, stated precisely.** `edgeRoute.reversePartnerOf` correctly answers "no reverse partner" for a
self-loop, so nothing suppresses it. What is missing is *routing*: source and target anchors sit on the
same card, and the current path is drawn between them, so a top→bottom loop cuts across the card face
instead of bowing around its edge. `drawRoute` does not receive the card's rect, so the fix is a
`selfLoopRoute(source, target, rect)` alongside `pairOffset`/`shiftRoute`, called when the edge's two
ends are the same card — and it belongs with the rest of the geometry, not in an edge component.

Recorded as a todo rather than implemented here, because it changes how every self-loop looks and
deserves its own tests next to `pairOffset`'s.

### Shipped: the loop goes around

`selfLoopRoute` in `edgeRoute.ts` now handles the shape the paragraph above named as missing. It bows
the loop out on the side its anchors already sit — dots on the right edge loop further right, dots on the
left edge loop further left — so the line never crosses the card to reach its own bow. The axis the
anchors span is the axis it leaves by, and the bow grows on the other one. `drawRoute` takes the card's
rect from the document's placement rather than React Flow's measurement, so the loop is correct before
the card has painted and does not jump on the first frame.

Two identical anchors answer `null`: clicking the armed connector disarms instead of drawing, so that
shape only exists in a hand-edited document, and a degenerate loop would be worse than none.

### Amendment — 2026-10-25: infer the port, show it, let the reader overrule it

The previous amendment drew a hard line — fan and branch decide by geometry, thread decides by choice —
and the author's refinement replaces the line with a **default plus an override**, which is better for
both:

1. **The port is inferred, not demanded.** Threading should not begin with "pick a dot": it should
   begin with the reader pointing at *where the card goes*, and the geometry suggesting which dot that
   means. The rule from the previous amendment still runs; it just runs *first* instead of being the only
   option.
2. **The inference is visible before it is committed.** While the link (and the card, when placing) is
   in flight, the dot that would be used is highlighted. This is the same convention `place` already
   follows — you see the line as you draw it — so threading stops being the one mode where the result is
   only discoverable after the fact.
3. **Any other dot overrules it.** Clicking a different connector before committing replaces the inferred
   default for that step. The override is per-step rather than sticky: the next step infers again, so a
   reader does not have to undo a preference they set for one unusual connection.
4. **A thread still tracks.** The chosen port becomes the armed tail, so the next inference starts from
   *that* port rather than from the card's centre. This is what keeps a thread a route through a card:
   in at the top, out at the bottom is one inference plus one override, not two special cases.

The rule in one line: **geometry proposes, the reader disposes, and the proposal is on screen while it
is still a proposal.**

## Amendment — a port on the same card is a handoff, not a loop

Point 7 said self-links stay legal, and the section above argued that a card threading to itself is a real
use case rather than a curiosity. The author's refinement keeps the use case and changes the *record*: a
card is something a thread passes **through**, and a line from a card to itself says the opposite.

1. **A second port on the same card is a handoff.** Clicking another dot of the card the thread is already
   on moves the thread's exit there and writes nothing. `A.top → A.bottom` is still one thread step — the
   route through a card the section above described — but it is *state*, not an edge: the next click draws
   from `A.bottom`.
2. **Self-links stop existing in thread mode.** They stay legal in the document (`addEdge`'s rule is
   unchanged, so fan mode, imported data and a hand-edited document keep working) and `selfLoopRoute` still
   draws them. What changed is the gesture: threading cannot produce one, because the click that would have
   now means "leave from here".
3. **This is the override, for free.** The previous amendment asked that "any other dot overrules the
   inference". In a thread the same click is both the override and the handoff, so the mechanism has one
   meaning instead of two.
4. **The armed dot is the whole feedback.** The port moves from the one clicked first to the one clicked
   second, and that is what the reader sees; nothing else is drawn. Two highlights on one card would read as
   a selection rather than a route.
5. **Fan keeps its loop.** A fan's origin is an anchor, not a way through — every spoke leaves the same port
   — so a spoke to another port of the origin card is the self-loop it always was.

`stepThread` returns `handoff: true` with no link; `stepFan` never returns it. The e2e that proved the loop
("a card can be threaded to itself, and the loop goes around it") is now the proof of the handoff, and the
geometry it guarded stays covered by `edgeRoute.test.ts`.
