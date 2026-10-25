# Suite

A local-first, collaborative canvas for connected thinking. A **workspace** owns its **cards** and
the **boards** they appear on: cards are objects first (they can sit in the Inbox, or on several
boards at once), and boards are views. Edits sync live and the canvas keeps working offline.

**Status: alpha, version `0.2.0-alpha.1` (MIT).** Self-host it with Docker. Hosted billing is not
open for the alpha: there is no checkout, no price and no account, and the Stripe webhook is not
deployed. Release notes and the rollback procedure are in [docs/release.md](docs/release.md).

![Suite](docs/assets/preview-dark.png)

## Quick start

```sh
pnpm install
pnpm dev          # canvas app (http://localhost:5173) + collab server (:1234)
```

The app opens on the **workspace launcher**: start a blank workspace, open a `.suite` backup, open a
`.suitekey` recovery key, or pick a recent workspace. Recent workspaces are local metadata only.

Open two browser windows at the same URL — including `?workspace=<any-id>` to work in a separate
workspace (`?doc=` still works as an alias) — and edits, carets, titles, and presence appear in
both. Board tabs in the app bar switch boards inside the same workspace.

The dock at the bottom of the canvas opens the **library**: cards taken off a board land in the
**Inbox**, the **Cards** tab lists everything in the workspace, and the **Trash** tab restores or
purges what you deleted. Clicking a card type creates a card on the current board.

## Editions

One codebase ships three profiles. The mode is a **build-time** value, so a
local-only bundle carries no relay code and no server URL, and no control can
appear that this build cannot honour:

| Edition | Build | What you get |
| --- | --- | --- |
| Hosted free | `VITE_SUITE_MODE=standalone` | Local-only: cards, boards, sections, connectors, mentions, types/fields/tags, library, trash, undo, export/import and multiple local workspaces, all in this browser. No sync, presence, sharing or publishing. |
| Self-host | `VITE_SUITE_MODE=relay` (default) | Full parity: sync, presence, every share scope and publish. |
| Hosted paid | `VITE_SUITE_MODE=relay` | **Not open for the alpha.** Hosted billing is closed: no checkout and no upgrade control exists in the app. The build is identical to self-host, and a licence key you hold yourself is what gates a relay — never a feature. |

`pnpm --filter @suite/canvas build:standalone` writes the local-only bundle;
`pnpm build` (or `pnpm --filter @suite/canvas build`) is the relay build. A
`?share=` link opened in a standalone build says the build is local-only instead
of attempting a request to a relay that is not there.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Canvas app + Loro collab server |
| `pnpm storybook` | Component workshop on :6006 |
| `pnpm verify` | lint → typecheck → unit tests → billing tests → stories → build (the gate until Actions runs) |
| `pnpm lint` / `pnpm lint:fix` | Biome |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm test` | Vitest (graph + server + canvas) |
| `pnpm e2e` | Playwright (boots app + collab server) |
| `pnpm build` | Builds `@suite/graph` then the canvas app |
| `node scripts/docs-check.mjs` | Links, code fences, retired terms, version consistency |
| `node scripts/generate-limits.mjs --check` | Fails when `docs/limits.md` is stale |
| `pnpm clean` | Removes build output and caches |

## Tests

Counted on 2026-10-25 at `0.2.0-alpha.1`; recount after adding tests:

- **1,671 Vitest tests** in 135 files across `packages/graph`, `apps/collab-server` and
  `apps/canvas`.
- **75 `node --test` tests** in `services/billing`, run by `pnpm verify` through Turbo.
- **171 Playwright tests** in 30 specs, all in the `chromium` project, run by `pnpm e2e`.

[docs/testing.md](docs/testing.md) has the layer table, the recount commands, and how to watch a
run.

## Layout

```
apps/canvas          React 19 + Vite + Tailwind v4 app (React Flow canvas, Tiptap editors)
apps/collab-server   Loro WebSocket sync server
packages/graph       @suite/graph — Zod schema + typed Loro document layer
e2e                  Playwright tests
docs/                Architecture, conventions, ADRs
Dockerfile           Collab-server runtime and Caddy static-host targets
compose.yaml         Hosted and self-hosted deployment (app + caddy + volume)
deploy/              Caddyfile with TLS, proxying and security headers
```

## How it works

A single `LoroDoc` per workspace is the source of truth:

- `boards` — named boards in this workspace
- `cards` — workspace-level objects with one primary type, tags, typed properties, connectors and
  `deletedAt`; content lives independently of any board
- `types` / `tags` — type definitions with fields, and freeform workspace labels
- `placements` — where a card sits on a board (`x`, `y`, `z`, `createdAt`); one per card and board
- `sections` — board-scoped rectangles; a card's section is derived from geometry, never stored
- `edges` — described links drawn on a board, dormant while an endpoint is off it
- `references` — a derived index of mention targets, rebuilt from card content
- `content` / `titles` — per-card body and title rich text (Loro maps shaped by
  `loro-prosemirror`), edited with Tiptap

A card keeps its identity when it moves between boards; a mention, a `card` property or an arrow
is a reference, while only an explicit place action puts a card on a board.

`LoroIndexeddbPersistence` persists locally; the `loro-websocket` sync server flushes each room to
SQLite so a workspace survives a server restart. Share links are capability tokens stored as
SHA-256 hashes only; a join is authorized per room as `read` or `write`. The projection worker
presents `SUITE_PROJECTION_TOKEN` for projection rooms and `SUITE_SOURCE_TOKEN` only for workspaces
with an active editor share; both are generated at startup when unset. Presence (`user`, `pointer`,
`board`, `focus`, `dragging`, plus editor carets) and the canvas gesture channel ride Loro
`EphemeralStore`s; they are not persisted in the document. All writes go through
`WorkspaceDocument`, which validates with Zod. See [docs/architecture.md](docs/architecture.md).

### Storage

Six stores exist in code: `documents`, `shares`, `workspaces`, `settings`, `licences` and
`attachments`. `compose.yaml` points each one at a file on the `suite-data` volume, so all six
survive a container recreate and are covered by `deploy/backup.sh` and `deploy/restore.sh`. The
exact paths, and which ones an operator can leave in memory, are generated from the code and the
compose file in [docs/limits.md](docs/limits.md#restore-targets).

Attachments are image bytes: PNG, JPEG, GIF, WebP or AVIF, uploaded per workspace, size-capped and
served by the relay. They are stored in the `attachments` store, addressed by id, and never in the
workspace document itself, so a card keeps working when an image is dropped.

## Workspace files

`Share` opens one dialog for the workspace, the active board or the selected card. A workspace
editor token and every viewer or board/card link are capability tokens opened through `?share=`;
the owner link is the ordinary `?workspace=` URL plus the owner-key fragment, kept behind
`File → Recovery key…`. Board and card links read a live projection of that scope, never the
workspace index; a workspace viewer reads the real workspace room and can switch boards. Board and card editor links write a draft: owner saves pause while the
draft is dirty, `POST /api/shares/:token/publish` applies one conflict-checked commit to the
workspace, and `POST /api/shares/:token/reload` discards the draft. A publish may carry the
share document's version vector, so it waits for the editor's own edits to reach the share room
before it plans. A conflicting publish is resolved in one dialog: `overwrite` lists the fields
whose draft value wins, unlisted conflicts keep the workspace value, and `Publish` stays manual.
`GET /api/shares/:token/status` tells the editor whether the draft is still unpublished, which is
the single `Draft`/`Published` word beside Publish. Links are capabilities, not accounts or an ACL. Room writes require the credential
that matches the room: an owner key for a workspace, a share token for its share. Creating, listing
and revoking links additionally needs the workspace owner key, so a share token can never mint or
revoke another link.

`File → Export backup…` writes a versioned `.suite` file containing the exact Loro snapshot. Import
it from the launcher; it always opens as a **new** workspace and never merges into the open
document. `File → Export JSON…` and `Export Markdown…` are readable projections for other tools;
they are export-only, not import formats.

## Publishing

`pnpm build` produces a static site in `apps/canvas/dist` and the typed library in
`packages/graph/dist`. The build resolves `@suite/graph` from source in development
(`development` export condition) and from `dist` in production, so a clean checkout always
builds via `pnpm build` (Turbo builds the dependency first).

Deploy `apps/canvas/dist` to any static host. A production build derives its endpoints from the
page, so it needs no collab variables at all: HTTP calls go to `/api` on the page's origin and the
socket to `ws(s)://<page host>/ws`. Set `VITE_COLLAB_HTTP_URL` / `VITE_COLLAB_URL` only when the
API and socket live on another origin:

```sh
VITE_COLLAB_HTTP_URL=https://api.example.com VITE_COLLAB_URL=wss://collab.example.com pnpm build
```

## Deployment

The hosted instance and a self-hosted instance are the same artifact: one `Dockerfile`, one
`compose.yaml`, one domain. `docker compose up` runs the collab server in `app` and Caddy in
`caddy`; Caddy terminates TLS, serves the canvas, and proxies `/api/*` and `/ws` to the server, so
the browser only ever talks to one origin.

```sh
cp .env.example .env        # set SUITE_DOMAIN, optionally tokens
docker compose up -d --build
```

- **Released images.** The tag workflow pushes `ghcr.io/<owner>/suite:<tag>` and `:latest` on every
  `v*` tag and records the image digest in the release notes; a host with no checkout runs
  `SUITE_IMAGE=ghcr.io/<owner>/suite:<tag> docker compose pull` and then `docker compose up -d`.
  The tag is baked into the image as `SUITE_VERSION`, so `/metrics`,
  `/api/admin/status` and the `server ready` log line name the release that is running. Roll back
  by re-pinning the previous digest — see [docs/release.md](./docs/release.md#rollback).
- **Bad configuration is a startup error.** Ports, database paths, tokens, `SUITE_HOSTED` (which
  needs `SUITE_LICENCE_PUBLIC_KEY`) and every `SUITE_*` quota are validated before the process
  opens a socket; a bad value logs the variable and the reason and exits `1`. See
  [docs/operations.md](./docs/operations.md#boot-time-validation).

- **TLS is required.** Caddy obtains and renews a certificate for `SUITE_DOMAIN` and redirects
  HTTP to HTTPS. Collaboration needs `wss://`; a plain-HTTP deployment cannot sync.
- **Development vs production endpoints.** `pnpm dev` keeps the fixed ports
  (`http://localhost:1235` for the API, `ws://localhost:1234` for sync). A production build
  uses `/api` and `ws(s)://<host>/ws` on the page's origin unless `VITE_COLLAB_*` overrides it.
- **One instance only.** The six stores are SQLite files on the `suite-data` volume and live rooms
  are in server memory. Do not scale `app` to multiple replicas; there is no shared room state.
  [docs/limits.md](./docs/limits.md#restore-targets) lists the configured path of each store.
- **Backups.** Back up the whole volume, never one file: share rows, owner hashes, documents,
  settings, licence claims and attachment bytes refer to each other, and restoring one without the
  others leaves links or owner keys orphaned. `deploy/backup.sh` snapshots every store with
  `.backup` (which drains an uncheckpointed WAL) and records integrity checks and counts. WAL is
  enabled, so never copy a live `*.sqlite` without its `-wal`/`-shm`; use the script, or stop `app`
  first:

  ```sh
  deploy/backup.sh                       # writes a manifest next to the archive
  docker compose stop app && deploy/restore.sh <archive> && docker compose start app
  ```

  The restore procedure, including the drill record, is in
  [docs/operations.md](./docs/operations.md#restore-it).
- **Health.** `GET /health` (proxied by Caddy, served by the API port) returns `{"ok":true}` and
  nothing else — counts, room state and database sizes live behind the admin API, not here. The
  compose healthcheck uses the same endpoint. The version is reported by
  `GET /api/admin/status` (`version`) and by `suite_build_info` on `/metrics`.

**AWS path.** One EC2 or Lightsail instance with Docker installed, an EBS volume for `/data`,
ports 80/443 open, and a DNS record pointing at the instance. Attach the EBS volume and point a
bind mount or a Docker volume at it so documents survive instance replacement. A load-balanced or
multi-AZ setup needs external state; it is deliberately out of scope.

**Self-host path.** The same compose file on any Docker host: copy the repository, set
`SUITE_DOMAIN`, and run `docker compose up -d --build`. Nothing else changes.


## Security

Suite has no accounts: access travels as bearer links. The relay stores documents in plaintext and
stores owner and share credentials only as SHA-256 hashes; there is no end-to-end encryption, no
attribution and no per-user ACL. TLS, disk encryption and coordinated backups are deployment
requirements, and the relay is a single SQLite-backed instance.

- [docs/security-model.md](docs/security-model.md) — capabilities, what the server can see,
  rotation/revocation, recovery and device hygiene, and deployment limits.
- Owner reset and workspace deletion are operator commands. Stop the server first, then use
  `pnpm --filter @suite/collab-server admin reset-owner <workspaceId> [--revoke-shares] --force`
  or `pnpm --filter @suite/collab-server admin delete <workspaceId> --force`.

## Docs

- [AGENTS.md](AGENTS.md) — repo map, rules, and workflow for AI agents
- [docs/architecture.md](docs/architecture.md) — data flow and layers
- [docs/conventions.md](docs/conventions.md) — coding standards
- [docs/limits.md](docs/limits.md) — every quota, its variable and where it is enforced (generated)
- [docs/testing.md](docs/testing.md) — test layers, counts, and how to watch a run
- [docs/operations.md](docs/operations.md) — runbook: boot, watch, back up, restore, tune
- [docs/release.md](docs/release.md) — tag, image digest, smoke test and rollback
- [docs/billing.md](docs/billing.md) — licence format and the self-host path (hosted billing is closed)
- [docs/security-model.md](docs/security-model.md) — capabilities and what the relay can see
- [docs/decisions/](docs/decisions/) — architecture decision records
- [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md),
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [CHANGELOG.md](CHANGELOG.md)
