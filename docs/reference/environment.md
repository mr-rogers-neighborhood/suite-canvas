# Environment

Every variable the relay reads, its default, and what it changes. `apps/collab-server/src/config/config.ts`
parses them once at boot and refuses to start on a value it cannot read, so a wrong variable is a startup
error naming itself, not a silent fallback. `.env.example` lists the same set, and `compose.yaml` passes all
of it through.

Setting a variable is [../how-to/deploy.md](../how-to/deploy.md); sizing the numbers is
[../how-to/operate.md](../how-to/operate.md); the quotas are generated into [limits.md](limits.md).

## Ports

| Variable | Default | Serves |
| --- | --- | --- |
| `PORT` | `1234` | the Loro WebSocket sync server |
| `HEALTH_PORT` | `1235` | the HTTP API, `/health`, `/metrics` and the admin panel |

The two must differ; anything else is refused at boot.

## Stores

Six SQLite stores exist in code. `compose.yaml` puts all six on the `suite-data` volume at `/data`; when a
variable is unset, the default in the table applies.

| Variable | Default | Holds |
| --- | --- | --- |
| `SUITE_DB` | `suite.documents.sqlite` | Loro snapshots and update logs, one room per workspace |
| `SUITE_SHARES_DB` | `suite.shares.sqlite` | share rows, token hashes, draft baselines, projection state |
| `SUITE_WORKSPACES_DB` | `suite.workspaces.sqlite` | owner-key hashes and workspace rows |
| `SUITE_SETTINGS_DB` | `:memory:` | per-workspace runtime quota overrides |
| `SUITE_LICENCE_DB` | `:memory:` | licence claims, recorded per licence id |
| `SUITE_ATTACHMENTS_DB` | `suite.attachments.sqlite` | attachment bytes and their metadata |

A relative path resolves against the working directory, so `:memory:` and a bare filename are fine for a
local run and wrong for a container. `SUITE_REQUIRE_DURABLE_STORES=1` (set by `compose.yaml`) requires each
of the six to be an absolute file path in one directory, and refuses `:memory:`, a relative path or two
stores in one file. Two stores must never share a file, whatever the mode.

## Mode and credentials

| Variable | Default | Effect |
| --- | --- | --- |
| `SUITE_HOSTED` | `0` | `1` enforces licences and installs the hosted quota defaults; `SUITE_LICENCE_PUBLIC_KEY` becomes required |
| `SUITE_LICENCE_PUBLIC_KEY` | none | Ed25519 public key that verifies licences, as PEM or the base64url raw key |
| `SUITE_ADMIN_TOKEN` | none | operator token for `/api/admin/*`, `/metrics` and `/admin`, at least 16 characters; unset answers `404`, which is the safe default |
| `SUITE_PROJECTION_TOKEN` | random per start | the projection worker's credential; writes only `share-` rooms |
| `SUITE_SOURCE_TOKEN` | random per start | the source worker's credential; writes only a workspace with an active editor share |
| `SUITE_INTERNAL_TOKEN` | none | legacy alias for `SUITE_PROJECTION_TOKEN`, still accepted |
| `SUITE_VERSION` | `package.json` | the stamp reported by `/metrics`, `/api/admin/status` and the startup line; an empty value is refused |
| `SUITE_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `SUITE_TRUST_PROXY` | `0` | `1` uses the first `X-Forwarded-For` hop as the client address for rate limits |
| `SUITE_ALLOWED_ORIGINS` | empty | comma-separated extra browser origins for the HTTP API; empty means same-origin |
| `SUITE_PUBLIC_URL` | none | base URL used for links created by `POST /api/admin/fixtures` |

An unset worker token is generated per start, which only matters if a worker reconnects after a restart.
Neither worker token may reach a browser or a log.

## Quotas

| Variable | Self-host | Hosted (`SUITE_HOSTED=1`) |
| --- | --- | --- |
| `SUITE_MAX_WORKSPACES` | unlimited | unlimited |
| `SUITE_DOCUMENT_BYTES_PER_WORKSPACE` | unlimited | unlimited |
| `SUITE_PROJECTION_BYTES_PER_WORKSPACE` | unlimited | 32 MiB |
| `SUITE_ATTACHMENT_BYTES_PER_WORKSPACE` | unlimited | unlimited |
| `SUITE_MAX_SHARES_PER_WORKSPACE` | 100 | 100 |
| `SUITE_MAX_SELECTION_CARDS` | 200 | 200 |
| `SUITE_DISK_SOFT_BYTES` | unlimited | 4 GiB |
| `SUITE_DISK_HARD_BYTES` | unlimited | 5 GiB |

Bytes, counts or `unlimited`. A hosted licence carries its own `workspaces`, `documentBytes` and
`attachmentBytes`, and the tighter of the licence and the instance value wins. Setting `unlimited` by hand
overrides the hosted guardrails, which is why leaving the variable unset is the safe choice. The exact
numbers and the code that enforces each one are in [limits.md](limits.md).

## Rate limits

Per client address, fixed one-minute windows. Empty keeps the default shown.

| Variable | Default |
| --- | --- |
| `SUITE_CLAIM_RATE_LIMIT` | 600 |
| `SUITE_ROTATE_RATE_LIMIT` | 10 |
| `SUITE_SHARE_RESOLVE_RATE_LIMIT` | 300 |
| `SUITE_SHARE_CREATE_RATE_LIMIT` | 30 |
| `SUITE_PUBLISH_RATE_LIMIT` | 20 |
| `SUITE_ADMIN_RATE_LIMIT` | 300 |

## Canvas build

These are inlined by Vite at build time, so they are fixed in the bundle and not read at runtime.

| Variable | Default | Effect |
| --- | --- | --- |
| `VITE_SUITE_MODE` | `relay` | `standalone` drops share resolution, the owner claim, the provider and sharing; any other value keeps the full product |
| `VITE_COLLAB_HTTP_URL` | `/api` | the HTTP API base the canvas calls |
| `VITE_COLLAB_URL` | `ws(s)://<host>/ws` | the sync WebSocket URL |

## Accounts, billing and the compose front end

The account service reads `SUITE_AUTH_ENABLED` (default `0`), `SUITE_AUTH_SECRET` (at least 32 characters),
`SUITE_AUTH_URL`, `SUITE_AUTH_DATABASE_URL`, `SUITE_GOOGLE_CLIENT_ID` with `SUITE_GOOGLE_CLIENT_SECRET`,
`SUITE_AUTH_EMAIL_FROM`, `SUITE_AUTH_RP_ID`, `SUITE_AUTH_RP_NAME`, `SUITE_AUTH_MAX_ORGS_PER_USER`,
`SUITE_TURNSTILE_SECRET` and `SUITE_ADMISSION_REQUIRED`. No running relay mounts that service, so these are
inert today; the meanings are in [security-model.md](security-model.md).

Billing owns `SUITE_BILLING_ENABLED`, `SUITE_BILLING_STORE`, `SUITE_BILLING_DATABASE_URL`,
`SUITE_APP_ORIGIN`, `SUITE_LICENCE_PRIVATE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_TIERS`, `SUITE_SELF_HOST_URL`, `SES_FROM_ADDRESS` and `SUITE_SES_REGION`, all listed in
[billing.md](billing.md).

`compose.yaml` adds three variables it consumes itself: `SUITE_DOMAIN` (the hostname Caddy serves),
`SUITE_ACME_EMAIL` (the ACME account address) and `SUITE_IMAGE` (the image to run, defaulting to `:latest`).

## Generated check

The tables above are written by hand from `config/config.ts`, `compose.yaml` and `.env.example`, and
`pnpm test` covers the parser rather than this page. A later change may generate the variable lists from
`config.ts` and fail the docs check when a variable is missing here; until then, the way to verify a
variable is to grep `config.ts` for it.
