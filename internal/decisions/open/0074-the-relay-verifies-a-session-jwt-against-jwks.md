# ADR-0074: The relay verifies a Better Auth session JWT against JWKS

- Status: proposed
- Date: 2026-10-26
- Related: [ADR-0073](0073-the-control-plane-is-a-separate-process.md) (where the token is signed), [ADR-0075](0075-hosted-entitlement-is-minted-from-the-subscription.md) (what the token carries), [ADR-0067](0067-the-account-is-the-identity.md) (the transport this replaces)
- Shipped: nothing. The relay verifies an Ed25519 licence token it parses itself
  (`apps/collab-server/src/store/licence.ts`) and refuses an account principal with
  `account-check-unavailable` (`apps/collab-server/src/sync/seatGate.ts`).
- Remaining: Better Auth's `jwt()` plugin and `/api/auth/jwks`, a `jose` verifier with a cached key
  set in the relay, the session-version claim, and the published TTL.

## Decision

The control plane signs a short-lived session JWT through Better Auth's `jwt()` plugin and publishes
the key set at `/api/auth/jwks`. The relay verifies it with `jose` against a cached JWKS, so it holds
no identity table and makes no network call per connection or per message. The payload carries `sub`,
`org`, `role`, `tier` and `limits`. Revocation is the token TTL plus a session-version bump that the
control plane writes when a subscription or a membership changes. The TTL is what bounds revocation, so
it is a published number: five minutes to start, which means a revoked seat keeps a working socket for
at most five.

## Rejected alternatives

- A hand-rolled Ed25519 session assertion. It is what `apps/collab-server/src/store/licence.ts` does
  today, and it costs a signing key, a payload format, a rotation story and its own tests, for a
  credential Better Auth already issues.
- Relay-side introspection per request. Every connect and every socket resume would need the control
  plane, so a control-plane restart would drop editing, and the network hop sits in the hot path.
- A shared session table read by the relay. That is `pg` in the relay by another name (ADR-0073).

## Consequences

- The relay needs a public key and no database credentials.
- A revoked user keeps sync until the token expires; that latency is a published number, not an
  accident.
- Verified claims are the only entitlement the relay trusts, so a field added to the token is a field
  the relay can enforce.
- A cached key set needs a refresh path and a clock-skew allowance; a set fetched once at boot is a
  silent outage at the first rotation.

## Amendment: the revocation window is a published limit

Re-read after a review asked whether a removed member keeps writing. They do, for up to
`RELAY_TOKEN_TTL_SECONDS` (five minutes), and that is this record working as designed rather than a
defect: the relay holds no identity table, so nothing in that process can learn that a `member` row is
gone. The token's expiry is the only clock it has.

What was missing is not a mechanism but a sentence someone can act on, so it is now stated in the
security model and in the roadmap's recorded limits: an organization that removes a member should
expect their open socket to stay writable for up to five minutes, and lowering the TTL is the knob that
shortens it, at the cost of minting tokens more often.

Closing the gap properly is a different design, not a smaller number: the relay would need to be told
by the control plane (a revocation channel) or would need to read a denylist it can reach, and both put
the identity process back in the relay's request path — which is the thing this record exists to avoid.
Recorded as a V2 concern rather than scheduled, because nothing before a launch depends on it.
