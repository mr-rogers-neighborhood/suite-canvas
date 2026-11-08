# ADR-0077: Sign-up is open, and an invitation is an organization feature

- Status: superseded
- Date: 2026-10-26
- Superseded by: [ADR-0083](0083-the-account-is-created-by-paying.md)
- Related: [ADR-0076](0076-the-owner-key-is-deleted.md) (how an anonymous workspace is kept), [ADR-0078](0078-billing-runs-on-the-auth-plugin.md) (what the new account buys), [ADR-0065](0065-accounts-own-workspaces.md) (the organization model)
- Shipped: nothing. `emailAndPassword.disableSignUp: true`
  (`services/auth/src/identity/betterAuth.ts:185`) and `mode: "invite-only"`
  (`services/auth/src/invitations/enrollment.ts:77`) close the front door, and `admissionRequired`
  adds a queue behind it.
- Remaining: open sign-up with Turnstile required, email verification on the sign-up path, the
  admission switch defaulting off, and invitations scoped to an organization.

## Decision

A stranger signs up, verifies an email and pays. `disableSignUp` becomes `false`, the captcha plugin
(`services/auth/src/identity/betterAuth.ts`, `provider: "cloudflare-turnstile"`) is required rather
than optional, and `/sign-in/email` keeps its `window: 10, max: 3` rate limit. Invitations stay as an
organization feature for adding a colleague to a paid team, and the invite-only pin in `enrollment.ts`
is removed. The admission queue becomes an operator switch that defaults off.

## Rejected alternatives

- Invitations as the front door. It blocks the path the product needs: offline to paid subscription
  starts with a stranger creating an account, and an invitation presupposes somebody already paying.
- Open sign-up with no challenge. The rate limit is per address per window; a bare sign-up form is a
  free account farm, and each account becomes a seat an organization pays for.
- Admission on by default. It puts a manual step between payment and the first sync, and the queue
  exists to ration an invitation-only alpha, not to gate a purchase.

## Consequences

- Anyone can create an account, so abuse control moves to Turnstile plus email verification.
- `services/auth/src/invitations/enrollment.ts` loses its admission mode; the plugin's invitations
  answer a different question, adding a member to an organization.
- The first paying customer no longer needs an operator to admit them.
- Email deliverability becomes part of the sign-up path, so the magic-link sender stops being
  optional glue.
