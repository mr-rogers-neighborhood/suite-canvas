# ADR-0045: Handbook articles are cards on a designated board

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0003](./0003-typed-object-graph.md), [ADR-0038](./0038-a-type-template-is-a-card.md), [ADR-0040](./0040-a-board-and-a-section-are-identities.md), [ADR-0041](./0041-alpha-core-is-a-closed-feature-set.md), [ADR-0044](./0044-one-target-primitive.md)

## Context

The handbook is the feature its author calls defining: documentation that explains every element of
the interface, **sorted contextually by what is on the screen**, with a picker that can explain
something you point at, and with the ability for a user to write their own documentation about their
own entities.

The obvious version is a help site. The interesting version is that the documentation is *content*:
written in the same editor, linked with the same links, shared with the same shares. The author has
seen a primitive version of this before and considers it a product pattern, not a help page.

Three questions had to be settled: where articles live, how an article is matched to what is on
screen, and how the pointer line is drawn from article to element.

## Decision

**An article is a card on a designated handbook board.** The handbook is a view of that board, not a
separate document.

1. **One designated board per workspace.** A workspace setting names it; nothing about the board record
   changes ([ADR-0040](./0040-a-board-and-a-section-are-identities.md)). Articles are ordinary cards
   and may be moved, linked, tagged and published like any other card.
2. **An article declares its subject with fields, not with prose.** The handbook card type carries
   `Target kind`, an optional `Target id`, and optionally the UI region name. Matching therefore uses
   the same `Target` primitive presence and Follow use ([ADR-0044](./0044-one-target-primitive.md)), so
   there is one idea of "this element" in the product.
3. **Context is computed from what is on screen.** The handbook lists articles whose target is
   satisfiable right now — a card on the active board, a section in view, a chrome element present on
   this screen — with the panel's contents changing as the user navigates. A "present" count is the
   bubble badge the author asked for.
4. **Hovering an article outlines its subject.** Hovering an article row draws one line from the row to
   the element and outlines it; opening it keeps the outline. When several instances of a target are on
   screen, the one nearest the viewport centre wins, which is stable and explainable.
5. **The picker inverts the relationship.** "Explain this" turns the next interface click into a
   `Target`, then opens the article whose subject matches it, or offers to create one pre-filled.
6. **A user's own documentation is the same mechanism.** Documenting *their* entity means writing an
   article on the designated board whose subject is that entity. It is not a new kind of annotation,
   and it inherits links, sharing and export from being a card.
7. **The handbook is read-only about the product's articles.** Built-in articles ship as a workspace
   seed; editing them is an ordinary card edit, and a workspace may diverge.

## Rejected alternatives

- **A bundled help site (static HTML or docs pages).** Cannot be contextual, cannot link into the graph,
  and cannot be extended by the user — the three things that make this feature different from a
  tooltip library.
- **Annotations on entities instead of articles.** Would scatter documentation across the thing
  documented, so there is nowhere to read the handbook, no order, and nothing to search.
- **A separate handbook document.** Duplicates the board machinery (tabs, sharing, links, presence) and
  makes "write docs about my entity" mean writing in a second place.
- **Match articles by keyword/embedding against screen text.** Unpredictable, unexplainable, and it
  cannot tell the difference between two cards with the same title. An explicit subject field is what
  makes the outline honest.
- **A modal help drawer.** The point is to keep working while reading; the panel is a bubble beside the
  canvas, not a takeover.

## Consequences

- **The handbook needs a card type and a board setting.** The type carries the subject fields; the
  setting names the board. Neither is a schema change to cards or boards.
- **The outline/line renderer is shared with Follow** ([ADR-0044](./0044-one-target-primitive.md)), which
  is the reason this ADR depends on it: two highlighters would disagree about what "the element" is.
- **Built-in articles are data, not code.** They are seeded cards, so they can be reworded, translated,
  linked and versioned like content, and adding one is not a release.
- **A card type is a publication surface.** If the handbook board is published as a share, the articles
  are published with it; the built-in seed must therefore contain nothing internal.
- **The badge counts articles, not "help".** A screen with no matching article shows no badge, which is
  the honest signal that documentation for that surface does not exist yet.

## Amendment 2026-10-25: backlinks, and the peek is general

§4's outline-and-point rule is generalised by [ADR-0055](./0055-hover-peek-names-an-entity.md): the same
gesture serves a mention in a card body, a backlink row and an article row, it never moves the camera unless
the reader opens it, and it writes nothing.

Articles gain **backlinks**: a card's backlinks list (inspector, Details) and an article's backlinks both list
the cards that mention or link to it, each row peeking its target. A dead reference reads as "removed" rather
than vanishing, so a backlink to a trashed card is history, not a broken link.

## Amendment 2026-10-25: an article can play a tour

An article may carry a **Play** control that starts a tour whose steps include the article's subject. The
article stays the contextual answer to "what is this on my screen?"; the control is a hand-off, not a second
mode of the panel.

The handbook still **only lists articles by what is on screen** (§3), and it still does not drive playback:
no step list, no scrubber, no present mode in this panel. A tour is read in the overlay and authored in the
tutorial card's own inspector — see
[ADR-0058](./0058-a-tour-is-one-document-on-three-surfaces.md). Keeping the two apart is what keeps "any set
of highlights" from becoming a tutorial.
