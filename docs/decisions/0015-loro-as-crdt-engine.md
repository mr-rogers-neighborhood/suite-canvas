# ADR-0015: Loro as the CRDT engine

- **Status:** accepted
- **Date:** 2026-10-21

## Context

The first engine choice was Yjs, because it was the mature local-first CRDT. After the canvas and
typed graph were working, two limits became concrete:

- **History and snapshot cost.** Yjs replays history and full snapshots grow with every edit. Large
  workspaces pay for history they do not need, and the card/index split that card-level sharing
  needs would multiply that cost.
- **Typed structure.** The semantic model wants typed objects, ordered moves, counters and nested
  trees. Yjs offers maps, arrays and text, so every richer structure has to be simulated.

The app also needed presence and cursor state. With Yjs that is a second protocol (awareness), with
its own lifecycle and no persistence semantics.

Loro addresses both directly: typed containers (`LoroMap`, `LoroList`, `LoroText`, `LoroTree`,
`LoroCounter`, `MovableList`), an event graph walker instead of full replay, and an
`EphemeralStore` for presence. `loro-prosemirror` and `loro-websocket` cover the editor and sync
paths. The trade-off is a younger ecosystem, a larger WASM bundle, and fewer production references.

There is no production data to migrate, so the cost of switching now is lower than switching after
types and relations ship.

## Decision

Loro is the single source of truth for document state.

- **Document:** one `LoroDoc` per workspace. `boards`, `cards`, `placements`, `edges`, `content`,
  `titles` and `meta` are root `LoroMap`s. Records are field maps; card text is a
  `loro-prosemirror` tree inside a per-card `LoroMap`.
- **Typed boundary:** `@suite/graph` exposes `WorkspaceDocument`, validates every write with Zod,
  and is the only code allowed to touch the CRDT.
- **Persistence:** `LoroIndexeddbPersistence` stores a snapshot plus an append-only update log in
  IndexedDB. The server stores the latest bytes per room in SQLite.
- **Sync:** `loro-websocket` client provider and `SimpleServer`. The workspace id is the room id;
  separate rooms are the target for card-level sharing.
- **Presence:** Loro `EphemeralStore` channels for board presence and editor cursors. They expire
  and are not persisted in the document.
- **Undo:** separate `UndoManager`s. Structural edits use `struct:` origins; title and body editors
  use `text:title` / `text:body` origins and exclude each other's prefix. Import and init origins are
  excluded everywhere.

### Patched `loro-prosemirror`

`loro-prosemirror@0.4.4` has two issues that matter for many small editors on one page:

1. **Deferred init can erase early typing (upstream #77).** `init()` runs in a `setTimeout(0)`. Typing
   before it runs must be preserved, not overwritten by the empty container. The patch makes `init`
   commit non-empty editor content before initializing, and ignores doc changes until init finishes.
2. **Cursors leak across editors.** A cursor store is keyed by peer, not by editor. Without a
   container check, every editor sharing the store renders the same remote caret. The patch skips a
   cursor unless its anchor and focus containers belong to the current editor's mapping.

The patch also adds a per-editor `commitOrigin`, so title and body undo stacks do not capture each
other's commits. It is tracked in `patches/loro-prosemirror@0.4.4.patch` and must be re-checked on
every upgrade.

## Consequences

- Typed structures can be expressed with native containers instead of simulated maps and arrays.
- Presence and cursors use one ecosystem and are ephemeral by construction.
- The canvas bundle includes the Loro WASM binary (~1.1 MB gzip). It must be loaded with
  `vite-plugin-wasm` and a modern build target.
- Loro is younger than Yjs; the provider, editor binding and docs are less battle-tested. Pin
  versions, keep the patch, and add regression tests for every patched behaviour.
- Full snapshots are still the safe export path. Do not use shallow snapshots until the upstream
  import/panic issues are resolved.
- The current document is one workspace doc. The index/card-doc split remains the target for
  card-level ACL and lazy body loading; Loro makes that a room-boundary change, not a model change.
