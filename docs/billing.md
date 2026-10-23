# Billing and licences

**Hosted billing is not open for the alpha.** There is no checkout, no price and no account, and
the Stripe webhook is not deployed. `SUITE_BILLING_ENABLED` defaults to `0` and the handler refuses
every delivery while it is off, so a function deployed by mistake cannot mint a licence. What stays
documented is the part that is real today: the licence token format, the self-host path, and the
design of the service that will take money when billing opens. The payment path is V1 work; the
alpha closes A5 by being explicitly closed rather than by being durable.

Nothing in the app asks for payment. A licence key is a signed token you paste into the workspace
when you run a hosted relay; local editing never consults it. Self-hosting needs no key at all.

How the service works, for when it opens: one Lambda, one endpoint, no server. Stripe collects the
money, `services/billing` turns the paid event into the same Ed25519 token the relay already
verifies, and SES delivers it.

## Switched off

The webhook checks one variable before it reads anything:

| `SUITE_BILLING_ENABLED` | Behaviour |
| --- | --- |
| unset, `0`, `false`, empty or anything else | `503 {"ok":false,"error":"billing-disabled"}`; no signature check, no claim, no licence, no email |
| `1` or `true` | The flow below |

`503` rather than `200` is deliberate: a disabled deployment reports the delivery as unhandled, so
a mistaken deploy is visible in the Stripe dashboard instead of silently swallowing a paid event.
There is no code path that mints a licence while the switch is off, and the guard runs before the
email transport is loaded.

The token format lives in `apps/collab-server/src/licence.ts` (`signLicence` and the payload:
`v, id, tier, workspaces, documentBytes, attachmentBytes, issuedAt, expiresAt, email`). This service
only fills that payload in — there is no second licence format, no second verifier, and no Stripe
SDK. Even the webhook signature is hand-rolled with `node:crypto`.

**What is sold:** hosted sync. The app is free and open source, and the licence gates the relay
only — workspace count and per-workspace byte caps. It never gates a feature.

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
invoice arriving in the same instant could both mint. The DynamoDB replacement should make the
customer write conditional on `lastInvoiceId` and the claim a conditional put on the event id. The
ordered retries Stripe actually performs are already covered.

The licence id is derived from the Stripe customer id (`lic-` + 16 hex chars of SHA-256), not
random. A retry, or a lost store entry, therefore re-issues under the same id, and the relay — which
records claims per licence id — cannot grant one subscription two workspace quotas.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `SUITE_BILLING_ENABLED` | no | `1` or `true` opens the endpoint. Unset is `0`: every delivery answers `503` and nothing is minted. |
| `STRIPE_WEBHOOK_SECRET` | yes | Endpoint secret (`whsec_…`) from the Stripe webhook. Never logged. |
| `SUITE_LICENCE_PRIVATE_KEY` | yes | Ed25519 private key, PEM (PKCS#8) or single line with `\n` escapes. |
| `STRIPE_PRICE_TIERS` | yes | JSON map of price id → plan. See below. |
| `SUITE_SELF_HOST_URL` | no | Link in the email for the self-hosted path. Defaults to this repo's deployment section. |
| `SES_FROM_ADDRESS` | no | Verified SES identity. Unset ⇒ the console transport logs "email sent" without sending or printing the token. |
| `SUITE_SES_REGION` | no | SES region; defaults to the Lambda's region. |

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

When the checkout session is created, set `metadata.price_id`. Checkout Sessions do not carry line
items unless the webhook expands them, and the metadata survives that.

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
| API Gateway (HTTP API) | `POST /stripe/webhook`, no auth beyond the signature, payload limit ≥ 1 MiB, integration timeout 30 s. |
| Lambda (Node 24+, ESM) | handler `handler.handler`, 256 MB, 10 s timeout, env from the table above. `STRIPE_WEBHOOK_SECRET` and `SUITE_LICENCE_PRIVATE_KEY` from SSM SecureString. Node 22.18+ also runs these files, since they rely on built-in type stripping. |
| SES | Verified domain or address; `SES_FROM_ADDRESS` is that identity. Request production access before selling. |
| DynamoDB | `pk` key on one table: `EVENT#<event id>` rows for claims (TTL 30 days), `CUSTOMER#<customer id>` rows for `LicenceRecord`. The in-process store in `store.ts` only survives a warm container and **must** be replaced before the endpoint takes real money. |
| CloudWatch | The handler logs `{ts, level, msg, component:"billing", eventId, licenceId, tier, expiresAt}`. It never logs the token, the private key or the webhook secret. |

Deploy steps, when billing opens: create the SES identity first (verification takes time), then the
Lambda with its env and `SUITE_BILLING_ENABLED=1`, then the API Gateway route, then point a Stripe
webhook at
`https://<api-id>.execute-api.<region>.amazonaws.com/stripe/webhook` for
`checkout.session.completed` and `invoice.paid`, and paste the signing secret into the Lambda
environment.

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
email rendering, idempotency and status codes — is exercised against in-memory fixtures.
