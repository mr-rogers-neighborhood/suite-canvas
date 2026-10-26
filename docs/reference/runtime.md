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

## Offline scope

Offline means the open tab keeps working: edits save to this device and sync when the connection returns. Reloading while offline needs the network, because Suite ships no service worker.

That is a decision, not an omission. There is no service worker, no web manifest and no app-shell cache, so a reload while offline has nothing to load and the reader sees the browser's own network error. Nothing is lost by it: the snapshot and the update log live in IndexedDB and load on the next open that can fetch the app. What is *not* promised is a cold start without the network, and no surface says otherwise.

`StoragePanel` publishes the same sentence (`OFFLINE_SCOPE` in `apps/canvas/src/sharing/StoragePanel.tsx`). Changing one without the other is a bug: a promise in the UI that the runtime cannot keep is worse than the limitation itself.

## Launcher and workspace names

The app starts at `/` on a workspace launcher: recent workspaces from `localStorage`, a blank workspace (`?fresh=1`), and `.suite` import. `localStorage` holds recents, never document truth.

The workspace name lives in `meta.name`, so it syncs and travels in an export. `workspaceName()` falls back to the first board's name and then "Untitled workspace". `renameWorkspace` refuses empty, overlong or control-character names.

An inline rename writes the document, or the `suite.workspaceNames.v1` mirror when the workspace is only a recent entry.

## Credentials

A workspace syncs with two credentials: a session JWT for an account and a share token for a link. There
is no owner key. [ADR-0076](../../internal/decisions/open/0076-the-owner-key-is-deleted.md) deleted it
outright, with no migration for keys already issued, so a `.suitekey` file from an earlier release is not
read.

The client asks `GET /api/auth/token` on the control plane for a session JWT and presents it as
`Authorization: Bearer <jwt>` on `/api/workspaces/<id>`, `/api/shares`, `/api/attachments` (upload and
delete) and the sync join. The relay verifies it against the key set at `<SUITE_AUTH_URL>/api/auth/jwks`;
`apps/collab-server/src/http/sessionToken.ts` holds the cache and the refusal rules, which
[security-model.md](security-model.md) states.

The first verified session that opens a workspace records its organization in the `workspace_orgs` table
of `SUITE_WORKSPACES_DB`, and every later join, upload and link operation is authorized against that row.
An empty credential never writes a workspace room, and a token that does not verify is a refused join
rather than an anonymous one.

A share link is unchanged: the token is exchanged on first open for a short-lived `HttpOnly` session
cookie, and a visitor with no account keeps exactly the access the link grants.

## Accounts

`services/auth` holds identity, organizations, invitations, seats and licence checks. Its HTTP entry, memory and Postgres repositories, and capability mapping have tests.

The shape is two processes behind one Caddy. `apps/control-plane` hosts that service and billing, and owns the only Postgres; the relay keeps the socket and its SQLite stores and imports neither. The relay verifies a short-lived session JWT against the control plane's published key set, so it holds no identity table and makes no call per message. `apps/collab-server/src/sync/seatGate.ts` answers from the token's claims: `org`, `tier` and `limits` are enough to decide a join, so the seat check reads no database.

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
4. A session JWT opens the workspace room and its derived presence and cursor rooms when the organization it names is the one recorded for that workspace. The first verified session to open an unrecorded workspace records its organization. A token from another organization, an expired token and a token that does not verify are all refused.
5. An empty or mismatched credential is rejected. A workspace id is not a secret, and a session can never open a `share-` room.

Live revocation closes sessions that already hold a link. `loro-websocket@0.6.2` keeps its socket and room maps private, so `patches/loro-websocket@0.6.2.patch` records each room's credential and adds `disconnectRoomWhere` and `disconnectAuth`, covering the derived presence and cursor keys.

`apps/collab-server/src/sync/roomSockets.ts` wraps it. Revoking a board or card link closes every session in `share-<token>` except the projection worker. Revoking a workspace link closes only credentials that no longer resolve, and leaves the account's own session alone. Nothing rotates a credential from this side any more: a session token expires and the control plane mints another.

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

- `POST /api/attachments/<workspaceId>` takes a session JWT for the organization that owns the workspace, and never a share token.
- `GET /api/attachments/<id>` treats the id as the read capability, so a projected node resolves without exposing the workspace.
- `DELETE /api/attachments/<id>` takes a session JWT for the owning workspace's organization.

A GET serves only allowlisted types with `nosniff`, `content-disposition: inline`, immutable caching and `content-security-policy: default-src 'none'; sandbox`. SVG and HTML are refused at upload and at read because markup can carry script.

`attachmentBytesPerWorkspace` is enforced inside `put`, in the transaction that inserts the row. A hosted licence's `attachmentBytes` caps one image on top.

A paste uploads under the node id when a relay is configured. Offline, standalone, or from a share session, the bytes go to this browser's IndexedDB and the node is local-only. The record carries `local`, `synced` or `unknown`; `unknown` must never be read as `local`. Unreachable bytes render a placeholder with the name, and rendering never throws.

`gcAttachments(workspaceId, referencedIds)` deletes every row the document no longer references. No admin route calls it yet.

`workspaceFile.ts` version 2 adds an `attachments` section of `{ mime, name, width, height, data }` per id, base64 of the exact bytes. Import restores each image locally and does not upload it.

An image the file cannot supply is named, not dropped. Export gathers the bytes it can and reports every miss by card title; import decodes what it can, then walks the imported document and reports each referenced id that is missing from the envelope or whose base64 does not decode, again by the card title that draws it (`ParsedWorkspaceFile.damaged`, `damagedAttachmentWarning`). The document always imports whole: losing one image must not cost the text that came with it.

## Stored formats and the N−1 policy

Six SQLite stores hold the server's data. A store written by the previous build has to open here, and a store written by a newer one must not be guessed at. The policy:

- **What is guaranteed.** A store from the previous build opens: additive migrations (`ALTER TABLE … ADD COLUMN`) run, a backfill fills only what it can derive, every row is readable, and a document blob is never rewritten by a read. Each older shape has a committed fixture under `apps/collab-server/src/fixtures/n-1/`, and `apps/collab-server/src/store/storeUpgrade.test.ts` runs the current boot path against each one.
- **For how long.** One schema bump. The commit that adds a migration also adds its fixture and keeps the previous fixture for at least the following release; a fixture is deleted only in the release that deletes its migration.
- **Unknown data.** Refused, never guessed. `PRAGMA user_version` above `DOCUMENT_STORE_SCHEMA` throws `UnsupportedStoreVersionError` naming both versions, and a document blob whose tag is not `loro-snapshot-v1` throws the same error naming both. A column this build does not know stays in the row untouched, because migrations only add columns. There is no best-effort read and no downgrade path; rolling back a schema change means restoring a backup taken on that build.

Every store sets the same three pragmas on the connection it opens, through `configureConnection(db, schemaVersion)` in `store/persistence.ts`. `WAL` is a property of the file, so the first opener holds it for every later connection; `busy_timeout` is a property of a connection, so each module sets its own; `user_version` records the schema the store claims, and a file stamped by a newer build is refused with `UnsupportedStoreVersionError` instead of read.

| Store | Journal mode | `busy_timeout` | `user_version` |
| --- | --- | --- | --- |
| Documents (`persistence.ts`) | WAL | 5000 ms | `DOCUMENT_STORE_SCHEMA` |
| Attachments (`attachments.ts`) | WAL | 5000 ms | `ATTACHMENT_STORE_SCHEMA` |
| Shares (`shares.ts`) | WAL | 5000 ms | `SHARE_STORE_SCHEMA` |
| Workspaces (`workspaceOrgs.ts`) | WAL | 5000 ms | `WORKSPACE_ORG_SCHEMA` |
| Settings (`settings.ts`) | WAL | 5000 ms | `SETTINGS_SCHEMA` |
| Licence claims (`licence.ts`) | WAL | 5000 ms | `LICENCE_STORE_SCHEMA` |

The workspaces store keeps its file name and its `SUITE_WORKSPACES_DB` variable, because `deploy/backup.sh` discovers the file by name. What it holds changed: a `workspace_orgs` table of workspace ids and the organization each belongs to, instead of owner-key hashes. A file written by an earlier build keeps its old `workspaces` table untouched and unread, because ADR-0076 ships no migration for issued keys.

## Diagnostics

The relay logs one JSON line per request with a request id. Capability paths are redacted. The logger is `apps/collab-server/src/logging.ts`; server code does not call `console`.

`GET /health` answers on `HEALTH_PORT` and is unauthenticated. `GET /metrics` is token-gated: 404 when no operator token is configured, 401 without the bearer token, 429 above the admin rate limit. Either token reads it; only `SUITE_ADMIN_TOKEN` mutates.

The admin API can read every workspace and delete any of them. Its panel is a separate Vite entry point, never linked from the app. A token is the access control; not linking it is not.

Limits come from `apps/collab-server/src/config/limits.ts` and are published in [limits.md](limits.md). Every environment variable the server reads is in [environment.md](environment.md).
