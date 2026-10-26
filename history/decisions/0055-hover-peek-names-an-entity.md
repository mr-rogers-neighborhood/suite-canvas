# ADR-0055: Hover-peek names an entity anywhere

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0019](./0019-references-not-typed-links.md) (references, not typed links),
  [ADR-0044](./0044-one-target-primitive.md) (one target primitive),
  [ADR-0045](./0045-handbook-articles-are-cards.md) (handbook articles are cards),
  [ADR-0054](./0054-a-tutorial-is-a-card.md) (tutorials and tours)

## Context

ADR-0045 §4 gave the handbook one good idea: hovering an article row draws a line to its subject and
outlines it, choosing the instance nearest the viewport centre when several are on screen. The author now
wants that gesture everywhere, and made it concrete for the handbook:

> if we should use backlinking in the handbook (yes) so then you can hover over a backlink in an article that
> includes multiple highlightable things referenced, and see that entity pointed to. The more of this we can
> also matter-of-fact provide for the user to use themselves, the better.

The tree already has the ingredients: mentions in a card body resolve through the `references` index
(ADR-0019), a `Target` names anything (ADR-0044), and the canvas can already outline and fly to a node. What
is missing is one decision about *what a hover is allowed to do* — because the tempting versions of this
feature write to the document, steal the camera, or open panels.

## Decision

**Hovering anything that names an entity outlines that entity and points at it. Nothing is written.**

1. **Three call sites, one mechanism.** A mention inside a card body, a backlink row (in the handbook panel or
   a card's backlinks list), and a handbook article row all resolve to the same "peek this `Target`".
2. **The peek is read-only.** No document write, no selection change, no presence publish — a hover is not an
   edit and must not look like one to a collaborator.
3. **Pointing, not travelling.** The peek outlines the entity and draws one line from the thing being hovered
   to it. It does not move the camera. Opening the peek (a click, or Enter on a focused row) scrolls the
   entity into view and keeps the outline, which is the only step that may move the viewport.
4. **Nearest instance wins.** When several instances of the target are on screen — three portals to the same
   board, a section repeated across boards — the one nearest the viewport centre is chosen, as ADR-0045
   already specified. Off-screen targets get a line pointing off-screen plus the count of instances, rather
   than a silent nothing.
5. **A dead reference still speaks.** If the target no longer resolves, the peek says "removed" instead of
   disappearing, so a backlink to a trashed card reads as history rather than as a broken link.
6. **Backlinks are a list, not a panel of their own.** A card's backlinks live in the inspector (Details), and
   the handbook's live in the article; both rows peek. No new navigation surface.
7. **User authoring is the same thing.** Any mention a user writes gets peek behaviour, because a mention *is*
   a reference. Nothing about this is reserved for our documentation.

## Consequences

- **The handbook stops being special.** Articles are cards (ADR-0045) and their subject rendering is the
  general peek, so there is one renderer to maintain and one to test.
- **Tours reuse it.** A tour step's spotlight is the peek's outline at full strength (ADR-0054).
- **Hover cost is bounded.** Peeking requires geometry the canvas already has; the one new lookup is
  "instances of a target on this board", which the spatial index can answer.
- **A peek never surprises a collaborator.** Because it writes nothing, two people hovering each other's
  references cannot perturb the document.
- **Backlinks become the first place a reader notices a hierarchy of content** — "this article is about that
  card" — which is what makes a docs board feel connected rather than filed.

## Rejected alternatives

- **A hover preview *card* (a mini panel of the entity's content).** Expensive to keep truthful, and it covers
  the canvas the user is pointing at.
- **Peeking by moving the camera.** A hover that moves the viewport is unusable on a board where the pointer
  crosses five mentions on the way to a click.
- **Publishing the hover as presence.** It would make every pointer move a network message and every
  collaborator's board jump.
- **A separate "references" surface with its own navigation.** Duplicates the library and the outline for a
  relationship the inspector can list.
