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
`/api/*` and `/ws`. A released image needs no Node and no checkout:

```sh
docker pull ghcr.io/<owner>/suite:v0.2.0-beta.1
SUITE_IMAGE=ghcr.io/<owner>/suite:v0.2.0-beta.1 docker compose up -d
```

`compose.yaml` keeps both `image:` and `build:`, so `--build` builds and tags locally while a deployed
host pulls. Pin `SUITE_IMAGE` to a release tag; unset follows `:latest`, which moves. The tag is baked
into the process as `SUITE_VERSION` and reported by `/metrics`, `/api/admin/status` and the
`server ready` line, so a container names its release without `docker inspect`. The tag flow is
[release.md](release.md).

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

`.env` and `/etc/suite/*.env` are credential files: `chmod 600`, never committed. `SUITE_ADMIN_TOKEN`
is all-or-nothing, since it reads every workspace's metadata and links, deletes workspaces, and serves
`/metrics` and `/admin`; rotate it by writing a new value and running `docker compose up -d app`.
`SUITE_PROJECTION_TOKEN` and `SUITE_SOURCE_TOKEN` are worker credentials: set them on a deployed host,
or each start generates new ones and a worker cannot reconnect. The hosted licence private key never
goes on the relay. Tokens are compared in constant time, and `share`, `token`, `key` and `owner` are
redacted from every log line.

## Watch it

### `/health`

`GET /health` answers `200 {"ok":true}` on the API port. It is a readiness probe: no counts, no sizes.
The compose healthcheck polls it.

### `/metrics`

Prometheus text, no client library, gated by the same token as `/api/admin/*`: `404` without
`SUITE_ADMIN_TOKEN`, `401` on a wrong bearer, `200` with the right one, `429` under the admin rate
limit. Never cached.

```sh
curl -s -H "authorization: Bearer $SUITE_ADMIN_TOKEN" http://127.0.0.1:1235/metrics
```

| Metric | Type | Meaning |
| --- | --- | --- |
| `suite_build_info{version}` | gauge `1` | The release, for joining with a deploy. |
| `suite_rss_bytes`, `suite_uptime_seconds` | gauge | Resident set size (absent when unreadable, never `0`) and seconds since start. |
| `suite_database_bytes` | gauge | Document-store bytes, the number the disk watermarks compare. |
| `suite_disk_soft_bytes`, `suite_disk_above_soft` | gauge | Watermark in force (absent when unlimited) and whether the store is above it. |
| `suite_open_rooms`, `suite_projection_rooms`, `suite_documents` | gauge | Rooms the sync server tracks; projections open now, bounded by `SUITE_PROJECTION_ROOMS_MAX`; stored documents. |
| `suite_http_requests_total{class}` | counter | Responses on the API port, one sample per status class. |
| `suite_share_creates_total`, `suite_publish_attempts_total`, `suite_publish_conflicts_total` | counter | Links accepted; publishes that reached the worker; of those, the ones refused on a conflict. |
| `suite_claim_attempts_total{outcome}` | counter | `owner` (first claim or matching key) against `mismatch`. |
| `suite_rate_limit_rejections_total`, `suite_projection_rebuilds_total`, `suite_projection_failures_total` | counter | `429`s from any limiter; rebuild passes requested, where coalesced saves share one; rebuilds that rejected. |

Labels are closed sets. No workspace id, share id, room id or token ever becomes a label, so a scrape
cannot multiply series or copy a capability into a metrics store.

### Admin status

With `SUITE_ADMIN_TOKEN` set, `GET /api/admin/status` returns uptime, pid, version, `rssBytes` (`null`,
never `0`, when unreadable), per-store sizes, room and client counts, and the limits in force. Its
`projections` block carries `open`, `limit`, `opened`, `evicted`, `refused` and `documentBytes`;
`opened` read just after boot is the boot cost. Without the token every `/api/admin/*` path answers
`404`. Read-only siblings: `rooms`, `shares?workspaceId=`, `workspaces?limit=&offset=`,
`workspaces/:id`, `limits`. Behind the same token: `POST fixtures`, `GET workspaces/:id/export`,
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
disposable workspace from a fixture, so a bug can be reproduced without customer data.

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
*/5 * * * * root SUITE_ADMIN_TOKEN=<token> /srv/suite/deploy/alert.sh >/dev/null
```

Any runner that can `curl` and read an exit code works: a hosted Prometheus with a bearer token, or a
dead-man's switch on the successful run. Suite ships no agent, no SDK and no call-home.

## Backups

`deploy/backup.sh` snapshots all six stores with SQLite's online backup, which stays consistent while
the server runs and includes whatever is still in the `-wal` file:

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

An upgrade is a new image tag, and a rollback after a schema change is a restore. See
[release.md](release.md).

## Tune it

### Limits

Quotas degrade a workspace; they never drop a save. A workspace over its document budget keeps loading
and saving for its owner, but cannot mint new share links, and its next status call says so. Refusal
happens only where nothing has been written yet: a new workspace and a new share link. The numbers are
in [reference/limits.md](../reference/limits.md).

Resolution order is built-in defaults, then `SUITE_*` environment, then runtime overrides, resolved in
`config/limits.ts`. An unreadable value is reported at boot and the layer below wins; a contradiction
such as soft above hard stops the process with the reason.

```sh
curl -s -H "authorization: Bearer $SUITE_ADMIN_TOKEN" http://localhost:1235/api/admin/limits
curl -s -X PUT -H "authorization: Bearer $SUITE_ADMIN_TOKEN" -H 'content-type: application/json' \
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

Rate limits are fixed-window counters in this process, keyed by client address. Behind a proxy set
`SUITE_TRUST_PROXY=1` so they key on the real client. They blunt casual abuse, not a determined flood,
so add request and connection limits in Caddy or your load balancer.

### Sizing and capacity

One writer: all rooms save into one SQLite file through one Node process. CPU and memory scale with
open rooms and their document size, and disk grows with Loro history, deleted-but-not-vacuumed pages
and the WAL while editing is busy. A `-wal` that grows without limit means checkpoints are starving,
usually from long readers or a stalled backup; a restart checkpoints on close. Never put the directory
on a network filesystem, where SQLite locking and WAL shared memory both break.

A projection room is rebuilt whenever the owner's workspace is saved, so cost has two factors: how many
rooms are open, capped by `SUITE_PROJECTION_ROOMS_MAX`, and how big one projection is. Measured with
`pnpm bench` (`packages/graph/bench/projection.bench.ts`), a 500-card board rebuilds in about 0.6 s to
1.04 MiB, 2 000 cards in 3.4 s to 4.15 MiB, and 5 000 cards in 8.3 s to 10.39 MiB, while a 200-card
selection stays under 1 s and about 550 KiB at any board size. A whole-board share of a very large
board is the expensive case; going below these numbers needs the deferred index and card split
(ADR-0021) rather than more tuning. `sync/roomsLoad.test.ts` converges 200 edits from five editors in
about a second and fails only past 20 s.

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
