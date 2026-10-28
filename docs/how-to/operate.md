# Operate a deployment

Suite runs as a single Node process with six SQLite stores on one directory; there is no external
database and no multi-replica mode.

Provisioning is [deploy.md](deploy.md). Every quota, its variable and the code that enforces it is
generated into [reference/limits.md](../reference/limits.md); every variable is in
[reference/environment.md](../reference/environment.md).

## Run it

Node 22 or newer, since the server runs TypeScript through `tsx`. No build step.

```sh
pnpm install
pnpm --filter @suite/collab-server start     # from the repo root
```

| Port | Env | Serves |
| --- | --- | --- |
| 1234 | `PORT` | Loro WebSocket sync (`/ws`) |
| 1235 | `HEALTH_PORT` | HTTP API (`/api/*`), `/health`, `/metrics` |

`docker compose up -d --build` runs the same server behind Caddy, which terminates TLS and proxies
`/api/*` and `/ws`. A deployed host builds the image from its own checkout, so Node is only needed
inside the container, never on the host:

```sh
deploy/deploy.sh                                              # build, pin SUITE_IMAGE, restart, verify
SUITE_IMAGE=suite:v1.1.0 docker compose up -d --no-build app  # start a tag that already exists
```

`compose.yaml` keeps both `image:` and `build:`, so the reference compose runs is a name for a local
image: `suite:<version>` once `deploy/deploy.sh` has written it into `SUITE_IMAGE`, and `suite:local`
when `.env` names none. Nothing is pulled from a registry. The version is baked into the process as
`SUITE_VERSION` and reported by `/metrics`, `/api/admin/status` and the `server ready` line, so a
container names its release without `docker inspect`. Upgrades and rollback are in
[deploy.md](deploy.md) §9 and [release.md](release.md).

### Boot-time validation

`config/config.ts` parses every variable once, at boot, and fails with one message per problem instead
of a half-configured process. It refuses a port that is not a number or that equals the other port; an
unreadable number or a soft disk watermark above the hard one; `SUITE_HOSTED=1` without
`SUITE_LICENCE_PUBLIC_KEY`; and, with `SUITE_REQUIRE_DURABLE_STORES=1` as compose sets it, any store
that is unset, `:memory:`, relative, or outside the one directory the others share, naming each
offender. Leave the flag unset locally, where `:memory:` is the point.

### Stores

| Store | Variable | Holds |
| --- | --- | --- |
| documents | `SUITE_DB` | Workspace snapshots and share projections. |
| shares | `SUITE_SHARES_DB` | Share rows and draft baselines. |
| workspaces | `SUITE_WORKSPACES_DB` | Owner-key hashes and claims. |
| settings | `SUITE_SETTINGS_DB` | Runtime limit overrides. |
| licences | `SUITE_LICENCE_DB` | Hosted licence claims. |
| attachments | `SUITE_ATTACHMENTS_DB` | Uploaded image bytes. |

All six live in one directory on the data volume. A document stores only an attachment id, so a lost
attachments store means permanently broken images, and restoring one file without the others leaves
links orphaned or a paid workspace unentitled.

### Secrets

`.env` and `/etc/suite/*.env` are credential files: `chmod 600`, never committed. `SUITE_AUTH_SECRET`
is all-or-nothing, since it reads every workspace's metadata and links, deletes workspaces, and serves
`/metrics` and `/admin`; rotate it by writing a new value and running `docker compose up -d app`.
`SUITE_PROJECTION_TOKEN` and `SUITE_SOURCE_TOKEN` are worker credentials: set them on a deployed host,
or each start generates new ones and a worker cannot reconnect. The hosted licence private key never
goes on the relay. Tokens are compared in constant time, and `share`, `token`, `key` and `owner` are
redacted from every log line.

## The images

Two server images are built from one checkout: `runtime` for the relay and `control-plane` for accounts
and billing. Both end at the same `server-base` stage, and three properties of that stage are load-bearing.

**The sources stay TypeScript and the image runs `tsx`.** There is no second compile pipeline. `tsx`
4.23.15 is installed globally and pinned in `Dockerfile`, which is what lets `services/auth` keep
exporting `./src/index.ts` instead of a `dist` nobody builds. The cost is one runtime dependency; the
alternative was a build step for a package that has never had one, and two type graphs that `pnpm
typecheck` would only gate one of.

**No development dependencies.** `prod-deps` runs `pnpm install --prod --frozen-lockfile --filter
@suite/collab-server... --filter @suite/control-plane...`, so the shipped tree is the production closure
of the two servers and the workspace packages they import. TypeScript, Vite, Vitest, Biome, Stryker,
Turbo, Storybook and Playwright are absent. Verify it rather than trust it:

```sh
docker run --rm suite-relay sh -c 'ls node_modules/.pnpm | grep -E "^(typescript|vitest|@biomejs|@stryker|turbo)@" || echo clean'
```

**The workspace packages a server imports are copied, not assumed.** The runtime stage carries
`packages/graph/dist`, `packages/licence/dist`, `services/auth/src` and `services/auth/sql`; the
control-plane stage swaps the last for `apps/control-plane/src` and `services/billing/dist`. A missing one
is not a slow start, it is `ERR_MODULE_NOT_FOUND` after the process has already printed a boot line.

Both images run as `node` (uid 1000) and declare `/data` as the only directory they own. `compose.yaml`
adds `read_only: true`, a `tmpfs` on `/tmp`, `cap_drop: ALL`, `no-new-privileges`, `pids_limit` and a
memory/CPU cap, so the root filesystem cannot be rewritten by a compromised process. The commands that
prove this, and their output, are in [deploy.md](deploy.md#container-hardening).

## Watch it

### `/health`

`GET /health` answers `200 {"ok":true}` on the API port. It is a readiness probe: no counts, no sizes.
The compose healthcheck polls it.

The control plane answers its own `/health` on `PORT` (1236 by default) with a little more, because the
question there is different: `status` (`ok` or `degraded`), `buildId`, `uptimeMs` and one entry per
route module (`mounted`, `absent` or `failed`). A failed module makes it `503`, so a monitor sees "the
control plane is up but billing is missing" instead of a bare green tick.

Both answers are point-in-time. Neither reports uptime history, and no page in the product invents an
availability percentage: `/admin` → Support shows the last `/health` answer with the time it was asked.

### Support, and the diagnostics bundle

`/admin` has a **Support** tab beside its other sections. It is the in-app route to support: a status
statement read live from `/health`, the two ways to reach a person (an issue for anything that is not a
vulnerability, `SECURITY.md` for anything that is), and one button that produces a file a ticket can
carry.

A crash screen offers the same bundle, which is the case that matters: the tab is broken, so the person
cannot reach a panel. Both call `buildDiagnosticBundle` in
`apps/canvas/src/shell/diagnostics.ts`.

The bundle contains: build version and mode, the sanitised route, the redacted configuration (relay
origin, canvas surface, session kind, online state, viewport, user agent, language), storage state and
estimate, connection state, document counts, room and store statistics when the operator API supplied
them, the last ten uncaught errors with up to twelve stack frames each, and up to ten `x-request-id`
values this page saw. A request id is only useful because the relay now returns `x-request-id` on every
response and logs the same value on its `http.request` line.

The bundle deliberately excludes, and has no field for: the session JWT, any share token, the licence
token, the admin token, cookies, card titles or bodies, attachment names and bytes, document snapshots,
and every request and response body. It is built from an allowlist rather than filtered afterwards, and
every string that came from outside, including an error message, a stack frame or a configured URL, is
scrubbed twice: once when it is recorded and once when the bundle is written. A URL-shaped value in the
configuration is reduced to its origin, because a query is not ours to keep.

### CSP violation reports

`POST /api/report/csp` is the collector both app hosts name in `report-uri` and `report-to`
(`deploy/Caddyfile`). It is public: a browser posts there from a page that may already be broken. Reports
are capped at 16 KiB and 120 per address per minute, are answered `204` whatever happens, and become one
`csp.violation` log line with the document URL and source file redacted. The policy itself stays
enforcing. Nothing in this deployment sends `Content-Security-Policy-Report-Only`, and a downgrade to
report-only is a deliberate change with a note, not a fallback.

### `/metrics`

Prometheus text, no client library, gated like `/api/admin/*`: `404` when the relay has no control
plane to verify a session against, `401` without an operator session, `200` with one, `429` above the
admin rate limit. Never cached.

A cron scrape has no browser and cannot hold a session, so `SUITE_METRICS_LOCAL=1` lets a request from
a loopback address read it with no credential. That opens `/metrics` and nothing else, and a request
that arrived through the proxy is never a loopback request.

The relay samples event-loop lag every 50 ms and exports it as a histogram, because a document write
is a full-snapshot upsert and the interesting question is how late the loop was, not how long one
write took. Five samples in a row at or over `SUITE_EVENT_LOOP_LAG_MS` (default 100) log one line at
`warn` with `code: "event-loop-lag"`, the run length and the document write counters for the same
window, so the first thing an operator reads says whether writes are the cause.

```sh
curl -s http://127.0.0.1:1235/metrics
```

| Metric | Type | Meaning |
| --- | --- | --- |
| `suite_build_info{version}` | gauge `1` | The release, for joining with a deploy. |
| `suite_rss_bytes`, `suite_uptime_seconds` | gauge | Resident set size (absent when unreadable, never `0`) and seconds since start. |
| `suite_memory_split` | gauge, `segment` | The same process split into `heap`, `external`, `arrayBuffers` and `rss`. Loro documents live in WASM linear memory, so they appear under `arrayBuffers`, not `heap`; this is the gauge that shows what a room actually costs. |
| `suite_database_bytes` | gauge | Document-store bytes, the number the disk watermarks compare. |
| `suite_disk_soft_bytes`, `suite_disk_above_soft` | gauge | Watermark in force (absent when unlimited) and whether the store is above it. |
| `suite_open_rooms`, `suite_projection_rooms`, `suite_documents` | gauge | Rooms the sync server tracks; projections open now, bounded by `SUITE_PROJECTION_ROOMS_MAX`; stored documents. |
| `suite_http_requests_total{class}` | counter | Responses on the API port, one sample per status class. |
| `suite_share_creates_total`, `suite_publish_attempts_total`, `suite_publish_conflicts_total` | counter | Links accepted; publishes that reached the worker; of those, the ones refused on a conflict. |
| `suite_claim_attempts_total{outcome}` | counter | `owner` (first claim or matching key) against `mismatch`. |
| `suite_rate_limit_rejections_total`, `suite_projection_rebuilds_total`, `suite_projection_failures_total` | counter | `429`s from any limiter; rebuild passes requested, where coalesced saves share one; rebuilds that rejected. |
| `suite_event_loop_lag_seconds` | histogram | How late the event loop woke up, per sample, in 5 ms to 10 s buckets. This is the number a reader of a board feels, and the one the save path is judged by. |
| `suite_event_loop_lag_max_seconds`, `suite_event_loop_lag_breaches_total` | gauge, counter | The worst sample since start, and how many samples were at or over `SUITE_EVENT_LOOP_LAG_MS`. |
| `suite_document_writes_pending`, `suite_document_writes_total` | gauge, counter | Writes accepted by the document store that are not on disk yet, and writes made durable. A pending count that does not return to zero is a stuck writer. |
| `suite_projection_skips_total`, `suite_projection_build_capped_total` | counter | Rebuilds skipped because the source had not changed; rebuilds refused or frozen by the card or build-time cap. |
| `suite_peer_limit_rejections_total`, `suite_document_limit_rejections_total`, `suite_room_backpressure_total` | counter | Joins refused by a per-room cap, and rebuilds refused because one room already held its work bound. Those are per room; the `429` counter is per address. |

Labels are closed sets. No workspace id, share id, room id or token ever becomes a label, so a scrape
cannot multiply series or copy a capability into a metrics store.

### Admin status

With an operator signed in, `GET /api/admin/status` returns uptime, pid, version, `rssBytes` (`null`,
never `0`, when unreadable), per-store sizes, room and client counts, and the limits in force. Its
`projections` block carries `open`, `limit`, `opened`, `evicted`, `refused` and `documentBytes`;
`opened` read just after boot is the boot cost. Without a control plane configured every `/api/admin/*`
path answers `404`, and without an operator session it answers `401` (or `403` for a signed-in account
that is not on `SUITE_ADMIN_EMAILS`). Read-only siblings: `rooms`, `shares?workspaceId=`, `workspaces?limit=&offset=`,
`workspaces/:id`, `limits`. Behind the same door: `POST fixtures`, `GET workspaces/:id/export`,
`PUT limits` and `POST rooms/sweep`.

### Projection rooms are opened on demand

A room opens because somebody is looking at the link or because it must be written, never because a
share row exists. Opening a link opens its room and skips the workspace's other links; a publish,
reload or draft status opens the one room it is about; an owner save refreshes only the rooms already
open and closes any whose link was revoked.

Boot connects and stops there. With 486 stored links over one 200-card board, boot went from 3.62 GB
RSS and a 152 s ready time to 119 MiB and about 5 s, and opening one of those links costs 40 MiB. If
`projections.opened` starts tracking your link count, rooms are being opened for existing links rather
than for being read.

The open set is bounded by `SUITE_PROJECTION_ROOMS_MAX`, default `128`. At the ceiling, the
least-recently-used room with no connected session is closed, and the open is refused and counted when
every room has a reader.

`SUITE_ROOM_IDLE_HOURS` is off on a self-host and `24` when `SUITE_HOSTED=1`. It sweeps rooms that no
owner save, publish or read has touched for the window and that have no connected session;
`POST /api/admin/rooms/sweep` runs the same sweep immediately. Sweep before a backup, because a backup
carries every live projection with it.

### The `/admin` panel

`/admin` is a separate entry point behind the same bearer token, held in `sessionStorage` and never in
a URL or `localStorage`. It lists workspaces with sizes and quota state, links with last-used and
expiry, open rooms with their `documentBytes`, and the limits with their source (`default`, `env` or
`override`); mutations are audited as `admin.mutation` lines. `POST /api/admin/fixtures` seeds a
disposable workspace from a fixture, so a bug can be reproduced without customer data. The Templates
section lists the starter templates the launcher offers, with the boards, edges and cards each one
holds, and writes the control plane's `templates` rows through `/admin/templates`: a template can be
renamed, re-described, downloaded as JSON and deleted, and a downloaded file pastes back into the
panel's "New template…" form.

### Logs and alerts

Every line on stdout is one JSON object:

```json
{"ts":"2026-10-22T18:12:24.001Z","level":"info","msg":"http.request","requestId":"9f1…","method":"POST","path":"/api/shares/redacted","status":201,"durationMs":3}
```

- Fields are `ts`, `level`, `msg`, plus whatever the call site adds. One `http.request` line per
  response: `requestId`, `method`, `path`, `status`, `durationMs`.
- `x-request-id` is reused when it is 1 to 64 safe characters, otherwise a UUID is generated.
- Capabilities are redacted before the line is written; bodies, cookies and headers never are.
- Startup logs one `server ready` line with the store inventory (path, bytes, document count, journal
  mode); shutdown logs `server stopping`.

stdout is the only sink, so point it at your collector. There is no built-in rotation.

`deploy/alert.sh` checks `/health`, the disk watermark and RSS, then exits non-zero with one `ALERT:`
line. It exits `2` with `CANNOT CHECK:` when it cannot check at all: no token, a wrong token, or
`/metrics` answering `404`. An alerting path that silently passes is worse than one that pages.
`--json` prints the same result for a wrapper.

```cron
*/5 * * * * root /srv/suite/deploy/alert.sh >/dev/null
```

Any runner that can `curl` and read an exit code works: a hosted Prometheus with a bearer token, or a
dead-man's switch on the successful run. Suite ships no agent, no SDK and no call-home.

## Backups

`deploy/backup.sh` snapshots all six stores with SQLite's online backup, which stays consistent while
the server runs and includes whatever is still in the `-wal` file, and it dumps the control plane's
Postgres database beside them. Accounts, organizations, invitations, starter templates and the panel's
settings live there; a snapshot without them restores the documents and leaves every account behind.

The dump runs through the compose database service, whose image ships `pg_dump`, so neither the host nor
the app image needs a Postgres client. `SUITE_POSTGRES_SERVICE`, `POSTGRES_USER` and `POSTGRES_DB` name
the service and role it uses, and the manifest records the dump's table count and checksum beside the
stores:

```sh
deploy/backup.sh                 # writes backups/suite-<UTC timestamp>/
SUITE_BACKUP_BUCKET=s3://suite-backups SUITE_BACKUP_PREFIX=suite deploy/backup.sh /srv/backups
```

Per store it runs `sqlite3 <db> ".timeout 10000" ".backup '<name>.sqlite'"`, then `PRAGMA
integrity_check`, a SHA-256, and a line in `manifest.txt` with the row count and the payload bytes of
every table that holds blobs. The manifest also records a SHA-256 over the attachment ids in sorted
order, so a restore can prove it restored the same set of images.

`SUITE_BACKUP_BUCKET` is an `s3://bucket` target, `SUITE_BACKUP_PREFIX` is the key inside it (default
`suite`), and `SUITE_BACKUP_ENDPOINT` points at R2, MinIO and friends. With a bucket set, each run
uploads one tarball to `suite/daily/` and, on Sunday in UTC, to `suite/weekly/` as well. If the bucket
is set and the CLI is missing, the script fails rather than leaving you with only a local copy.

Retention belongs to the bucket, not the script: 7 daily and 4 weekly copies.

Schedule it off-host. One cron entry is enough; the script fails loudly (non-zero, and with `SUITE_BACKUP_BUCKET` set it refuses to finish without an upload) so the same entry can back a dead-man's switch:

```cron
15 3 * * * root mkdir -p /srv/backups && cd /srv/suite && \
  SUITE_BACKUP_BUCKET=s3://suite-backups SUITE_BACKUP_PREFIX=suite \
  SUITE_BACKUP_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
  deploy/backup.sh /srv/backups >> /var/log/suite-backup.log 2>&1
```

Rehearse the restore as well as the snapshot. `pnpm drill:backup` seeds six throwaway stores, runs the
real backup script over them, copies the snapshot into a fresh directory and compares the row counts, so
a snapshot that verifies but comes back empty fails the drill rather than at the moment it is needed:

```sh
pnpm drill:backup          # cleans up after itself
pnpm drill:backup --keep   # leaves the snapshot and the restored copy in a temp directory
```

Every run verifies itself before it is trusted: `PRAGMA integrity_check` per store, a SHA-256 per file, a row count per table, and a SHA-256 over the sorted attachment ids. A snapshot that fails any of those never reaches the bucket.

```sh
aws s3api put-bucket-lifecycle-configuration --bucket suite-backups --lifecycle-configuration \
  '{"Rules":[{"ID":"daily-7","Status":"Enabled","Filter":{"Prefix":"suite/daily/"},"Expiration":{"Days":7}},
             {"ID":"weekly-35","Status":"Enabled","Filter":{"Prefix":"suite/weekly/"},"Expiration":{"Days":35}}]}'
```

### RPO and RTO

| | Value | Basis |
| --- | --- | --- |
| RPO | 24 h | The daily run above; the off-host copy is written in the same run, so both copies share the bound. A more frequent schedule lowers it proportionally; nothing else in the pipeline adds delay. |
| RTO | 2.2 s (measured) | `deploy/restore.sh` over a live `app`: verify, stop, replace six stores, start, `/health` answered, in 2 192 ms on 2026-10-26. Snapshot: six stores, 132 KB, one workspace document, two attachments (31 KiB of bytes), warm host with the image already pulled. See `deploy/drills/attachments-record.md`. |

Both numbers are replayed, not estimated. RTO is dominated by things this fixture does not have: pulling an image, provisioning a host, and the copy itself at production data size: a 10 GiB attachments store is a `cp` of 10 GiB. Treat the measured 2.2 s as the floor of the procedure and `deploy/restore.sh --verify-only` on the monthly schedule as the part that is actually rehearsed. Restoring at production size is **unmeasured**; it has no published number yet.

Honest caveats:

- The six snapshots are sequential, not one cross-file transaction. For a byte-exact point in time,
  stop `app` first.
- `sqlite3` must exist where you run it. The runtime image does not include it, so run the script on
  the host against the bind mount.
- Backups are unencrypted and hold every workspace in plaintext, every image, and share and owner
  hashes. Store them encrypted, off the data volume.
- A snapshot taken before a store existed restores with a warning naming it, and never invents an
  empty database silently.

## Restore

Stop the server first, because replacing a live database under a running process loses writes and
sockets. `deploy/restore.sh` performs the whole sequence:

```sh
deploy/restore.sh SNAP                 # refuses a non-empty volume
deploy/restore.sh SNAP --force         # a real restore over live data
deploy/restore.sh SNAP --verify-only   # the monthly drill: verify, write nothing
```

It resolves the compose volume from the `app` container (`SUITE_DATA_VOLUME` overrides it), checks the
manifest's sizes, SHA-256, per-table row counts and the attachment-id checksum, runs
`PRAGMA integrity_check` on every file, stops `app`, deletes the six files and their stale `-wal` and
`-shm` sidecars, copies the snapshot in, starts `app`, and waits up to 90 s for `/health`. Anything it
cannot verify aborts before the volume is touched; a failure after the stop leaves `app` down and says
so.

By hand the order is the same: stop, delete `*.sqlite`, `*.sqlite-wal` and `*.sqlite-shm`, copy all six
in, start, then ask the container for `/health` and `/api/admin/status`, since `1235` is not published.

The drill is replayable: `deploy/drills/attachments.sh --record deploy/drills/attachments-record.md` uploads two attachments with different byte lengths, opens a seeded workspace, recreates the container, checks the ids, lengths and bytes are identical, backs up, restores into a second volume, and checks them again, including the workspace loading through the restored app. The last run, with its manifest excerpt and timings, is [the attachments drill record](../../deploy/drills/attachments-record.md).

## Upgrade and stored formats

A build only reads what it can prove it understands.

- Schema bumps are explicit: new DDL, the migration that fills it, an N−1 fixture under
  `apps/collab-server/src/fixtures/n-1/`, and a test that opens it.
- Every snapshot blob starts with `loro-snapshot-v1`; untagged blobs are the pre-tag format and pass
  through untouched. An unknown tag throws `UnsupportedStoreVersionError` naming both versions, so a
  downgrade fails loudly instead of importing a document it may truncate.
- `PRAGMA user_version` records the store schema in `DOCUMENT_STORE_SCHEMA`. A file above it is refused
  at boot with one piece of advice: upgrade the binary, or restore a backup taken on this build.
- Reading a document rewrites nothing, so no backfill happens behind your back.

An upgrade is a new image built and tagged on the host, and a rollback after a schema change is a
restore. See [release.md](release.md).

## Tune it

### Limits

Quotas degrade a workspace; they never drop a save. A workspace over its document budget keeps loading
and saving for its owner, but cannot mint new share links, and its next status call says so. Refusal
happens only where nothing has been written yet: a new workspace, a new share link, a new session in a
room that is at its peer or projection-byte ceiling. The numbers and the refusal codes are in
[reference/limits.md](../reference/limits.md).

The stream limits are per room rather than per address: `SUITE_MAX_PEERS_PER_ROOM`,
`SUITE_ROOM_OUTSTANDING_MAX`, `SUITE_MAX_PROJECTION_CARDS` and `SUITE_PROJECTION_BUILD_MS`. Each one
lets one boarding room degrade itself instead of the process: a join beyond the peer cap is refused
before a session exists, a rebuild past the outstanding bound is refused rather than queued, a board
over the card cap is not projected, and a room whose rebuild exceeded the build-time cap stops
rebuilding until somebody reloads or publishes into it. Every one of them logs a line with a `code`
field, so `grep '"code":"peer-limit"'` answers "why was I refused" without reading the relay.

Resolution order is built-in defaults, then `SUITE_*` environment, then runtime overrides, resolved in
`config/limits.ts`. An unreadable value is reported at boot and the layer below wins; a contradiction
such as soft above hard stops the process with the reason.

```sh
# Signed in as an operator: the browser panel sends this, and so does this command.
curl -s -H "authorization: Bearer $OPERATOR_SESSION" http://localhost:1235/api/admin/limits
curl -s -X PUT -H "authorization: Bearer $OPERATOR_SESSION" -H 'content-type: application/json' \
  -d '{"maxWorkspaces":50,"projectionBytesPerWorkspace":67108864,"diskSoftBytes":"unlimited"}' \
  http://localhost:1235/api/admin/limits
```

`GET` returns the limits, their `sources`, the env names, the overrides in force, `diskBytes` and any
`problems`. `PUT` accepts only known keys, rejecting an unknown one with `400`, validates the result
and audits every attempt. Values are whole bytes, `"unlimited"`, or `null` to clear one override.
Overrides live in `SUITE_SETTINGS_DB`, so they survive a restart and are included in a backup.

### Fixed limits and rate limits

| Limit | Value | Where |
| --- | --- | --- |
| JSON request body | 64 KiB | `http/request.ts` |
| Claim, rotate, resolve, create and publish per minute | 600 / 10 / 300 / 30 / 20 | `http/rateLimit.ts`, per client address |
| Room save interval | 2 s, coalesced | `sync/server.ts` (`saveInterval`) |
| Expired-share sweep and idle projection-room sweep | 60 s each; the idle sweep is a no-op while `SUITE_ROOM_IDLE_HOURS` is `0` | `sync/server.ts`, `projection/sweep.ts` |
| `PRAGMA optimize` | document store on start and hourly | `store/persistence.ts` |
| Journal mode | WAL on the document and attachment stores | `store/persistence.ts`, `store/attachments.ts` |
| Disk measurement cache | 1 s per process | `config/limits.ts` |
| Document writes | batched per turn of the loop, on a writer thread; `flush` blocks on close | `store/persistenceWriter.ts` |
| Event-loop lag sample, breach threshold, sustained run | every 50 ms, 100 ms, 5 samples | `ops/eventLoopLag.ts` |

Rate limits are fixed-window counters in this process, keyed by client address. Behind a proxy set
`SUITE_TRUST_PROXY=1` so they key on the real client. They blunt casual abuse, not a determined flood,
so add request and connection limits in Caddy or your load balancer.

### Sizing and capacity

One writer: all rooms save into one SQLite file through one Node process. CPU and memory scale with
open rooms and their document size, and disk grows with Loro history, deleted-but-not-vacuumed pages
and the WAL while editing is busy. A `-wal` that grows without limit means checkpoints are starving,
usually from long readers or a stalled backup; a restart checkpoints on close. Never put the directory
on a network filesystem, where SQLite locking and WAL shared memory both break.

A document write is a full-snapshot upsert, so it runs on a writer thread rather than on the event loop
(`store/persistenceWriter.ts`). The read path keeps a connection of its own, and a read that follows a
save in the same tick answers from the accepted-write overlay, so `save` then `load` never returns the
previous bytes. Ordering is the whole design: the host numbers every write before queueing it, one
writer thread applies the batches in arrival order inside one transaction, and a writer that fails is
replaced by inline writes on the main thread in the same sequence, never by a second writer. `close`
blocks until the queue is on disk, so a graceful shutdown loses nothing; a `SIGKILL` can lose the last
partial batch, which is the same window the 2 s save interval already had.

A projection room is rebuilt whenever the owner's workspace is saved, unless the source version vector
has not moved since the last rebuild: the worker records the vector it built from, so a save that
changes a card outside a share costs one comparison per open room. A rebuild past the card cap or the
build-time cap freezes the room at its last good projection. Those are the two numbers that used to
make one big board everybody's problem. Measured with
`pnpm bench` (`packages/graph/bench/projection.bench.ts`), a 500-card board rebuilds in about 0.6 s to
1.04 MiB, 2 000 cards in 3.4 s to 4.15 MiB, and 5 000 cards in 8.3 s to 10.39 MiB, while a 200-card
selection stays under 1 s and about 550 KiB at any board size. A whole-board share of a very large
board is the expensive case; going below these numbers needs the deferred index and card split
(ADR-0021) rather than more tuning. `sync/roomsLoad.test.ts` converges 200 edits from five editors in
about a second and fails only past 20 s.

### What a load run measured

`apps/collab-server/bench/load.mjs` (`pnpm --filter @suite/collab-server bench:load`) starts a real
relay on a seeded workspace, opens real share rooms with real peers, drives edits, and prints rooms,
document size, peers, p50 and p99 latency, peak RSS and event-loop lag. The numbers it produced on this
checkout, and the profile they were produced at, are in
[`apps/collab-server/bench/report.md`](../../apps/collab-server/bench/report.md). Read the profile
line before the numbers: a run at four rooms is not a run at the published concurrency.

Two ceilings that report found, both outside the relay's own code:

- A peer receives a document in one Loro message, and `loro-protocol` caps a message at 256 KiB
  (`MAX_MESSAGE_SIZE`). A board whose snapshot is larger cannot be delivered to a joining client at
  all: the socket stays open and the document never arrives. On this schema that starts somewhere
  between a 240-card and a 300-card board, which is far below `SUITE_MAX_PROJECTION_CARDS`. Chunked
  snapshots are the fix, and they are not in this build.
- A shared board lags its owner by one save interval plus one rebuild: the relay coalesces socket
  saves at 2 s (`saveInterval`), the projection debounce adds 200 ms, and the rebuild itself follows
  the measured numbers above. That is the p50 a reader of a share actually sees.

Run `VACUUM` by hand, never on a schedule: after large deletions through the admin CLI, or when a store
is much larger than `/api/admin/status` suggests. It rewrites the file, needs free disk roughly equal
to its size, takes an exclusive lock and can take minutes, so back up first.

```sh
docker compose stop app
docker run --rm -v suite_suite-data:/data alpine sh -c \
  'apk add --no-cache sqlite && for db in documents shares workspaces settings licences attachments; do sqlite3 "/data/$db.sqlite" "VACUUM;"; done'
docker compose start app
```

## Failure modes

- An over-quota workspace keeps its bytes. The budget is enforced by degrading, not deleting: new links
  stop and the owner is told to export. Watch `documentBytes` and `overQuota` in
  `/api/admin/workspaces`.
- One replica only. Rooms, presence, projection state and rate-limit counters live in one process. Two
  containers on one volume corrupt locking; two volumes behind one hostname split workspaces.
- Capability tokens travel in URLs. The server redacts them from its own logs, but proxies, CDNs and
  browser history can record them. Keep `Referrer-Policy: no-referrer`, which Caddy sets, and do not
  log query strings at the proxy.
- There is no encryption at rest, and the admin API is all-or-nothing: one bearer token, no scopes.
- `sqlite3` is not in the runtime image, so the online backup runs on the host or in a throwaway
  container.
- A dead or wrong admin token makes `alert.sh` exit `2` rather than `0`. Fix the credential; do not
  ignore the page.

## Prove the mail transport without a sign-up

Settings → mail → **Send a test message** sends one message with the transport the saved
rows configure, the same composition the account service boots with. A `smtp` or `resend`
transport that cannot be built answers with its own error, so a wrong password or a
missing `SUITE_MAIL_FROM` shows up in the panel rather than in a stranger's sign-up. The
`console` transport answers as success and writes the message to the control-plane log,
which is what it was asked to do.

`POST /admin/mail/test` with `{"to": "you@example.com"}` is the same call, for a script.
