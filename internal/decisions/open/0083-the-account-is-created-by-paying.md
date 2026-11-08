# ADR-0083: The account is created by paying

- Status: partial
- Date: 2026-10-28
- Related: [ADR-0077](0077-sign-up-is-open.md) (superseded), [ADR-0078](0078-billing-runs-on-the-auth-plugin.md) (the plugin whose checkout this needs), [ADR-0082](0082-hosted-plans-sell-one-seat.md) (the one-seat plans), [ADR-0075](0075-hosted-entitlement-is-minted-from-the-subscription.md) (the entitlement a payment mints), `services/auth/src/identity/betterAuth.ts`, `apps/canvas/src/auth/SignInDialog.tsx`, `docs/reference/billing.md`
- Shipped: `allow_promotion_codes` on the plugin's Checkout Session, so a comp or a launch
  discount is a Stripe coupon rather than a second price list in this process. The sign-in dialog
  states what an account gives you (a workspace across devices) instead of promising sync, and the
  sync refusal's `plan` sentence already offers the plans tab. Everything below the door — a
  subscription, its organization, the licence row, the entitlement a token carries — works for an
  account that already exists.
- Remaining: the anonymous checkout (`POST /api/billing/subscribe`), the `pending_checkout` row, the
  webhook branch that creates the user, organization and membership from a completed session, the
  magic link that follows it, and `disableSignUp: true` on the form. Until those land, an account is
  still created by the sign-up form and a plan is bought afterwards; the door is open but not paid.

## Decision

A hosted account exists **because somebody paid for one**. A visitor chooses a plan, gives an email
address, and is handed to Stripe's Checkout; the account, its organization and its membership are
created from the completed session, and a magic link then signs them in. The sign-up form closes, so
a free account is not a thing this deployment creates.

Two properties make this the right door rather than a restriction on it:

- No card data ever reaches our origin. Checkout is a hosted redirect, so the payment page, the card
  fields and the payment intent all live on `checkout.stripe.com` and this deployment is out of PCI
  scope beyond the redirect.
- Sync and file storage are the paid product, and they already refuse a session with no
  `licence-unprovisioned` subscription. An account that cannot sync is a better-shaped commitment
  than an account that discovers a paywall at the first share, which is what an open sign-up gives a
  stranger.

The email is the identity, so the address on the payment *is* the account: the webhook creates the
user from `customer_email`, and the magic link that follows proves the mailbox before anything is
delivered to it.

## Rejected alternatives

- Keep open sign-up (ADR-0077) and gate sync. It sells the same thing but puts the paywall after the
  account, so the first thing a stranger gets is a workspace that cannot be shared. It also makes
  every free account a row somebody eventually has to reconcile against payments.
- Sign up first, then subscribe. This is the shape the plugin supports natively
  (`POST /subscription/upgrade` needs a session and a verified address), which is exactly the point of
  paying first: starting a checkout before an account exists is the one thing the plugin cannot do,
  so this is a deliberate exception to ADR-0078 rather than an oversight of it.
- A Stripe Payment Link. It is the same hosted page with a static URL, so it saves one call and
  loses the two things the door needs: `customer_email` (whose account to create) and
  `client_reference_id` (which pending checkout the payment settles). A shared link can only carry a
  query parameter the browser could forge.
- Promotional access as a licence grant minted by this process. Stripe already owns coupons, expiry
  and redemption limits, and a second table describing what somebody paid is the failure
  ADR-0078 removed.

## Consequences

- The webhook becomes the only place an account is born, so it is the one route whose failure blocks
  a purchase from becoming a login. It has to be idempotent on the session id, and the magic link has
  to be resendable, because the first one may arrive before the account row is committed.
- `disableSignUp: true` closes the form, so a deployment that wants a self-serve account with no
  billing configured has no way to make one. That is the honest state of a build that sells one
  thing; a self-host has no accounts at all, and an operator can still nominate one address through
  `SUITE_ADMIN_EMAILS` to reach the admissions queue.
- The `pending_checkout` row is not a subscription and must not become one: it records an intent to
  pay, is deleted once a session completes or expires, and nothing reads it as an entitlement.
- A refund or a cancelled subscription does not delete the account. The account is the identity that
  still owns its local workspace and its exports; only the sync and storage entitlements lapse.
