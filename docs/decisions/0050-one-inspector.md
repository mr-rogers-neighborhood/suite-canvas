# ADR-0050: One inspector, driven by what is selected

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0040](./0040-a-board-and-a-section-are-identities.md) (containers are identities, not types),
  [ADR-0044](./0044-one-target-primitive.md) (one target primitive),
  [ADR-0045](./0045-handbook-articles-are-cards.md) (handbook articles are cards),
  [ADR-0047](./0047-a-view-can-be-a-card-and-an-embed-is-one-concept.md) (view cards),
  [ADR-0048](./0048-links-paint-beneath-cards.md) (one row per other card),
  [`useUiStore.ts`](../../apps/canvas/src/store/useUiStore.ts),
  [`CardInspectorHost.tsx`](../../apps/canvas/src/components/CardInspectorHost.tsx),
  [`ContainerPanel.tsx`](../../apps/canvas/src/components/ContainerPanel.tsx)

## Context

The right-hand drawer answers one question: *what is this, and what is it connected to?* Every
selectable thing wants that answer, and the tree currently answers it in pieces — a card is
`inspectorNodeId` plus `inspectorFieldId`, a section or portal is `containerInspector`, and a link
has only the canvas right-click menu, because there was nowhere for it to go. The handbook adds two
more candidates: an article being read, and the list of articles that match what is on screen.

The tempting shape is a panel per kind, each owning its own open flag and close button. That shape
does not fail loudly; it drifts. Three panels diverge in chrome (padding, header, scroll), in what
Escape does, in what a read-only or share-scoped session hides, and in how an outbound link is
rendered and clicked. Then each new selectable thing adds a fourth surface that has to be brought
back into line, and the drift compounds.

The forces pulling the other way are real, and they are all about *size*, not about plurality: a
container has no fields, types or body ([ADR-0040](./0040-a-board-and-a-section-are-identities.md)),
so its panel is three controls and a link list; a link is not an entity at all, just an edge, so
there is nothing to type or tag; a card wants its body, fields and references. And the handbook is
genuinely not the same question — browsing articles is not inspecting the thing you selected.

## Decision

1. **There is one inspector.** Whatever is selected decides what the single right-hand drawer shows:
   a card, a container (a portal or a section), or a link. One slot, one close affordance, one
   editing session at a time. Selection is the only way in.
2. **A surface asks the store for a target; it never mounts its own panel.** The store holds one
   inspector target — a value discriminated by kind, extending the existing `containerInspector` idea
   rather than adding a field per kind. "Reveal this field" is the same target carrying a `fieldId`,
   which is why the card's reveal path does not need a second open flag. A `Target`
   ([ADR-0044](./0044-one-target-primitive.md)) is the vocabulary; the drawer's target is the subset
   it can render. A link is the one kind that needs no new flag: exactly one selected edge already
   says "inspect this link", so the drawer reads that and a second open flag would only be a way for
   the two to disagree.
3. **The shell is shared, the body is per kind.** Header, close, focus and keyboard, the read-only
   rendering and the empty-when-nothing-selected state live once. A new inspectable kind is one
   renderer keyed by the target's kind, never a new surface.
4. **A container's panel stays deliberately small.** A section or portal exposes what its record
   holds — name or title, colour, cover for a board, links — plus **Open board** on a portal. It does
   not grow a body, fields or types, because the record does not have them.
5. **A link gets its canvas controls plus what the canvas cannot show.** The inspector repeats the
   right-click menu (style, delete) and adds the three things a line cannot: which two connectors it
   joins (named by their owner and their dot), a description that reads on the line and can be slid
   along it, and a way to move one end to another connector. It is an edge, so there is no name,
   type, tag or body to edit. Several links between the same two things list as one row per other
   card, with every description under it ([ADR-0048](./0048-links-paint-beneath-cards.md)).
6. **Read-only and share sessions gate the same slot.** A target the session may not write renders
   read-only, in place; the drawer does not hide, and it does not become a different panel. That is
   the permission rule [ADR-0044](./0044-one-target-primitive.md) requires, paid once.
7. **The handbook is the recorded exception.** Selecting an article *card* reads it through the
   inspector like any other card, because an article **is** a card
   ([ADR-0045](./0045-handbook-articles-are-cards.md)). The handbook's **browser** — which articles
   match what is on screen, authoring an article, the explain-this picker — is a surface of its own,
   not a tab of the drawer. Authoring is not a special editor: it uses the canvas and the same
   primitives as everything else, so an article is written where cards are written. The articles the
   product ships are core content and read-only to the user; a workspace's own articles are the
   workspace's to edit. This narrows [ADR-0045](./0045-handbook-articles-are-cards.md) point 7.

## Consequences

- The drawer's chrome, close behaviour, focus handling, link rendering and read-only rules are
  written once. A fourth selectable thing is a renderer, a `kind` in the target union, and a line in
  the decision about how it is gated — not a panel that has to be brought back into line.
- The store has one inspector truth: the drawer is open exactly when a target exists, and closing it
  clears the target. No panel owns an open flag, so "two panels open" and "the wrong one closed" stop
  being possible states.
- The drawer must size itself by kind rather than by a fixed layout, because a section's three
  controls and a card's body want very different widths. The small panel has to look finished, not
  stunted; that is a real design cost, paid once.
- Links are now inspectable, which is the first time a non-entity has a target. Anything that
  resolves an inspector target must tolerate a link id that no longer exists (the peer deleted the
  edge) by closing the drawer, not by rendering an empty shell.
- The handbook browser can be open while the inspector is, and the two must not both claim the
  editing lock: browsing is reading, the drawer edits. The picker deliberately sets an inspector
  target as a result of a click, which is the one place a surface opens the drawer on the user's
  behalf.
- A read-only share session has one place to get right, and a share projection has one panel to
  redact against instead of three.

## Amendment 2026-10-25: a tour mode is the same drawer

A tutorial's **tour mode is the existing inspector**, not a fourth panel kind. A tutorial is a card, so
selecting it renders the card renderer like any other card; the mode adds tabs (**Details · Steps ·
Style**) and a Present control to that renderer, and presenting changes what the same drawer shows. It
inherits the shared chrome, the close and Escape behaviour, the editing session and the read-only rule
by being the drawer, which is the whole point of this decision.

The **overlay is not an inspector.** It is chrome over the canvas — spotlight, dimming, caption bubble,
previous/next, progress — a reading surface that works with nothing selected and no drawer open. It
never becomes an inspectable target and it never opens the drawer on the user's behalf.

Surfaces, and where a tour's state lives, are recorded in
[ADR-0058](./0058-a-tour-is-one-document-on-three-surfaces.md).
