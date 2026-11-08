# ADR-0070: One Postgres control plane

- Status: partial; the process boundary is settled by [ADR-0073](0073-the-control-plane-is-a-separate-process.md) and the relay's reads by [ADR-0074](0074-the-relay-verifies-a-session-jwt-against-jwks.md)
- Date: 2026-10-25
- Shipped: the control-plane schema (`services/auth/sql/0001`–`0005`), the `pg` pool and repositories in
  `services/auth/src/store/postgres.ts`, and the Postgres billing store.
- Remaining: a migration runner and a deployed database, and relay seat reads that come from it.
- Full text: [archive](../../../../history/decisions/0070-one-postgres-control-plane.md)

## Decision

One Postgres database holds identity, membership, entitlement, money and the audit trail, and document
content never enters it. A `.loro` snapshot, an attachment's bytes or a rendered projection stays in the
document store; only metadata about a document may live beside the licence.

## Consequences

- One connection string per deployment, with billing falling back to the auth database.
- Backups of the control plane never become copies of every customer's content.
- The relay needs no database credentials, so its offline licence check survives.
- A control plane that is unreachable blocks sign-in, not editing.

## Settled 2026-10-26

- The process boundary: [ADR-0073](0073-the-control-plane-is-a-separate-process.md) puts this database
  behind a control plane, which is the only process that depends on `pg`.
- The relay's seat reads: [ADR-0074](0074-the-relay-verifies-a-session-jwt-against-jwks.md) answers
  them from a verified token, so the relay reads no identity table and the remaining work here is the
  migration runner and a deployed database.
