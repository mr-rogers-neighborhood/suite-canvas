# ADR-0069: Billing runs on the Stripe plugin

- Status: superseded
- Superseded by: [ADR-0078](0078-billing-runs-on-the-auth-plugin.md), which deletes the issuer this record keeps as the relay's proof and leaves a signed licence file to self-hosting ([ADR-0075](0075-hosted-entitlement-is-minted-from-the-subscription.md))
- Date: 2026-10-25
- Shipped: our Ed25519 licence issuer and the billing service around it — checkout, webhook event
  handling, SES delivery, tier table, Postgres licence records (`services/billing/src/`).
- Remaining: `@better-auth/stripe` itself, plan `limits` as the single definition of entitlement,
  customer-on-sign-up, and one webhook replacing ours.
- Full text: [archive](../../../../history/decisions/0069-billing-runs-on-the-stripe-plugin.md)

## Decision

`@better-auth/stripe` will own subscription state, with `customerType: "organization"` and the
organization id as `referenceId`, while our Ed25519 issuer turns that state into the relay's offline
proof. The issuer consumes a `SubscriptionState` value object, so Stripe is the first adapter rather
than the shape.

## Consequences

- One active subscription per organization is the plugin's invariant, not ours to write.
- The relay keeps verifying a signature offline and never calls the auth service per connection.
- Plan limits become the licence fields instead of a third definition of entitlement.
- Until the plugin lands, our webhook remains the only path and `STRIPE_PRICE_TIERS` the only table.

## Settled 2026-10-26

[ADR-0078](0078-billing-runs-on-the-auth-plugin.md) keeps the first half of this record, that
`@better-auth/stripe` owns subscription state with `customerType: "organization"`, and reverses the
second: our Ed25519 issuer is not the relay's hosted proof. The plugin's table is read when the session
token is minted ([ADR-0075](0075-hosted-entitlement-is-minted-from-the-subscription.md)), and a signed
licence file is a self-host path only.
