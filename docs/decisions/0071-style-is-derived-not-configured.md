# ADR-0071: Style is derived, not configured

- **Status:** accepted — the rules are settled; the surface is being built in slices
- **Date:** 2026-10-25
- **Related:** [ADR-0051](./0051-one-style-vocabulary-over-edges.md) (one style vocabulary over edges), [ADR-0056](./0056-card-settings-owns-defaults.md) (card settings own defaults), [ADR-0064](./0064-two-axes-and-a-cursor-that-says-so.md) (the value palette), [ADR-0068](./0068-a-system-workspace-authors-what-workspaces-start-with.md) (the system workspace), [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md) (a view is a lens)

## Context

The author's note, verbatim: *"Our theming/style system globals/dashboard etc can maybe have an entry
point inside the light/dark mode switcher for easier access and dynamic updates based on the user's
preference… remember the shell has its styling at least for now fully derived/blended with the
board/overall styling, so this is more like the entry point to 'Automatic CSS' in our system, with the
type-level defaults, card overrides, utility classes as right click, etc. Its a bit to structure so what's
important is we have the concept thought/hashed out and noted fully. Shouldn't be the only entry point but
it's a logical one, particularly if the shell derives its style via its minimalism anyways."*

The observation underneath it is already true in the code, which is why it is easy to miss: **the shell has
no separate style**. The top bar, the dock, panels, menus and the widget are painted from the same tokens
the board is (`--surface`, `--ink`, `--hairline`, `--section-*`, the `--value-*` palette). A card's feel
and a menu's feel are one system today; we simply never said so, and there is no place in the product
where a reader can reach it.

Meanwhile three style authorities already exist and do not know about each other:

- **A type** carries defaults (`ADR-0056`): a card type can say what its cards look like.
- **A card** carries an override (ADR-0051's style vocabulary): this card, this once, a colour or a fill.
- **The system workspace** carries what a *new* workspace starts with (`ADR-0068`), which is where
  deployment-wide taste would live.

And the runtime has a fourth: the reader's theme preference (`light · dark · system`), stored per device.

So "an entry point next to the theme switcher" is the small visible part of a larger question: **who is
allowed to decide how this looks, and in what order?** This ADR answers the shape of that question. It
deliberately does not build it.

## Decision

**Style is derived from the document, and configured only where a document cannot say it.**

One direction of derivation, four rungs of authority, and one entry point among several.

### 1. The direction is fixed: document → palette → chrome

```
card style ─┐
type default ─┼→ document palette ─→ interface tokens ─→ every surface
system default ┘        (one place)         (one sheet)
```

Nothing derives the document from the chrome, ever. That is the property that makes "my board is dark
green, so my toolbar is dark green" possible without a second theme system: the chrome is downstream. It
is also the property that stops a preference from ever being mistaken for content — a reader's theme
changes what a token *resolves to*, never what is stored in the document.

### 2. Four rungs, narrowest wins

| rung | who sets it | lives in | scope |
| --- | --- | --- | --- |
| **card override** | the reader, on one card | the document (card `style`) | this card, this once |
| **type default** | the schema author, on a type | the document (type style) | every card of that type that has no override |
| **workspace default** | whoever authored the workspace | the document (workspace style) | everything in this workspace |
| **reader preference** | the reader, on this device | local preference store | theme *mode* only — light, dark, system |

The order is by **scope, not by recency**: the smallest claim wins, so a card that says red stays red in a
workspace that says green, and a reader's dark theme never overrides a card's colour — it changes the
*surface* that colour sits on.

### 3. A rung is written through the graph, never as CSS

Every style a reader can reach is a **named utility applied through `@suite/graph`** — `colour: section-blue`,
`fill: tinted`, `density: compact` — never a CSS string, never a style attribute in the document. Two
reasons, both non-negotiable:

- a name can be validated (the Zod schema refuses a colour that is not a role), re-themed, and merged by
  the CRDT without conflicting on a string;
- a raw CSS value would let a document escape its surface, which is how every "custom HTML" feature
  eventually becomes a security review.

### 4. "Utility classes on the right-click"

The right-click menu is where a reader reaches a style **in place**: the card under the pointer, the value
they want, one property at a time, written as a document mutation and therefore undoable, collaborative and
per-card. It is the fourth rung's UI, and it is deliberately *not* a stylesheet: the menu offers the
vocabulary the document understands (roles, not hexes).

### 5. Entry points are plural, and the theme switcher is one

The switcher is a good door because it is already the reader's "how should this look" button — but it is
one of at least four, and each opens the same surface scoped differently:

| entry | scope it opens |
| --- | --- |
| theme switcher (top bar) | reader preference; a link to the workspace's style |
| card settings / right-click | this card (rung 1) |
| the type editor | this type (rung 2) |
| the system workspace (`ADR-0068`) | what new workspaces start with |
| the library | everything at once — the browser of what exists |

There is no "settings page" that owns all of it. A settings page would centralise a vocabulary that is
already spatial: the reader is looking at the thing they want to change.

### 6. Semantic hues are not editable — the hard invariant

`fan` is blue because it *means* fan ([ADR-0064](./0064-two-axes-and-a-cursor-that-says-so.md)); the mode
palette is a legend, and a reader who retuned it would make a peer's cursor lie about what that peer is
about to do. So the eight mode values are **role tokens, fixed by the build**, and the editable surface is
everything *else* a card can wear: its section colour, its fill treatment, density, radius, its type's
defaults.

This is the line the whole ADR turns on: **a style you can edit is a statement about content; a style you
cannot edit is a statement about meaning.** Confusing the two is how a design system becomes unusable.

### 7. What the first entry point would actually contain (not built)

For the concept to be judged, the smallest useful surface was sketched and is recorded here so it does not
have to be re-invented: reader theme mode, density, canvas background treatment (dot grid on/off, its
colour role), card radius and shadow, reduced motion, and read-only mirrors of the workspace's style with a
link to the scope that owns each. All of it reading and writing **preferences or document style** — never
CSS.

## Consequences

**Easier**

- One derivation direction means one place to look when something looks wrong: the palette.
- Type defaults and card overrides already exist; this names them as rungs of one ladder instead of two
  features that happen to overlap.
- A hosted workspace can carry taste (its own section colours, its own density) without a theme system per
  customer, because taste is document data.

**Harder, and accepted**

- **A derived shell is a coupling.** A workspace with an unusual palette will produce an unusual toolbar.
  The mitigation is the invariant in §6 plus a contrast floor (already enforced for the mode palette by
  `e2e/tests/palette-contrast.spec.ts`), which must extend to any editable surface before it ships.
- **Four rungs is more than a settings page.** The cost is real; the alternative — one flat list of
  preferences — cannot express "this card is red because I said so" alongside "this type is blue".
- **Nobody can theme the app to their taste alone** in the sense a code editor allows. That is a
  deliberate refusal, not an oversight: the product is collaborative, and a reader's re-skin would be
  visible to nobody while making their own screen unrecognisable to the documentation.

## Open questions

1. **A per-reader override of a workspace style?** "My board is dark, my shell is light" is a real
   preference for some readers. The current answer is that the audience is one — a workspace looks like
   itself — but this is the question most likely to be revisited, and the honest cost of changing it is a
   fifth rung and a rule for what a screenshot means.
2. **Does a shared workspace carry its style to a visitor?** A public share link opens someone else's
   workspace: do they see the author's palette or their own? Today nobody has asked, because sharing
   exists before styles do; the decision must be made before editable surfaces ship.
3. **Where does a *workspace* default live?** A dedicated record, or one flagged board of the system
   workspace? The latter reuses everything (ADR-0068) and the former is simpler to query.
4. **Does density belong to style at all?** It changes layout rather than paint, and layout is the
   document's business (positions are stored). Density would have to be a *render* preference, which puts
   it on the reader rung rather than the document ladder.

## Acceptance (2026-10-25)

Accepted by the author with the decisions this ADR needed:

- **All four rungs are real**, and the first slice builds the whole ladder: the Control vocabulary, colour as a
  Control, the utility index with owner **and** fallback, and the appearance entry point — not a demo of one piece.
- **The derivation direction is settled**: document → palette → chrome, with semantic hues fixed by the build.
- **The appearance surface is reader preferences only** (density, card radius, canvas background, reduced motion).
  Authoring type- and workspace-level style in the UI comes later; the index documents those rungs now so the
  editors have something to write into.
- **Authoring CSS stays refused**, and so do per-breakpoint matrices. Those are the two things most likely to be
  re-proposed once a styling surface exists; the record says no, and why.

## Amendment — what the page-builder frameworks teach, and what they do not

The references the author named (Automatic.css, Advanced Themer, Core Framework, GeneratePress) were read
against this ADR; the comparison lives in
[design-inspirations.md § Style systems](../design-inspirations.md#style-systems-what-transfers-from-page-builder-frameworks).
Three conclusions belong in the decision itself, because they change requirements rather than taste:

1. **A utility is a named role with a declared owner and a declared fallback.** The strongest idea in
   Advanced Themer is not its 176 tweaks but its **"safe to disable"** marker. Translated: removing a
   utility must fall back to the next rung *by name* (`card override → type → workspace → built-in`), never
   to an undefined value or a broken paint. A utility index that states both — owner and fallback — is
   therefore part of the deliverable, not documentation added later.
2. **Preview is in place, not beside.** ACSS and Core both ship a live preview because the thing they style
   is elsewhere (a page in a builder). Ours is on the canvas, under the reader's eyes, so a hover on a
   utility previews the actual card and a commit is one undoable mutation. A separate preview pane would be
   copying a compromise we do not have.
3. **Few knobs at the top, and say so.** GeneratePress is the closest to the posture chosen here: a small
   set of global controls and targeted overrides, rather than a full token editor. The failure mode of a
   page-builder customizer is an infinite settings tree; the equivalent failure here would be exposing the
   eight mode values, so §6 stands: semantic hues are never editable, and the top rung stays short enough
   to read in one screen.

Two things from those frameworks are refused on the record, so they are not re-proposed later: **authoring
CSS** (custom classes, auto-BEM, component HTML/CSS editors) and **per-breakpoint style matrices** (our
"breakpoints" are zoom levels, and the canvas already degrades by LOD rather than by media query).

Also noted from the same pass, and belonging to this ADR's scope rather than to a separate one: **colour is
a Control in the Style tab**, and the property inspector, the library row menu and the context menus must
present the *same* controls from one abstraction. Three surfaces grown separately is exactly the drift that
made the two mode families need one palette.

## Note — home, navigation and new-tab surfaces when they come

The author asked for a revisit: *"Revisit home, navigation, and new tab pages/boards to consider when they
should be implemented and how they should interact with the overall style/theme system."*

The rungs answer half of it, and it is worth writing down now so the surfaces are not invented twice:

- **A home board is document content.** It is a board that the workspace names, so every rung above it
  applies unchanged: its paint is a board style, its cards carry their own, and a visitor sees what the
  author set. Nothing new is needed; the record is a board id on the workspace, and the place it is
  remembered is the same "which board am I looking at" that already survives a reload.
- **The new-tab chooser is shell chrome.** It is a *choice surface*, not a place, so it is a reader
  preference (what this device opens with) and writes nothing to the document. It must not become a
  board, which would make a navigation setting collaborative and undoable by a peer.
- **The ordering follows from that split**: the home board can ship with nothing but a board id and a
  navigation rule; the chooser wants the reader-preference store the appearance slice just built, so it
  is cheaper *after* this slice than before it.

Nothing is built here. The point of recording it is that the two surfaces look alike and belong to
different rungs — which is exactly the confusion this ADR exists to prevent.

## What implementing the first slice settled

Built and shipped; the rest is recorded as open.

- **The ladder already existed.** `rules.ts` resolves global → kind → type → shell and then the surface's
  own style, with a contrast floor and corrections. The slice did not add a second one; it added **an
  index over it** (`canvas/styleUtilities.ts`) that answers what a control cannot: which rungs may own a
  property, and what removing it falls back to. The paint utilities are the `SurfaceStyle` fields that
  already existed — the index names them, it does not invent them.
- **Provenance is what makes "Inherit" honest.** `styleProvenance` reports the rung and a readable label
  per property, so the Style tab's empty option reads "Inherit from Concept" when a rule has an opinion
  and stays plain when none does. A word with no object was the real defect, not the control.
- **Reader preferences are attributes, not inline styles.** `[data-density]`, `[data-canvas]`,
  `[data-motion]` and `--reader-card-radius` on `<html>`, so the stylesheet owns what compact *means* and
  the canvas behind the panel is the preview. `--reader-card-radius` is a default only: a card's own
  radius still wins, which is the ladder working.
- **`!important` is the honest tool for reduced motion, once.** A component's own transition rule is more
  specific than any selector that catches every element, and a preference that loses to one of them is not
  a preference. The rule is the last thing in the sheet, with the reason on it.
- **Still open**: authoring type- and workspace-level style in the UI (the index covers them; no editor
  writes them), named rules and themes as a surface a reader can create, and the utility index rendered as
  a browsable list rather than a per-control source.

## Amendment — the edges of "appearance": rounding is not only a radius

Two notes from the author after the first slice shipped, and both change what a control owes the reader.

**1. Corner rounding drags three other things with it.** *"When changing the rounding on cards and other
entities, we'll need to account for any shadows/outlines/background, and for the attachment of the
connectors to ensure visual consistency and avoid layout issues… especially with shapes and particularly
custom shapes."* He is right, and it is a consequence of radius being the first preference offered rather
than a cosmetic one:

- a **shadow** follows the silhouette, so a rounded card with a rectangular shadow looks detached;
- an **outline** (a drawn route, [ADR-0060](./0060-shape-strip-and-rollup.md)'s family) has to be inset by
  the radius or it cuts the corner;
- a **connector** anchors at a normalised point (0.5, 0) — *not* at the corner — but its grab ring and its
  hit target are sized in pixels, so on a very round card the dot can float off the visible edge.

The rule this implies: **a paint that changes the silhouette must publish the silhouette to everything that
attaches to it.** Practically, one derived value — the resolved outline — rather than four components each
re-deriving "what is the edge of this card". Custom shapes make it non-optional, which is why this is a
requirement now rather than a polish item.

**2. Appearance is not the home for every visual option.** *"Canvas should allow custom backgrounds… grid
visibility, snap-to-grid defaults (could justify a sixth, final toggle/ui in the canvas control menu… but
that might be overloading that bar), and possibly theme-specific adjustments."*

Three different rungs are tangled in that sentence, and separating them is the whole point of this ADR:

| option | rung | why |
| --- | --- | --- |
| canvas background, grid visibility | **reader preference** | it draws differently on this screen and nowhere else |
| snap-to-grid defaults | **reader preference**, per board at most | it is how *this* pointer behaves, and it is not content |
| "Reading / Editing / Presentation view" | **not a preference at all** | it changes what a click *does*, which is the purpose axis (ADR-0064) — a view is a mode |
| theme-specific adjustments | **the theme**, not a control | a theme owns its values; exposing them per reader is a different product |

The author's own instinct about the canvas control bar is also recorded as a constraint: **the widget bar is
full.** Four mode values, four purposes, zoom and fit already share one column; a sixth segment would make
it a menu of menus. Anything new that is a preference belongs in Appearance, and anything that is a mode
belongs on the axis it changes — not in the bar.

## Amendment — the silhouette is published, not restated

The radius slice shipped the mechanism and missed its second half. `--reader-card-radius` reached the
card's box, and `.whiteboard-card` and `.whiteboard-surface` were already written to read a
`--card-radius` that **nothing ever set**. The card's own chrome kept a fixed `rounded-t-md`, and a
painted card's underlay fell back to `6px`. Below 6px nobody could tell; the moment the reader could
choose 28px, the disagreement became visible as a notch inside the card's own curve.

1. **One value per node kind, published.** `.node-card`/`.portal-node` set
   `--card-radius: var(--paint-radius, var(--reader-card-radius, 12px))` and derive their own
   `border-radius` from it; `.whiteboard-node` publishes the reader default alone, because a sketch has
   no paint. That is the ladder, expressed once, in the order the ladder resolves.
2. **Everything that hugs the corner reads it back**, subtracting only what it actually sits inside: the
   header is `calc(var(--card-radius) - 1px)` on an ordinary card (it is inside the box's 1px border) and
   the full radius on a painted one (whose border lives on the underlay).
3. **A fixed radius anywhere inside a card is now a defect**, not a detail, which is the same rule the
   mode palette got: the value is chosen in one place so the parts cannot disagree.
4. **The prior-art claim is unchanged.** The shadow still follows the box's radius rather than being
   computed separately, and connectors still anchor by normalised point — the silhouette *contract*
   (`silhouette.ts`, Batch A of Phase 18) is what will make a dot land on the painted edge rather than on
   the box's. This amendment only stops the corners contradicting each other.

Recorded because the bug is evidence for Batch A: the components of a silhouette drifted as soon as one
of them became configurable, and the answer is the same one the utilities index already gives.

## Amendment — the silhouette contract (Phase 18 Batch A)

The previous amendment published one radius so the parts of a card could not disagree. That fixed the
*inside* of the card. It did not touch the other consumer of a silhouette: **a connector's position is a
slot on the box, and a rounded card does not paint its box's corners.** At 28px a corner dot floated a
third of the short side away from the card it belonged to — reported twice, second time confirmed on a
fresh card.

`apps/canvas/src/canvas/silhouette.ts` is now the contract, and it is three pure functions:

| function | the question it answers |
| --- | --- |
| `clampRadius` | how round can this box actually paint? CSS silently scales a radius past half the short side, so the geometry has to clamp *first* or it measures an arc nobody draws |
| `edgePoint` | given a normalised position on the box, where is the painted edge? |
| `cornerInset` | `r - r/√2` — how far a corner is pulled in along the diagonal |

Three properties are asserted rather than described, because each one is a thing that could quietly stop
being true: **a side midpoint never moves** (so this is a correction, not a change of geometry), **a box
corner lands exactly on the arc** (measured as a distance from the arc's centre), and **radius 0 is the
identity** (so a board that never rounds anything pays nothing).

**Measured, not resolved, at the one place it matters.** `NodeConnectors` reads the silhouette from the
DOM — `offsetWidth`/`offsetHeight` of the connector layer plus the inherited `--card-radius` — rather
than re-deriving it from the rules. The radius is the end of a ladder (`rules.ts` owns it: paint, type
rule, kind rule, reader preference, 12px default) and a second implementation of that ladder is exactly
the drift ADR-0071 exists to prevent. The layer is the box a percentage position resolves against, which
is why it is the box measured: the card has a 1px border, and positioning in the layer while measuring
the card is a sub-pixel disagreement that only shows up when a corner dot has to sit on an arc.

**What implementing settled.** Two things the plan did not anticipate:

1. **A corner dot's link follows for free.** The dot *is* a React Flow handle, so re-measuring the handle
   after the correction is all it takes for a link to route from where the dot is drawn. No second
   geometry path, no per-edge special case.
2. **The first measurement must be silent.** It happens inside React Flow's initial fit, and calling
   `updateNodeInternals` there clamps the viewport to that one node and hides every other node behind
   visibility culling — a hazard this codebase had already written down once (the connector-count effect
   in the same file) and which cost an hour to rediscover. The guard has to skip *both* "no answer yet"
   and "same answer as last time": the first measure can legitimately return `null` before layout, which
   slips past a naive `previous !== null` check.

**Still open, and deliberately not in this batch:** a painted *outline* (ADR-0060's family) is inset by
nothing, so a drawn border still cuts the corner; and the card's shadow follows `border-radius` by
accident rather than being derived. Both are consumers this contract now makes possible, not work it
finished.

## Amendment — the ladder is writable (Phase 19)

Every part of this system existed except the authoring. `styleRuleSchema` has named four scopes since it was
written, `rules.ts` has resolved them by specificity, and `styleUtilities.ts` has said which rungs may state
each value and what removing one falls back to. Nothing could write a rule: a reader could paint **one card**
and had no way to say "every Concept looks like this". The three rungs above the card were read-only fiction,
and `p15-style-controls-shared` was stuck behind that.

**One abstraction, not a second editor.** A style edit now has a *target*:

```ts
type StyleTarget =
  | { rung: "surface"; kind; id }   // the card, section, board or link
  | { rung: "rule"; ruleId }        // the same controls, one rung up
```

`useSurfaceStyleDraft` reads and writes either, so `StyleTab` — which was already a generic `{kind, id}`
editor — edits a rule with no knowledge that it is doing so. A parallel rule editor was the obvious build and
the wrong one: two sets of controls is precisely the drift this ADR exists to prevent.

**The scope picker is the whole feature, in one row.** `This applies to: [this card ▾]` offers the rungs that
can state the value being edited, and nothing else — a section has no type, so it is not offered a type rung.

- **Choosing a rung writes nothing.** A rule is created by the first *edit*, named for its scope and ordered
  last, so browsing the ladder never litters the document with rules that name nothing and never reorders the
  ladder a reader is looking at.
- **The caption states the blast radius before the edit**, because the next click is no longer about the card
  in front of them.
- **Clearing every control keeps the rule.** A rule that names nothing answers a real question ("what would
  this look like if it said nothing?"); deleting is the list's verb, and removing a rule as a side effect of a
  reset is the kind of surprise that stops people editing.

**A list, because "what rules exist?" was unanswerable.** `StylesDialog` groups rules the way the resolver
walks them (everywhere, types, kinds, shell regions), edits the selected one with the *same* `StyleTab`, and
reorders by writing `order` — the number the resolver already compares, so the arrow a reader presses and the
comparison the engine makes are the same number. Removing a rule names how many surfaces fall back.

**Promotion says what it changes.** "Apply to every Concept…" is the gesture that makes the ladder
discoverable, and it is a document-wide write behind one press. The confirm counts the **cards that actually
change**: a card's own style wins over any rule, so a card that already has one is unaffected — and so is the
card being promoted, which already looks like that. The write states the rule and strips nobody, so the
exceptions that made the board readable survive and undo is one step.

**The shell's scope stopped being fiction too.** `shellRegionPaintFor` resolves the shell once per region
(`app-bar`, `tabs`, `dock`, `drawer`) with the workspace's shell style as every region's base; the root names
only the regions that have their own paint and carries per-region variables, so an untouched shell is still
byte-identical and "the dock is blue" cannot leak into the app bar.

**What this does not do, on purpose:** named presets as a browsable library, and a per-reader override of a
workspace style (Q1 above). Both are decisions rather than wiring.
