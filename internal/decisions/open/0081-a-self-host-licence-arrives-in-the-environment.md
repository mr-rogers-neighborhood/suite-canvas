# ADR-0081: A self-host licence arrives in the environment

- Status: accepted
- Date: 2026-10-26
- Related: [ADR-0075](0075-hosted-entitlement-is-minted-from-the-subscription.md) (what a hosted relay reads instead), [ADR-0076](0076-the-owner-key-is-deleted.md) (the claim route this replaces), [ADR-0074](0074-the-relay-verifies-a-session-jwt-against-jwks.md) (the hosted credential)

## Decision

A self-hosted relay reads its entitlement from `SUITE_LICENCE`, the token
`pnpm --filter @suite/collab-server licence sign` prints, and verifies it at boot against
`SUITE_LICENCE_PUBLIC_KEY`. The claims become the instance caps: `workspaces`, `documentBytes` and
`attachmentBytes` cap the matching `SUITE_*` limits, and the tighter of the two wins. A token that
is malformed, expired, signed by another key or of an unknown version stops the process with a
named error. `SUITE_HOSTED=1` reads no licence file, because capacity there comes from the
organization's subscription, and setting both refuses to start.

## Rejected alternatives

- A claim route, the entry point deleted with the owner key. A self-hoster has no account, so
  there is no session to present and no organization to record the claims against.
- An upload through the admin API. It needs a running, writable instance to receive a file whose
  caps would then apply only after a restart, and the environment already survives a restart.
- Verifying the licence through the hosted path by setting `SUITE_HOSTED=1`. That switch also
  opens the per-workspace claim store, the seat gate and a JWKS dependency, so a licensed
  self-host would need a control plane.
- Ignoring `SUITE_LICENCE` when `SUITE_HOSTED=1` instead of refusing. The operator who pasted it
  would see nothing happen and keep both configurations.
- Starting unlicensed on a bad token hides capacity the operator paid for. An error at boot is the earliest honest answer.

## Consequences

- One token per instance, applied at boot. A new licence, an expiry or a key rotation lands at
  the next start; a running instance never gains or loses capacity mid-flight.
- A self-hosted instance that also runs a control plane accepts its session tokens for identity,
  and they raise no cap: the per-workspace claim record is written only in hosted mode.
- `GET /api/admin/limits` reports the caps with the source `env`: `applyLicenceLimits` writes them
  into the variables `resolveLimits` reads, because that function has no licence layer and is
  re-run on every runtime override.
- The seller holds the private key and never runs the customer's relay; the operator pastes a
  token and never sees the private key.
