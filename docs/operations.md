# Operations

How to run, watch, back up, restore and size one Suite collab server. Suite is a single
Node process with three local SQLite files; there is no external database and no multi-replica mode.

## Run it

Requirements: Node 22+ (the server runs TypeScript through `tsx`). No build step is needed for the
server.

```sh
pnpm install
pnpm --filter @suite/collab-server start     # from the repo root
```

The process serves two ports:

| Port | Env | Serves |
| --- | --- | --- |
| 1234 | `PORT` | Loro WebSocket sync (`/ws`) |
| 1235 | `HEALTH_PORT` | HTTP API (`/api/*`) and `/health` |

`docker compose up -d --build` runs the same server behind Caddy, which terminates TLS and proxies
`/api/*` and `/ws` to those ports.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `1234` | Sync WebSocket port. |
| `HEALTH_PORT` | `1235` | HTTP API and health port. |
| `SUITE_DB` | `suite.documents.sqlite` | Workspace and share-projection snapshots. |
| `SUITE_SHARES_DB` | `suite.shares.sqlite` | Share rows and draft baselines (`share_baselines`). |
| `SUITE_WORKSPACES_DB` | `suite.workspaces.sqlite` | Owner-key hashes and claims. |
| `SUITE_PROJECTION_TOKEN` | generated per start | Worker credential for projection rooms. |
| `SUITE_SOURCE_TOKEN` | generated per start | Worker credential for workspaces with an editor share. |
| `SUITE_ADMIN_TOKEN` | unset (admin API off) | Bearer token for `/api/admin/*`. |
| `SUITE_PUBLIC_URL` | request origin | Base URL for fixture links (`POST /api/admin/fixtures`). |
| `SUITE_ALLOWED_ORIGINS` | `*` | Comma-separated browser origins allowed to call the API. |
| `SUITE_TRUST_PROXY` | unset | `1` uses the first `X-Forwarded-For` hop as the client address. |
| `SUITE_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `SUITE_MAX_SHARES_PER_WORKSPACE` | `100` | Active links allowed per workspace. |
| `SUITE_CLAIM_RATE_LIMIT` | `600` | Claims per minute per client address. |
| `SUITE_ROTATE_RATE_LIMIT` | `10` | Owner-key rotations per minute. |
| `SUITE_SHARE_RESOLVE_RATE_LIMIT` | `300` | Share-token resolutions per minute. |
| `SUITE_SHARE_CREATE_RATE_LIMIT` | `30` | Share creations per minute. |
| `SUITE_PUBLISH_RATE_LIMIT` | `20` | Draft publishes per minute. |
| `SUITE_ADMIN_RATE_LIMIT` | `300` | Admin API requests per minute. |

The database paths are relative to the working directory; `compose.yaml` points them at `/data`.

## Watch it

### `/health`

`GET /health` answers `200 {"ok": true}` on the API port. It is a readiness probe only: no counts,
no sizes. The compose healthcheck polls it.

### Admin status

Set `SUITE_ADMIN_TOKEN` and read the detailed state from there:

```sh
curl -s -H "Authorization: Bearer $SUITE_ADMIN_TOKEN" http://localhost:1235/api/admin/status
```

It returns uptime, pid, per-database sizes (documents, shares, workspaces), room and client counts,
and the limits in force. Without `SUITE_ADMIN_TOKEN` every `/api/admin/*` path answers `404`, so the
route does not advertise itself. Other read-only routes: `/api/admin/rooms`,
`/api/admin/shares?workspaceId=…`, `/api/admin/workspaces?limit=&offset=`,
`/api/admin/workspaces/:id`. Two more sit behind the same token:
`POST /api/admin/fixtures` seeds a disposable workspace (see below) and
`GET /api/admin/workspaces/:id/export` downloads its stored snapshot as a `.suite` file.

### The `/admin` panel

The operator panel is its own Vite entry: `apps/canvas/admin.html` loads `src/admin/`, and the build
emits `dist/admin.html` beside `index.html`. Nothing under `src/admin/` is imported by the
workspace app, so no admin code ships in the workspace bundle. The panel calls `/api/admin/*`, so it
only works while `SUITE_ADMIN_TOKEN` is set; an unconfigured server answers `404` and the gate
cannot unlock.

- Paste the token into the gate. It is kept in that tab's `sessionStorage` only — never
  `localStorage`, never a URL — and **Sign out** clears it.
- Screens: **Status** (uptime, version, database sizes, room counts, limits), **Workspaces** (id,
  claimed, sizes, counts, last save; detail, revoke all links, reset owner, delete with the id typed
  to confirm), **Rooms** (socket rooms and projection rooms, disconnect), **Shares** (per
  workspace, revoke one or all), **Fixtures**.
- Read-only until you take an explicit action. Destructive actions confirm inline; errors show as
  one line.
- **The panel grants full data access.** The token has no scopes: anyone holding it can read every
  workspace's metadata and links and can delete a workspace. Treat it as a root credential.

Caddy serves the panel from the same static root as the app:

```caddyfile
handle /admin {
	rewrite * /admin.html
	root * /srv
	file_server
}
```

Not being linked from the app is obscurity, not access control. Restrict `/admin` with an IP
allowlist (for example `@admin_allowed remote_ip 203.0.113.4/32` plus a `403` for everything else)
or put it behind your SSO proxy. Keep `Referrer-Policy: no-referrer` and never paste the token into
a URL; the panel stores it in `sessionStorage` precisely so it cannot leak through history, referrers
or proxy logs.

#### Fixtures as a reproduction tool

`POST /api/admin/fixtures` builds a workspace through the public `@suite/graph`
`WorkspaceDocument` API and saves it through the normal document store, so the result behaves
exactly like a workspace the app created. One call reproduces a sync or collaboration bug:

```sh
curl -s -X POST \
  -H "Authorization: Bearer $SUITE_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"boards":2,"cards":20,"sections":1,"shares":2}' \
  http://localhost:1235/api/admin/fixtures
```

- Body: optional `workspaceId` (omit to create a new workspace), `boards` (1–50, default 1),
  `cards` (0–2000, default 10), `sections` (0–200, default 0), `shares` (0–20, default 0).
  Anything above a cap is a `400` naming the limit.
- Response: `workspaceId`, `ownerKey` (the credential that opens it; `null` when the given
  workspace was already claimed), the created `boards`, `cards` and `sections` ids, and viewer
  links as `{scope, token, url}`.
- Links point at `SUITE_PUBLIC_URL` when set, otherwise at the request's `Origin`; set it behind a
  proxy so links are usable outside the relay host.
- Fixtures are real data. Delete the workspace from the panel when the reproduction is done.

### Structured logs

Every line on stdout is one JSON object:

```json
{"ts":"2026-10-22T18:12:24.001Z","level":"info","msg":"http.request","requestId":"9f1…","method":"POST","path":"/api/shares/redacted","status":201,"durationMs":3}
```

- Fields: `ts`, `level`, `msg`, plus whatever the call site adds.
- One `http.request` line per HTTP response: `requestId`, `method`, `path`, `status`, `durationMs`.
- `x-request-id` is reused when it is 1–64 safe characters; otherwise a UUID is generated.
- **Capabilities are redacted before the line is written.** Query parameters named `share`,
  `token`, `key` and `owner` get the value `redacted`, and the token segment of
  `/api/shares/<token>` becomes `redacted`. Everything else stays.
- Bodies, cookies and request/response headers are never logged.
- Startup logs one `server ready` line with the document store inventory (path, bytes, document
  count, journal mode); shutdown logs `server stopping`.

Log lines are the only supported sink: point the process's stdout at your collector. There is no
file rotation built in.

## Back it up

`deploy/backup.sh` snapshots the three databases together with the share draft baselines and the
projected share documents into one timestamped directory:

```sh
deploy/backup.sh                 # writes backups/suite-<UTC timestamp>/
deploy/backup.sh /srv/backups    # or an explicit destination
```

What it does, per database: `sqlite3 <db> ".timeout 10000" ".backup '<name>.sqlite'"`, which is
SQLite's online backup mechanism — consistent while the server runs, and it includes whatever is
still in the `-wal` file. Each snapshot is then checked with `PRAGMA integrity_check`, hashed with
SHA-256 and counted into `manifest.txt`:

```
documents      12684 rows
shares           369 rows
share_baselines  223 rows
workspaces      2772 rows
```

Why all three files: share rows, owner-key hashes and document snapshots reference each other.
Restoring one without the others leaves links or owner keys orphaned. Baselines live in the share
database (`share_baselines`), projected share rooms in the document database (`…:share-*` keys);
both are in the snapshot.

Caveats, honestly:

- The three snapshots are taken one after another, not in one cross-file transaction. A share
  created in the seconds between them can be missing its projection (fixed by the next projection
  run) and a document saved after its file was copied is one save behind. For a byte-exact
  cross-file point in time, stop `app`, then run the script.
- `sqlite3` must be installed where you run it. The runtime container image does not include it;
  run the script on the host against a bind mount, or stop `app` and copy the files with `tar`
  (see the README).
- Backups are unencrypted and contain every workspace in plaintext plus share and owner hashes.
  Store them encrypted.

## Restore it

Stop the server first. Replacing a live database under a running process loses writes and sockets.

```sh
docker compose stop app                                  # or stop the pnpm process
SNAP=backups/suite-20261023T001541Z

# 1. Verify the snapshot you are about to restore.
sha256sum "$SNAP"/*.sqlite            # compare with $SNAP/manifest.txt
sqlite3 "$SNAP/documents.sqlite" "PRAGMA integrity_check;"   # -> ok

# 2. Replace all three files together, in a fresh data directory.
docker run --rm -v suite_suite-data:/data -v "$PWD/$SNAP":/snapshot alpine \
  sh -c 'rm -f /data/*.sqlite /data/*.sqlite-wal /data/*.sqlite-shm && cp /snapshot/*.sqlite /data/'

# 3. Start and check.
docker compose start app
curl -s http://localhost:1235/health        # {"ok":true}
curl -s -H "Authorization: Bearer $SUITE_ADMIN_TOKEN" http://localhost:1235/api/admin/status
```

On a bare host, step 2 is `cp "$SNAP"/*.sqlite <data-dir>/` after deleting the old `*.sqlite`,
`*.sqlite-wal` and `*.sqlite-shm` files. **Remove stale sidecars**: a `-wal` file left next to a
different main file is at best ignored and at worst confusing.

### Drill performed

Run against the live development databases while the server was running (SQLite in WAL mode), then
restored into a scratch directory and read back through the server's own store:

```sh
deploy/backup.sh "$PWD/.ops-drill/backups"
cp .ops-drill/backups/suite-20261023T001541Z/*.sqlite .ops-drill/restored/
sqlite3 -readonly .ops-drill/restored/documents.sqlite "PRAGMA integrity_check; SELECT COUNT(*) FROM documents;"
sqlite3 -readonly .ops-drill/restored/shares.sqlite "PRAGMA integrity_check; SELECT COUNT(*) FROM shares; SELECT COUNT(*) FROM share_baselines;"
sqlite3 -readonly .ops-drill/restored/workspaces.sqlite "PRAGMA integrity_check; SELECT COUNT(*) FROM workspaces;"
```

Result: all three `integrity_check`s returned `ok`; counts matched the live databases
(12,685 documents including 299 share projections, 369 shares, 223 baselines, 2,773 owner rows).
Reading the restored files through `createDocumentStore` and `WorkspaceDocument` parsed
`%LOR:default-workspace` (3 cards, 1 board, schema v4) and a `share-*` projection (2 cards); the
largest draft baseline (176,118 bytes) also parsed. A separate check with 50 rows living only in an
uncheckpointed `-wal` file (4 KB main file) restored all 50 rows from the snapshot, confirming
`.backup` drains the WAL.

## Tune it

### Limits in force

| Limit | Value | Where |
| --- | --- | --- |
| Active shares per workspace | 100 (`SUITE_MAX_SHARES_PER_WORKSPACE`) | `http.ts` creation path |
| Cards per selection share | 200 (`MAX_SELECTION_CARDS`) | `shares.ts`, fixed |
| JSON request body | 64 KiB | `http.ts` |
| Claim / rotate / resolve / create / publish per minute | 600 / 10 / 300 / 30 / 20 | `rateLimit.ts`, per client address |
| Admin requests per minute | 300 | `adminHttp.ts` |
| Room save interval | 2 s, coalesced | `server.ts` (`saveInterval`) |
| Expired-share sweep | 60 s | `server.ts` |
| `PRAGMA optimize` | document store on start and hourly (unref'd timer); share and workspace files on start | `persistence.ts` |
| Journal mode | WAL on all three databases | `persistence.ts` |

Rate limits are fixed-window counters in this process, keyed by client address. Behind a proxy set
`SUITE_TRUST_PROXY=1` so they key on the real client; otherwise every request shares the proxy's
address. They blunt casual abuse, not a determined flood — add request and connection limits in
Caddy or your load balancer.

### Sizing one instance

- **One writer.** All rooms save into one SQLite file through one Node process. CPU and memory
  scale with the number of open rooms and the size of their documents; disk grows with Loro history
  (snapshots keep it), with deleted-but-not-vacuumed pages, and with the WAL while editing is busy.
- **Measure, do not guess.** `/api/admin/status` gives database sizes, room count and connected
  clients; the `share_baselines` table and the document snapshots dominate the share and document
  databases.
- **Watch the WAL.** `*.sqlite-wal` growing without limit means checkpoints are starving (long
  readers, a stalled backup). It shrinks after a checkpoint; a restart checkpoints on close.
- **Do not put the data directory on a network filesystem.** SQLite locking is unreliable there,
  and WAL needs shared memory.
- **Memory.** Any room that is loaded stays in memory while clients are connected; restarting the
  process frees it and drops live sockets, not documents.

### VACUUM policy

`deploy/backup.sh` and `PRAGMA optimize` keep the files consistent but do not return free pages to
the filesystem. Run `VACUUM` by hand, never on a schedule:

```sh
docker compose stop app
sqlite3 /data/documents.sqlite "VACUUM;"    # and shares.sqlite, workspaces.sqlite
docker compose start app
```

Run it after large deletions through the admin CLI (`admin delete`, `reset-owner --revoke-shares`),
or when a database is much larger than the data in `/api/admin/status` suggests. `VACUUM` rewrites
the file, needs free disk roughly equal to its size, takes an exclusive lock and can take minutes on
a large document store — take a backup first and accept the outage. Per-table growth is normal
otherwise; do not vacuum weekly out of habit.

On a bare-metal host run `sqlite3 <path> "VACUUM;"` directly. Inside the compose volume `sqlite3`
is not in the app image, so use a throwaway container:

```sh
docker compose stop app
docker run --rm -v suite_suite-data:/data alpine \
  sh -c 'apk add --no-cache sqlite && for db in documents shares workspaces; do sqlite3 "/data/$db.sqlite" "VACUUM;"; done'
docker compose start app
```

### Capacity: what a projection costs

A board, card or selection share keeps one live projection room per link, rebuilt from the saved
source whenever the owner's workspace is saved. Rebuild cost therefore bounds how large a shared
board can get. Measured with `pnpm bench` (`packages/graph/bench/projection.bench.ts`, one machine,
synthetic but board-shaped data — a type schema, tags, sections, a sparse edge graph and bodies with
mentions):

| scope | cards | rebuild | projected document |
| --- | --- | --- | --- |
| board | 500 | ~0.6 s | 1.04 MiB |
| board | 2 000 | ~3.4 s | 4.15 MiB |
| board | 5 000 | ~8.3 s | 10.39 MiB |
| 200-card selection | 2 000 | ~0.58 s | 554 KiB |
| 200-card selection | 5 000 | ~0.9 s | 550 KiB |

Reading it: a selection link costs the size of the *selection*, not the board, and stays well under
a second. A whole-board share of a very large board is the expensive case — a 5 000-card board costs
seconds per rebuild per link, and rebuilds follow the owner's saves. Two things follow:

- Keep the share cap in mind: 100 links over a huge board means 100 rebuilds of that board. The
  `/api/admin/rooms` endpoint shows which projection rooms are open and whether they are dirty.
- Going below these numbers needs the deferred index/card document split
  ([ADR-0021](../docs/decisions/0021-sharing-seam-deferred.md)), not more tuning: the remaining cost
  is copying every card's rich text into the projection.

### Known gaps and risks

- **No per-workspace document byte cap.** Nothing on the server rejects a workspace whose Loro
  snapshot grows without bound; a single very large or heavily edited workspace enlarges every
  backup and slows its own saves. Size limits are a client/UI concern today, not an enforced server
  limit. Track `documentBytes` per workspace in `/api/admin/workspaces`.
- **Single replica only.** Rooms, presence, projection state and rate-limit counters live in one
  process. Running two `app` containers against one volume corrupts locking assumptions and splits
  live state; running them against separate volumes silently splits workspaces.
- **Capability tokens travel in URLs.** The server redacts them from its own logs, but proxies, CDNs
  and browser history can still record them. Keep `Referrer-Policy: no-referrer` (Caddy sets it) and
  do not log query strings at the proxy.
- **No encryption at rest.** Use an encrypted volume for `/data` and encrypted off-site backups.
- **The admin API is all-or-nothing.** One bearer token, no scopes; anyone holding it can read every
  workspace's metadata and share list.
- **`sqlite3` is not in the runtime image**, so the online backup script runs on the host (or needs
  a throwaway container with it installed).
