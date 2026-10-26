# Billing and licences

Hosted billing is closed for the alpha. There is no button, no price and no deployed route, and
`SUITE_BILLING_ENABLED` defaults to `0`, which refuses every request before a signature is read, an event
claimed or a licence minted.

A licence is a signed token you paste into a workspace when you run a hosted relay. Local editing never
consults it, and self-hosting needs no key at all.

`services/billing` is the service that will take money. Stripe collects it, the webhook turns a paid event
into the same Ed25519 token `apps/collab-server/src/licence.ts` already verifies, and SES delivers it.
Payment work is V1.

## Switched off

Unset, `0`, `false`, empty or any other spelling of `SUITE_BILLING_ENABLED` answers
`503 {"ok":false,"error":"billing-disabled"}`: no signature check, no claim, no licence, no email, no
checkout session, and `STRIPE_SECRET_KEY` is never read. Only `1` or `true` opens the flows below.

`503` rather than `200` is deliberate, because a disabled deployment then reports the delivery as unhandled
and a mistaken deploy shows up in the Stripe dashboard. The guard runs before the email transport loads, and
the front door has its own copy so a checkout is refused for the same spellings.

## The licence token

The format lives in `apps/collab-server/src/licence.ts`: `signLicence` and a payload of `v`, `id`, `tier`,
`workspaces`, `documentBytes`, `attachmentBytes`, `issuedAt`, `expiresAt` and `email`. This service fills
that payload in. There is no second format, no second verifier and no Stripe SDK: the webhook signature and
the two Checkout calls are hand-rolled over `node:crypto` and `fetch` with form-encoded bodies.

The licence id is `lic-` plus 16 hex characters of SHA-256 over the Stripe customer id, so a retry or a
lost store entry re-issues under the same id and the relay, which records claims per licence id, cannot
grant one subscription two workspace quotas.

Hosted sync is what is sold. The app is free and open source, and a licence gates the relay on workspace
count and per-workspace byte caps. It never gates a feature.

## Front door

The webhook is the only thing that mints a licence. Two routes let a surface start the flow.

| Route | Body | `200` |
| --- | --- | --- |
| `POST /api/billing/checkout` | `{"organizationId":"org_1","workspaceId":"ws_1","tier":"solo"}` | `{"ok":true,"url":"https://checkout.stripe.com/…","mode":"test"}` |
| `POST /api/billing/portal` | `{"customerId":"cus_…"}` | `{"ok":true,"url":"https://billing.stripe.com/…","mode":"test"}` |

`tier` is the `tier` label from `STRIPE_PRICE_TIERS` and not a price id, which answers `unknown-tier`. When
two prices name one tier, as a monthly and an annual do, the first in the table is sold.

`organizationId` is the payer: the tenant holding the members, the seats and the licence, which may hold
many workspaces. It becomes `client_reference_id` and `metadata.organizationId`, so the payment page, the
dashboard and support name the same organization. Both ids are free text this service never checks, and
`workspaceId` is only a return address.

The session uses `mode=subscription`, one line item and `metadata.price_id`, because a Checkout Session does
not expand its line items unless the endpoint asks. `success_url` and `cancel_url` are `SUITE_APP_ORIGIN`
with `?billing=success` or `?billing=cancelled` and `&organization=<id>`.

One checkout makes one customer, and the stateless route creates a second customer and licence id on a
second checkout by the same person; the identity service answering which organization a session owns is what
closes that, and until then the front door is a test-mode tool.

| Status | Body | When |
| --- | --- | --- |
| `503` | `billing-disabled` | `SUITE_BILLING_ENABLED` is not `1` |
| `400` | `invalid-request` or `unknown-tier` | the body is not JSON, a required id is missing or longer than 128 characters, or `tier` is not in `STRIPE_PRICE_TIERS` |
| `500` | `checkout-failed` with `missing-secret-key`, `stripe-error` or `invalid-config` | `STRIPE_SECRET_KEY` is unset, Stripe refused, or `STRIPE_PRICE_TIERS` and `SUITE_APP_ORIGIN` do not parse; the portal answers `portal-failed` |
| `404` | `not-found` | any other path; no path at all is still the webhook |

`mode` comes from the key prefix: `sk_test_…` and `rk_test_…` report `test`, `…_live_…` reports `live`, and
anything unrecognised reports `test`. When `SUITE_BILLING_STORE` is not `postgres`, a successful checkout
also carries `"warning":"billing store is not durable"`, so a surface can refuse to present a live
checkout. Test mode is not blocked, and the portal mints nothing so it carries no warning.

## Event flow

| Stripe event | Read from `data.object` | What happens |
| --- | --- | --- |
| `checkout.session.completed` | customer, email, price (`metadata.price_id`, else line items), subscription, `payment_status` | mints the first licence for 30 days and emails it; an unpaid session is ignored because the invoice follows |
| `invoice.paid` | invoice id, customer, email, price, subscription, `period_start`, `period_end` | a renewal: re-signs with `expiresAt` at the end of the paid period, never earlier than what the customer holds |
| anything else | none | `200`, no claim, no write, no email |

The first invoice of a subscription describes the same month as the checkout event, so it is compared
against the stored licence and dropped as unchanged. When it describes a longer period, as an annual plan
does, it extends the licence.

The lifecycle is verify, parse, claim, map, sign, email, record. Verification is HMAC-SHA256 over
`"{t}.{raw body}"` with a constant-time compare and plus or minus five minutes on `t`. Email precedes the
record on purpose: if SES fails there is no record, so Stripe's retry sends the mail. A `400` is untrusted
and Stripe stops; `500` is fixable and retried for up to three days; `503` means billing is off.

## Idempotency

`claimEvent(eventId)` runs before any work and is released only if the work throws, so a repeated delivery
returns `200 {"status":"duplicate"}` and touches nothing. A different event id can describe the same money,
so `invoice.paid` is deduped by `lastInvoiceId`, and any payment whose plan, contact and expiry match the
stored licence within a day reports unchanged. The in-process store is not atomic across concurrent
invocations, which is why the Postgres adapter makes the claim a conditional insert and the customer write
conditional on `updatedAt`; the ordered retries Stripe performs are covered by the in-process store, which
stays the default.

## Durable store

`services/billing/src/store/postgres.ts` implements `BillingStore` on the control-plane Postgres. DynamoDB
was the durable adapter until that decision changed: subscriptions already live in this database, and a
second store made entitlement exist twice.

| Variable | Meaning |
| --- | --- |
| `SUITE_BILLING_STORE` | `postgres` selects the database; unset, empty, `memory` or any other spelling, including the retired `dynamodb`, keeps the in-process store |
| `SUITE_BILLING_DATABASE_URL` | the connection string; `SUITE_AUTH_DATABASE_URL` is a fallback because it is the same database. Missing is a `500`, never a silent fall back to memory |

| Table | Key | Holds |
| --- | --- | --- |
| `billing_event` | `event_id` | one row per processed event with `claimed_at` and `expires_at` (30 days); the row existing is the claim |
| `billing_customer` | `customer_id` | the `LicenceRecord` from `store.ts`, one column per field |

Correctness comes from the write. `claimEvent` is one `INSERT … ON CONFLICT (event_id) DO NOTHING RETURNING
event_id`, where a returned row means this statement inserted it, and `releaseEvent` deletes the row so a
retry after a `500` is not mistaken for a duplicate. `putCustomer` is one `INSERT … ON CONFLICT
(customer_id) DO UPDATE`, because the record is the latest answer for that customer. The conflict clause
carries correctness, not the expiry deletion, so a stale row can never mint twice.

The pool is `max: 4` and module-scoped for the life of the container, because a pool per request would be a
connection storm. `pg` loads lazily, so an in-memory deployment never imports it, and the adapter is tested
against a recording fake client with no live database test. None of this is deployed for the alpha: no table
exists, and `SUITE_BILLING_ENABLED=0` closes the endpoint before the store is touched.

## Environment

| Variable | When | Meaning |
| --- | --- | --- |
| `SUITE_BILLING_ENABLED` | always | `1` or `true` opens the routes; unset is `0` |
| `STRIPE_WEBHOOK_SECRET` | webhook | endpoint secret (`whsec_…`), never logged |
| `STRIPE_SECRET_KEY` | checkout and portal | secret or restricted key, read only by the front door and never logged |
| `SUITE_APP_ORIGIN` | checkout and portal | where the browser returns, as `scheme://host[:port]` with no path; defaults to `http://localhost:5173` |
| `SUITE_LICENCE_PRIVATE_KEY` | webhook and manual issue | Ed25519 private key, PEM (PKCS#8) or one line with `\n` escapes |
| `STRIPE_PRICE_TIERS` | webhook and checkout | JSON map of price id to plan |
| `SUITE_SELF_HOST_URL` | webhook | link in the email for the self-hosted path |
| `SES_FROM_ADDRESS`, `SUITE_SES_REGION` | webhook | verified SES identity and region, defaulting to the Lambda's; unset means the console transport logs "email sent" without sending or printing the token |
| `SUITE_BILLING_STORE`, `SUITE_BILLING_DATABASE_URL` | durable store | see above |

`STRIPE_PRICE_TIERS` turns a tier into configuration:

```json
{
  "price_1PAbCdEfGhIjKl": { "tier": "solo", "workspaces": 3, "documentBytes": 268435456, "attachmentBytes": 1073741824 },
  "price_1PAbCdEfGhIjKm": { "tier": "studio", "workspaces": 25, "documentBytes": 2147483648, "attachmentBytes": 8589934592 }
}
```

`tier` is a label the relay echoes, and the three caps are what it enforces per licence. A price missing
from the table is a `500` and not a free licence, because the customer paid and the event is retried until
someone fixes the map.

## Keys, rotation and manual issue

Generate the keypair once, offline:

```sh
pnpm --filter @suite/collab-server licence generate-keypair --out ./licence-private.pem
```

The public key goes on every relay as `SUITE_LICENCE_PUBLIC_KEY`. The private key goes into the Lambda's
environment or an SSM SecureString and nowhere else.

The relay verifies with one public key, so rotation is a cut-over: generate a keypair and keep the old
private key, deploy the new private key, flip the public key on the relays, then re-issue to every active
customer by hand, because renewals would otherwise wait for the next period boundary. Between the last two
steps a customer's token stops verifying, which pauses sync and loses no work. Rotate immediately on a
compromise, or batch it with a period boundary. A two-key grace period would remove the window and would be
a change to `licence.ts`.

For the customer who emails support:

```sh
cd services/billing
SUITE_LICENCE_PRIVATE_KEY="$(cat ../../licence-private.pem)" \
  node src/ops/dev.ts --dry-run --email customer@example.com --tier hosted --workspaces 10 --days 30
```

The token goes to stdout and the email it would have sent goes to stderr. `--price` uses the configured plan
instead of naming the tier and quotas, and `--days` defaults to 30. `--dry-run` is required: the script never
calls Stripe and never sends mail. The licence id is derived from the address, so the same customer keeps
the same id. Do not paste a token into a ticket, a chat or a shared shell history; write it into the email,
and record the customer, tier and `expiresAt` next to the payment.

## Cancellation

Keep the licence to expiry, and never stop local editing. Cancelling in Stripe stops the next invoice, and
the current period is already paid, so the licence runs to `expiresAt`. Nothing watches subscription status
and there is no revocation channel: a token is honoured until its signed expiry, because the relay cannot
phone home.

At expiry the relay refuses that account's hosted sync and answers `402` with "Local editing still works".
Share links keep resolving as read-only projections, nothing is deleted, and every device keeps editing its
local copy. Refunds inside a period do not claw the licence back, and resubscribing issues a fresh token for
the same licence id, so the workspace claims already recorded against it are picked up again.

## Deployment shape

None of this exists on any account.

| Piece | Configuration |
| --- | --- |
| API Gateway, HTTP API | `POST /stripe/webhook` with no auth beyond the signature, plus the two front-door routes; payload limit of at least 1 MiB and a 30 s integration timeout |
| Lambda, Node 24+ and ESM | handler `handler.handler`, 256 MB, 10 s timeout; the two Stripe secrets and the private key from SSM SecureString |
| SES | a verified identity matching `SES_FROM_ADDRESS`, with production access before selling |
| Postgres | `billing_event` and `billing_customer` in the control-plane database |

Deploy the SES identity first, then the Lambda with its env and `SUITE_BILLING_ENABLED=1`, then the three API
Gateway routes, then a Stripe webhook pointed at
`https://<api-id>.execute-api.<region>.amazonaws.com/stripe/webhook` for `checkout.session.completed` and
`invoice.paid`. Set `SUITE_APP_ORIGIN` to the deployed canvas origin and `SUITE_BILLING_STORE=postgres`
before the key is anything but a test key.

`@aws-sdk/client-ses` is an optional dependency imported by name at runtime, so the main install stays
AWS-free and the Lambda package must carry it. The bundle also needs `apps/collab-server/src/licence.ts`,
which this service imports to sign the token the relay verifies.
