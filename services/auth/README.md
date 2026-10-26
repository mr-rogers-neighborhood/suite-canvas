# `@suite/auth` — the account service

The account service behind ADR-0067 and ADR-0077. It owns identity, tenants, members, invitations,
the relay's session JWT and licence bookkeeping. It never touches a document: there is no Loro
dependency, no graph dependency and no document store in this package.

`apps/control-plane/src/modules/auth.ts` mounts it at `/api/auth/*` plus three account routes. The
relay serves none of it.

## Layout

Folder by feature, with one `index.ts` per folder as its public surface. `src/index.ts` re-exports
those surfaces and nothing reaches past them:

| Folder | What lives there |
| --- | --- |
| `identity/` | `betterAuth.ts` (the only module that knows Better Auth exists), `relayToken.ts` (the claims the relay verifies), `mfa.ts` (advice and enforcement), `principal.ts`, `capabilities.ts` |
| `organizations/` | `workspaces.ts` (claim), `adoption.ts` (anonymous to account), `seats.ts` (the licence allowances), `freeTier.ts` (the free licence every organization starts on) |
| `invitations/` | `enrollment.ts` (the invitation engine and its redemption port), `admission.ts` (the review queue's gate) |
| `licensing/` | `licences.ts` (the licence port), `entitlements.ts` (the tier and limits the token carries) |
| `mail/` | `mail.ts`: the transport interface, the console transport, and the three senders |
| `store/` | `memory.ts`, `postgres.ts` (pool, Kysely adapter, raw-SQL seam), `postgresRepositories.ts`, `migrate.ts` |
| `http/` | `handler.ts`, `routes.ts`, `response.ts`, `entry.ts`, `env.ts`, `errors.ts`: the shell |
| `types.ts` | the shared vocabulary every folder speaks (roles, records, sessions, environment) |

Refusals are values at the boundaries: `admissionGate`, `mfaGate`, `redemptionResult` and every route
return a `Result`, and `http/response.ts` holds the single code to status mapping. The domain modules
(`claimWorkspace`, the issuing functions) still throw their own tagged error for an invariant, and
`http/routes.ts` converts that once, at the seam.

## What is wired

| Piece | State |
| --- | --- |
| `better-auth` 1.7.12 | Constructed by `createAuthService` with organization, magic link, passkey, Google, anonymous, admin, `twoFactor`, `jwt`, `emailHarmony` and the invitation engine |
| Database adapter | Kysely over a `pg` pool. `postgresDatabase` builds `{ db, type: "postgres" }` for Better Auth and a raw-SQL `Queryable` over the same pool for our repositories and the migration runner. `store/adapter.test.ts` pins the shape: a query executor, not an arbitrary object |
| Postgres path | `pnpm test` has no database, so the unit suite asserts the adapter as a shape. `pnpm db:verify` is what executes it: a throwaway cluster, every migration, the real repositories, and the real organization plugin creating an organization |
| Sign-up | Open, with a verified email required before a session is issued (ADR-0077). See “Sign-up” below |
| Magic link, verification, invitations | Delivered through `mail/mail.ts`. The console transport is the development one; a deployment injects a `MailTransport` |
| Session JWT | `jwt()` mints a five-minute token and publishes the key set at `/api/auth/jwks`. See “The relay credential” |
| MFA | `twoFactor` is registered, and an `admin` without a second factor is refused everywhere except enrolment |
| Billing | A seam, not an implementation: pass `billingPlugin` and its endpoints are mounted. Nothing here imports `@suite/billing` |

## The shape

```
organization (Better Auth)  ── the tenant: people, roles, seats, subscription
   │  slug = the tenant's name, never a document id
   ├── member (role: owner | admin | member)  ── a seat; roles are organization-wide
   ├── invitation (email-bound, expiring, revocable)  ── the organization plugin's own flow
   ├── invite / inviteUse (better-enrollment)  ── private + shareable links, use log
   ├── jwks (the jwt plugin)  ── the key pair the relay verifies against
   └── workspaces (our row)   ── id IS the document id; organization_id may be NULL (anonymous)
```

Claiming an anonymous workspace is one conditional write on `workspaces`, and it can only set
`organization_id`. The primary key is the document id, so there is nothing to rename and no share link
to reissue. `CLAIM_WORKSPACE_SQL` in `src/organizations/workspaces.ts` is the exact statement,
duplicated as `claim_workspace()` in the migration so a second writer must obey the same rule.

Roles become the app's nine capability flags in `capabilitiesForRole`, the only place the mapping
exists. `owner` and `admin` differ in ownership (deleting the workspace, holding the licence), not in
flags.

Teams stay disabled (`teams: { enabled: false }`). Our sync unit is one document per connection, so
the finest access we can enforce is per workspace.

## Sign-up

An account is created by `POST /api/auth/sign-up/email`, and four things stand between that form and
a session:

- `emailAndPassword.disableSignUp` is false, so the form exists.
- `emailAndPassword.requireEmailVerification` is true, so no session is issued until the address
  answers. `emailVerification.sendOnSignUp` sends the message.
- `/sign-up/email` and `/sign-in/email` are each limited to 3 attempts per 10 seconds. The limit is
  per instance by default; a multi-instance deployment points `rateLimit.storage` at a shared store.
- `captcha` (Cloudflare Turnstile) is registered when `SUITE_TURNSTILE_SECRET` is set, and absent
  otherwise, which is the self-host default.

Magic link, passkey and Google remain available to everyone. `SUITE_ADMISSION_REQUIRED` still defaults
off, and when an operator turns it on it gates `/organization/create` only: a held account can sign
in, edit locally and export.

## Invitations are an organization feature

Two invitation paths are mounted, both under `/api/auth`:

| Path | Flow |
| --- | --- |
| `POST /api/auth/organization/invite-member` | the organization plugin's own invitation: writes an `invitation` row and mails `${SUITE_AUTH_URL}/accept-invitation?id=<id>` through `sendOrganizationInvitation` |
| `POST /api/auth/invites/redeem` | `better-enrollment`'s invitation, wrapped in our error codes |

The organization plugin's invitation is what "add a colleague" means now. The link carries no token:
the plugin checks the signed-in account's address against the invitation, so a forwarded link is
useless to anyone else. The app has to serve `/accept-invitation?id=`, which is a client route this
package cannot add (ADR-0077).

`@octopi-ai/better-enrollment` runs in `mode: "open"`. That is the pin ADR-0077 removes: the plugin no
longer treats an invitation as the only way to get an account, and every redemption goes through its
activate path, which requires a session. The redeemer is somebody who already signed up; the
invitation adds them to the organization with the role it names.

Two kinds exist:

- private, bound to one email, single use, delivered by mail. The signed-in account must own that
  address and have verified it.
- public, a shareable link with `maxUses`, expiry and revocation. It grants membership to whoever
  presents it and is signed in.

`src/invitations/enrollment.ts` does two jobs:

1. `enrollmentOptions` sets the mode, `passwordless: false`, and `resolveSeatLimit`, which answers
   from `organization_licences` through `seatCeiling`.
2. `enrollmentRedemption` is our route's only way in. It posts to Better Auth's own
   `/api/auth/invite/redeem` through the real handler and maps the plugin's codes onto ours
   (`INVITE_EXPIRED` to `invite-expired`, `SEAT_LIMIT_REACHED` to `seat-refused`, `429` to
   `rate-limited`). Anything it does not recognise fails closed, including a 2xx.

Seats are one policy with two call sites. A redemption writes its `member` row through the adapter, so
`beforeAddMember` never fires for it; the same licence decision reaches it as `resolveSeatLimit`, which
reads `seatCeiling`, the function `checkSeatAllowance` also uses. `beforeAddMember` remains the only
seat gate for member rows the organization plugin writes.

### Where the licence row comes from

Every organization is born on the free tier. `0009_free_licence_provisioning.sql` puts a trigger on
`organization` that writes the organization's `organization_licences` row in the same transaction, so
a create that fails at any point rolls the organization back rather than leaving an ownerless row
behind — the orphan the seat refusal used to produce. The numbers are `FREE_LICENCE_TIER` in
`src/organizations/freeTier.ts`: one workspace, one seat (the owner's), 64 MiB per document, 8 MiB per
attachment, for a hundred years. `pnpm db:verify` reads the row the trigger wrote and compares it with
that object, so the SQL and the TypeScript cannot describe two different free tiers.

The free row is a default, not a second kind of licence. `organization_licences.organization_id` is
the primary key, so a paid subscription *replaces* the row: a second row for one organization is not
representable, and the write that replaces it has to be an upsert. Nothing in this package writes that
paid row; the entitlement read (`src/licensing/entitlements.ts`) answers tier `free` with no limits
when there is no live `subscription`, and `services/billing`'s `createEntitlementReader` is what turns
a live one into a plan.

A missing row is consequently a deployment fault and not a customer's state. `checkSeatAllowance`
reports it as `licence-unprovisioned`, whose sentence says the row was never provisioned; a free
organization that has spent its one seat reports `seat-allowance-exhausted`, which is the answer an
upgrade fixes. One place still loses that distinction: the invitation plugin turns `seatCeiling`'s `0`
into its own `SEAT_LIMIT_REACHED`, which `enrollment.ts` maps to `seat-refused` (see ADR-0065 §7).

## Sessions and devices

The device list and revocation are Better Auth's own endpoints, not ours, and the module delegates
them:

| Endpoint | Does |
| --- | --- |
| `GET /api/auth/list-sessions` | every live session for the caller, with user agent, address and timestamps |
| `POST /api/auth/revoke-session` | revokes one session by its token |
| `POST /api/auth/revoke-sessions` | revokes all of the caller's sessions |
| `POST /api/auth/revoke-other-sessions` | keeps the current one and drops the rest |

The distinction matters because a revoked session stops a new token being minted immediately, while a
token already minted keeps working until it expires. That window is the TTL below.

## The relay credential

`jwt()` is registered with an Ed25519 key pair and publishes the public half at
`GET /api/auth/jwks`. The relay verifies a token against that key set and holds no identity table
(ADR-0074).

Claims, all read server-side at mint time:

| Claim | Source |
| --- | --- |
| `sub` | `user.id` |
| `org` | `session.activeOrganizationId`, or `null` for a session with no tenant |
| `role` | that organization's `member.role`, or `null` when membership is gone |
| `tier` | the injected entitlement reader |
| `limits` | the injected entitlement reader |
| `iss`, `aud` | `SUITE_AUTH_URL` |
| `iat`, `exp` | five minutes apart |

The TTL is 300 seconds (`RELAY_TOKEN_TTL_SECONDS`). It is the revocation window: nothing can withdraw
a token that is already signed, so a removed seat, a lowered role or a cancelled subscription takes
effect at the next mint, and the next mint is at most five minutes away. Shortening it buys a smaller
window; lengthening it buys fewer refreshes and a stale entitlement.

Entitlement is injected. `EntitlementReader.forOrganization` answers `{ tier, limits }`, and a session
with no organization gets `freeEntitlement` without a query, so a reader never has to decide what a
null id means. The default, `noEntitlements`, reports tier `free` with no limits, which is what a
deployment without billing gets; the billing lane's `createEntitlementReader` has the same
`forOrganization` shape, so wiring it is one property and no adapter (ADR-0075).

## MFA

`twoFactor` is enforced for the `admin` role, not merely offered. An admin whose
`twoFactorEnabled` is not true is refused every route except the enrolment endpoints, the session
read, sign-out and the revoke routes, with `403` and a body carrying
`{ code: "mfa-enrollment-required", enrollAt: "/two-factor/enable" }`. Enrolment is
`POST /api/auth/two-factor/enable`, which returns the `totpURI` to render as a QR code and the backup
codes; `POST /api/auth/two-factor/verify-totp` confirms it and flips `twoFactorEnabled`.

A session also reports `mfaRequired`, so the client can open the enrolment screen before a route
fails. Owners and other roles get advice, not enforcement (`mfaAdvice`).

## Billing seam

`AuthServiceDeps.billingPlugin?: BetterAuthPlugin` is spread into the plugin list when present and
absent otherwise. `@better-auth/stripe` registers checkout (`POST /api/auth/subscription/upgrade`),
the portal (`POST /api/auth/subscription/billing-portal`) and its webhook on that instance, and the
control-plane module already delegates every `/api/auth/*` path, so no route changes when it lands.
This package imports nothing from `@suite/billing` and implements no checkout, portal or webhook.

## Routes

`/api/auth/*` belongs to Better Auth. Everything below is `createAuthHandler(deps)`: one event in, one
JSON response out, named codes only (`unauthorized`, `forbidden`, `invalid-request`,
`workspace-already-claimed`, `invite-*`, `seat-refused`, `rate-limited`, `auth-not-configured`).

| Route | Who | Does |
| --- | --- | --- |
| `POST /api/workspaces/claim` | owner or admin of the organization | Assigns an anonymous workspace; refuses another organization's, and refuses past the licence ceiling |
| `POST /api/invites/redeem` | a signed-in account holding a token | Joins the organization the invitation names, with its role, in our error codes |
| `GET /api/workspaces/:id/members` | any member | Lists members (ids and roles, never addresses) |

The account-side claim has one home: `POST /api/workspaces/claim` here, which is what
`apps/canvas/src/auth/endpoints.ts` calls. The relay's `POST /api/workspaces/:id/claim` is the
owner-key path and is deleted with the owner key (ADR-0076); the two are not aliases, and this module
declines the relay's shape.

## Environment

`SUITE_AUTH_ENABLED` (default `0`), `SUITE_AUTH_SECRET` (32+ characters), `SUITE_AUTH_URL`,
`SUITE_AUTH_DATABASE_URL`, `SUITE_AUTH_MIGRATE` (default on; `0` skips the boot migration),
`SUITE_GOOGLE_CLIENT_ID` and `SUITE_GOOGLE_CLIENT_SECRET` (together or not at all),
`SUITE_AUTH_RP_ID`, `SUITE_AUTH_RP_NAME`, `SUITE_AUTH_MAX_ORGS_PER_USER` (default `1`),
`SUITE_TURNSTILE_SECRET` (unset means no challenge), `SUITE_ADMISSION_REQUIRED` (default off: every
account is admitted).

There is no `SUITE_AUTH_EMAIL_FROM`. Mail is a `MailTransport` the deployment supplies; the module
passes `consoleTransport`, which writes the link to the process log.

## Plugins

Better Auth is composed of plugins rather than hand-rolled routes:

| Plugin | Why |
| --- | --- |
| `organization` | the tenant: members, roles, invitations. Teams disabled |
| `magicLink`, `passkey`, Google | the other ways in, open to everyone |
| `better-enrollment` | private and public invitations with an append-only use log, registered after `admin()` because its management gate reads that role |
| `anonymous` | a session with no PII, and `onLinkAccount` |
| `lastLoginMethod` | so the sign-in screen can offer the method that worked last |
| `twoFactor` | available to everyone, required of `admin` |
| `admin` | the user role field, ban, impersonation |
| `jwt` | the relay's session token and the `/jwks` key set |
| `emailHarmony` | normalizes addresses (`foo+temp@gmail.com` equals `foo@gmail.com`) and blocks 55k disposable domains |
| `captcha` | invisible Turnstile, only where `SUITE_TURNSTILE_SECRET` is set |

Admission is ours, not a plugin: `admittedAt` on the user plus one global hook that refuses
`/organization/create` while it is null and the queue is on.

`onLinkAccount` is wired to `transferAnonymousWorkspaces`, which this package accepts as a dependency
and the control-plane module does not yet supply: adoption needs an `AdoptionStore` over `member` and
`organization` that no repository implements. Until it lands, an anonymous account's organizations
stay with the anonymous user.

## Deployment seam

`createAuthEntry(env, deps)` is the one function a deployment calls. Its order is the point: switch,
then connection string, then pool, then Better Auth, then the handler, so a misconfigured deployment
refuses at start-up instead of producing a session that silently does not exist.

```ts
const auth = await createMigratedAuthEntry(authEnvironment(process.env), {
  ...mailSenders(transport),
});
// sql/ has been applied; auth.handler(request) speaks Better Auth's Request -> Response
// auth.redeem, auth.sessions and auth.repositories are what createAuthHandler takes
// await auth.close() closes the pool it opened, and only that
```

`postgresDatabase` builds one pool and two views of it: the Kysely adapter Better Auth takes, and a
`Queryable` for our repositories and the migration runner. They must be injected together
(`database` and `queryable`); one without the other throws, because a generated adapter over a
different pool reads rows nobody wrote and surfaces as a missing licence.

The repositories stay injected rather than built by the service. The memory implementations are what
makes the rules testable without a database.

## Migrations

`sql/` is the schema, in order: `0001_control_plane.sql` creates the control plane,
`0002_plugins.sql` adds what the plugin set contributes, `0003_billing.sql` adds the billing tables,
`0004_licence_limits.sql` adds the licence ceilings, `0005_enrollment.sql` retires our hand-rolled
invitations in favour of `better-enrollment`, `0006_jwks.sql` creates the `jwt` plugin's key table,
`0007_subscription.sql` adds the plugin's own `subscription` row, `0008_drop_billing_tables.sql`
drops the two tables the retired hand-written billing function owned, and
`0009_free_licence_provisioning.sql` gives every organization its free licence row in the
transaction that creates it.

`src/store/migrate.ts` applies them at boot through `createMigratedAuthEntry`:

- files are discovered in `sql/` in lexical order, so the numbers are the order;
- every applied file is recorded in `schema_migrations` (`filename`, `checksum`, `applied_at`) and
  only unapplied files run, each inside its own transaction with its row written in the same
  transaction;
- a second boot applies nothing and logs `auth migrations: schema is up to date` once;
- a file that changed after it was applied fails the boot, naming the file;
- `SUITE_AUTH_MIGRATE=0` (or `false`/`no`/`off`) skips the step for an operator who migrates out of
  band. It is on by default.

`migrate(queryable)` and `status(queryable)` (exported as `migrationStatus`) are available to a runner
outside the HTTP entry. Both take the same `Queryable` seam as the repositories, so their tests drive
them with a recording fake and `pnpm test` still needs no database.

The column names in 0002 and 0006 are asserted against Better Auth's own table output in
`src/identity/pluginSchema.test.ts`, which is what makes a hand-written migration safe to trust after
a dependency bump.

## Tests

```sh
pnpm vitest run --project auth
```

No network, no database, no clock: the licence, the repositories and `now` are injected. What the
suite does not prove is a live Postgres connection, so that lives outside it:

```sh
pnpm db:verify
```

It starts a throwaway cluster, applies `sql/` in order, and drives the shipped code against it —
including `POST /api/auth/organization/create` through the real plugin, asserting that the creator
becomes the organization's first member. That is the one check that would have caught a new
organization being refused its own owner.
