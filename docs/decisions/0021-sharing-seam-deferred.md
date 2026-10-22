# ADR-0021: Card-level sharing is a per-card room, recorded but deferred

- **Status:** accepted
- **Date:** 2026-10-22
- **Related:** [ADR-0020](./0020-main-and-loro-plan-of-record.md), `docs/design-inspirations.md` §7

## Context

The product target includes "share this card like a Notion page" without sharing the workspace.
That capability is not a permission flag on the current document:

- The workspace document contains every card title, property and placement. Handing it to an
  external viewer leaks the workspace.
- A card share needs a room whose membership can be authenticated independently. The sync server
  currently authenticates a connection for one room and returns `"write"` for every caller; a room
  URL is the only secret (`apps/collab-server/src/server.ts` has an explicit `TODO(auth)`).
- Loro has no multi-document transactions. Creating a card share, revoking it, or moving a card
  between a private workspace and a shared projection must be compensating, idempotent sequences,
  not one atomic write.
- Undo is already scoped by surface. A card document adds another scope; the UI must not pretend a
  single `Cmd-Z` spans both documents.

## Decision

1. **Do not implement card-level sharing in this phase.** Do not add an ACL flag to cards and do not
   imply one in the UI. The Share affordance copies the workspace/board URL and says that anyone
   with the link can edit.
2. **The seam is a per-card Loro room.** The future shape is an index document (boards, placements,
   sections, types, tags, card summaries, relations) plus one card document per card (body, long-form
   blocks, attachments). The card document is the unit of content ACL and the unit of lazy loading.
3. **The index remains workspace-private.** A share is served as a redacted projection: the shared
   card summary, its body document, and relation stubs that reveal only titles of cards that are
   also shared (otherwise "private card").
4. **Cross-document operations are convergent sequences.** Create writes the index summary first,
   then the card document; purge tombstones the index first, then deletes the card document. Readers
   tolerate a missing body as empty.
5. **Keep today's storage one document.** `WorkspaceDocument`'s export/import and card-container
   resolution stay isolated so a future split is a storage change, not a semantic rewrite. The
   benchmark in `packages/graph/bench/workspace.bench.ts` is the signal for when the split is worth
   it, not a hunch.

## Consequences

- The Share button is honest: a link grants collaborative editing of the workspace, not a card.
- Per-room auth remains the blocking prerequisite for any real sharing; the server TODO stays
  visible rather than being replaced by a client-side check.
- Card-level sharing remains a named project with a documented data boundary, so it is not
  rediscovered as a UI feature later.
