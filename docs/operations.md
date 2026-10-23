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

### A released image instead of a build

CI builds the runtime image on every tag and pushes it to GHCR, so a host with no Node and no
checkout can run a release:

```sh
docker pull ghcr.io/mr-rogers-neighborhood/suite:v1.4.0     # or :latest
SUITE_IMAGE=ghcr.io/mr-rogers-neighborhood/suite:v1.4.0 docker compose up -d
```

`compose.yaml` keeps both directives: `image:` names the tag to pull, `build:` still builds the same
target from a checkout. `docker compose up -d --build` therefore builds and tags the local image
with that name, while `docker compose up -d` (without `--build`) uses whatever the tag resolves
to — which is what a deployed host does after `docker compose pull`. Pin `SUITE_IMAGE` in `.env`
to a release tag; leaving it unset follows `:latest`.

The tag travels into the process as `SUITE_VERSION` (a Docker build arg) and is reported by
`/metrics`, `/api/admin/status` and the `server ready` log line, so the running container can say
which release it is without `docker inspect`.

Release flow, in order:

1. `git tag v1.4.0 && git push origin v1.4.0`
2. The `image` job in `.github/workflows/ci.yml` runs only for `refs/tags/*`, authenticates with the
   built-in `GITHUB_TOKEN` (`packages: write`) and pushes
   `ghcr.io/<owner>/suite:<tag>` plus `ghcr.io/<owner>/suite:latest` from the `runtime` target.
3. On the host: `docker compose pull && docker compose up -d`. `latest` moves; a pinned tag does
   not. Roll back by setting `SUITE_IMAGE` back to the previous tag and repeating.

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
| `SUITE_VERSION` | `package.json` | Version stamp for `/metrics`, `/api/admin/status` and the startup line; the image sets it from the tag. |
| `SUITE_HOSTED` | unset (self-host) | `1` turns on the hosted relay: licence enforcement and the hosted limit defaults. |
| `SUITE_LICENCE_PUBLIC_KEY` | unset | Ed25519 key that verifies licences; **required** when `SUITE_HOSTED=1`. |
| `SUITE_ROOM_IDLE_HOURS` | `0` (off); `24` when `SUITE_HOSTED=1` | Hours a projection room may sit with no viewer and no owner save before the sweep revokes its link. `0` switches the sweep off. |
| `SUITE_MAX_SHARES_PER_WORKSPACE` | `100` | Active links allowed per workspace. |
| `SUITE_MAX_WORKSPACES` | unlimited | Workspaces a licence (hosted) or this instance (self-host) may hold. |
| `SUITE_DOCUMENT_BYTES_PER_WORKSPACE` | unlimited | Document bytes a workspace may reach before it is marked over quota. |
| `SUITE_PROJECTION_BYTES_PER_WORKSPACE` | unlimited (`32 MiB` when `SUITE_HOSTED=1`) | Bytes of a workspace's active share projections. |
| `SUITE_ATTACHMENT_BYTES_PER_WORKSPACE` | unlimited | Reserved for attachments; nothing stores them yet. |
| `SUITE_MAX_SELECTION_CARDS` | `200` | Cards one selection share may include. |
| `SUITE_DISK_SOFT_BYTES` | unlimited (`4 GiB` when `SUITE_HOSTED=1`) | Document-store size that logs a warning. |
| `SUITE_DISK_HARD_BYTES` | unlimited (`5 GiB` when `SUITE_HOSTED=1`) | Document-store size that pauses new workspaces. |
| `SUITE_SETTINGS_DB` | in memory | SQLite file holding runtime limit overrides; set it to survive a restart. |
| `SUITE_LICENCE_DB` | in memory | SQLite file recording hosted licence claims; set it to survive a restart. |
| `SUITE_CLAIM_RATE_LIMIT` | `600` | Claims per minute per client address. |
| `SUITE_ROTATE_RATE_LIMIT` | `10` | Owner-key rotations per minute. |
| `SUITE_SHARE_RESOLVE_RATE_LIMIT` | `300` | Share-token resolutions per minute. |
| `SUITE_SHARE_CREATE_RATE_LIMIT` | `30` | Share creations per minute. |
| `SUITE_PUBLISH_RATE_LIMIT` | `20` | Draft publishes per minute. |
| `SUITE_ADMIN_RATE_LIMIT` | `300` | Admin API requests per minute. |

The database paths are relative to the working directory; `compose.yaml` points them at `/data`.

### Secrets

`.env` (and everything in `/etc/suite/*.env`) is a credential file: `chmod 600`, owned by the deploy
user, never committed — `.gitignore` already excludes `.env*` except `.env.example`.

- `SUITE_ADMIN_TOKEN` is all-or-nothing: it reads every workspace's metadata and links, can delete a
  workspace, serves `/metrics` and unlocks the `/admin` panel. Rotate it by writing the new value and
  restarting `app` (`docker compose up -d app`); every open panel session must sign in again.
- `SUITE_PROJECTION_TOKEN` and `SUITE_SOURCE_TOKEN` are worker credentials. Unset means "generate one
  per start", which is fine until a worker needs to reconnect; set them on a deployed host.
- The hosted licence **private** key never goes on the relay. Generate the keypair and sign licences
  on a workstation, keep the `.pem` offline, and copy only the public key into
  `SUITE_LICENCE_PUBLIC_KEY`.
- The server compares tokens in constant time and redacts `share`, `token`, `key` and `owner` query
  values from its own logs. Proxies and CDNs are a different story: capability tokens travel in
  share URLs, so keep `Referrer-Policy: no-referrer` (Caddy sets it) and do not log query strings at
  the edge. See "Known gaps and risks" below.

### Deploy to one AWS instance

The end-to-end runbook is [deploy-aws.md](./deploy-aws.md): instance sizing, EBS layout, security
group, DNS and Cloudflare rules, first boot, backups, the restore drill and upgrades by image tag.
The short version: one instance, one `app` container, `/data` on a separate EBS volume, Cloudflare
proxied in front, and two cron jobs (backup and alert). Two replicas are not an option; the reasons
are in the runbook and under "Known gaps and risks".

### Boot-time validation

`apps/collab-server/src/config.ts` reads every variable above (and both ports) exactly once, before
`server.ts` binds a socket or opens a database. **The process refuses to start with a bad config, and
says why:** one structured `invalid configuration` line per problem, naming the variable, then
`refusing to start` with the count, then `exit 1`. Nothing is created, migrated or bound, so a
typo cannot leave a half-configured instance serving traffic.

What is checked:

- **Ports** — `PORT` and `HEALTH_PORT` must be whole numbers in 1–65535 and must differ.
- **Database paths** — `SUITE_DB`, `SUITE_SHARES_DB`, `SUITE_WORKSPACES_DB` must be non-empty, must
  be distinct files (each store needs its own), and must be a regular file when they already exist.
  `SUITE_SETTINGS_DB` and `SUITE_LICENCE_DB` accept `:memory:`.
- **Tokens** — `SUITE_ADMIN_TOKEN`, `SUITE_PROJECTION_TOKEN`, `SUITE_SOURCE_TOKEN` may be unset; when
  set they need at least 16 characters and no whitespace or control characters. The refusal never
  repeats the value.
- **Switches** — `SUITE_HOSTED` and `SUITE_TRUST_PROXY` accept only `1` or `0`.
- **Licences** — `SUITE_LICENCE_PUBLIC_KEY` is required when `SUITE_HOSTED=1`, and the value must
  parse as the Ed25519 key `licence.ts` will use (a PEM SPKI block, or the base64url raw key — the
  practical form for `.env`, where multi-line PEM is awkward).
- **Origins** — `SUITE_ALLOWED_ORIGINS` entries must be `*` or an `http`/`https` origin with no
  path, query or fragment; a URL that could never match a browser's `Origin` header is refused.
- **Rate limits and quotas** — every `SUITE_*_RATE_LIMIT` must be a positive whole number, and the
  `limits.ts` values are resolved and checked for contradictions (soft > hard, a non-numeric size).
- **Misc** — `SUITE_LOG_LEVEL` must be a known level, `SUITE_PUBLIC_URL` an http(s) URL,
  `SUITE_VERSION` a short printable version.

Drill performed on the dev checkout, against the just-built tree:

```sh
$ SUITE_HOSTED=1 PORT=1336 HEALTH_PORT=1337 pnpm start
{"ts":"2026-10-23T01:46:48.740Z","level":"error","msg":"invalid configuration","component":"server","variable":"SUITE_LICENCE_PUBLIC_KEY","problem":"SUITE_LICENCE_PUBLIC_KEY is required when SUITE_HOSTED=1; a relay cannot verify licences without it."}
{"ts":"2026-10-23T01:46:48.744Z","level":"error","msg":"refusing to start","component":"server","version":"0.1.0","problems":1}
[ELIFECYCLE] Command failed with exit code 1.
exit=1

$ PORT=1336 HEALTH_PORT=1337 SUITE_ADMIN_TOKEN=short pnpm start
{"ts":"2026-10-23T01:46:50.144Z","level":"error","msg":"invalid configuration","component":"server","variable":"SUITE_ADMIN_TOKEN","problem":"SUITE_ADMIN_TOKEN must be at least 16 characters; generate one with \"openssl rand -base64 32\"."}
{"ts":"2026-10-23T01:46:50.146Z","level":"error","msg":"refusing to start","component":"server","version":"0.1.0","problems":1}
[ELIFECYCLE] Command failed with exit code 1.
exit=1
```

Neither run bound `1336`/`1337`: `ss -ltn` showed nothing on those ports afterwards.

The startup line carries the stamp:

```json
{"ts":"…","level":"info","msg":"server ready","component":"server","version":"0.1.0","hosted":false,"ws":"ws://localhost:1334",…}
```

## Watch it

### `/health`

`GET /health` answers `200 {"ok": true}` on the API port. It is a readiness probe only: no counts,
no sizes. The compose healthcheck polls it.

### Metrics

`GET /metrics` returns Prometheus text (`version=0.0.4`) with no client library and no new
dependency. It is **gated by the same token as `/api/admin/*`**: `404` when `SUITE_ADMIN_TOKEN` is
unset, `401` on a wrong or missing bearer token, `200` with the right one, `429` under the admin
rate limit. It is never cached (`cache-control: no-store`).

```sh
curl -s -H "Authorization: Bearer $SUITE_ADMIN_TOKEN" http://localhost:1235/metrics
```

Counters are incremented where the server already knows the event; gauges are read at scrape time.

| Metric | Type | What it means |
| --- | --- | --- |
| `suite_http_requests_total{class="1xx"…"5xx"}` | counter | Every HTTP response on the API port, by status class. One sample per class, always present. |
| `suite_share_creates_total` | counter | Link creations the store accepted. A refused creation (quota, cap, selection too large) is not counted. |
| `suite_publish_attempts_total` | counter | Publishes that reached the projection worker (the rate limiter already passed). |
| `suite_publish_conflicts_total` | counter | Of those, the ones refused because the workspace moved on and the editor must choose. |
| `suite_claim_attempts_total{outcome="owner"\|"mismatch"}` | counter | Workspace claims: `owner` is the first claim or a matching key, `mismatch` is a different key for a claimed workspace. |
| `suite_rate_limit_rejections_total` | counter | Requests refused with `429`, from any limiter. |
| `suite_projection_rebuilds_total` | counter | Rebuild passes requested: one per debounced save batch, one per share create/revoke. Coalesced saves share one pass. |
| `suite_projection_failures_total` | counter | Rebuild requests whose promise rejected; each also logs a `projection rebuild failed` warning. |
| `suite_build_info{version="…"}` | gauge, always `1` | The version stamp (`SUITE_VERSION`, else `package.json`), for joining with a release. |
| `suite_rss_bytes` | gauge | Resident set size of the process, from `process.memoryUsage().rss`. Absent when it cannot be read — never `0`, because a zero would let an RSS threshold silently pass. |
| `suite_uptime_seconds` | gauge | Seconds since the process started. |
| `suite_database_bytes` | gauge | Bytes the document database occupies (page count × page size), the same number the disk watermarks compare against. |
| `suite_disk_soft_bytes` | gauge | The soft watermark in force. **Absent when it is unlimited**, because "unlimited" is not a number. |
| `suite_disk_above_soft` | gauge `0`/`1` | `1` when `suite_database_bytes` exceeds `suite_disk_soft_bytes`; absent when either is unknown. |
| `suite_open_rooms` | gauge | Rooms the sync server currently holds. A room's `:presence`/`:cursors` stream counts as its own entry, so this is "rooms the sync server tracks", not "open documents". |
| `suite_projection_rooms` | gauge | Share projection rooms the worker holds (one per live board/card/selection link). |
| `suite_documents` | gauge | Stored documents: workspace snapshots plus share projections. |

Labels are closed sets — a status class, a claim outcome, the build version. **No workspace id,
share id, room id or token ever becomes a label**, so scraping cannot multiply series or copy a
capability into a metrics store. The same numbers are available as JSON from `snapshot()` in
`metrics.ts` if a collector wants them without the text format.

### Alerting

`deploy/alert.sh` is the probe to put behind cron or any scheduler that reads an exit code:

```sh
SUITE_ADMIN_TOKEN=… deploy/alert.sh                       # against 127.0.0.1:1235
deploy/alert.sh --url https://canvas.example.com --token … --rss-limit-mb 512
deploy/alert.sh --token … --json                          # one JSON line, for a wrapper
```

It fails **loudly** (one `ALERT:` line on stderr, exit `1`) when `/health` is not `200`, when the
database is above the `diskSoftBytes` watermark, or when RSS exceeds the threshold (default
`1024` MiB). It exits `2` with `CANNOT CHECK:` when it cannot check at all — no token, a token that
does not match, or `/metrics` answering `404` — because an alerting path that silently passes is
worse than one that pages.

```cron
# /etc/cron.d/suite-alert: mail the operator when the probe fails.
*/5 * * * * root SUITE_ADMIN_TOKEN=<token> /srv/suite/deploy/alert.sh >/dev/null
```

#### Drill performed

Against a second instance on ports 1334/1335 (the development servers on 1234/1235/5173 were left
running), with `SUITE_ADMIN_TOKEN=drill-admin-token-0123456789`, a scratch data directory and the
same checkout:

```sh
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:1335/metrics
401
$ curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer wrong-token-0000000000" http://127.0.0.1:1335/metrics
401
$ curl -s -H "Authorization: Bearer …" http://127.0.0.1:1335/metrics | head -6
# HELP suite_http_requests_total HTTP responses by status class.
# TYPE suite_http_requests_total counter
suite_http_requests_total{class="1xx"} 0
suite_http_requests_total{class="2xx"} 0
suite_http_requests_total{class="3xx"} 0
suite_http_requests_total{class="4xx"} 2
```

The two `4xx` samples are the unauthorized probes above — the counter is real, not seeded.

```sh
$ deploy/alert.sh --url http://127.0.0.1:1335 --token drill-admin-token-0123456789
OK   health  http://127.0.0.1:1335/health answered 200
OK   metrics 20 metric samples served
OK   disk    12.0 KiB, soft watermark unlimited
OK   memory  117.1 MiB under 1024 MiB
exit=0

$ deploy/alert.sh --url http://127.0.0.1:1335 --token drill-admin-token-0123456789 --rss-limit-mb 1
ALERT: RSS is 117.1 MiB, above the 1 MiB threshold
exit=1
```

Restarted with `SUITE_DISK_SOFT_BYTES=1024 SUITE_DISK_HARD_BYTES=2048` (the database is 12 KiB), the
disk branch fires:

```sh
$ deploy/alert.sh --url http://127.0.0.1:1335 --token drill-admin-token-0123456789
ALERT: database is 12.0 KiB, above the soft watermark of 1.0 KiB
exit=1
$ curl -s -H "Authorization: Bearer …" http://127.0.0.1:1335/metrics | grep -E 'suite_(database_bytes|disk_soft_bytes|disk_above_soft) '
suite_database_bytes 12288
suite_disk_soft_bytes 1024
suite_disk_above_soft 1
```

And the "cannot check" path, which is the most likely state on a fresh host:

```sh
$ deploy/alert.sh --url http://127.0.0.1:1235          # dev server, no admin token
CANNOT CHECK: /metrics is token gated and SUITE_ADMIN_TOKEN is unset; pass --token or set the variable
exit=2
$ deploy/alert.sh --url http://127.0.0.1:1335 --token wrong-token-0000000000
CANNOT CHECK: /metrics answered 401; SUITE_ADMIN_TOKEN does not match the server
exit=2
```

The JSON form is what a wrapper (or a scheduled Lambda) should parse:

```sh
$ deploy/alert.sh --url http://127.0.0.1:1335 --token … --json
{"ok":true,"url":"http://127.0.0.1:1335","version":"0.1.0","health":200,"samples":20,"databaseBytes":12288,"rssBytes":122757120,"rssLimitMb":1024}
```

**Hosted alternatives, no vendor lock-in.** Nothing above is Suite-specific beyond the scrape URL:
any runner that can `curl` and read an exit code works. On AWS, an EventBridge scheduled rule
invoking a small Lambda that `curl`s `/metrics` and publishes to CloudWatch puts `suite_rss_bytes`,
`suite_database_bytes` and the counters into CloudWatch metrics and alarms without running an agent.
Pointing a hosted Prometheus at `/metrics` with a bearer token, or a healthchecks.io/Better Stack
ping at the end of a successful `deploy/alert.sh` run, gives "no news is good news" delivery plus a
dead-man's switch for a probe that stops running. Suite ships no agent, no SDK and no call-home: the
endpoint and the script are the whole contract.

### Admin status

Set `SUITE_ADMIN_TOKEN` and read the detailed state from there:

```sh
curl -s -H "Authorization: Bearer $SUITE_ADMIN_TOKEN" http://localhost:1235/api/admin/status
```

It returns uptime, pid, the version stamp, `rssBytes` (this process's resident set size, from
`process.memoryUsage().rss`; `null` when it cannot be read, never `0`), per-database sizes
(documents, shares, workspaces), room and client counts, and the limits in force. Without
`SUITE_ADMIN_TOKEN` every `/api/admin/*` path answers `404`, so the
route does not advertise itself. Other read-only routes: `/api/admin/rooms`,
`/api/admin/shares?workspaceId=…`, `/api/admin/workspaces?limit=&offset=`,
`/api/admin/workspaces/:id`, `/api/admin/limits`. Two more sit behind the same token:
`POST /api/admin/fixtures` seeds a disposable workspace (see below) and
`GET /api/admin/workspaces/:id/export` downloads its stored snapshot as a `.suite` file.
`PUT /api/admin/limits` stores runtime overrides, and `POST /api/admin/rooms/sweep` closes idle
projection rooms (below).

#### Sweeping idle projection rooms

Every board, card and selection link keeps one live projection room — a full copy of the projected
document — for as long as the link exists. Links do not expire by default, so a single long e2e
session left **354** of those rooms behind on a development instance, each one a document copy.
`SUITE_ROOM_IDLE_HOURS` bounds that:

- A room is **idle** when no owner save, publish, reload or status read has touched it for the
  window **and** the sync server reports no connected session in it other than the projection
  worker. A browser that is still looking at the link keeps it alive however long the owner has
  been away, and a room whose sessions cannot be read is never swept.
- The sweep runs every 60 seconds (the same timer cadence as the share-expiry sweep) and is a
  no-op at `0`, which is the self-host default: a self-host keeps every link warm unless the
  operator asks for a window. `SUITE_HOSTED=1` defaults to 24 hours.
- A swept room is **revoked**, not just closed: the link stops working, it leaves
  `/api/admin/rooms`, its stored documents and draft baseline are deleted through the same revoke
  path an operator revoke takes, and the sync server drops its in-memory copy of the room — that
  copy, not the row on disk, is the largest part of a dead link's footprint. A viewer who
  reconnects gets **Share not found.** and the owner has to share again.

Run it by hand, or dry-run it first to see what it would close:

```sh
curl -s -X POST -H "Authorization: ******" \
  'http://localhost:1235/api/admin/rooms/sweep?dryRun=1'
curl -s -X POST -H "Authorization: ******" \
  http://localhost:1235/api/admin/rooms/sweep
```

The dry run reports candidates and changes nothing; `{"dryRun":true}` in a JSON body does the same.
With `dryRun: true`, `closed` lists what it *would* close. Both forms answer:

```json
{
  "ok": true,
  "dryRun": false,
  "idleHours": 24,
  "checked": 41,
  "unknown": 0,
  "closed": [
    { "roomId": "share-…", "shareId": "…", "workspaceId": "ws-…", "idleMs": 90061000 }
  ]
}
```

`checked` is how many rooms the pass looked at and `unknown` how many it kept because it could not
read their sessions, so "closed nothing" is distinguishable from "looked at nothing". Every call
writes one `admin.mutation` audit line with `action: "sweep-rooms"` and the counts, never a token.

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
- `SUITE_SETTINGS_DB` (runtime limit overrides) is not one of the three snapshotted stores; a restore
  reverts any overrides made in the admin panel.

### Off-host copies

Set `SUITE_BACKUP_BUCKET` to upload the snapshot as a single tarball (manifest and checksums included)
next to the local copy:

```sh
SUITE_BACKUP_BUCKET=s3://suite-backups SUITE_BACKUP_PREFIX=suite deploy/backup.sh /srv/backups
# -> s3://suite-backups/suite/daily/suite-<timestamp>.tar.gz
# -> s3://suite-backups/suite/weekly/...  too, when the run is on a Sunday (UTC)
```

| Variable | Meaning |
| --- | --- |
| `SUITE_BACKUP_BUCKET` | `s3://bucket` target; unset means local-only, exactly as before |
| `SUITE_BACKUP_PREFIX` | key prefix inside the bucket (default `suite`) |
| `SUITE_BACKUP_ENDPOINT` | S3-compatible endpoint for R2, MinIO and friends |

The upload runs through `aws s3 cp`; if the bucket is set but the CLI is missing, the script **fails**
rather than quietly leaving you with only a local copy. Retention belongs to the bucket, not the
script: a lifecycle rule expiring `daily/` after 7 days and `weekly/` after 35 days keeps 7 daily and
4 weekly copies. The exact rule and the IAM policy are in
[deploy-aws.md § Backups](./deploy-aws.md#8-backups). Nothing is deleted locally.

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

# 3. Start and check. 1235 is not published, so ask the container itself.
docker compose start app
docker compose exec -T app node -e \
  'fetch("http://127.0.0.1:1235/health").then((r) => r.text()).then(console.log)'
docker compose exec -T app node -e \
  'fetch("http://127.0.0.1:1235/api/admin/status", { headers: { authorization: "Bearer " + process.env.SUITE_ADMIN_TOKEN } }).then((r) => r.text()).then(console.log)'
```

On a bare host, step 2 is `cp "$SNAP"/*.sqlite <data-dir>/` after deleting the old `*.sqlite`,
`*.sqlite-wal` and `*.sqlite-shm` files. **Remove stale sidecars**: a `-wal` file left next to a
different main file is at best ignored and at worst confusing.

### Restore with `deploy/restore.sh`

The script performs the steps above, in that order, and is what a deployed host should use:

```sh
deploy/restore.sh SNAP                 # refuses a non-empty volume
deploy/restore.sh SNAP --force         # a real restore over live data
deploy/restore.sh SNAP --verify-only   # the monthly drill: verify, write nothing
```

It resolves the compose volume from the `app` container (`SUITE_DATA_VOLUME` overrides it), checks
the manifest's sizes and SHA-256, runs `PRAGMA integrity_check` on every file (host `sqlite3`, or a
throwaway container when the host lacks it), stops `app`, deletes the three main files **and their
stale `-wal`/`-shm` sidecars**, copies the snapshot in, starts `app`, and waits up to 90 s for
`/health` (a containerised `curl` in the app's network namespace, or `SUITE_HEALTH_URL`). Anything
it cannot verify aborts before the volume is touched; a failure after the stop leaves `app` down and
says so. `settings.sqlite` (runtime limit overrides) is not part of a snapshot and is left in place.

The full drill for a deployed host is in
[deploy-aws.md § Restore drill](./deploy-aws.md#9-restore-drill).

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

Quotas degrade a workspace; they never drop a save. The rule is deliberate: losing an edit to
enforce a budget is worse than the budget. A workspace over its document budget keeps loading and
saving for its owner, but it cannot mint **new** share links, and its next
`GET /api/workspaces/:id/status` call says so (`quota.overQuota`, `shareBlock`). A refusal only
happens at a boundary where nothing has been written yet: **new workspaces** and **new share
links**.

| Limit | Env var | Self-host default | Hosted default | When it is hit |
| --- | --- | --- | --- | --- |
| Workspaces | `SUITE_MAX_WORKSPACES` | unlimited | the licence's `workspaces` | New workspace refused `429` `workspace-limit` |
| Document bytes per workspace | `SUITE_DOCUMENT_BYTES_PER_WORKSPACE` | unlimited | the licence's `documentBytes` | Workspace marked over quota: saves keep working, new shares refused `409` |
| Projection bytes per workspace | `SUITE_PROJECTION_BYTES_PER_WORKSPACE` | unlimited | 32 MiB | New share refused `507` |
| Attachment bytes per workspace | `SUITE_ATTACHMENT_BYTES_PER_WORKSPACE` | unlimited | the licence's `attachmentBytes` | Reserved; enforced when attachments land |
| Active shares per workspace | `SUITE_MAX_SHARES_PER_WORKSPACE` | 100 | 100 | New share refused `409` |
| Cards per selection share | `SUITE_MAX_SELECTION_CARDS` | 200 | 200 | Selection share refused `400` |
| Disk soft watermark | `SUITE_DISK_SOFT_BYTES` | unlimited | 4 GiB | New workspace allowed, one warning logged |
| Disk hard watermark | `SUITE_DISK_HARD_BYTES` | unlimited | 5 GiB | New workspace refused `507` `disk-full` |

Reading the table:

- **Saves are never dropped.** Nothing on the save path consults a quota. A workspace over its
  document budget keeps working read/write for its owner; the owner's client is told on its next
  status call so it can warn and offer an export.
- **New workspaces and new shares are refused.** Those are the only refusals: a claim that would
  create one more workspace, and a link that would add one more projection. The message names the
  limit and the current total.
- **Self-host is unlimited by default.** With no licence and no `SUITE_*` quota set, every storage
  quota is unlimited; only the 100-link and 200-card interaction caps apply. The hosted defaults
  are the licence's own `workspaces`, `documentBytes` and `attachmentBytes`, plus 32 MiB of
  projections and the 4/5 GiB disk marks.
- **Hosted is the tighter of the two.** A licence cap and an instance limit are both applied; the
  smaller wins, so an operator can always tighten a plan and never loosen it by accident.
- **Resolution order** is built-in defaults ← `SUITE_*` environment ← runtime overrides
  (`limits.ts`). An unreadable value is reported at boot and the layer below it wins; a
  contradiction such as soft > hard stops the process with the reason instead of enforcing a
  watermark that can never fire.

#### Tuning at runtime

```sh
curl -s -H "Authorization: ******" http://localhost:1235/api/admin/limits
curl -s -X PUT -H "Authorization: ******" -H 'content-type: application/json' \
  -d '{"maxWorkspaces":50,"projectionBytesPerWorkspace":67108864,"diskSoftBytes":"unlimited"}' \
  http://localhost:1235/api/admin/limits
```

`GET` returns `limits`, their `sources` (`default` / `env` / `override`), the `env` variable names,
the overrides in force, `diskBytes` and any `problems`. `PUT` accepts only the keys in the table —
an unknown key is a `400`, never a silently ignored field — validates the resulting configuration
and audits every attempt (`admin.mutation`, `action: "limits.update"`). Values are whole numbers of
bytes, `"unlimited"`, or `null` to clear one override. Overrides are stored in `SUITE_SETTINGS_DB`;
without that file they last one process.

Per-workspace state lives in `/api/admin/workspaces` (`documentBytes`, `overQuota`) and in the
owner's own `GET /api/workspaces/:id/status`. Per-licence caps are enforced against the
`workspace_licences` rows, so a reclaimed workspace never counts twice.

### Fixed limits and rate limits

| Limit | Value | Where |
| --- | --- | --- |
| JSON request body | 64 KiB | `http.ts` |
| Claim / rotate / resolve / create / publish per minute | 600 / 10 / 300 / 30 / 20 | `rateLimit.ts`, per client address |
| Admin requests per minute | 300 | `adminHttp.ts` |
| Room save interval | 2 s, coalesced | `server.ts` (`saveInterval`) |
| Expired-share sweep | 60 s | `server.ts` |
| Idle projection-room sweep | 60 s; a no-op while `SUITE_ROOM_IDLE_HOURS` is `0` (the self-host default) | `server.ts`, `projectionWorker.ts` |
| `PRAGMA optimize` | document store on start and hourly (unref'd timer); share and workspace files on start | `persistence.ts` |
| Journal mode | WAL on all three databases | `persistence.ts` |
| Disk measurement cache | 1 s per process, so a request batch does not re-stat the store | `limits.ts` |

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

**One workspace, five editors.** `apps/collab-server/src/roomsLoad.test.ts` runs five websocket
clients on one workspace room, each with its own credential: 40 edits apiece (200 in total — text
appends into each client's own card, plus card moves), then waits until all five report the same
version vector, title text and placement. Measured on this checkout:

```
[load] 5 clients / 200 edits converge in 936ms
```

Three runs on this checkout printed 890 ms, 895 ms and 1 101 ms, so expect a little under a second
on a developer machine. The test prints its own line on every run, so the number belongs to the
machine that ran it; it fails only if convergence takes longer than 20 seconds, which is the
regression signal.

**Idle rooms add up.** A link with no expiry keeps its projection room forever, so one long e2e
session left **354** live rooms on the development instance (381 at the worst, against a 146 MiB
document store). `SUITE_ROOM_IDLE_HOURS` — off on a self-host, 24 h when `SUITE_HOSTED=1` — and
`POST /api/admin/rooms/sweep` bound that; see "Sweeping idle projection rooms" above. Sweep, or
lower the window, before a backup: a backup carries every live projection with it.

### Known gaps and risks

- **An over-quota workspace keeps its bytes.** A per-workspace document budget is enforced by
  degrading, not by deleting or refusing saves: the workspace is marked over quota, new share links
  stop, and the owner is told to export. A single very large or heavily edited workspace still
  enlarges every backup and slows its own saves, so watch `documentBytes` and `overQuota` in
  `/api/admin/workspaces` and the disk marks in `/api/admin/limits`.
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
- **A claim that only succeeds after boot does not re-join the sync room.** The claim retries; the
  sync connection does not, so a tab that booted offline keeps editing locally and only syncs on its
  next boot even though the relay now considers the workspace claimed. The fix is in the canvas app
  and is written out below rather than guessed at from the server side.

#### Offline re-join: proposal (not shipped)

The claim retries today: a failed `POST /api/workspaces/:id/claim` leaves the tab `pending` or
`offline`, `startClaimRetry` in `apps/canvas/src/session/ownerKey.ts` backs off up to a minute and
watches `online`, and it settles on `claimed`. The **sync connection does not retry**. It is created
at module load in `apps/canvas/src/store/useCanvasStore.ts` (`new LoroProvider(...)`) after
`bootRelay` configured the session, and the relay refuses that join while the workspace is
unclaimed — `authorize` verifies an owner key, it never claims one. Nothing re-runs when the claim
settles, so the tab edits locally, looks disconnected, and syncs only on the next boot.

The change, in four small steps (all in `apps/canvas`, outside this lane):

1. `prepareOwnerSession` already forwards `onOutcome` into `startClaimRetry`. `bootRelay` in
   `apps/canvas/src/main.tsx` passes a callback that fires on the **transition** to `claimed` only.
2. `LoroProvider` (`collab/loroProvider.ts`) gains `rejoin()`: return if `this.disposed`, if the
   workspace room is already joined, or if `this.joining` is set; otherwise
   `await this.client.waitConnected()` and run the existing `join()` again. A refused join leaves
   `workspaceRoom` null and clears `joining` in `finally`, so this is a second attempt on the same
   socket, not a second socket.
3. The callback resolves the store lazily (`useCanvasStore.getState().provider?.rejoin()` after a
   dynamic `import`, because `main.tsx` runs before the store module exists).
4. Loop guard: fire at most once per boot, only on the `claimed` transition, and let `rejoin()`
   no-op while a join is in flight. A re-join that fails is retried by the next `online` event or
   the next boot, never by its own timer, so a relay that keeps refusing cannot spin.

Until that ships, reloading the tab after the claim settles is the workaround — it is what "sync
resumes on the next boot" means in practice.
