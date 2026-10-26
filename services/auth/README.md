# `@suite/auth` — the control plane for owned workspaces

The account service from [ADR-0065](../../docs/decisions/0065-accounts-own-workspaces.md). It owns
identity, tenants, members, invite keys and licence bookkeeping. **It never touches a document** —
there is no Loro dependency, no graph dependency and no document store in this package, which is the
structural version of "an invitation never touches the document".

## What is actually wired today

Blunt, because a half-wired identity service is the kind of thing that looks finished:

| Piece | State |
| --- | --- |
| `better-auth` (1.7.12) | **Installed and constructed.** `createAuthService` builds a real instance with the **organization** plugin, **magic link** and **passkeys** (`@better-auth/passkey`), plus **Google** when `SUITE_GOOGLE_CLIENT_ID`/`_SECRET` are set. |
| Plugin hooks | **Real and tested.** `beforeCreateOrganization` (tenant ceiling), `beforeAddMember` and `beforeAcceptInvitation` (licence seats) run inside Better Auth, through its in-memory adapter, in `betterAuth.test.ts`. |
| Magic-link sign-in | **Real and tested end to end** (no network): the plugin asks for a link, the test opens it, and the returned `set-cookie` session resolves through `sessionReader`. |
| Postgres adapter | **Not wired.** No `pg`/Kysely driver is installed, so `createAuthService` takes a `database` adapter and production has nothing to pass yet. The SQL that adapter must satisfy is `sql/0001_control_plane.sql`. |
| Sessions at the relay | **Not wired.** A websocket join carries an owner key or a share token, not a cookie, so `apps/collab-server/src/seatGate.ts` refuses an *account* principal with `account-check-unavailable` instead of guessing a seat count. |
| Membership writes | Two writers, one table: Better Auth writes `member` for organization invitations and `addMember`; the invite-key path writes it inside `redeem_invite_key` (see below), because a redeemer is not yet a member and cannot pass the plugin's own permission check. Both obey the same unique constraint. |

If you need the Postgres adapter installed, add `pg` and `kysely` here and pass
`new Kysely({ dialect: new PostgresDialect({ pool }) })` as `database`; nothing else in this package
changes. Do that in the lane that deploys the service, with a live database to test against —
shipping a driver nobody has run is how a login breaks in production only.

## The shape

```
organization (Better Auth)  ── the tenant: people, roles, seats, subscription
   │  slug = the tenant's name, never a document id
   ├── member (role: owner | admin | member)  ── a seat; roles are organization-wide
   ├── invitation (email-bound, expiring, revocable)  ── the plugin's own flow
   ├── invite_keys (our row)  ── shareable, role + expiry + max_uses + revoked_at
   └── workspaces (our row)   ── id IS the document id; organization_id may be NULL (anonymous)
```

- **Claiming** an anonymous workspace is one conditional write on `workspaces`, and it can only set
  `organization_id`. The primary key is the document id, so there is nothing to rename and no share
  link to reissue. `CLAIM_WORKSPACE_SQL` in `src/workspaces.ts` is the exact statement, duplicated as
  `claim_workspace()` in the migration so a second writer must obey the same rule.
- **Roles** become the app's nine capability flags in `capabilitiesForRole` — the only place the
  mapping exists. `owner` and `admin` differ in *ownership* (deleting the workspace, holding the
  licence), not in flags, because Better Auth has no finer role and a custom `ac` matrix nobody can
  explain is a support burden.
- **Teams are disabled** (`teams: { enabled: false }`). Our sync unit is one document per connection,
  so the finest access we can enforce is per workspace; a team would have to be a set of workspace
  grants, which is a later ADR.

## Invite keys: the interesting function

`redeemInviteKey` answers four refusals by name (not found, revoked, expired, exhausted) and one
non-answer: **already a member**, which spends no use and is not an error. Safety is not one of those
checks — it is the conditional counter update:

```sql
UPDATE invite_keys SET used_count = used_count + 1
 WHERE id = $1 AND revoked_at IS NULL AND used_count < max_uses
   AND (expires_at IS NULL OR expires_at > now())
RETURNING *;
```

Zero rows means the key is spent, wherever the race landed. The same transaction inserts the `member`
row, so the two cannot disagree. `invites.test.ts` fires two redemptions at one single-use key and
asserts exactly one wins.

## Routes

All four are `createAuthHandler(deps)` — one event in, one JSON response out, named codes only
(`unauthorized`, `forbidden`, `invalid-request`, `workspace-already-claimed`, `invite-*`,
`seat-refused`, `auth-not-configured`).

| Route | Who | Does |
| --- | --- | --- |
| `POST /api/workspaces/claim` | owner/admin of the organization | Assigns an anonymous workspace; refuses another organization's, and refuses past the licence ceiling |
| `POST /api/auth/invites` | owner/admin | Mints a key; returns the plaintext once, stores only its SHA-256 |
| `POST /api/invites/redeem` | any signed-in account | Checks seats **before** the write, then redeems into `member` |
| `GET /api/workspaces/:id/members` | any member | Lists members (ids and roles, never emails) |

## Environment

`SUITE_AUTH_ENABLED` (default `0`), `SUITE_AUTH_SECRET` (32+ chars), `SUITE_AUTH_URL`,
`SUITE_AUTH_DATABASE_URL`, `SUITE_GOOGLE_CLIENT_ID`/`_SECRET` (together or not at all),
`SUITE_AUTH_EMAIL_FROM`, `SUITE_AUTH_RP_ID`, `SUITE_AUTH_RP_NAME`, `SUITE_AUTH_MAX_ORGS_PER_USER`
(default `1`), `SUITE_TURNSTILE_SECRET` (unset means no challenge), `SUITE_ADMISSION_REQUIRED`
(default off: every account is admitted).

## Plugins

Better Auth is composed of plugins rather than hand-rolled routes, and each one is here for a stated
reason ([ADR-0067](../docs/decisions/0067-the-account-is-the-identity.md)):

| Plugin | Why |
| --- | --- |
| `organization` | the tenant: members, roles, invitations. Teams disabled, because our sync unit is one document |
| `passkey`, `magicLink`, Google | the three ways in; no passwords |
| `anonymous` | a real session with no PII, and `onLinkAccount` — the hook that moves an anonymous account's workspaces to a real one on sign-up |
| `lastLoginMethod` | so the sign-in screen can offer the method that worked last |
| `twoFactor` | available to operators and org owners |
| `admin` | the user-management half of the admin panel: role field, ban, impersonation |
| `captcha` | invisible Turnstile, only where `SUITE_TURNSTILE_SECRET` is set |
| `emailHarmony` | normalizes addresses (`foo+temp@gmail.com` = `foo@gmail.com`) and blocks 55k disposable domains — under per-seat billing a duplicate account is a duplicate seat |

Admission is **ours**, not a plugin: `admittedAt` on the user plus one global hook that refuses
`/organization/create` (and, later, claim and sync) while it is null. It is a licensing gate, never an
authentication one — local editing, import and export are never refused
([ADR-0067](../docs/decisions/0067-the-account-is-the-identity.md) §7).

When an anonymous account signs up, `adoptAnonymousOrganizations` runs in the
`onLinkAccount` window: it gives the new account ownership of every organization the
anonymous one *owned* (not ones it merely belonged to) and drops the anonymous
membership, so the work survives the anonymous user's deletion without any workspace
row — or any id, URL or share link — moving.

## Deployment seam

`createAuthEntry(env, deps)` is the one function a deployment calls. Its order is the
point: switch, then connection string, then pool, then Better Auth, then the handler —
so a misconfigured deployment refuses at start-up instead of producing a session that
silently does not exist (which the relay would read as anonymous).

```ts
const auth = createAuthEntry(authEnvironment(process.env), {
  licences, memberships, sendMagicLink, transferAnonymousWorkspaces: adopt,
});
// auth.handler(request)  — Better Auth's own Request -> Response
// await auth.close()     — closes the pool it opened, and only that
```

`postgresDatabase()` builds the pool Better Auth takes directly (no ORM, no query
builder), and `postgresRepositories(client)` returns the three repositories over the
same pool — `LicenceStore`, `MembershipReader` and `WorkspaceRepository`
([ADR-0070](../docs/decisions/0070-one-postgres-control-plane.md)). They stay
*injected* rather than built by the service, because the memory implementations are
what makes the rules testable without a database; a deployment passes the Postgres
ones.

```ts
const { database, close } = postgresDatabase({ connectionString });
const repos = postgresRepositories(database as never);
const auth = createAuthEntry(env, { ...repos, sendMagicLink, close });
```

## Migrations

`sql/0001_control_plane.sql` creates the control plane; `sql/0002_plugins.sql` adds what
the plugin set contributes; `sql/0003_billing.sql` adds the billing tables that ADR-0069
moved here from DynamoDB. Neither is applied automatically: there is no boot-time
migration, so a deployment runs them deliberately. The column names in 0002 are asserted
against Better Auth's own table output in `src/pluginSchema.test.ts`, which is what makes
a hand-written migration safe to trust after a dependency bump.

## Tests

```sh
pnpm vitest run services/auth
```

No network, no database, no clock: the licence, the repositories and `now` are all injected. What the
suite does *not* prove is the Postgres adapter — see the table above.
