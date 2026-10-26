# ADR-0071: Style is derived, not configured

- **Status:** proposed — a concept record, deliberately not implemented
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
