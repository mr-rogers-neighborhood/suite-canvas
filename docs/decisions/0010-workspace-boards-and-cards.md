# ADR-0010: Workspaces, boards, cards and placements

- **Status:** accepted
- **Date:** 2026-10-21

## Context

The canvas was the document: one board, every node placed by definition, and deletion destroyed
content. A PKM needs the opposite: cards are ideas that exist whether or not they are on screen,
and boards are contexts that show them. Boards in the same workspace should share cards;
workspaces should not share anything.

## Decision

1. **One `Y.Doc` per workspace, boards as views.** Boards are records inside the workspace document,
   not separate documents. Sharing a card across boards is then a placement pair, and moving a card
   between boards is a single atomic transaction. Separate documents per board would make sharing a
   copy across CRDTs, which duplicates on an offline client.
2. **Cards own content; placements own position.** `cards` holds identity, kind, connectors and
   `deletedAt`; `placements` (key `${boardId}/${cardId}`) holds `x`, `y`, `z` and `createdAt`. At
   most one placement per card and board, so "the card on this board" stays unambiguous for
   selection, links and drag presence.
3. **Home is derived.** The oldest placement is home. Nothing is stored to pin it, so there is no
   second source of truth to reconcile, no concurrent-pin race, and deleting or leaving the home
   board simply promotes the next placement. Placement `createdAt` is strictly increasing per
   client, because two placements created in the same millisecond must not flip home.
4. **Deleting a board never silently deletes cards.** `deleteBoard` removes the board's placements
   and edges; the UI asks whether cards left without a board keep living in the library or move to
   the trash. Cards still placed elsewhere are untouched.
5. **Trash is a tombstone, edges go dormant.** `deletedAt` hides a card from every board while its
   placements and text survive, so restore is lossless. Edges are board-scoped and stay in the CRDT
   when an endpoint leaves, reviving on return; only `purgeCard` destroys them.
6. **Titles are fragments.** A `Y.Map` string resolves concurrent renames last-write-wins for the
   whole value; an `XmlFragment` per card merges character-wise and reuses y-prosemirror carets.
   `displayTitle` falls back to the body's first line, so existing cards migrate without a
   destructive text move.
7. **Delete means unplace.** Delete/Backspace takes a card off the board (Inbox); Shift+Delete and
   the card menu trash it. Destructive actions stay explicit.

8. **Reads never materialise shared containers.** Text lives in `Y.XmlFragment`s keyed by card id,
   and only creation writes them. A reader that raced the document load would publish a second
   fragment, win the merge and orphan the real text (observed as "edits stop syncing" and "carets
   disappear"). Peek returns the shared fragment or a local placeholder, and the card re-resolves it
   on every change so it adopts the winner as soon as it arrives.
9. **Startup waits for hydration.** Migration, seeding and board resolution run only once local
   storage is ready, and migration leaves `schemaVersion` unset when the document has no legacy
   nodes, so an empty, not-yet-loaded client cannot stamp over real data.

## Consequences

- Cards can appear on several boards at once; the footer lists the placements and marks home.
- Links are a statement made in a context: the same two cards can be wired differently on two
  boards, and "this card's links" becomes an aggregate rather than a property.
- Presence is workspace-wide but board-scoped by `peer.board`, so cursors and drags never leak
  between boards; carets stay card-scoped so two people can edit one card from different boards.
- Layer order reindexes one board's placements only, so Inbox cards never consume z slots.
- The pre-workspace schema is migrated once, deterministically, with `meta.schemaVersion`.
- Card size is per placement, so a shared card can be sized differently on each board, and resizes
  are projected to peers live before the final size is persisted.
