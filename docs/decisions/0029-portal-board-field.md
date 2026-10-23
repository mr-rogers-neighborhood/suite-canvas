# ADR-0029: Portals are cards with a `board` field, not a reserved property

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0010](./0010-workspace-boards-and-cards.md), [ADR-0016](./0016-semantic-core.md), [ADR-0019](./0019-references-not-typed-links.md), `docs/roadmap/alpha.md` §7.4, `packages/graph/src/loro/WorkspaceDocument.ts`

## Context

A11 defines a **portal**: a card on a board that stands for another board. Activating it replaces
the active board through a camera transition, so the user reads it as a doorway rather than a
navigation to a new page.

The data model had two credible shapes:

1. A first-class `board` **field kind** plus a built-in `portal` **type** whose single field holds
   the target board id.
2. A reserved `portalBoardId` **text property** on an ordinary note.

The second is cheaper — no new kind, no seed — but it makes the most important value in the feature
an unvalidated string. A `text` field cannot say "this is a board id": views cannot predicate on it,
publish redaction cannot recognise it, and a typo is indistinguishable from a deleted board. It also
smuggles a second, hidden schema into a product whose rule is that properties come from a type
definition ([ADR-0016](./0016-semantic-core.md)).

Two further questions had to be answered: does a portal own its target, and how are cycles
represented?

## Decision

1. **`board` is a field kind.** `fieldKinds` gains `"board"`, and a `board` value stores a board id
   as a string, exactly as a `card` value stores a card id. It is a reference-shaped scalar, not a
   new record class: there is no `Portal` table, no join record, and no second source of truth for
   "which board does this card open".
2. **A built-in `portal` type is seeded with the other starter types.** `ensureDefaultTypes()` writes
   `portal` (name *Portal*, plural *Portals*, glyph `◉`) with exactly one field:
   `portal-board`, name *Board*, kind `board`, required, order 0. The ids are stable because the
   seed, the UI and every test have to agree on them. The seed is idempotent and deliberately
   shallow: an existing portal type is left untouched, including a user rename of the type or the
   field. Seeding never rewrites a user's vocabulary on load.
3. **A portal is a card.** Cards already carry multiple placements, tags, type memberships and
   content, so the same target board can be reached from several boards without a new object class,
   and a portal already participates in search, trash and undo. Making it a new kind of object would
   duplicate all of that for one extra property.
4. **A portal references a board; it does not own it.** Deleting a board never deletes the portals
   that point at it, and deleting a portal never deletes its target. The stored value is left dormant
   and the card stays readable: it reads as *Unavailable board*, the same way a dangling `card` value
   reads as *Unavailable card*. A portal carries no lifecycle authority over another board — a
   doorway is not a container.
5. **Validation is soft, at the writer and in publish.** `assertPropertyValue` only checks that a
   `board` value is a non-empty string, so a board deleted on another client cannot make a card
   unwritable or unreadable. `propertyValueError` accepts an optional `boardExists` resolver for the
   callers that can prove a target is gone (a publish plan, a share), but no caller is obliged to
   supply one. There is no self-reference check: a board value is a board id, and a card is not a
   board.
6. **The built-ins are protected.** `deleteType("portal")` throws, and so does
   `removeField("portal", "portal-board")`. A portal type without its board field has nothing to
   point at, and silently reassigning every portal to the note type would destroy the only handle on
   the target. Extra fields may still be added to the portal type; only the seeded field is pinned.
7. **`createPortalCard` is one commit.** `createCard` and `setProperty` each commit on their own, so
   the helper wraps both in `batch()`: a portal is never observable without its target, and one undo
   step removes the card, its value and its placement together.
8. **Cycles are a navigation problem, not a data-model problem.** A → B → A is a legal pair of
   portal cards; the document stores both, and nothing enforces acyclicity. Entering and leaving
   boards is governed by a back stack in the client (Escape, breadcrumb, reverse zoom), which returns
   to the exact previous board and viewport. A graph constraint would need a reachability query on
   every property write and would still have to answer what happens when two clients create a cycle
   concurrently.
9. **A `board` value is never a card reference.** Backlinks (`propertySources`,
   `outgoingPropertyLinks`), projection adjacency, mention indexes, search and publish validation
   all decide "is this a card link?" with `kind === "card"`. A `board` value therefore stays out of
   card backlinks, does not become a projection edge, and is never matched against a card id — even
   when a board id and a card id happen to collide. Portable export, which has the board list in
   hand, reads the value as the board's name; an id it cannot resolve reads as *Unavailable board*.

## Rejected alternatives

- **A reserved `portalBoardId` text property.** Rejected in §Context: no validation, no view
  predicate, no way to tell a typo from a deleted board, and a hidden schema.
- **A `portal` *object* separate from cards.** More code for strictly less: no tags, no content, no
  multiple placements, and a parallel trash/undo path.
- **Owning the target board.** Would make "delete board" cascade into portals on other boards, and
  would make a portal's meaning depend on creation order. Reference semantics are simpler and
  survive concurrent edits.
- **A `parentBoardId` pointer on `Board`.** That models one parent per board, which the roadmap
  explicitly rules out (tab grouping and cross-board edges are follow-ons), and it cannot express
  two portals on one board pointing at the same target.
- **Cycle prevention in the document.** Rejected in point 8: it is a per-write graph query with a
  concurrent-creation hole, for a case the back stack already navigates.

## Consequences

- **The board id travels with the card, not the placement.** One portal card may be placed on
  several boards and always opens the same target; a second portal card is how a board gets two
  targets. This mirrors how a `card` value behaves.
- **A deleted board does not break the workspace.** Portals to it stay on their boards, read as
  unavailable, and become live again if a board with that id is restored (for example from a
  workspace backup). Nothing needs a repair migration.
- **Old clients do not understand the kind.** A build from before this ADR rejects a `board` field
  when it parses a type. That is the same forward-compatibility limit every new field kind has
  (`docs/roadmap/v2.md` §6 counts fourteen places a kind must land); the answer is the shared
  deployment, not a second encoding.
- **Publish treats a portal as an ordinary card with an inert value.** Portal-aware publish/export
  is a named non-goal of the first slice; when it lands, `boardExists` in
  `PropertyValidationContext` is the seam for redaction and stub handling.
- **The UI contract is fixed here, the UI is not.** The canvas workstream consumes
  `PORTAL_TYPE_ID`, `PORTAL_BOARD_FIELD_ID`, `createPortalCard`, `boardName`/`boardPresence` in
  `FormatPropertyOptions`, and the two protection errors. This ADR deliberately says nothing about
  the camera transition, `PortalNode` or card focus.
- **Tested by construction.** `packages/graph/src/property.test.ts` covers board validation,
  formatting and the empty state; `packages/graph/src/loro/portal.test.ts` covers the seed and its
  idempotence under a rename, one-commit creation, placement, a deleted target, the refused
  deletions, and the guarantee that a board value never surfaces as a card backlink or a Markdown
  card reference.
