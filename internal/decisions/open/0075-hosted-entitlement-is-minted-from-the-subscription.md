# ADR-0075: Hosted entitlement is minted from the subscription row

- Status: partial
- Date: 2026-10-26
- Related: [ADR-0074](0074-the-relay-verifies-a-session-jwt-against-jwks.md) (what carries the claim), [ADR-0078](0078-billing-runs-on-the-auth-plugin.md) (who writes the subscription), [ADR-0070](0070-one-postgres-control-plane.md) (where the row lives)
- Shipped: the tier-to-limits table (`services/billing/src/stripe/tiers.ts`), the claim record the relay
  keeps per workspace (`apps/collab-server/src/store/licence.ts`), and `organization_licences`
  (`services/auth/sql/0001_control_plane.sql`).
- Remaining: reading tier and limits from the plugin's `subscription` row at mint time, and moving the
  verifier out of `apps/collab-server/src/store/licence.ts` into `packages/licence` (planned) so
  `services/billing` stops deep-importing the relay.

## Decision

In hosted mode the `tier` and `limits` in the token are read from the organization's subscription row
when the token is minted, so the plugin's plan entry is the only written definition of what a customer
bought. A self-hoster has no organization and no account, so a signed licence file stays their path,
verified by `packages/licence` against the public key in `SUITE_LICENCE_PUBLIC_KEY`
(`apps/collab-server/src/config/config.ts`). The relay holds both verifiers and chooses by
`SUITE_HOSTED`.

## Rejected alternatives

- One credential format for both. A licence file has no issuer to refresh and no revocation; a session
  JWT cannot be verified by a deployment that runs no control plane. One shape means a self-hoster runs
  Postgres to be licensed, or a hosted customer holds a file that outlives their subscription.
- A second limits table maintained by hand beside the plugin's plans. Two definitions of what a tier
  includes drift, and the drift shows up as a customer paying for a limit the relay refuses.
- Reading entitlement from Postgres on every connection. That is a control-plane dependency inside the
  relay's connect path (ADR-0073).

## Consequences

- The plugin's `plans[].limits` is the only place a paid limit is written.
- Self-hosting needs no account, which is the promise the licence file exists for.
- `packages/licence` is one verifier for both processes, so the relay and billing cannot disagree
  about a signature.
- A tier change lands at the next mint, not mid-session.
