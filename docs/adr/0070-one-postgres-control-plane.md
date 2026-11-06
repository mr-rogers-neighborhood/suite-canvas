# ADR-0070: One Postgres control plane, and document bytes never in it

- **Status:** proposed
- **Date:** 2026-10-25
- **Related:** [ADR-0065](./0065-accounts-own-workspaces.md) §9 (Postgres arrives for the control plane), [ADR-0067](./0067-the-account-is-the-identity.md), [ADR-0069](./0069-billing-runs-on-the-stripe-plugin.md) + its amendment, `docs/billing.md`, `services/auth/sql/`

## Context

Three decisions have each moved something into a database without ever stating the shape of the thing
they were moving into:

- **ADR-0065 §9** brought Postgres for the control plane — people, organizations, workspaces as rows.
- **ADR-0067** added admission, normalization, two-factor and the plugin tables on top.
- **ADR-0069's amendment** moved billing state there and deleted the DynamoDB store.

Those were each right, and none of them answered the questions a database decision has to answer:
what lives in it, what must never, who connects to it, how it is migrated, and what happens when it is
unreachable. The result is a working schema and three repositories *still injected and memory-only* —
the service is proven against Better Auth's memory adapter and cannot yet run against the real thing.

There is also a live temptation to reach for something else — SQLite for simplicity, DynamoDB for the
relay, Supabase for the dashboard — and each of those is a second source of truth unless this ADR says
otherwise.

## Decision

**One Postgres database holds the whole control plane. Document content never enters it.**

1. **What lives there.** Better Auth's own tables (`user`, `session`, `account`, `verification`,
   `organization`, `member`, `invitation`, `passkey`, `twoFactor`), ours (`workspaces`,
   `organization_licences`, and whatever replaces `invite_keys`), billing (`billing_event`,
   `billing_customer`), and the audit trail. That is identity, membership, entitlement and money.
2. **What must never live there.** A `.loro` snapshot, an attachment's bytes, or a rendered projection.
   Documents are opaque blobs that belong to the document store; putting them here would make every
   backup a copy of every customer's content, make the control plane the slowest thing in the product,
   and quietly undo the local-first promise by making content reachable wherever the control plane is.
   The one exception is metadata *about* a document — its size, its counts — which is already what the
   licence records.
3. **One connection string per deployment, and a fallback that says so.** `SUITE_AUTH_DATABASE_URL` is
   the control plane; `SUITE_BILLING_DATABASE_URL` may point at it and falls back to it, because they
   are the same database and asking for the string twice is how two environments drift.
4. **`pg` and SQL, no ORM.** Better Auth takes a `pg` `Pool` directly; our repositories are SQL next to
   the interface they implement. The schema is checked in (`sql/0001…0003`) and a migration is run
   deliberately, never at boot: a service that migrates itself on start-up turns a rollback into a
   restore.
5. **Every durable store is one write, not read-then-write.** `INSERT … ON CONFLICT` is the primitive:
   event claims (ADR-0069), workspace claims (ADR-0065 §2) and seat checks all rely on the conflict
   clause rather than on a read the other container cannot see.
6. **Pools are small, module-scoped, and owned by whoever built them.** A Lambda or a relay holds one
   pool for its lifetime (`max` in the single digits); `close()` exists and is called on shutdown. RDS
   Proxy is the answer if invocation rates ever outgrow that.
7. **The relay keeps its own small store.** Its licence claims are SQLite (`SUITE_LICENCE_DB`), and that
   is deliberate: the relay verifies a signed token offline, so it must be deployable without a
   database connection at all. It is not part of the control plane and does not need to be.
8. **Unreachable means refused, loudly.** A control-plane outage must produce an obvious error, never a
   quiet fallback to memory: a fallback would mint licences twice, forget claims, and — worst — read an
   account request as anonymous.
9. **Row-level security is not the access control here.** Authorization is `capabilitiesForRole` in the
   service, on a connection the service owns. RLS would be a second, weaker copy of one decision, and
   the relay never connects to this database in the first place.
10. **Backups are the durability story.** "Real money needs the durable store" means point-in-time
    recovery is configured and a restore has been rehearsed, not that an environment variable is set.

## Consequences

- **One place to join.** "Which organizations are over their workspace ceiling", "who is on a trial that
  expired", "which workspaces has this person lost access to" are queries, not exports.
- **One transaction for anything that must not half-happen** — issuing a licence, adopting an anonymous
  organization, redeeming an invitation.
- **One thing to run**: one backup, one restore drill, one migration story, one connection budget. A
  second managed service for two tables is a second incident surface.
- **The repositories become real.** `LicenceStore`, `MembershipReader` and `WorkspaceRepository` stop
  being injected mocks and gain Postgres implementations; that is the work this ADR unblocks.
- **Postgres is a dependency of every hosted request.** A control-plane outage takes sign-in with it,
  though not editing: local-first means a reader keeps working while we are down. That asymmetry is the
  point and should be said out loud rather than discovered.
- **Cost risk**: connection storms from serverless are a real failure mode, mitigated by the pool rules
  in item 6 and by RDS Proxy when they are not enough.
- **Risk: the schema drifts from Better Auth.** Mitigated by `pluginSchema.test.ts`, which asserts the
  columns against Better Auth's own table output, and by migrations that are additive-first.

## Rejected alternatives

- **SQLite as the control plane.** Fine for the relay's claims and for tests; wrong for a hosted
  multi-tenant service that needs concurrent writers, PITR and network access from several processes.
- **DynamoDB for everything.** Rejected in ADR-0069's amendment: no joins, no transactions across
  entities, and entitlement would live twice.
- **Documents in the same database** (a `document_bytes` column). Makes every backup a copy of every
  customer's content and makes the control plane the hot path for editing.
- **An ORM or query builder.** Adds a dependency and a second way to express SQL for a schema that is
  checked in and small; Better Auth already takes the pool directly.
- **Boot-time migrations.** Convenient until two instances race, or until a bad migration needs a
  restore instead of a rollback.
- **Row-level security as the tenant boundary.** Our authorization is already one function; RLS would
  duplicate it in a place the service does not read.
