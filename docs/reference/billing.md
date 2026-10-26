# Billing and licences

Billing is `@better-auth/stripe` registered on the auth instance (ADR-0078). The plugin
owns the Stripe customer, Checkout, the billing portal, the webhook, the subscription row,
trials and seat sync. This repository supplies the plan list, the organization rule and the
entitlement read.

A licence is a signed token you paste into a workspace that runs a hosted relay. Local
editing never consults it, and self-hosting needs no key at all. Since ADR-0075 the hosted
proof is the session JWT the auth instance signs, so the Ed25519 licence file is the
self-host path only.

## What the plugin owns

The plugin is registered inside the auth instance, so its routes sit under `/api/auth/*`
and the auth module answers them. The control plane mounts that module for the prefix and
mounts the billing module for `/api/billing/*`; neither duplicate the other.

| Route | Method | Job |
| --- | --- | --- |
| `/api/auth/subscription/upgrade` | `POST` | Checkout for a plan |
| `/api/auth/subscription/billing-portal` | `POST` | Stripe's own portal |
| `/api/auth/subscription/cancel`, `/restore` | `POST` | End or resume a subscription |
| `/api/auth/subscription/list` | `GET` | The live subscription for a reference |
| `/api/auth/stripe/webhook` | `POST` | Every Stripe event, signature verified by the plugin |
| `/api/billing/entitlement` | `POST` | `{ tier, limits }` for an organization |
| `/api/billing/plans` | `POST` | The plan catalogue with its limits |

`services/billing` contains `createBillingPlugin` (the plugin options), the tier table and
the entitlement read. The hand-written webhook handler, checkout call, signature check,
event claim, Postgres store, licence issuer and SES mailer that used to do this work are
deleted rather than kept beside the plugin. Two paths writing subscription state is the
failure this decision removes.

## The organization is the customer

A subscription belongs to an organization, because a workspace is owned by one and seats
come from its member rows. Checkout therefore sends `customerType: "organization"` and a
`referenceId` holding the organization id, and the plugin stores that id on the
`subscription` row.

The plugin defaults `customerType` to `user`, which would bill an individual and put
subscription state outside the tenant. Two callbacks close that:

- `authorizeReference` asks the deployment whether the signed-in account administers the
  referenced organization, on checkout, the portal, cancel and restore.
- `getCheckoutSessionParams` refuses a checkout whose reference the account does not
  administer, and writes the organization id onto the Checkout Session as
  `client_reference_id` and `metadata.organizationId` so the Stripe dashboard names the
  same tenant support does.

`organization: { enabled: true }` is what gives an organization its own Stripe customer.
The plugin also hooks the organization plugin: a rename updates the customer, a member
change syncs the seat quantity when the plan carries `seatPriceId`, and deleting an
organization with a live subscription is refused.

## Plans and limits

`STRIPE_PRICE_TIERS` maps price ids onto tiers, and the plugin receives it as its static
plan list. Nothing else holds a limit: the plugin's `plans[].limits`, the entitlement read
and the deployment's configuration all come from this one table.

```json
{
  "price_1PAbCdEfGhIjKl": { "tier": "solo", "workspaces": 3, "documentBytes": 268435456, "attachmentBytes": 1073741824 },
  "price_1PAbCdEfGhIjKm": { "tier": "studio", "workspaces": 25, "documentBytes": 2147483648, "attachmentBytes": 8589934592 }
}
```

The plugin sells one plan per tier name. Two prices naming one tier, as a monthly and an
annual do, collapse to the first price in the table. A price missing from the table is a
configuration failure: the customer paid, so the deployment has to be fixed rather than
granting a free plan.

## The entitlement read

`POST /api/billing/entitlement` takes `{"organizationId":"org_1"}` and answers
`{"tier":"solo","limits":{"workspaces":3,"documentBytes":268435456,"attachmentBytes":1073741824}}`.
It reads the plugin's `subscription` row and the tier table, and calls Stripe for nothing:
a payment provider outage must not stop hosted sync for customers who already paid.

| Subscription status | Answer |
| --- | --- |
| `active` | the plan's tier and limits |
| `trialing` | the plan's tier and limits |
| `past_due` | the plan while `periodEnd` is in the future, then `free` |
| `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused` | `free` |
| no row for the organization | `free` |
| a status a later Stripe version adds | `free` |

A cancelled subscription answers `free` on the next read. The row is the evidence, and a
session token lives five minutes, so a wrong answer there is free service for as long as
the customer keeps minting.

`active` with `cancelAtPeriodEnd` set stays on the plan: the period is already paid, and
the row turns `canceled` when it ends. `past_due` keeps the plan only until `periodEnd`,
which bounds the grace window to the period Stripe last collected for.

## The free tier and the licence row

The entitlement read answers `free` for an organization with no live subscription, and the
seat check reads a different row to decide what that organization may hold:
`organization_licences` in the control-plane database. The two agree about the tier label,
and the licence row is the one with numbers on it.

Every organization starts on the free tier. Migration `0009_free_licence_provisioning.sql`
puts a trigger on `organization` that writes the licence row in the same transaction, so an
organization and its licence appear together or not at all. The ceilings are
`FREE_LICENCE_TIER` in `services/auth/src/organizations/freeTier.ts`: one workspace, one
seat (the owner), 64 MiB per document and 8 MiB per attachment, for a hundred years.
`pnpm db:verify` compares the row the trigger writes with that object.

That row is a default, and it is replaced rather than joined. `organization_licences` is
keyed by `organization_id`, so one organization holds exactly one licence: a second row
that would outrank the free one cannot exist.

### The projection

`@better-auth/stripe` is the only writer of the `subscription` row, so its lifecycle hooks
are the only notification that a subscription changed. `createLicenceProjection`
(`services/billing/src/licence/projection.ts`) is called from `onSubscriptionCreated`,
`onSubscriptionComplete`, `onSubscriptionUpdate` and `onSubscriptionDeleted`, and
`apps/control-plane/src/modules/auth-billing.ts` is where it is built: the one file that
knows both packages, because the free tier's numbers live in `@suite/auth` and the write
lives in `@suite/billing`.

The decision is not a second policy. Both sides call `entitlementFor`: the token is minted
from it and the licence row is written from it, so the tier a seat check enforces and the
tier a token carries are the same value for the same organization at the same moment. Each
status lands on one row:

| Subscription status | Licence row written |
| --- | --- |
| `active` | the plan's tier, its workspace and byte limits, `expires_at` = `periodEnd` |
| `trialing` | the same: a trial is inside a period Stripe will bill |
| `past_due`, `periodEnd` in the future | the plan, expiring at `periodEnd`: the grace window is bounded by the period Stripe last collected for |
| `past_due`, `periodEnd` passed | the free row |
| `canceled`, `paused`, `unpaid`, `incomplete`, `incomplete_expired` | the free row |
| no subscription row | the free row |
| a status a later Stripe version adds | the free row |

A lapsed subscription falls back to the free row rather than deleting it: a lapsed account
loses the plan and keeps its data, where a missing row would read as
`licence-unprovisioned` (a provisioning fault no upgrade fixes) and a workspace nobody can
reach. The fallback row is byte-for-byte the row the trigger writes, `free:<org>` and
all, so "downgraded" and "never subscribed" are the same state.

`seats` is the subscription's seat quantity, never below the free tier's one seat: a plan
that sells no seats still admits the owner it always admitted. Per-seat billing is what
makes that number larger; the plugin syncs the quantity from member rows when a plan carries
a `seatPriceId`.

Two limits are worth stating rather than hiding:

- **The hooks fire on Stripe's events, not on a clock.** A `past_due` subscription whose
  period runs out with no further event keeps a paid row until one arrives. That row's
  `expires_at` is the period end, so the seat check refuses at the same instant instead of
  granting the plan indefinitely, and the next event rewrites it.
- **A failed write is logged, not retried.** The plugin catches a hook's error and answers
  the webhook `200`, so `composeBilling` reports the failure through its logger and the
  following lifecycle event repairs the row.

A missing licence row is therefore a fault and not a customer state: `services/auth`
reports it as `licence-unprovisioned`, which says the row was never provisioned. A free
organization that has spent its seat reports `seat-allowance-exhausted`, which is the answer
a plan fixes.

The read answers `free` with empty limits when the plan name is not in the table. Limits
come from configuration, so a table edited under a live subscription loses caps rather
than failing every token mint.

## Environment

| Variable | When | Meaning |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | always | Secret or restricted key. Absent, the deployment mounts no billing plugin |
| `STRIPE_WEBHOOK_SECRET` | always | Endpoint secret (`whsec_…`) printed by `stripe listen`; never logged |
| `STRIPE_PRICE_TIERS` | always | The tier table above, as JSON keyed by price id |
| `SUITE_CONTROL_PLANE_DATABASE_URL` | entitlement read | The one Postgres holding `subscription` (ADR-0070) |
| `SUITE_CONTROL_PLANE_PORT` | local runs | Listener port, `1236` by default |
| `SUITE_LICENCE_PUBLIC_KEY` | self-host relay | The key that verifies a signed licence file |

`/api/billing/*` answers `503` with `not-configured` when the tier table or the database
URL is missing, and logs which one once.

## Local Stripe

[The local Stripe page](../../deploy/stripe/README.md) has the full sequence. The short
form, all in test mode:

```sh
stripe login
pnpm stripe                     # creates the fixture prices, prints the environment
pnpm --filter @suite/control-plane dev
pnpm stripe --listen            # forwards to localhost:1236/api/auth/stripe/webhook
```

`pnpm stripe` reads the test key `stripe login` stored and creates each fixture price once.
The forwarder prints the webhook secret the control plane needs. A checkout with test card
`4242 4242 4242 4242`, then a read of `/api/billing/entitlement`, is the whole loop.
`pnpm stripe --clock` creates a Stripe test clock for a renewal or a cancellation without
waiting a month.

## Keys and rotation

The hosted proof is the session JWT. Its signing key lives in the auth database and is
published as a key set at `/api/auth/jwks`, so the relay verifies a token against whatever
keys the plugin currently signs with and rotation there is the plugin's own.

The Ed25519 licence key covers the self-host path. Generate and sign with the relay's
operator CLI:

```sh
pnpm --filter @suite/collab-server licence generate-keypair --out ./licence-private.pem
pnpm --filter @suite/collab-server licence sign --key ./licence-private.pem \
  --tier hosted --workspaces 25 --document-bytes 5242880 --attachment-bytes 26214400 --days 365
```

Rotation of that key is a hard cut. `SUITE_LICENCE_PUBLIC_KEY` holds one key and
`verifyLicence` takes one key, so there is no overlap window: from the moment a relay is
given a new public key, every token signed with the old private key fails with
`bad-signature`. The consequence is that hosted sync refuses those licences until each one
is re-signed, and no document is lost, because local editing never consults a licence.
Rotate on a compromise, accept that window, or wait for a period boundary and re-sign every
active licence in one pass. A two-key grace period would change `packages/licence` to take
a key set, and that is not implemented.

## Cancellation

Cancelling through the portal sets `cancelAtPeriodEnd` and leaves the row `active`. The
period is paid, so the tier holds until `periodEnd`, and the entitlement read keeps granting
it until the row turns `canceled`. Cancelling immediately turns the row `canceled` and the
next read answers `free`.

Nothing pushes a revocation to the relay. A session token is valid for five minutes, so a
cancellation takes effect at the next mint, at most that long after the webhook lands.
Share links keep resolving as read-only projections, no document is deleted, and every
device keeps editing its local copy.

## Deployment

| Piece | Configuration |
| --- | --- |
| Control plane | The auth module with `createBillingPlugin`, plus the billing module; `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_TIERS` |
| Postgres | The control-plane database: the plugin's `subscription` row is the record of what is paid |
| Stripe webhook | `https://<control-plane>/api/auth/stripe/webhook`, subscribed to the subscription and invoice events |

The plugin creates its own tables. Migration `0003_billing.sql` in `services/auth/sql`
declared `billing_event` and `billing_customer` for the retired hand-written billing
function; `0008_drop_billing_tables.sql` drops both, so the `subscription` row is the only
record of what is paid.
