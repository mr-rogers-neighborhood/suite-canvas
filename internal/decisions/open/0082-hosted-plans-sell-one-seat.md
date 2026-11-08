# ADR-0082: Hosted plans sell one seat

- Status: partial
- Date: 2026-10-26
- Related: [ADR-0078](0078-billing-runs-on-the-auth-plugin.md) (the plugin whose quantity this reads), [ADR-0075](0075-hosted-entitlement-is-minted-from-the-subscription.md) (the entitlement the licence row is written from), `services/billing/src/stripe/tiers.ts`, `services/billing/src/licence/projection.ts`, `services/auth/src/organizations/seats.ts`, `docs/reference/billing.md`
- Shipped: `seats` is a field on the tier table and in `deploy/stripe/fixtures.json`, `planList` refuses a plan that declares more than one, the licence row's `seats` follows the subscription quantity floored at the free tier's one seat, a quantity that is not a whole count is read as absent, and the plans are named `solo` and `solo-pro` with the one-seat limit stated on the site.
- Remaining: a plan that admits a team, which needs a per-seat price, a checkout that buys seats ahead of the people, and an admission rule that spends a purchased seat instead of comparing against the current headcount.

## Decision

Both hosted plans sell one seat, and the names say so: `solo` and `solo-pro`. The seat count
is a declared number in the tier table rather than something that happens because no price
was configured, and a table that declares more is refused when the plugin is built. A
second member of a paying organization is refused with `seat-refused` and
`reason: seat-allowance-exhausted`, which is a named answer rather than a silent one, and
the site says so next to the plan table.

## Rejected alternatives

- Configure `seatPriceId` on both plans now. `@better-auth/stripe` writes
  `subscription.seats` from the organization's member count for a plan that carries a seat
  price, and the licence projects that number into a ceiling that `checkSeatAllowance`
  compares the member count against. Quantity and ceiling are one number, so the join that
  would raise the quantity is the join the ceiling refuses: the plan bills per head and
  admits an owner. Seat pricing needs a purchased quantity above the headcount, which is a
  change to the admission rule in `@suite/auth` and not to billing alone.
- Buy seats by multiplying the plan price, passing `seats` in the upgrade body. The plugin
  supports it and a third member is then refused, but the buyer types the quantity, there
  is no per-seat price in the table, and $49 for one person against $98 for two is a
  pricing decision nobody took. The plans would also keep team-shaped names.
- Leave the names alone and defer. A buyer reads "Studio" on the Checkout page and buys a
  team plan that admits one person, which is the dishonesty this record removes.

## Consequences

- A team cannot buy a plan that seats it yet. That is stated on the site, in the billing
  reference and in the refusal a second member receives, rather than discovered after paying.
- The plan names lose the implication of a shared room. `studio` becomes `solo-pro`, so its
  lookup key changes and an existing `STRIPE_PRICE_TIERS` has to be regenerated; hosted
  subscriptions are not on sale yet, so no live row needs migrating.
- A subscription row that still says `studio` reads as `free`, because the tier left the
  table. A deployment that sold it must re-checkout rather than deploy this unchanged.
- Seat pricing becomes a feature with a cost: a price per seat, a quantity the buyer chooses
  or the plan includes, and an admission rule that treats a seat as something bought. The
  deferred work is written here so the next reader does not try to fix it with configuration.
