# Runtime

The browser process: boot order, persistence, the relay, sharing, and the diagnostics an operator can read. It does not cover the document model ([data-model.md](data-model.md)) or the board gestures ([canvas.md](canvas.md)).

## Boot order

A client holds two copies of the document: IndexedDB and the server. Acting on an empty document is indistinguishable from acting on a deleted workspace, so the order is fixed.

`main.tsx` resolves `?share=<token>` before it imports `App`. `configureSession` records the room, the role and the read-only flag that `useCanvasStore` reads at module load. A plain workspace open uses `?workspace=<id>`; `?doc=` is a legacy alias, and the default id is `default-workspace`.

The store constructs the `LoroDoc`, `WorkspaceDocument`, presence stores and provider once, and starts `LoroIndexeddbPersistence` immediately. They are eager because cursor plugins need a stable `CursorEphemeralStore` on first render.

`ready` flips when the local snapshot and update log are imported. Migrations run then, and again when `synced` flips. `synced` flips when the room join completes, or after `SYNC_WAIT_MS` (5 s) when offline.

Seeding and board resolution wait for both. Seeding an empty local document before the first sync would resurrect starter cards in a workspace someone emptied on another client.

The first editable frame waits only for local hydration. Until then the shell renders `BootSkeleton`, which mounts no canvas, whiteboard or editor.

Boot marks live in `apps/canvas/src/dev/bootTiming.ts` and appear with `?perf=1`: `hydrate`, `to-ready`, `to-synced`, `to-canvas`.

## Persistence

`LoroIndexeddbPersistence` stores a Loro snapshot plus the update log. On open it imports the snapshot, then each update, then starts `subscribeLocalUpdates`. The provider and persistence share one `LoroDoc`, so a local edit reaches both paths without a second serialization.

The workspace id is both the IndexedDB key and the sync room. The active board rides in `?board=<id>` and is not part of the document key.

A backup is a versioned JSON envelope around `doc.export({ mode: "snapshot" })`. Import validates the file, refuses a newer version, writes the snapshot under a new workspace id and navigates. It never merges into the open document. JSON and Markdown exports are projections and cannot be imported.

## Launcher and workspace names

The app starts at `/` on a workspace launcher: recent workspaces from `localStorage`, a blank workspace (`?fresh=1`), and `.suite` import. `localStorage` holds recents, never document truth.

The workspace name lives in `meta.name`, so it syncs and travels in an export. `workspaceName()` falls back to the first board's name and then "Untitled workspace". `renameWorkspace` refuses empty, overlong or control-character names.

An inline rename writes the document, or the `suite.workspaceNames.v1` mirror when the workspace is only a recent entry.

## Owner key and recovery

A workspace has a 32-byte base64url owner key. The browser generates it, keeps it in local storage and the URL fragment (`#owner=<key>`), and the server stores only its SHA-256 hash in `SUITE_WORKSPACES_DB`.

`POST /api/workspaces/:id/claim` registers the first key and reports a conflict for a different one. An offline open keeps working locally and claims on the next online open. An empty credential never writes a workspace room.

Recovery is a separate `.suitekey` file (`kind: "suite.owner"`, `version: 1`, `workspaceId`, `ownerKey`, `exportedAt`). It is never embedded in a `.suite` backup because that file gets copied and shared. The protected screen accepts the file or its pasted contents, refuses another workspace's key, and reloads with `#owner=`.

`POST /api/workspaces/:id/rotate` replaces the hash atomically. Old owner links and `.suitekey` files stop working, and the response offers to revoke every share link.

## Accounts

`services/auth` holds identity, organizations, invitations, seats and licence checks. Its HTTP entry, memory and Postgres repositories, and capability mapping have tests.

No process mounts that entry yet, and no relay opens a Postgres pool. A socket join carries an owner key or a share token, so `apps/collab-server/src/sync/seatGate.ts` refuses an account principal with `account-check-unavailable` instead of guessing a seat count. Anonymous workspaces are what ships. [security-model.md](security-model.md) describes what accounts add.

## Connection lifecycle

`status` is `connecting`, `connected` or `disconnected`. The UI stays usable in all three. `App` calls `connect()` through `LoroProvider`; the standalone build skips the call.

Presence binds once the provider exists. A reconnect reuses the same document and sends the local oplog version, so a peer that missed updates receives the diff rather than a full snapshot.

## Share projections

A board or card share opens `share-<token>`, a room holding a self-contained projection.

`apps/collab-server/src/projection/worker.ts` joins every active share with the internal token, keeps one `LoroDoc` per room, and rebuilds a workspace's shares after each save. A rebuild calls `projectWorkspace` then `applyProjection`, which clears and rewrites every projection root in one commit. The room keeps one peer for its lifetime so each rebuild wins the LWW race against the previous one.

A share row stores a `room_id` and only the token hash. The worker can name a room without seeing the token, and resolving a board or card token reports that room as its `workspaceId`, so a share link cannot be exchanged for a workspace link.

Redaction runs before the projection is built. A projection carries whiteboard `drawings` for the cards in scope. A portal to a board outside the scope reads as "Unavailable board".

A reference row is emitted once per card crossing the boundary, from one walk over mention targets, card properties and edge endpoints. Per-card helpers made a large rebuild quadratic.

A selection share filters the projection to card ids fixed at creation. It keeps the real board id, name and geometry, copies every section containing a selected anchor plus its ancestors, and copies an edge only when both endpoints are selected. `ShareDialog` caps it at `SUITE_MAX_SELECTION_CARDS`.

## Publish from a draft

A board or card editor starts from a projection of its scope and publishes the diff back.

A board draft can create cards, sections and edges on its board. A card draft edits only its card. Boards, types, tags, trash and links are not creatable from a draft.

Publish preserves the client UUID, rejects an id that already exists, and requires a new card to be placed on the shared board. The operation is all or nothing. A rejected object keeps the draft and appears in the "Can't publish yet" dialog.

A card body publishes block by block. Each top-level block carries its own conflict key, `card:<cardId>:body:<blockKey>`, so two editors touching different paragraphs both publish. Identity prefers the block's Loro container id; between two projections, which share no ids, the fallback is a structural key of node name, subtree hash and occurrence.

Apply rewrites only changed blocks in one `share:publish` commit. When blocks cannot be lined up, the card degrades to one whole-body conflict, which still accepts the legacy `card:<cardId>:body` key.

## Room authorization

Every sync join carries an `auth` payload. `authorize(roomId, auth, deps)` maps it to a permission:

1. The projection worker token writes only `share-` projection rooms.
2. The source worker token writes only a workspace room that currently has an active editor share.
3. A share token opens exactly its share room, `read` for a viewer and `write` for an editor, plus the derived `<room>:presence` and `<room>:cursors` rooms.
4. An owner key verifies its workspace and the derived presence and cursor rooms. A join never claims an unclaimed workspace; the explicit HTTP claim does that. A different key is refused.
5. An empty or mismatched credential is rejected. A workspace id is not a secret, and an owner key can never claim a `share-` room.

Live revocation closes sessions that already hold a link. `loro-websocket@0.6.2` keeps its socket and room maps private, so `patches/loro-websocket@0.6.2.patch` records each room's credential and adds `disconnectRoomWhere` and `disconnectAuth`, covering the derived presence and cursor keys.

`apps/collab-server/src/sync/roomSockets.ts` wraps it. Revoking a board or card link closes every session in `share-<token>` except the projection worker. Revoking a workspace link closes only credentials that no longer resolve. Rotating the owner key closes sessions holding the previous key.

## Standalone and relay

`apps/canvas/src/session/mode.ts` owns the profile. `suiteMode()` reads `VITE_SUITE_MODE` (default `relay`). `bootPlan(mode, url)` returns `resolveShare`, `claimOwner`, `connectProvider` and `showSharing`, all true under relay and all false under standalone whatever the URL says.

`sessionCapabilities` returns `STANDALONE_CAPABILITIES` before it looks at a share: local editing, layout, creation, boards, schema and trash, with `canManageLinks` and `canPublish` false.

`main.tsx` boots standalone with no `ownerKey` and no `share`, and imports the share client and owner-key claim only inside the relay branch. A standalone bundle contains no `/api` path and no socket URL.

`App` skips `connect()` and presence binding, marks `synced` itself and shows a "Local only" note. `WorkspaceActions` keeps the File menu and drops Share and the recovery key.

`session/mode.test.ts` guards the split: a direct `fetch`, `WebSocket` or `collabHttpBase()` call may only live in a listed relay module.

## Opening a share link

`main.tsx` resolves `?share=<token>` before importing `App`. `configureSession` records the room, role and read-only flag.

A board or card viewer targets `share-<token>` only, so `workspaceId`, the IndexedDB key and the provider room are that projection room. The viewer never learns the owner's workspace id.

A workspace viewer targets the real room, learns the id and not the owner key, and joins presence and cursor rooms with the share token.

`useUiStore.readOnly` closes every write surface: canvas drag, connect and delete, context menus, section gestures, the card menu, inline editors, panel type/tag/property edits, and the dock, library and share actions. Board tabs remain without create, rename or delete.

A revoked or unknown token renders `ShareUnavailable` instead of the shell.

## Attachments

Images are nodes that name bytes stored beside the document. An `attachment` inline atom holds `{ id, mime, width, height, name, bytes }`. The same allowlist lives in `publishValidation.ts`, and `editorSchemaContract.test.ts` keeps schema and allowlist aligned. A projection copies the document, so bytes in a node would put a private copy of every image in every share link.

`apps/collab-server/src/store/attachments.ts` owns the bytes: `put`, `get`, `delete` and `usage` over one table (`id`, `workspace_id`, `mime`, `bytes`, `size`, `created_at`) in `SUITE_ATTACHMENTS_DB`. The interface is the seam for object storage.

`apps/collab-server/src/http/attachmentHttp.ts` serves `/api/attachments`.

- `POST /api/attachments/<workspaceId>` takes the owner key and never a share token.
- `GET /api/attachments/<id>` treats the id as the read capability, so a projected node resolves without exposing the workspace.
- `DELETE /api/attachments/<id>` takes the owning workspace's owner key.

A GET serves only allowlisted types with `nosniff`, `content-disposition: inline`, immutable caching and `content-security-policy: default-src 'none'; sandbox`. SVG and HTML are refused at upload and at read because markup can carry script.

`attachmentBytesPerWorkspace` is enforced inside `put`, in the transaction that inserts the row. A hosted licence's `attachmentBytes` caps one image on top.

A paste uploads under the node id when a relay is configured. Offline, standalone, or from a share session, the bytes go to this browser's IndexedDB and the node is local-only. The record carries `local`, `synced` or `unknown`; `unknown` must never be read as `local`. Unreachable bytes render a placeholder with the name, and rendering never throws.

`gcAttachments(workspaceId, referencedIds)` deletes every row the document no longer references. No admin route calls it yet.

`workspaceFile.ts` version 2 adds an `attachments` section of `{ mime, name, width, height, data }` per id, base64 of the exact bytes. Import restores each image locally and does not upload it.

## Diagnostics

The relay logs one JSON line per request with a request id. Capability paths are redacted. The logger is `apps/collab-server/src/logging.ts`; server code does not call `console`.

`GET /health` answers on `HEALTH_PORT` and is unauthenticated. `GET /metrics` is token-gated: 404 when `SUITE_ADMIN_TOKEN` is unset, 401 without the bearer token, 429 above the admin rate limit.

The admin API can read every workspace and delete any of them. Its panel is a separate Vite entry point, never linked from the app. A token is the access control; not linking it is not.

Limits come from `apps/collab-server/src/config/limits.ts` and are published in [limits.md](limits.md). Every environment variable the server reads is in [environment.md](environment.md).
