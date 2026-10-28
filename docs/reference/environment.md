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
| `SUITE_HOSTED` | `0` | `1` enforces hosted licences and installs the hosted quota defaults; `SUITE_LICENCE_PUBLIC_KEY` becomes required and `SUITE_LICENCE` is refused |
| `SUITE_LICENCE` | none | signed licence token for a self-hosted instance, verified at boot; see [Self-host licence](#self-host-licence) |
| `SUITE_LICENCE_PUBLIC_KEY` | none | Ed25519 public key that verifies `SUITE_LICENCE` and the relay's licence tokens, as PEM or the base64url raw key |
| `SUITE_RELAY_PURGE_TOKEN` | none | bearer the control plane presents to the relay's own workspace delete, so an account erase removes documents, shares and attachments. It opens that one route and nothing else |
| `SUITE_RELAY_URL` | none | where the control plane reaches that relay. Empty leaves the three stores in place and reports them as not-configured |
| `SUITE_ADMIN_EMAILS` | none | comma-separated addresses that may use the operator surface: `/api/admin/*`, `/metrics` and `/admin`. Matched case-insensitively against the signed-in account, so revoking an operator is a restart rather than a rotation. Unset means nobody, which is the safe default |
| `SUITE_METRICS_LOCAL` | `0` | `1` lets a request from a loopback address read `/metrics` with no credential, which is what a cron scrape on the box needs. It opens nothing else |
| `SUITE_PROJECTION_TOKEN` | random per start | the projection worker's credential; writes only `share-` rooms |
| `SUITE_SOURCE_TOKEN` | random per start | the source worker's credential; writes only a workspace with an active editor share |
| `SUITE_INTERNAL_TOKEN` | none | legacy alias for `SUITE_PROJECTION_TOKEN`, still accepted |
| `SUITE_VERSION` | `package.json` | the stamp reported by `/metrics`, `/api/admin/status` and the startup line; an empty value is refused |
| `SUITE_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `SUITE_TRUST_PROXY` | `0` | `1` uses the first `X-Forwarded-For` hop as the client address for rate limits |
| `SUITE_ALLOWED_ORIGINS` | empty | browser origins for the HTTP API, comma-separated; empty answers loopback origins only, `*` answers any origin |
| `SUITE_PUBLIC_URL` | none | base URL used for links created by `POST /api/admin/fixtures` |

An unset worker token is generated per start, which only matters if a worker reconnects after a restart.
Neither worker token may reach a browser or a log.

## Self-host licence

A self-hosted relay starts with no control plane, so nothing mints it a session token and no
organization subscription holds its capacity. `SUITE_LICENCE` is the whole entitlement: one signed
token, the line `pnpm --filter @suite/collab-server licence sign` prints, plus
`SUITE_LICENCE_PUBLIC_KEY` holding the public half of the key that signed it.

The relay verifies the token at boot. A token that is malformed, expired, signed by another key,
or of a format this build does not read stops the process, and the error names the case:
`licence-malformed`, `licence-expired`, `licence-bad-signature`, `licence-unknown-version`. A token
with no key configured is reported on `SUITE_LICENCE_PUBLIC_KEY`, and an empty value means no
licence.

The claims become the instance caps. `workspaces` caps `SUITE_MAX_WORKSPACES`, `documentBytes`
caps `SUITE_DOCUMENT_BYTES_PER_WORKSPACE` and `attachmentBytes` caps
`SUITE_ATTACHMENT_BYTES_PER_WORKSPACE`; a lower value set in the environment still wins. The boot
writes each cap into that variable before the quota layer reads it, so `GET /api/admin/limits`
reports the cap with the source `env`. Changing the licence or its caps takes effect at the next
start.

`SUITE_LICENCE` beside `SUITE_HOSTED=1` is a contradiction, and the process refuses to start. A
hosted relay takes capacity from the organization's subscription and reads it from the session
token, so there is no merge to define. A session token on a self-hosted instance, which is
possible when the operator runs a control plane as well, authenticates a person and adds no
capacity: the per-workspace claim record is written only in hosted mode. [billing.md](billing.md)
has the seller's command and the operator's side.

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
`attachmentBytes`, and the tighter of the licence and the instance value wins. A self-host licence
caps the same three and follows the same rule. Setting `unlimited` by hand overrides the hosted
guardrails, which is why leaving the variable unset is the safe choice. The exact numbers and the
code that enforces each one are in [limits.md](limits.md).

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

The account service is mounted by `apps/control-plane/src/modules/auth.ts` at `/api/auth/*`, so these
variables affect that process and not the relay. `SUITE_AUTH_ENABLED` (default `0`) turns it on; off,
every account path answers `503 auth-not-configured`.

| Variable | Default | Effect |
| --- | --- | --- |
| `SUITE_AUTH_ENABLED` | `0` | `1` or `true` composes the service and mounts its routes |
| `SUITE_AUTH_SECRET` | none | signing secret for cookies and the JWT key pair, at least 32 characters |
| `SUITE_AUTH_JWKS_URL` | `${SUITE_AUTH_URL}/api/auth/jwks` | where the relay fetches the key set. Set it when the control plane is reachable under a different name than the public origin, which is every compose deployment: the token names `https://app.suite.run` and the relay reaches `control-plane:1236` |
| `SUITE_AUTH_URL` | none | public origin the session cookie is scoped to, and the JWT's `iss` and `aud` |
| `SUITE_AUTH_DATABASE_URL` | none | Postgres for accounts, organizations and licences; required when the service is on |
| `SUITE_AUTH_MIGRATE` | on | `0`, `false`, `no` or `off` skips the boot migration for an operator who applies `services/auth/sql` out of band |
| `SUITE_AUTH_RP_ID` | `localhost` | WebAuthn relying-party id; the registrable domain passkeys are bound to |
| `SUITE_AUTH_RP_NAME` | `Suite` | relying-party name shown by the authenticator, and the TOTP issuer |
| `SUITE_AUTH_MAX_ORGS_PER_USER` | `1` | organizations one account may own |
| `SUITE_GOOGLE_CLIENT_ID` | none | with the secret, registers the Google provider |
| `SUITE_GOOGLE_CLIENT_SECRET` | none | one half of the pair without the other refuses to boot |
| `SUITE_TURNSTILE_SECRET` | none | set it to require invisible Turnstile in front of sign-up; unset means no challenge |
| `SUITE_ADMISSION_REQUIRED` | `0` | `1` holds a new account until an operator admits it, gating `/organization/create`. Refused at startup unless `SUITE_ADMIN_EMAILS` names an operator, because the queue would have no door |
| `SUITE_APP_URL` | none | where the admission notice sends someone; unset admits without sending one |
| `SUITE_MAIL_TRANSPORT` | `console` | `console`, `resend` or `smtp`. Anything else refuses to boot |
| `SUITE_MAIL_FROM` | none | sending address, e.g. `Suite <hello@example.com>`; required by `resend` and `smtp` |
| `RESEND_API_KEY` | none | required by `SUITE_MAIL_TRANSPORT=resend` |
| `SUITE_SMTP_URL` | none | required by `SUITE_MAIL_TRANSPORT=smtp`: `smtp://user:pass@host:587` or `smtps://host:465` |
| `SUITE_SMTP_REQUIRE_TLS` | `1` | `0` accepts a relay with no StartTLS; only for a loopback or private network |
| `SUITE_FEEDBACK_TO` | none | where the in-app feedback bubble sends; unset hides the bubble, because a form that cannot send is worse than none |
| `SUITE_AUTH_REQUIRE_VERIFICATION` | on | `0` or `false` issues a session before the address is confirmed. For a local run with no mailbox; a deployment that sets it has an open sign-up |

Sign-up is open, and an account cannot sign in until its address is verified. The service takes a
`MailTransport` and the control plane chooses one from `SUITE_MAIL_TRANSPORT`: `console` writes the link
to the process log with the token redacted, `resend` posts to the Resend API, and `smtp` speaks
submission SMTP with StartTLS and `AUTH PLAIN` or `AUTH LOGIN`. A vendor transport missing its key or its
sender refuses to boot rather than falling back to `console`, which would look healthy while every
verification email went to a log file. The meanings are in [security-model.md](security-model.md).

Billing owns `SUITE_BILLING_ENABLED`, `SUITE_BILLING_STORE`, `SUITE_BILLING_DATABASE_URL`,
`SUITE_APP_ORIGIN`, `SUITE_LICENCE_PRIVATE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_TIERS`, `SUITE_SELF_HOST_URL`, `SES_FROM_ADDRESS` and `SUITE_SES_REGION`, all listed in
[billing.md](billing.md).

`compose.yaml` adds three variables it consumes itself: `SUITE_DOMAIN` (the hostname Caddy serves),
`SUITE_ACME_EMAIL` (the ACME account address) and `SUITE_IMAGE` (the image to run, defaulting to the image
the host builds locally, `suite:local`).

## Generated check

The tables above are written by hand from `config/config.ts`, `compose.yaml` and `.env.example`, and
`pnpm test` covers the parser rather than this page. A later change may generate the variable lists from
`config.ts` and fail the docs check when a variable is missing here; until then, the way to verify a
variable is to grep `config.ts` for it.
