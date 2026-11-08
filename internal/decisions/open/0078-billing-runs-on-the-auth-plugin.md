# ADR-0078: Billing runs on the auth plugin

- Status: proposed
- Date: 2026-10-26
- Related: [ADR-0069](0069-billing-runs-on-the-stripe-plugin.md) (the record this replaces), [ADR-0075](0075-hosted-entitlement-is-minted-from-the-subscription.md) (the entitlement read that survives), [ADR-0073](0073-the-control-plane-is-a-separate-process.md) (where it runs)
- Shipped: nothing of the decision. The hand-written path is live: checkout
  (`services/billing/src/stripe/checkout.ts`), the webhook handler
  (`services/billing/src/handler/handler.ts`) and the Postgres store
  (`services/billing/src/store/postgres.ts`).
- Remaining: installing `@better-auth/stripe` with `customerType: "organization"` and the organization
  id as `referenceId`, moving the tier table to `plans[].limits`, deleting the custom handler, checkout,
  event verification and store, and pointing the Stripe CLI at `/api/auth/stripe/webhook`.

## Decision

`@better-auth/stripe` owns the customer, checkout, the portal, the webhook, subscription lifecycle,
trials and team seats. Checkout is `POST /subscription/upgrade`, the portal is
`POST /subscription/billing-portal`, and the endpoint is `/api/auth/stripe/webhook`. The custom
handler, checkout, event verification and store in `services/billing` are deleted rather than
maintained in parallel. Two things survive: the tier-to-limits table, which becomes the plugin's
`plans[].limits`, and the entitlement read that mints the token (ADR-0075).

## Rejected alternatives

- Keep our handler and take the plugin for checkout only. Two paths write subscription state, and the
  plugin's lifecycle events would fight the rows our webhook writes.
- Keep our handler and skip the plugin. That means owning signature verification, idempotent event
  claims, trials and seat proration, which is the set of code this decision deletes.
- Run the plugin inside the relay. Billing needs Postgres and a session; the relay holds neither
  (ADR-0073).

## Consequences

- One source of subscription state, and the plugin's table is the audit trail.
- Our Ed25519 issuer stops being the hosted proof; a signed licence file is a self-host path only
  (ADR-0075).
- Deleting `services/billing` deletes its tests with it, so the surviving coverage is the entitlement
  read and the tier table.
- A plugin upgrade becomes a dependency bump instead of a change we control.
