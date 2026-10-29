# Try the paid flow on this machine

The whole product runs in five containers on one machine: the relay, the control plane, Postgres,
Caddy, and the docs site. This page walks the parts that need a human (signing in, the operator panel,
and paying with a Stripe test card) against that stack rather than against a deployment.

The sandbox keys are the only thing this needs from outside. Everything else is in the repository.

## 1. Set the three variables that make it a local stack

`.env` is read by `docker compose`. Three values decide whether a local run works:

```sh
SUITE_DOMAIN=localhost                     # Caddy's internal CA, not Let's Encrypt
SUITE_ADMIN_EMAILS=you@example.com         # who may use the operator surface
STRIPE_SECRET_KEY=sk_test_...              # the sandbox key
STRIPE_WEBHOOK_SECRET=whsec_...            # printed by `pnpm stripe --listen`, step 4
STRIPE_PRICE_TIERS='{"price_…":{"tier":"personal",…}}'   # printed by `pnpm stripe`
SUITE_BILLING_ENABLED=1
```

`SUITE_MAIL_TRANSPORT` stays unset: the console transport writes every message to the control plane's
log, which is where the magic links and the verification links are read from in step 2.

## 2. Bring it up

```sh
docker compose --profile docs up -d --build
docker compose ps                       # five services, four healthy and one running
```

Caddy serves `https://app.localhost`, `https://docs.localhost` and `https://suite.localhost` with its
own certificate authority. A browser warns once and can accept it. `curl` needs the address pinned and
the warning ignored:

```sh
curl -sk --resolve app.localhost:443:127.0.0.1 https://app.localhost/health
```

Accepting the warning by hand is enough for a look. A headless browser or a tool that refuses an
unknown authority needs the root itself, which Caddy keeps in its volume:

```sh
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

`SUITE_DOMAIN=canvas.example.com` in a local run makes Caddy ask Let's Encrypt for a domain this machine
does not own; every host then answers nothing while it retries.

## 3. Become the operator

An operator is an **address**, not a token, so the account has to exist before its address can be
trusted:

1. Open `https://app.localhost` and create the account with the address in `SUITE_ADMIN_EMAILS`.
2. Read the confirmation link out of the log:

   ```sh
   docker compose logs control-plane | grep "auth mail" | tail -1
   ```

   The line is JSON and the URL is in `line`. Open it.
3. Sign in. Then open `https://app.localhost/admin.html`; the panel says whether this account is an
   operator. If it says it is not, the variable did not reach the process — it is read through a
   whitelist (`services/auth/src/http/env.ts`): an empty value there mints `operator: false` rather
   than refusing to boot.

The panel is where accounts are admitted (`SUITE_ADMISSION_REQUIRED=1`) and where starter templates are
written. `https://app.localhost/metrics` is a scrape, and needs either an operator session or a request
from inside the container while `SUITE_METRICS_LOCAL=1`.

## 4. Forward Stripe's webhooks through Caddy

The control plane publishes no port: in a deployment, Caddy is the only way in, so the local stack is
the same shape.

```sh
pnpm stripe                      # creates or reuses the two prices, prints STRIPE_PRICE_TIERS
pnpm stripe --listen https://app.localhost/api/auth/stripe/webhook
```

`--listen` adds `--skip-verify` for a `localhost` target, because the certificate is Caddy's own and the
CLI has no way to trust it. The CLI also resolves names itself and does not treat `*.localhost` as
loopback, so add one line to `/etc/hosts` first, or every delivery answers `no such host`:

```sh
echo '127.0.0.1 app.localhost docs.localhost suite.localhost' | sudo tee -a /etc/hosts
```

Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET` and restart the control plane:

```sh
docker compose up -d control-plane
```

Leave the listener running. A delivery that arrives while it is down is retried by Stripe, but the
sandbox forgets quickly, so a missed one is easiest to reproduce with a fresh purchase.

## 5. Pay with a test card

The Plan tab is only as alive as the control plane: if it says the account service did not
answer, that process is not running (`pnpm dev` starts it on 1236) and nothing else on this page
will work either. With it up, a deployment whose `.env` has `SUITE_BILLING_ENABLED=1` lists the
plans from `STRIPE_PRICE_TIERS`, and a deployment without them says so instead of showing a
blank space.

A brand-new account should show **Local** with **See plans**, not Synced. The organization is born
with a licence for zero workspaces, so the relay refuses the socket join and the control plane refuses
the claim, both with `plan-required`. The workspace stays on the device and stays editable, which is
the product rather than a fault. Pressing **See plans** and paying is what opens the room; after Checkout the
browser comes back to the same URL, the claim runs again on that load, and the room opens.

If a fresh account reads **Synced** without a plan, the door is open somewhere: check
`workspaces.sqlite` in the relay's data volume for a row belonging to that organization, and check
that `SUITE_HOSTED=1` reaches both the relay and the control plane.

Sign in as any account, open the workspace menu, and the Plan tab: the two plans come from
`STRIPE_PRICE_TIERS`, so a plan that is missing there is missing from the page.

| Field | Value |
| --- | --- |
| Card number | `4242 4242 4242 4242` |
| Expiry | any future date |
| CVC | any three digits |
| Name and postcode | anything |

The Checkout page is Stripe's own, so no card detail reaches this origin. It also carries a
**promotion code** field: a percentage or 100% coupon made in the sandbox dashboard is how a comp is
given, and a 100%-off code is the fastest way to test the whole flow without money moving.

## 6. Check what the payment did

Three places, in increasing order of directness:

```sh
# 1. the webhook arrived and was verified
docker compose logs control-plane | grep stripe/webhook

# 2. the subscription row exists
docker compose exec postgres psql -U suite -d suite -c 'select plan, status, "referenceId" from subscription'

# 3. the entitlement the relay will enforce
curl -sk --resolve app.localhost:443:127.0.0.1 \
  -X POST https://app.localhost/api/billing/entitlement \
  -H 'content-type: application/json' -d '{"organizationId":"<org id>"}'
```

The organisation id is in the `subscription` row above. The Plan tab shows the same answer, and it comes
from that read rather than from a copy in the browser.

A renewal or a cancellation is easiest to see with a test clock:

```sh
pnpm stripe --clock
```

It prints the customer and clock commands, including how to advance a month.

## 7. What this cannot test yet

The account is still created by the sign-up form and the plan is bought afterwards.
[ADR-0083](../../internal/decisions/open/0083-the-account-is-created-by-paying.md) records the door that
replaces it: anonymous Checkout, then the account created from the completed session. Its `Remaining`
list is the work. Until that lands, "buy without an account" has no path, and step 5 starts
from a signed-in page.

## 8. The same walk on the deployment

The hosted stack is `https://app.suite.run`, and it differs in three ways: the webhook is
registered in the Stripe dashboard rather than by a CLI listener, the database is RDS rather
than a local Postgres, and the promo code is already made.

Prerequisites, all already true: `SUITE_BILLING_ENABLED=1`, `SUITE_BILLING_MODE=test`, the two
test price ids in `billing.stripe.prices.test`, and a webhook endpoint for
`https://app.suite.run/api/auth/stripe/webhook`. The mode and the catalogue are on the
operator panel's Settings tab, which is the answer to "are we live?" without an SSH session.

1. Sign in at `https://app.suite.run` and open a workspace.
2. The account menu, then Plan. Two plans, `personal` and `organization`, come from the
   deployment's `billing.stripe.prices.test`; a plan missing from that page is missing from the
   setting.
3. Choose a plan. Stripe Checkout opens on Stripe's own origin, so no card detail reaches us.
4. Apply the promo code `SUITE-TESTER`: 100% off, 20 redemptions, made for exactly this walk.
   A test card (`4242 4242 4242 4242`, any future expiry, any CVC) also works.
5. Back in the app, the Plan tab should show the tier and its limits, because that read comes
   from `/api/billing/entitlement` rather than from a copy in the browser.
6. Open a workspace that was capped before. The sync control should stop offering plans and
   claim the workspace instead, which is the whole paid loop landing.
7. Billing portal, then cancel. The entitlement should return to the free row, and the next
   claim should be capped again.

When a step does not do what this page says, the log is the first place to look:

```sh
AWS_PROFILE=suite deploy/cloudwatch/queries.sh webhooks 1
AWS_PROFILE=suite deploy/cloudwatch/queries.sh errors 1
```

`webhooks` shows the delivery and its signature check. A rejected signature while in test mode
usually means `billing.stripe.webhookSecret.test` was replaced by a different endpoint's secret.

## 9. Put it down

```sh
docker compose --profile docs down          # keeps the volumes
docker compose --profile docs down -v       # forgets the accounts and the documents
```
