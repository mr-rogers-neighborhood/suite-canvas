# ADR-0022: Share links are capabilities over live projection rooms

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0021](./0021-sharing-seam-deferred.md), `docs/architecture.md`

## Context

The workspace document contains every board, card, property and reference. A board or card link
must not hand that document to an external reader, and there are still no accounts. ADR-0021 named
the per-card document split as the eventual boundary; that split is still future work, but the
first sharing slice cannot wait for it.

The sync server authorizes one join at a time. A room id was the only secret, and the server
returned `"write"` for every unauthenticated non-share room.

## Decision

1. **A share is a capability token.** The server stores only its SHA-256 hash. A token authorizes
   exactly one room, with `read` or `write`. There is no account, ACL or per-person attribution.
2. **Workspace editing stays the ordinary room.** The workspace editor link remains
   `?workspace=<id>`; the room id is the owner secret. The API does not mint workspace editor links.
3. **Board and card viewers get a projection room.** A board share copies the board, its sections,
   placements, edges, placed cards, used schema and content into a self-contained Loro document.
   A card share copies one card into a synthetic `share-board`. The room is `share-<token>`, and
   the viewer joins it with the token. The owner workspace id never appears in that response or
   document.
4. **Projections are live, not snapshots.** A worker in the collab server holds one Loro document
   per projection room, rebuilds it from the saved workspace after writes (debounced, serialized
   per workspace), and applies the new projection in one commit. Revoking a share closes its room.
5. **Redaction is explicit.** A board share replaces off-board reference titles with “Private
   card”. A card share may show referenced titles as inert context, but those rows never navigate.
   Reference title stubs keep the viewer self-contained without card records.
6. **Roles ship in stages.** S1 is workspace edit plus board/card viewer. Board and card editors
   need merge-back from a projection room to the source workspace; the Share dialog marks them
   “coming next” instead of pretending they exist.
7. **Workspace viewer links are deferred.** A token that joins the workspace room necessarily
   learns the id that share management uses, and with no accounts that id is also write access.
   Minting a workspace viewer token would therefore allow an editor link. It waits for a separate
   management credential or a full-workspace projection room. The viewer shell already supports
   the scope.

## Consequences

- A board or card link cannot be exchanged for workspace access: the owner id is not in the
  resolve response, the local persistence key, or the provider room.
- Projection rooms duplicate the shared subset. The first slice accepts a full rebuild per save;
  incremental projection is an optimization, not a semantic change.
- A shared card can become unavailable when the source card is trashed; the worker keeps the last
  good projection rather than emptying a room a viewer may be reading.
- Cross-document merge-back remains the blocking prerequisite for editor links, as ADR-0021
  predicted.
