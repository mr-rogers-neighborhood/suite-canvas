# ADR-0022: Share links are capabilities over live projection rooms

- **Status:** accepted; portal and drawing projection scopes added in [ADR-0031](./0031-whiteboard-cards-and-loro-binding.md)
- **Date:** 2026-10-23
- **Related:** [ADR-0021](./0021-sharing-seam-deferred.md), [ADR-0031](./0031-whiteboard-cards-and-loro-binding.md), `docs/architecture.md`

> **Amendment (2026-10-23).** Two projection rules are explicit. A board projection must copy the
> `drawings` entries of whiteboards in scope, under the same redaction rules as body text. A portal
> target renders as its board only when that target board is inside the projection; otherwise the
> card reads as *Unavailable board*. The projection records whether a target is included, redaction
> runs before the projection is built, and no share expands or fetches a board outside its scope. This
> extends the existing "self-contained projection" rule; it does not add a new token or room kind.

## Context

The workspace document contains every board, card, property and reference. A board or card link
must not hand that document to an external reader, and there are still no accounts. ADR-0021 named
the per-card document split as the eventual boundary; that split is still future work, but the
first sharing slice cannot wait for it.

The sync server authorizes one join at a time. A room id was the only secret, and the server
returned `"write"` for every unauthenticated non-share room.

## Decision

1. **A share is a capability token.** The server stores only its SHA-256 hash. A token authorizes
   one document room with `read` or `write`, plus that room's derived ephemeral presence/cursor
   rooms. There is no account, ACL or per-person attribution.
2. **Workspace editing stays the ordinary room.** The workspace editor link is
   `?workspace=<id>#owner=<key>`; the owner key, not the room id, is the secret. The API does not
   mint workspace editor links.
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

   *Revised in S3:* board and card editors exist. An editor token writes only its projection room;
   the draft is published to the workspace by `POST /api/shares/:token/publish`, which rejects a
   conflict and leaves the draft intact. `POST /api/shares/:token/reload` discards the draft. The
   owner workspace changes still flow into a clean draft and pause while the draft is dirty.

   *Revised in S5:* a conflict is resolved field by field. The publish body becomes
   `{ version?, overwrite?: string[] }`: a listed conflict key takes the draft value, an unlisted
   one keeps the workspace value, and an unsupported change still rejects the whole publish.
   `GET /api/shares/:token/status` reports `{ dirty, hasBaseline }` to an editor token, which drives
   the single `Draft`/`Published` word beside Publish. Publishing stays manual.

   *Revised in S7:* a board draft can create content. A board editor may create cards, sections
   and edges on its shared board; a card editor still edits only its one card. Creation is
   content-only — never boards, card types, tags, trash or links.
   Client UUIDs are preserved, a collision with an existing source object rejects the publish, and
   a new card must be placed on the shared board and nowhere else. The whole publish is
   all-or-nothing: one invalid or conflicting creation leaves the draft intact and names every
   rejected object in “Can’t publish yet”; there is no partial publish. Editing a published
   object remains field-granular.
   *Revised for block-level body conflicts:* a card body is no longer one key. Each top-level block
   of the body gets `card:<cardId>:body:<blockKey>`, so two editors who edit different paragraphs
   of the same card both publish. A block's identity prefers its Loro container id; two projections
   copy the body into fresh containers and share no ids, so the fallback is a structural key (node
   name, a hash of the block's subtree, the occurrence of that content), and a block the draft
   changed keeps the baseline block's key so both-sided edits collide on purpose. Apply rewrites
   only the changed blocks, still in one `share:publish` commit, so an untouched block keeps its
   containers and a peer's caret there. The dialogue accepts both a block key and the legacy
   `card:<cardId>:body` key; a one-block body keeps the legacy key and the whole-body write.
   When the blocks cannot be aligned — a reorder, or a structure where no key means the same block
   — the card deliberately degrades to one whole-body conflict. Guessing which block moved where
   silently loses text, and a visible conflict is always cheaper than a lost paragraph.
7. **Workspace viewer links are deferred.** A token that joins the workspace room necessarily
   learns the id that share management uses, and with no accounts that id is also write access.
   Minting a workspace viewer token would therefore allow an editor link. It waits for a separate
   management credential or a full-workspace projection room. The viewer shell already supports
   the scope.

   *Revised in S2a:* the owner credential is now required for workspace rooms and for share
   management, so the workspace id is no longer write access. Workspace viewer links are enabled;
   they open the real workspace room read-only and join presence with the share token.

*Revised in S8:* the projection seam also carries a **selection** scope, a board projection
filtered to a fixed set of card ids, so part of a board can be shared without duplicating the
workspace. `projectWorkspace` accepts it beside `board` and `card`; see
[ADR-0023](./0023-selection-projections.md).

## Consequences

- A board or card link cannot be exchanged for workspace access: the owner id is not in the
  resolve response, the local persistence key, or the provider room.
- Projection rooms duplicate the shared subset. The first slice accepts a full rebuild per save;
  incremental projection is an optimization, not a semantic change.
- A shared card can become unavailable when the source card is trashed; the worker keeps the last
  good projection rather than emptying a room a viewer may be reading.
- Cross-document merge-back is a publish step, not a live loop: the worker diffs the draft
  against a per-share baseline, applies one `share:publish` commit to the workspace, and rebuilds
  the projection. Conflicting fields reject the publish unless the editor selects them in the
  conflict dialog; there is no automatic share-wins fallback. A body conflicts per block, and a
  body whose blocks cannot be aligned degrades to one whole-body conflict rather than an inferred
  merge — the merge never rewrites blocks the draft did not change.
