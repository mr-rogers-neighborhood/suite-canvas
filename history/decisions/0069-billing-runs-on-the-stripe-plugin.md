# ADR-0069: Billing runs on the Stripe plugin, and the licence token stays our proof

- **Status:** proposed
- **Date:** 2026-10-25
- **Related:** [ADR-0065](./0065-accounts-own-workspaces.md) (an organization owns many workspaces), [ADR-0067](./0067-the-account-is-the-identity.md), `docs/billing.md`, `services/billing/`, `apps/collab-server/src/licence.ts`

## Context

`services/billing` was built by hand: its own Stripe `fetch` calls, its own webhook with signature
verification, its own event-dedupe store, its own `STRIPE_PRICE_TIERS` table, and an Ed25519 licence
token the relay verifies **offline**. A Checkout and a Portal route were added on top.

Three problems have accumulated.

1. **The customer is created by the checkout, not by the account.** `docs/billing.md` says it plainly:
   a second checkout by the same person makes a second Stripe customer and therefore a second licence
   id. That caveat exists only because there was no account to attach a customer to.
2. **The same facts live in three places.** Price table in an env var, subscription state in Stripe,
   entitlement in a signed token — and the webhook is the only thing keeping them in step.
3. **The relay cannot ask.** Verifying the licence locally is the whole reason a sync connection never
   touches a second service, so whatever replaces the webhook must still end in a signature.

[ADR-0065](./0065-accounts-own-workspaces.md) settled *who* pays: an organization, with the licence's
`workspaces` field as a ceiling. What it did not settle is what owns the subscription state.

## Decision

**`@better-auth/stripe` owns subscription state; our Ed25519 issuer turns that state into the relay's
proof.**

1. **The plugin is the source of truth for subscriptions.** `customerType: "organization"` with
   `referenceId` set to the organization id, so organisation-billed subscriptions are first class. The
   plugin enforces **one active or trialing subscription per reference id**, which is exactly the
   invariant we would otherwise have to write.
2. **Customers attach to the account, not to a checkout.** `createCustomerOnSignUp` means a second
   purchase updates a customer instead of creating a second one, and the "one checkout, one customer"
   caveat in `docs/billing.md` is deleted rather than documented.
3. **Plan `limits` are the licence fields.** `workspaces`, `documentBytes` and `attachmentBytes` are
   defined once, in the plan configuration, and read by the issuer. The signed token stops being a third
   definition of entitlement and becomes a *transport* for it.
4. **`authorizeReference` is `capabilitiesForRole`.** Only an organization owner or admin may start,
   change or cancel a subscription. The rule lives in one function, with the rest of the capability
   matrix.
5. **The Ed25519 licence token survives, and its issuer reads subscription state.** One webhook (the
   plugin's, at `/api/auth/stripe/webhook`) feeds one issuer. Our webhook, its event store and
   `STRIPE_PRICE_TIERS` are **deleted**. The relay keeps verifying a signature offline.
6. **The issuer is provider-agnostic by construction.** It consumes a `SubscriptionState` value object —
   reference id, status, plan, seats, limits, period end — not a Stripe session. Stripe is the first
   adapter, not the shape. This is why **Paystack is deferred rather than excluded**: it is a second
   processor with its own region and webhook, not a rewrite, and its seat enforcement (hooking
   `member.create`/`invitation.create`) confirms where our gate already lives.
7. **Seats are organization members, capped by the purchased quantity.** `beforeAddMember`,
   `beforeAcceptInvitation` and `better-enrollment`'s pending-invite reservation are the only gate; a
   purchase raises the ceiling, it does not add people.
8. **Test mode remains the default, and real money remains gated on the durable store.** The response
   still reports `mode` and still carries the non-durable warning, so a surface can refuse to present a
   live checkout on an in-process store.

## Consequences

- **Duplicate customers and duplicate licence ids stop being possible**, because a customer belongs to
  an organization rather than to a browser that happened to check out.
- **One webhook, one issuer, one definition of a limit.** The env table, the event store and the
  hand-rolled signature check disappear.
- **The relay stays offline.** Nothing about this decision makes a sync connection depend on the auth
  service being reachable.
- **A migration is required, not a refactor**: the Stripe SDK arrives, subscription state moves into the
  auth database, and existing licence claims must survive it. Existing paid subscribers (if any) need
  their customers reattached by `referenceId`.
- **Risk: entitlement now depends on the auth service's database.** Mitigated by the token's TTL: a
  licence keeps working until it expires even if the issuer is down, which is the same failure mode as
  today.
- **`limits` become a shared vocabulary** between billing, the issuer and the relay. Adding a limit
  means adding it in one place, which is a discipline the old three-place arrangement could not enforce.

## Rejected alternatives

- **Keep the hand-rolled webhook** and only adopt the customer creation. Leaves two definitions of a
  subscription and one more year of writing Stripe plumbing.
- **Let the relay ask the auth service on every connection.** Loses offline verification, couples sync
  availability to the auth service, and turns a licence into a network dependency.
- **Drop the signed token and read limits from the database at the edge.** Same loss, plus the relay
  needs database credentials it should never have.
- **Adopt Paystack as a second provider now.** Two processors, two webhooks, two subscription models, for
  a market we are not selling into yet. The issuer's shape keeps the door open at no cost.
- **Let `@better-auth/stripe` also mint the licence.** It would put our signing key inside a third-party
  plugin's hook path, and couple the relay's proof to a library's internals.

## Amendment — 2026-10-25: one control plane, so DynamoDB goes

The decision above removes the billing store's reason to exist, and that is worth stating rather than
discovering during the migration.

**What DynamoDB does today, and nothing else does.** `services/billing/store-dynamodb.ts` is the only
DynamoDB code in the repository. It holds two things: event-claim rows (webhook idempotency) and the
`LicenceRecord` per customer. The relay does **not** use it — its licence claims live in SQLite
(`SUITE_LICENCE_DB`, `:memory:` by default) — and documents never touch it.

**What replaces both jobs.**

- *Event claims* were idempotency for our webhook. The webhook is deleted; the plugin's is the only
  one, and it keeps its own state.
- *Subscription state* moves into the auth database (item 1 above).
- *A record of issued licences* remains genuinely useful — an audit of who was signed what and until
  when — and it belongs beside the subscription it derives from, in one transaction:
  `INSERT ... ON CONFLICT DO NOTHING` gives the same conditional-write guarantee DynamoDB was used for,
  in the same transaction that reads the subscription.

**Decision: one Postgres control plane** holds accounts, organizations, memberships, invitations,
subscriptions, licence records and workspace rows. `store-dynamodb.ts` and the
`SUITE_BILLING_STORE=dynamodb` switch are deleted with our webhook.

Reasons, in the order they matter:

1. **No dual write.** Issuing a licence is read-subscription-then-write-record; in one database that is
   one transaction. Across two stores it is a failure mode where the customer paid and holds nothing.
2. **Joins that ops will ask for.** "Which organizations are over their workspace ceiling", "who is on
   a trial that expired" — one query, not an export.
3. **One thing to run.** One backup, one restore drill, one migration story, one connection budget.
   A second managed service for two tables is a second incident surface.
4. **The gate stops lying.** "Real money needs the durable store" currently means "set an env var". It
   becomes "Postgres is reachable and backed up", which is a property of the deployment rather than a
   flag someone can forget.

Accepted costs, stated plainly: a Lambda holding a `pg` pool needs module-scope reuse and a small
`max` (or RDS Proxy) to avoid cold-start connection storms, and Postgres has to be reachable from the
billing function at all — a network boundary DynamoDB did not have. Both are ordinary operational
concerns with known answers; two sources of truth for entitlement is not.

**What still may not move:** if the relay is ever deployed as a stateless edge with no database, its
licence claims stay local (SQLite now, a key-value store then). That is a relay decision, and it does
not need billing's cooperation because the token is verified offline.
