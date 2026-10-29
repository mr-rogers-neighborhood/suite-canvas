# Billing and licences

Billing is `@better-auth/stripe` registered on the auth instance (ADR-0078). The plugin
owns the Stripe customer, Checkout, the billing portal, the webhook, the subscription row,
trials and seat sync. This repository supplies the plan list, the organization rule and the
entitlement read.

**Who can buy is a separate question from what buying unlocks.** Today an account is created by the
sign-up form and a plan is bought afterwards; ADR-0083
records the door that replaces it: anonymous Checkout, then the account, organization and membership
created from the completed session, and lists what is still missing. Until that lands, the plan
surface below is reachable only by an existing account, and the sync refusal is what tells a reader
that a plan is the next step.

A **promotional code** is a Stripe coupon, not a licence grant. Checkout is created with
`allow_promotion_codes`, so the field appears on Stripe's own page and an operator makes a percentage
or 100% discount in the dashboard. This process holds no second table describing what somebody paid,
which is the same reason ADR-0078 deleted the hand-written store.

### A checkout that costs nothing

Two session parameters decide whether a free plan still asks for a card, and both live in
`getCheckoutSessionParams` in `services/billing/src/stripe/plugin.ts`:

| Parameter | Value | Why |
| --- | --- | --- |
| `payment_method_collection` | `if_required` | Stripe asks for a card only when the amount due is above zero, so a fully discounted first invoice goes through without one |
| `discounts` **or** `allow_promotion_codes` | one coupon id, or the field | Stripe refuses both on one session, so `billing.checkout.coupon` (`STRIPE_CHECKOUT_COUPON`) chooses: a coupon applies to every checkout with nothing to type, and an empty value leaves the code field |

Setting the coupon is one request from the dashboard, and clearing the row brings the code field
back:

```sh
stripe coupons create --percent-off 100 --duration forever --id alpha-free
```

The catch has to be stated, because it is the difference between a free launch and a paying one: a
subscription that collected no payment method has nothing to charge when the discount stops applying.
Its renewal fails, Stripe marks it `past_due` and then `canceled`, and the licence read answers `free`
at the next token mint. A coupon with `--duration forever` keeps working; a three-month launch coupon
becomes a three-month trial with no card to convert.

`POST /admin/settings/billing/verify` checks the coupon in the mode being verified, next to the
prices. A coupon made in test mode does not exist in live, which is the same trap as a copied price
table and fails at a customer's checkout rather than at the switch.

### Handing out a free plan

A **coupon** is the discount; a **promotion code** is the string somebody types to claim it. Making
the coupon reachable without a field on every checkout is two objects and no code here:

```sh
stripe coupons create --percent-off 100 --duration forever --id friends-and-family
stripe promotion_codes create --coupon friends-and-family --code FRIENDS
```

With `billing.checkout.coupon` empty, Checkout carries the code field, so `FRIENDS` is redeemed on
Stripe's page and nothing is charged. A redemption limit and an expiry belong on the promotion code
(`--max-redemptions`, `--expires-at`), not in this process, which is the same reason the tier table
holds price ids and no prices.

The alpha deployment carries `suite-alpha-free` (100% off, forever) and the code `SUITE-ALPHA` in
both universes, as a working example of that pair.

A licence is a signed token. A self-hosted relay reads one from `SUITE_LICENCE` and verifies it
at boot (ADR-0081);
a hosted relay reads none, because its proof is the session JWT the auth instance signs
(ADR-0075). Local editing consults neither.

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

That is why the operator panel's **Subscriptions** view reads the `subscription` table and
shows one row per organization: there is no per-workspace plan to look at, and a plan is
changed by the organization itself through the billing portal on its Plan tab, not by an
operator. The view is read-only, because ending somebody's subscription is a billing write
with their money behind it.

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
  "price_1PAbCdEfGhIjKl": { "tier": "personal", "seats": 1, "workspaces": 3, "documentBytes": 268435456, "attachmentBytes": 1073741824 },
  "price_1PAbCdEfGhIjKm": { "tier": "organization", "seats": 1, "workspaces": 25, "documentBytes": 2147483648, "attachmentBytes": 8589934592 }
}
```

The plugin sells one plan per tier name. Two prices naming one tier, as a monthly and an
annual do, collapse to the first price in the table. A price missing from the table is a
configuration failure: the customer paid, so the deployment has to be fixed rather than
granting a free plan.

`seats` is how many people the plan admits, the owner included. `seats` is not part of
`limits`: the relay enforces the three caps against a document, and a seat count bounds
member rows, so the two numbers have different readers.

## Seats in v1: one per plan

Both hosted plans sell one seat, so an organization on a paid plan has its owner and no
second member. `personal` is $9 a month and `organization` $24, and **Organization buys
capacity, not people**: 25 workspaces and 2 GiB of documents, still for one person. The site
says so where a buyer reads the price, because a plan called "Organization" that admits one
member has to be honest about what it is selling (ADR-0082).

The number is enforced, not asserted. `planList` refuses a table that declares more than
one seat, because there is no per-seat price to charge for the rest:

```
plan "team" sells 2 seats, and this build sells 1: there is no per-seat price to charge
for the rest (ADR-0082)
```

`@better-auth/stripe` writes `subscription.seats` from the member count for any plan that
carries a `seatPriceId`, and `licenceRowFor` copies that quantity into
`organization_licences.seats`, which `checkSeatAllowance` treats as a ceiling on the
organization's members. Quantity and ceiling are then the same number, so the join that
would raise the quantity is the join the ceiling refuses. Seat pricing needs a purchased
quantity above the current headcount, and that is a change to the admission rule in
`@suite/auth` as much as to this service.

## The entitlement read

`POST /api/billing/entitlement` takes `{"organizationId":"org_1"}` and answers
`{"tier":"personal","limits":{"workspaces":3,"documentBytes":268435456,"attachmentBytes":1073741824}}`.
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

## The catalogue

`POST /api/billing/plans` answers the price list and the mode that produced it:

```json
{"mode":"test","plans":[{"tier":"personal","priceId":"price_…","limits":{"workspaces":3,…}}]}
```

Four fields, and every one of them has been a bug when it was missing. `tier` is the
identifier checkout takes, because it is the plan name the Stripe plugin was built with;
`priceId` is Stripe's, so no client hardcodes a price; `limits` is the tier table the relay
will enforce; and `mode` is what lets a surface say whether these are test cards. The table
is read from the **active** mode (`STRIPE_PRICE_TIERS` in test, `_LIVE` in live), because a
test price id in a live checkout opens nothing.

The canvas reads the same body through `listPlans` in `apps/canvas/src/auth/billing.ts`. It
once read only `name`, dropped every plan, and reported an empty catalogue with `ok: true`,
which is how a deployment selling two plans showed none; both sides now assert one fixture
copied between them.

When the catalogue says `mode: "test"`, the Plan tab states it plainly: these are Stripe test
cards and no money moves. Every reader sees that, because the person typing the card number
is the one who needs it.

## What the Plan tab shows

`apps/canvas/src/auth/PlanPanel.tsx` reads the entitlement, the catalogue and the subscription
and states them. Four states, each with its own sentence, because three of them used to look
the same: a blank space under "Subscription".

| State | What it says |
| --- | --- |
| A plan-less organization (`tier: "free"`) | **Synced workspaces: none yet**, then one sentence: everything on this device is uncapped, and a plan adds the room |
| Plans listed | one card per price in `STRIPE_PRICE_TIERS`, and the self-host card beside them |
| No session | a plan belongs to an account, with **Create an account**, because nothing else can follow |
| Nothing listed | this deployment has no plans configured, and an operator sets `STRIPE_PRICE_TIERS` |
| The catalogue failed | the account service's own message, with **Try again** |

### The plan card

A card carries what a person needs before pressing a button, and every number on it is the
server's:

| Element | Source |
| --- | --- |
| Name | the tier name from the price table, which is also the identifier checkout takes |
| Amount | `price` in the catalogue, read from Stripe by price id and cached for ten minutes |
| Synced workspaces, document storage, attachment storage | the tier table's limits, which are the caps the relay enforces |
| Members | `seats`, one per plan in this build (ADR-0082) |
| A sentence of purpose | a client map keyed by tier name, with a fallback built from the workspace count |

`price` is `null` when Stripe could not be asked, and the card then renders **Price unavailable**
rather than a number nobody can honour. A display amount typed beside a price id would be a second
price list, and a second price list drifts from what is actually charged.

**Self-host** is the third card and sells nothing: a dashed border, no price, and a link to
`/how-to/deploy/` on the documentation host (`VITE_SUITE_DOCS_URL`, defaulting to
`https://docs.suite.run`). It renders as a link rather than a button because nothing about running
Suite yourself charges anybody, a relay with no `SUITE_LICENCE` enforces no limit, and a reader
should be able to find that out without reading the source.

Under the cards, one caveat block states what a plan buys (sync, collaboration, uploads), that it
admits one member today with share links as the collaboration path, and that a cancellation holds
to the end of the paid period.

A zero is shown rather than dropped. The quota rows come from the limits the token carries,
and filtering out every non-positive limit is how this panel once said "This server sets no
limits" directly under "You are on the free plan": the list came back empty and the empty
case was described as unlimited. The free tier's own zero is added from the tier name, because
the free entitlement carries no limit keys at all. The token's limits are not changed to suit
the display: a `documentBytes: 0` claim would cap a free organization's saves at zero in the
relay's quota service.

**Manage billing in Stripe** appears only when a subscription exists. The portal needs a
customer, and the customer is created by Checkout, so offering the button before that gives a
refusal ("no customer exists") that reads like a broken button. Before a plan exists, the plans
are the action.

## The born-with licence, and the wall

The entitlement read answers `free` for an organization with no live subscription, and the
seat check reads a different row to decide what that organization may hold:
`organization_licences` in the control-plane database. The two agree about the tier label,
and the licence row is the one with numbers on it.

**Local and offline use is free and needs no account**, so a hosted account exists to buy
sync. Every organization is therefore born with a licence that grants the owner's seat and
*no workspace*: migration `0009_free_licence_provisioning.sql` writes the row in the
organization's own transaction through a trigger, and
`0011_no_free_workspace.sql` sets its numbers to zero workspaces, zero document bytes and
zero attachment bytes. `FREE_LICENCE_TIER` in
`services/auth/src/organizations/freeTier.ts` is the same object, and `pnpm db:verify`
compares the row the trigger writes with it.

The one number that is not zero is the seat, because a seat *is* a `member` row: an
organization whose owner cannot be a member cannot exist. Zero seats would repeat the
provisioning bug `0009` fixed; zero workspaces is the intended wall.

There are two doors from a local workspace to a synced one, and both read this row.

`POST /api/workspaces/claim` is the control plane's door. The refusal is `plan-required`
with a **402**: the request was well formed and the account is real, it just has no plan
behind it. The app turns that code into the plan picker. `workspace-limit` (403) is the
neighbouring case: a plan that names workspaces and has spent them.

The relay's socket join is the other door, and it used to stand open. `claimWorkspaceForSession`
in `apps/collab-server/src/http/access.ts` records the organization for a workspace on the
first verified open, and it did so without reading the plan, so a free account connected,
synced, and read "Synced" while the claim route was refusing the same workspace. It now asks
the same question before it writes anything, with the token's `limits.workspaces` as the
ceiling: absent or zero answers `plan-required`, and a count at the ceiling answers
`workspace-limit`. A workspace the organization already holds is always allowed, so a licence
that shrank ends new work rather than taking documents away from somebody mid-sentence.

The relay counts workspaces in its own SQLite store, because it holds no Postgres credential.
That count is a lower bound on what the organization owns, because a workspace claimed in the
control plane but never opened on the relay is not counted, so the ceiling can only refuse an
organization the relay has itself watched reach it.

What a free account keeps is everything local: as many workspaces as it likes, in IndexedDB on
the device, with export. What a plan buys is the room.

A free account is not cut off from other people's rooms, and both ways in are deliberate:

- **A share link** is a capability, not a seat. `seatGate.ts` answers `{ ok: true, seat: "share" }`
  for it, so a visitor with no plan, or no account at all, opens the shared workspace.
- **An invitation** makes the account a member of the paying organization, and the plan that pays
  for the room is that organization's. Accepting the invitation makes that organization the
  session's active one (better-auth sets it), so the token that arrives at the relay names the tenant
  that owns the workspace. `/api/account/workspaces` joins `member` to `workspaces`, so the shared
  workspace appears in the launcher's list beside their own.

The one shape that does not work is holding a plan-less organization as the *active* one while
opening somebody else's workspace: the relay records one organization per workspace and answers
`workspace-owned-elsewhere` rather than guessing. Accepting an invitation switches the active
organization, which is the path a person actually takes.

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

`seats` is the subscription's seat quantity, never below the born-with row's one seat: a plan
that sells no seats still admits the owner it always admitted. The plugin reports that
quantity on create and on every update, and a quantity that is not a whole number is read
as absent rather than as a fractional ceiling. A member whose join would take the count past
it is refused with `seat-refused` and `reason: seat-allowance-exhausted` before the row is
written, so the plan is never silently oversold. No plan prices seats today, so the quantity
is one and so is the row; the section above says why.

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

## The self-host licence

A self-hosted relay starts with no control plane, so nothing mints it a session token and no
subscription row holds its capacity. The entitlement is a token the operator holds:
`SUITE_LICENCE`, one line of text, verified once at boot against `SUITE_LICENCE_PUBLIC_KEY`.

The seller signs a licence for that operator:

```sh
pnpm --filter @suite/collab-server licence sign --key ./licence-private.pem \
  --tier team --workspaces 25 --document-bytes 5368709120 --attachment-bytes 26843545600 --days 365
```

The command prints the token on stdout. The operator pastes that line, whole and unbroken, into
the relay's environment:

```sh
SUITE_LICENCE=eyJ2IjoxLCJpZCI6InRlYW0tMjAyNiIs...
SUITE_LICENCE_PUBLIC_KEY=<the public half of the key the seller signed with>
```

The relay exits on a token it cannot use, and the message names the case: `licence-malformed`,
`licence-expired`, `licence-bad-signature`, `licence-unknown-version`. A token with no key
configured is reported on `SUITE_LICENCE_PUBLIC_KEY`. Starting anyway would run the instance
unlimited while the operator believes capacity was bought.

The claims cap the instance. `workspaces` caps `SUITE_MAX_WORKSPACES`, `documentBytes` caps
`SUITE_DOCUMENT_BYTES_PER_WORKSPACE` and `attachmentBytes` caps
`SUITE_ATTACHMENT_BYTES_PER_WORKSPACE`, and a lower value in the environment still wins. `tier` is
a label for support and gates nothing.

`SUITE_HOSTED=1` and `SUITE_LICENCE` together refuse to boot. A hosted relay takes capacity from
the organization's subscription, so there is no second source to merge.

A session token and a licence do not compete on a self-hosted relay. Capacity comes from
`SUITE_LICENCE`; a session token, when the operator runs a control plane as well, authenticates a
person and raises no cap, because the per-workspace claim record is written only in hosted mode.

## Test and live, side by side

Stripe keeps two universes, and this deployment carries a credential set for each: the test set in
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_TIERS`, and the live set in the same
names with a `_LIVE` suffix. `billing.mode` (`SUITE_BILLING_MODE`) picks which one the process
spends, and nothing from the other universe is read, so a test event that arrives while the
deployment is live fails the signature check instead of writing a licence.

Both sets are first-class, and the point is parity: the same plans, the same limits, the same
checkout, portal and webhook, in whichever universe is active. What test mode proves and what only
live mode can prove:

| Flow | Test mode | Live mode |
| --- | --- | --- |
| Checkout, portal, webhook, projection | Yes, with a test card | Yes, with real money |
| Renewal and cancellation | Yes, with a test clock | Yes, and slowly |
| Price ids | Test-mode ids | Live-mode ids, a different table |
| Webhook endpoint | Registered in the test dashboard | Registered separately, in live |
| Anything about tax, disputes, payouts | No | Only here |

Because the price ids differ between the universes, a price table cannot be moved across: each set
names its own, and the dashboard's copy action works on products in the other universe rather than
on a price id. A table pasted from test mode into `billing.stripe.prices.live` parses, reports two
plans, and is unspendable, because Stripe has never heard of those ids in live mode. Nothing about
the table's shape reveals it.

`settingsBody` reports both profiles with what each one still lacks, and
`PUT /admin/settings/billing.mode` refuses a switch to a profile that is incomplete **while billing
is enabled**, because a mode with no credentials boots billing off, and on a deployment that charges
people that means everybody syncs for free while the panel says nothing is wrong. With billing off the mode
is free to set, because nothing is charged either way.

Shape is only half the question, so the switch also asks Stripe. `verifyStripeProfile` calls
`GET /v1/account` with the candidate mode's key and then each price id in that mode's table, and a
mode whose key is refused or whose prices are missing is refused with the ids named. A network that
cannot reach Stripe decides nothing, so it does not block the write. The same check runs on demand at
`POST /admin/settings/billing/verify` with `{"mode":"test"|"live"}`, which is what the **Check with
Stripe** button on each profile card calls: a profile can be checked without switching to it.

The order is therefore: fill the target profile's three rows, check the profile, then switch, then
restart the control plane (billing is read at boot). A row saved after boot shows **Restart to
apply** beside it.

### The customer id belongs to one universe too

`organization.stripeCustomerId` is written by the plugin when a customer is created, and it records
no mode. After a switch the deployment holds ids from the other universe, and Stripe answers
`No such customer` for every one of them: the portal fails with "Unable to create billing portal
session", and a checkout that names the stored customer fails before it renders. The subscription
row has the same shape, which is why a test-mode subscription keeps granting a licence in live mode.

The repair is one statement per organization whose id the active mode does not know. Ask Stripe
first, then clear the ones it refuses:

```sql
-- one organization, after confirming the id is not in the active mode
update organization set "stripeCustomerId" = null where id = '<organization id>';
```

A blank id is a supported state: the plugin searches the active universe for a customer carrying
that organization's metadata and creates one when it finds none, so the next checkout (or portal
open) makes a live customer and writes the id back. The cost is that switching back to test mode
does not recover the old test customers; they are made again the same way.

Recording the mode beside the id is the fix that removes the manual step, and it needs a column the
identity tables do not have yet. Until then, this is an operator step in the mode switch, listed
here rather than discovered through a customer's failed portal.

### Secrets in the table

A row of kind `secret` is encrypted before it is written, with AES-256-GCM under a key derived from
`SUITE_SETTINGS_KEY`, and the API returns a mask instead of a value. The one place a value is
decrypted is `envWithSettings`, which composes the environment billing and mail are built from, so
the key this process hands to Stripe is the plaintext an operator typed. A `SUITE_SETTINGS_KEY` that
cannot open the envelope leaves the variable empty, which the readiness read reports as a missing
key rather than as a profile that looks ready and answers `401`. `SUITE_SETTINGS_KEY` itself cannot
live in the table, because it is what decrypts it.

## Environment

| Variable | When | Meaning |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | always | Secret or restricted key. Absent, the deployment mounts no billing plugin |
| `STRIPE_WEBHOOK_SECRET` | always | Endpoint secret (`whsec_…`) printed by `stripe listen`; never logged |
| `STRIPE_PRICE_TIERS` | always | The tier table above, as JSON keyed by price id |
| `STRIPE_SECRET_KEY_LIVE`, `STRIPE_WEBHOOK_SECRET_LIVE`, `STRIPE_PRICE_TIERS_LIVE` | live mode | The same three, in Stripe's live universe |
| `STRIPE_CHECKOUT_COUPON` | optional | One coupon id applied to every checkout, which replaces the promotion-code field |
| `SUITE_BILLING_MODE` | always | `test` (default) or `live`: which set is spent |
| `SUITE_CONTROL_PLANE_DATABASE_URL` | entitlement read | The one Postgres holding `subscription` (ADR-0070) |
| `SUITE_CONTROL_PLANE_PORT` | local runs | Listener port, `1236` by default |
| `SUITE_LICENCE` | self-host relay | The signed token, verified at boot against the public key |
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
| Stripe webhook | `https://<app host>/api/auth/stripe/webhook`, one endpoint per mode; see below |

### The webhook endpoint

One endpoint per Stripe mode, because an endpoint created in test mode does not exist in
live. Both answer on the app host, and the path is the plugin's and nothing else's:

| Setting in the Stripe dashboard | Value |
| --- | --- |
| Destination type | **Webhook endpoint** (not EventBridge, not a thin-event destination) |
| Endpoint URL, test mode | `https://app.suite.run/api/auth/stripe/webhook` |
| Endpoint URL, live mode | the same path on the live host |
| Payload style | **Snapshot**, the full event object |
| Events | `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` |

Snapshot because the plugin verifies with `stripe.webhooks.constructEvent` and then reads
`event.data.object` directly; a thin event carries only an id and would need a fetch the
plugin does not make. Those four events are the whole switch in `@better-auth/stripe`:
anything else is acknowledged and ignored, so subscribing to invoices, payment intents or
customers adds deliveries whose bodies do nothing here. A renewal arrives as
`customer.subscription.updated` (the period end moved) and a cancellation as
`customer.subscription.deleted`, so neither needs an invoice event.

After creating the endpoint, copy its **signing secret** (`whsec_…`) into the row for that
mode: `billing.stripe.webhookSecret.test` or `.live` in the panel, which is
`STRIPE_WEBHOOK_SECRET` and `STRIPE_WEBHOOK_SECRET_LIVE` in the environment. A secret from
the other mode fails the signature check by design, so a test event delivered to a live
deployment is refused rather than writing a licence.

The path is the plugin's. There is no `/stripe/*` route and never was on the control plane,
so an endpoint pointed there answers `404 not_found` and every delivery fails.

The plugin creates its own tables. Migration `0003_billing.sql` in `services/auth/sql`
declared `billing_event` and `billing_customer` for the retired hand-written billing
function; `0008_drop_billing_tables.sql` drops both, so the `subscription` row is the only
record of what is paid.
