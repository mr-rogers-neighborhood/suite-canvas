# Billing and licences

**Hosted billing is not open for the alpha.** There is no button, no price and no account, and none
of these routes is deployed. What exists is switched off: `SUITE_BILLING_ENABLED` defaults to `0` and
the handler refuses every request — Stripe deliveries and checkout sessions alike — while it is off,
so a function deployed by mistake can neither mint a licence nor take a card. What stays documented
is the part that is real today: the licence token format, the self-host path, and the design of the
service that will take money when billing opens, now including the [front door](#front-door) a
surface uses to start a payment. The payment path is V1 work; the alpha closes A5 by being explicitly
closed rather than by being durable. A DynamoDB adapter (`SUITE_BILLING_STORE=dynamodb`) exists
behind the same interface but is not deployed for the alpha either — see
[DynamoDB store](#dynamodb-store).

Nothing in the app asks for payment. A licence key is a signed token you paste into the workspace
when you run a hosted relay; local editing never consults it. Self-hosting needs no key at all.

How the service works, for when it opens: one Lambda, one endpoint, no server. Stripe collects the
money, `services/billing` turns the paid event into the same Ed25519 token the relay already
verifies, and SES delivers it.

## Switched off

Every route checks one variable before it reads anything:

| `SUITE_BILLING_ENABLED` | Behaviour |
| --- | --- |
| unset, `0`, `false`, empty or anything else | `503 {"ok":false,"error":"billing-disabled"}`; no signature check, no claim, no licence, no email, no checkout session, and `STRIPE_SECRET_KEY` is never read |
| `1` or `true` | The flows below |

`503` rather than `200` is deliberate: a disabled deployment reports the delivery as unhandled, so
a mistaken deploy is visible in the Stripe dashboard instead of silently swallowing a paid event.
There is no code path that mints a licence while the switch is off, and the guard runs before the
email transport is loaded and before the Stripe key is read. The front door has its own copy of the
same guard (`env.ts` holds the one implementation) so a checkout is refused for exactly the same
spellings.

The token format lives in `apps/collab-server/src/licence.ts` (`signLicence` and the payload:
`v, id, tier, workspaces, documentBytes, attachmentBytes, issuedAt, expiresAt, email`). This service
only fills that payload in — there is no second licence format, no second verifier, and no Stripe
SDK. Even the webhook signature and the two Checkout calls are hand-rolled (`node:crypto`, `fetch`)
over form-encoded bodies.

**What is sold:** hosted sync. The app is free and open source, and the licence gates the relay
only — workspace count and per-workspace byte caps. It never gates a feature.

## Front door

The webhook is still the only thing that mints a licence; two routes exist so a surface can *start*
the flow. They are plain `fetch` calls for the same reason the signature is hand-rolled: two form
posts do not justify bundling the Stripe SDK into the Lambda.

| Route | Body | `200` |
| --- | --- | --- |
| `POST /api/billing/checkout` | `{"organizationId":"org_1","workspaceId":"ws_1","tier":"solo"}` | `{"ok":true,"url":"https://checkout.stripe.com/…","mode":"test"}` |
| `POST /api/billing/portal` | `{"customerId":"cus_…"}` | `{"ok":true,"url":"https://billing.stripe.com/…","mode":"test"}` |

`tier` is the `tier` label from `STRIPE_PRICE_TIERS`, not a price id — a price id in that field is an
`unknown-tier`. When two prices name one tier (a monthly and an annual), the first in the table is
the one sold, so list the default first.

`organizationId` is the payer: a subscription belongs to the tenant that holds the members, the seats
and the licence ([ADR-0065](decisions/0065-accounts-own-workspaces.md)), and that tenant may hold
many workspaces. It becomes `client_reference_id` and `metadata.organizationId`, so the payment page,
the Stripe dashboard, the webhook and support all name the same organization. Both ids are free text
this service never checks against anything it owns — the front door does not know your database.

`workspaceId` is optional and only ever a return address: it names the workspace in
`metadata.workspaceId` and in the redirect so the customer lands where they were. Omit it from an
organization-level surface (a plan page with no board open) and the checkout still works; the session
simply carries no workspace.

The session is created with `mode=subscription`, one line item (`line_items[0][price]`,
`line_items[0][quantity]=1`) and `metadata.price_id` — the webhook prefers `metadata.price_id`
because a Checkout Session does not expand its line items unless the endpoint asks. `success_url` and
`cancel_url` are `SUITE_APP_ORIGIN` with `?billing=success` / `?billing=cancelled`,
`&organization=<id>`, and `&workspace=<id>` when one was given.

**One checkout, one customer — until the account supplies one.** The route is stateless today: it
takes no session and looks nothing up, so it trusts the caller's `organizationId` and a second
checkout by the same person creates a second Stripe customer, and therefore a second licence id (the
id is derived from the customer id). Two things close that, in order: the identity service starts
answering *which organization does this session own* (`services/auth`, ADR-0065), and the route then
takes `customer` from the organization's stored subscription instead of creating one. Until then the
front door is a test-mode tool — see *Real money needs the durable store* above. Plan changes belong in the Portal,
which reuses the customer; a duplicate subscription is a support refund, not a code path.

| Status | Body | When |
| --- | --- | --- |
| `503` | `{"ok":false,"error":"billing-disabled"}` | `SUITE_BILLING_ENABLED` is not `1`. Checked before the key is read, exactly like the webhook. |
| `400` | `{"ok":false,"error":"invalid-request"}` | The body is not JSON, or `organizationId` / `tier` / `customerId` is missing or empty, or an id is longer than 128 characters. |
| `400` | `{"ok":false,"error":"unknown-tier"}` | `tier` is not a `tier` in `STRIPE_PRICE_TIERS`. |
| `500` | `{"ok":false,"error":"checkout-failed","code":"missing-secret-key"}` | `STRIPE_SECRET_KEY` is unset. A misconfigured deployment is loud, never a silent no-op. The portal answers `portal-failed` with the same code. |
| `500` | `{"ok":false,"error":"checkout-failed","code":"stripe-error"}` | Stripe refused, or answered without a url. The log line carries Stripe's own error type; the response does not. |
| `500` | `{"ok":false,"error":"checkout-failed","code":"invalid-config"}` | `STRIPE_PRICE_TIERS` is unreadable, or `SUITE_APP_ORIGIN` is not a URL. |
| `404` | `{"ok":false,"error":"not-found"}` | Any other path. A request with no path at all is still the webhook. |

`mode` is read from the key prefix: `sk_test_…` / `rk_test_…` report `test`, `…_live_…` reports
`live`, and anything unrecognised reports `test`. A surface that cannot charge says so instead of
pretending; this is the field it reads to say it.

**Real money needs the durable store, and the response says so.** When `SUITE_BILLING_STORE` is not
`dynamodb`, a successful checkout answer carries `"warning":"billing store is not durable"` and the
service logs one line per container. Test mode is not blocked — a duplicated test event costs
nothing — but a surface can read the warning and refuse to present a live checkout. This is the code
half of ADR-0065 item 7 and [beta gate A5](roadmap/beta.md): the sentence is in the response, not
only in this file. The portal route mints nothing, so it carries no warning.

### Stripe test mode, end to end

These five variables are enough for a checkout that charges nothing and a portal that changes
nothing:

| Variable | Value |
| --- | --- |
| `SUITE_BILLING_ENABLED` | `1` |
| `STRIPE_SECRET_KEY` | an `sk_test_…` (or `rk_test_…`) key with Checkout Sessions and Billing Portal write access |
| `STRIPE_PRICE_TIERS` | the table below, with test-mode price ids |
| `SUITE_APP_ORIGIN` | where the canvas runs, e.g. `http://localhost:5173` (the default) |
| `SUITE_BILLING_STORE` | leave unset for test mode; the answer then carries the warning |

The webhook that turns a payment into a licence still needs `STRIPE_WEBHOOK_SECRET`,
`SUITE_LICENCE_PRIVATE_KEY`, `STRIPE_PRICE_TIERS` and (if mail is to leave) `SES_FROM_ADDRESS`. The
front door reads none of those, and a broken SES identity does not stop a customer from paying.

## Event flow

| Stripe event | Read from `data.object` | What happens |
| --- | --- | --- |
| `checkout.session.completed` | customer, customer email, price (`metadata.price_id`, else line items), subscription, `payment_status` | Mints the first licence for one default period (30 days) and emails it. A session that is not paid is ignored; the invoice will follow. |
| `invoice.paid` | invoice id, customer, email, price (line items, else the stored price), subscription, `period_start`/`period_end` | A renewal: the licence is re-signed with `expiresAt` at the end of the paid period, never earlier than what the customer already holds. |
| anything else | — | `200`, no claim, no write, no email. Stripe stops retrying. |

The first invoice of a subscription (`billing_reason: subscription_create`) arrives seconds after the
checkout event and describes the same month, so it is compared against the stored licence and
dropped as "unchanged". When it describes a *longer* period — an annual plan — it extends the
licence, which is how a yearly customer gets 365 days instead of the checkout default of 30.

Request lifecycle:

1. **Verify** `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET`: HMAC-SHA256 over
   `"{t}.{raw body}"`, constant-time compare, ±5 minutes on `t`. The raw body is used as it arrived;
   API Gateway's base64 form is decoded first.
2. **Parse** the event envelope.
3. **Claim** the event id (see [Idempotency](#idempotency)).
4. **Map** the price id onto a plan from `STRIPE_PRICE_TIERS`.
5. **Sign**, **email**, then **record**. Email before record on purpose: if SES fails there is no
   record, so Stripe's retry sends the mail. A recorded-but-unsent licence would be invisible to the
   customer forever.
6. On any failure in 4–5: release the claim and answer `500`.

| Status | Meaning | Stripe |
| --- | --- | --- |
| `400` | not a trustworthy Stripe request (bad signature, bad body) | stops |
| `200` | issued, renewed, ignored, or a duplicate delivery | stops |
| `500` | a failure an operator can fix: unknown price, SES outage, missing key | retries for up to 3 days |
| `503` | hosted billing is switched off (`SUITE_BILLING_ENABLED` is not `1`); nothing was read, claimed or sent | retries while the deployment is wrong |

## Idempotency

Two layers, because one is not enough:

- **Event id.** `claimEvent(eventId)` is taken before any work and released only if the work throws.
  A repeated delivery of the same event returns `200 {"status":"duplicate"}` and touches nothing.
- **Outcome.** A different event id can describe the same money: `invoice.paid` is deduped by
  `lastInvoiceId`, and any payment whose plan, contact and expiry match the stored licence within a
  day is reported as `unchanged` — no second token, no second email.

The in-process store is not atomic across concurrent invocations: two *different* event ids for one
invoice arriving in the same instant could both mint. That is the reason the DynamoDB adapter exists:
it makes the claim a conditional put on the event id and the customer write conditional on
`updatedAt`, so the second writer loses instead of overwriting. The ordered retries Stripe actually
performs are already covered by the in-process store. The default stays the in-process store — see
[DynamoDB store](#dynamodb-store).

The licence id is derived from the Stripe customer id (`lic-` + 16 hex chars of SHA-256), not
random. A retry, or a lost store entry, therefore re-issues under the same id, and the relay — which
records claims per licence id — cannot grant one subscription two workspace quotas.

## DynamoDB store

`services/billing/store-dynamodb.ts` implements the same `BillingStore` on one DynamoDB table.
Selection is one variable, and unset is the in-process default:

| Variable | Required | Meaning |
| --- | --- | --- |
| `SUITE_BILLING_STORE` | no | `dynamodb` selects the table below. Unset, empty, `memory` or any other spelling keeps the in-process store. |
| `SUITE_BILLING_TABLE` | with `SUITE_BILLING_STORE=dynamodb` | Table name. Missing is a `500`, never a silent fall back to memory: a Lambda that forgot its claims would mint twice. |

One table, string partition key `pk`, no sort key, two prefixes:

| Row | Key | Value |
| --- | --- | --- |
| Event claim | `event#<stripe event id>` | `claimedAt` and `ttl` (30 days). The row existing *is* the claim. |
| Customer | `customer#<stripe customer id>` | The `LicenceRecord` from `store.ts`, unchanged in shape, flattened beside `pk`. |

Every write is conditional. A read followed by a write is two round trips with a window in between,
and two deliveries of one event routinely land in different containers:

- `claimEvent` is `PutItem` with `attribute_not_exists(pk)`. A `ConditionalCheckFailedException`
  means "already processed" and returns `false`; every other error propagates. `releaseEvent`
  deletes the row, so a retry after a `500` is not mistaken for a duplicate.
- `putCustomer` is `PutItem` with `attribute_not_exists(updatedAt) OR updatedAt <= :updatedAt`. A
  slow retry carrying an older `updatedAt` is refused rather than rolling a customer back to a
  shorter expiry; an equal timestamp still writes, so replaying the same record is harmless.
- TTL only tidies the table, and DynamoDB deletes on its own schedule. Correctness rests on the
  conditional write, not on the deletion.

IAM for the function role — one table, three actions, no query:

```json
{
  "Effect": "Allow",
  "Action": ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:DeleteItem"],
  "Resource": "arn:aws:dynamodb:<region>:<account>:table/<table>"
}
```

Every access is one item by key (`GetItem`, `PutItem`, `DeleteItem`); the adapter never queries or
scans, and TTL expiry is performed by DynamoDB itself. `dynamodb:DescribeTable` is not needed at
runtime.

`@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` are optional dependencies of the service and
are imported by name only when the flag selects them, so a deployment on the in-process store neither
installs nor initializes them; put them in the Lambda bundle (or a layer) for a DynamoDB deployment.
The adapter is tested against a fake client (`store-dynamodb.test.ts`); there is no live AWS test.

> **Not deployed for the alpha.** This is code and tests only: the flag is unset wherever the alpha
> ships, no table exists, and `SUITE_BILLING_ENABLED=0` still closes the endpoint before the store is
> touched. A5 closes by public closure, not by this adapter. Creating the table, the IAM policy and
> the flag is V1 work.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `SUITE_BILLING_ENABLED` | no | `1` or `true` opens the routes. Unset is `0`: every delivery and every checkout answers `503` and nothing is minted. |
| `STRIPE_WEBHOOK_SECRET` | yes | Endpoint secret (`whsec_…`) from the Stripe webhook. Never logged. |
| `STRIPE_SECRET_KEY` | for checkout | Stripe's secret or restricted key (`sk_test_…`, `sk_live_…`). Read only by the [front door](#front-door), never by the webhook, never logged. Missing is a `500`, not a quiet no-op. |
| `SUITE_APP_ORIGIN` | no | Origin the browser returns to after a checkout or a portal session (`scheme://host[:port]`, no path). Defaults to `http://localhost:5173`, the canvas dev server; a live deployment must set it. |
| `SUITE_LICENCE_PRIVATE_KEY` | yes | Ed25519 private key, PEM (PKCS#8) or single line with `\n` escapes. |
| `STRIPE_PRICE_TIERS` | yes | JSON map of price id → plan. See below. |
| `SUITE_SELF_HOST_URL` | no | Link in the email for the self-hosted path. Defaults to this repo's deployment section. |
| `SES_FROM_ADDRESS` | no | Verified SES identity. Unset ⇒ the console transport logs "email sent" without sending or printing the token. |
| `SUITE_SES_REGION` | no | SES region; defaults to the Lambda's region. |
| `SUITE_BILLING_STORE` | no | `dynamodb` selects the durable store; unset keeps the in-process store. See [DynamoDB store](#dynamodb-store). |
| `SUITE_BILLING_TABLE` | with `SUITE_BILLING_STORE=dynamodb` | DynamoDB table name; the default table has key `pk`. |

`STRIPE_PRICE_TIERS` is what makes a tier configuration instead of code:

```json
{
  "price_1PAbCdEfGhIjKl": {
    "tier": "solo",
    "workspaces": 3,
    "documentBytes": 268435456,
    "attachmentBytes": 1073741824
  },
  "price_1PAbCdEfGhIjKm": {
    "tier": "studio",
    "workspaces": 25,
    "documentBytes": 2147483648,
    "attachmentBytes": 8589934592
  }
}
```

`tier` is a label the relay echoes; `workspaces`, `documentBytes` and `attachmentBytes` are the caps
the relay enforces per licence. A price missing from the table is a `500`, not a free licence: the
customer paid, so the event is retried until someone fixes the map.

The checkout session is created with `metadata.price_id` set to the price the front door just sold.
Checkout Sessions do not carry line items unless the webhook expands them, and the metadata survives
that; a session created by hand (a Stripe payment link, say) needs the same field, or the webhook
falls back to the line items.

## Signing-key rotation

The keypair is generated once, offline:

```sh
pnpm --filter @suite/collab-server licence generate-keypair --out ./licence-private.pem
```

The **public** key goes on every relay (`SUITE_LICENCE_PUBLIC_KEY`); the **private** key goes into
the Lambda's environment (or an SSM SecureString parameter it is deployed from) and nowhere else.

The relay verifies with exactly one public key, so rotation is a cut-over, not a background job:

1. Generate a new keypair. Keep the old private key until the step below finishes.
2. Deploy the new private key to the Lambda.
3. Flip `SUITE_LICENCE_PUBLIC_KEY` on the relays.
4. Re-issue to every active customer — the store holds their email, tier and expiry, and
   [manual issuance](#issuing-a-licence-by-hand) signs with the new key. Renewals re-sign on their
   own, but nothing forces a renewal early.

Between steps 3 and 4 a customer's current token stops verifying. That window is a paused relay, not
lost work: local editing never consults the licence, and the re-issued token restores sync. Rotate on
a compromise immediately (the old tokens die with the key, which is the point) or, when nothing is
urgent, batch it with a period boundary and tell customers a re-sync may be needed.

A two-key grace period would remove the window; that is a change to `licence.ts`, not to this
service.

## Issuing a licence by hand

For the customer who emails you — lost key, invoice paid by transfer, a comped account.

```sh
cd services/billing
SUITE_LICENCE_PRIVATE_KEY="$(cat ../../licence-private.pem)" node dev.ts --dry-run \
  --email customer@example.com --tier hosted --workspaces 10 --days 30
```

- The token is on **stdout** (ready to paste into the reply); the exact email it would have sent,
  with the token in it, is on **stderr**.
- `--price price_…` uses the configured plan instead of naming the tier and quotas by hand.
- The licence id is derived from the address, so the same customer gets the same id every time and
  support and the relay see one customer, not two.
- `--dry-run` is required: the script never calls Stripe and never sends mail. You send the reply.

Minutes matter more than ceremony here. Do not paste a token into a ticket system, a chat, or a
shared shell history; write it into the email and close the terminal. Record the customer, tier and
`expiresAt` next to the payment.

## Cancellation

**Keep the licence to expiry. Drop the relay to read-only. Never revoke mid-period. Local editing
always continues.**

- Cancelling a subscription in Stripe stops the *next* invoice. The current period is already paid
  for, so the licence runs to `expiresAt` with no further action.
- Nothing in this service watches subscription status, and there is no revocation channel: a token
  is honoured until its signed expiry. That is deliberate. The relay cannot phone home, so it cannot
  be told to forget a customer.
- At expiry the relay refuses that account's hosted sync (the claim gate answers `402`, "Local
  editing still works"), existing share links keep resolving as their read-only projections, and
  nothing is deleted. No writes are lost, because no writes were accepted.
- The app itself has no licence check outside the relay, so every device keeps opening and editing
  the local copy — before, during and after any billing event.
- Refunds inside a period do not claw the licence back. Fraud or chargeback is handled by not
  re-signing at the next renewal, not by breaking a key someone is currently using.
- Resubscribing issues a fresh token for the same licence id; the workspace claims already recorded
  against that id are picked up again, so nothing has to be re-claimed.

## AWS shape

**Not deployed for the alpha.** None of the pieces below exist on any account; this is the shape the
service is written for. Deploying them is V1 work, and `SUITE_BILLING_ENABLED=0` is the default that
keeps a premature deploy from issuing a token.

There is no server to patch:

| Piece | Configuration |
| --- | --- |
| API Gateway (HTTP API) | `POST /stripe/webhook` (no auth beyond the signature), `POST /api/billing/checkout` and `POST /api/billing/portal`, payload limit ≥ 1 MiB, integration timeout 30 s. The front-door routes need the app origin in CORS (`POST`, `content-type`) if the canvas calls them from a browser. |
| Lambda (Node 24+, ESM) | handler `handler.handler`, 256 MB, 10 s timeout, env from the table above. `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` and `SUITE_LICENCE_PRIVATE_KEY` from SSM SecureString. Node 22.18+ also runs these files, since they rely on built-in type stripping. |
| SES | Verified domain or address; `SES_FROM_ADDRESS` is that identity. Request production access before selling. |
| DynamoDB | One table, `pk` string key: `event#<event id>` claims (TTL 30 days) and `customer#<customer id>` for the `LicenceRecord`. The adapter is selected by `SUITE_BILLING_STORE=dynamodb`; see [DynamoDB store](#dynamodb-store). The default in-process store in `store.ts` only survives a warm container and **must** not take real money. |
| CloudWatch | The handler logs `{ts, level, msg, component:"billing", eventId, licenceId, tier, expiresAt}`. A checkout adds `{organizationId, workspaceId, tier, priceId, mode}`. It never logs the token, the private key, the webhook secret or the Stripe key. |

Deploy steps, when billing opens: create the SES identity first (verification takes time), then the
Lambda with its env and `SUITE_BILLING_ENABLED=1`, then the three API Gateway routes, then point a
Stripe webhook at
`https://<api-id>.execute-api.<region>.amazonaws.com/stripe/webhook` for
`checkout.session.completed` and `invoice.paid`, and paste the signing secret into the Lambda
environment. Set `SUITE_APP_ORIGIN` to the deployed canvas origin — the default points at a
developer's machine — and `SUITE_BILLING_STORE=dynamodb` before the key is anything but a test key.

Bundling: `@aws-sdk/client-ses` is an `optionalDependencies` entry of this package and is imported by
name at runtime, so the main repository install stays Stripe- and AWS-free. The Lambda package needs
it present (bundled or in `node_modules`); without it, the function answers `500` and logs
`email transport unavailable`, naming the package. The bundle must also carry
`apps/collab-server/src/licence.ts`, which this service imports to sign the same token the relay
verifies.

## Working on it

```sh
pnpm exec tsc --noEmit -p services/billing    # from the repo root
pnpm biome check --write services/billing     # from the repo root
cd services/billing && node --test "*.test.ts"
```

`services/billing` **is** a pnpm workspace member (`services/*` in `pnpm-workspace.yaml`), so
`pnpm typecheck` and CI reach it like any other package; `pnpm verify` runs its tests through
`turbo run test --filter=@suite/billing`. Its tests still use Node's built-in runner via type
stripping, so the Stripe- and AWS-free install is preserved by `ignoredOptionalDependencies`:
`@aws-sdk/client-ses` stays declared as an optional dependency for the Lambda bundle and is simply
not installed here. That distinction is load-bearing — installing the SDK flips the test that
asserts the missing-SDK path, which is how the constraint was found.

What is not covered by the tests, because neither Stripe nor SES is reachable from them: the real
webhook handshake, SES delivery (including sandbox restrictions), and the deployed DynamoDB store.
Everything up to those boundaries — signature verification, event parsing, tier mapping, signing,
email rendering, idempotency, routing and status codes — is exercised against in-memory fixtures.
The front door is tested the same way, against a fake `fetch` (`checkout.test.ts`): the assertion is
the encoded form body, because a field name that is merely wrong is accepted by nobody and
diagnosed by nobody.
