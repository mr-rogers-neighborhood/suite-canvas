# Local Stripe

Test-mode billing on a laptop: real Stripe API calls, real Checkout page, real webhook
delivery, no live key and no dashboard clicking.

## What owns what

The Stripe plugin runs inside the auth instance, so every route the plugin defines sits
under `/api/auth/*` and the control plane mounts the auth module at that prefix.

| Surface | Route | Owner |
| --- | --- | --- |
| Checkout | `POST /api/auth/subscription/upgrade` | the plugin |
| Billing portal | `POST /api/auth/subscription/billing-portal` | the plugin |
| Cancel, restore, list | `POST /api/auth/subscription/cancel`, `/restore`, `GET /api/auth/subscription/list` | the plugin |
| Stripe webhook | `POST /api/auth/stripe/webhook` | the plugin, registered by the auth module |
| Entitlement read | `POST /api/billing/entitlement` | `apps/control-plane/src/modules/billing.ts` |
| Plan catalogue | `POST /api/billing/plans` | `apps/control-plane/src/modules/billing.ts` |

The control plane listens on `1236` by default, which is why the webhook forwarder and
the environment below use that port.

## Prerequisites

The Stripe CLI, installed and logged in:

```sh
stripe login
```

`stripe login` opens a browser once and writes a test-mode key to
`~/.config/stripe/config.toml`. `pnpm stripe` reads that key, so nothing below needs the
Stripe dashboard.

## Steps

1. Create the fixture prices and print the environment:

   ```sh
   pnpm stripe
   ```

   The script reads `fixtures.json`, creates each price once (monthly, `usd`, with a
   lookup key), reuses it on every later run, and prints:

   ```sh
   STRIPE_SECRET_KEY=sk_test_…
   STRIPE_WEBHOOK_SECRET=<whsec_… from `pnpm stripe --listen`>
   STRIPE_PRICE_TIERS='{"price_…":{"tier":"solo",…}}'
   SUITE_CONTROL_PLANE_PORT=1236
   ```

2. Export those variables in the shell that runs the control plane. `STRIPE_PRICE_TIERS`
   is the tier table: the price a customer picks is the limits the relay later enforces.

3. Forward webhooks, in a second terminal:

   ```sh
   pnpm stripe --listen
   ```

   It prints `Ready! Your webhook signing secret is whsec_…`. Put that value in
   `STRIPE_WEBHOOK_SECRET` and restart the control plane if it is already running.

4. Start the control plane:

   ```sh
   pnpm --filter @suite/control-plane dev
   ```

   `GET http://localhost:1236/health` reports `auth` and `billing` as mounted. A module
   that failed to load is listed there with its error.

5. Sign in through the app, then start a checkout with the session cookie. The plugin
   defaults `customerType` to `user`, so a subscription checkout has to name the
   organization explicitly:

   ```sh
   curl -sS -X POST localhost:1236/api/auth/subscription/upgrade \
     -H 'content-type: application/json' \
     -H 'origin: http://localhost:5173' \
     -H 'cookie: <the session cookie from the browser>' \
     -d '{
       "plan": "solo",
       "customerType": "organization",
       "referenceId": "<organization id>",
       "successUrl": "http://localhost:5173/?billing=success",
       "cancelUrl": "http://localhost:5173/?billing=cancelled",
       "disableRedirect": true
     }'
   ```

   The answer carries `{"url": "https://checkout.stripe.com/…"}`. Open it and pay with
   `4242 4242 4242 4242`, any future expiry and any CVC. A checkout that sends no
   organization is refused, because a subscription belongs to the tenant that owns the
   workspaces.

6. Read the entitlement:

   ```sh
   curl -sS -X POST localhost:1236/api/billing/entitlement \
     -H 'content-type: application/json' \
     -d '{"organizationId":"<organization id>"}'
   ```

   Before payment this answers `{"tier":"free","limits":{}}`. After the webhook lands it
   answers the plan's tier and its three caps. The webhook forwarder prints each event it
   delivers, so a missing subscription is visible there first.

## Renewal and cancellation with a test clock

A monthly renewal is otherwise a month away. A test clock moves Stripe's own clock:

```sh
pnpm stripe --clock
```

That creates a clock and prints the three commands it takes to use it. In order:

```sh
stripe customers update <cus_…> -d test_clock=clock_…
stripe test_helpers test_clocks advance clock_… -d "frozen_time=<next month>"
curl -sS -X POST localhost:1236/api/billing/entitlement -d '{"organizationId":"<org id>"}'
```

The advance fires `invoice.paid`, the plugin writes the new period, and the entitlement
read stays on the plan. Cancelling through the portal leaves the row `active` with
`cancelAtPeriodEnd` set, so the tier holds until the period ends. Advancing past that
point turns the row `canceled`, and the entitlement read answers `free`.

## Fixture prices

`fixtures.json` holds the amounts, the seat counts and the caps, and it is the only copy:
`pnpm stripe` creates these prices from it, the printed `STRIPE_PRICE_TIERS` carries its
seats and caps, and the billing unit tests read the same file. A limit edited there is a
limit the suite asserts.

| Tier | Lookup key | Seats | Price |
| --- | --- | --- | --- |
| `solo` | `suite_solo_monthly` | 1 | $12/month |
| `solo-pro` | `suite_solo_pro_monthly` | 1 | $49/month |

`seats` is how many people a plan admits. Both plans sell one, because the tier table
carries no per-seat price and the licence keeps no headroom over the member count; a plan
that claims more is refused when the plugin is built (ADR-0082). The lookup keys changed
with the rename from `studio`, so `pnpm stripe` creates a new price the first time it runs
after this and an existing `STRIPE_PRICE_TIERS` has to be regenerated.

## When it does not work

`503 not-configured` on `/api/billing/*` means `STRIPE_PRICE_TIERS` or
`SUITE_CONTROL_PLANE_DATABASE_URL` is missing; the control plane logs which one once.

No webhook arrives at all: check that `pnpm stripe --listen` is running, and that the
secret it printed is the value in `STRIPE_WEBHOOK_SECRET`. A secret from an earlier
listen session fails signature verification, and the plugin answers `400`.

A checkout that answers `invalid-request` about an organization did not send
`customerType: "organization"` with a `referenceId` the signed-in account administers.
