# ADR-0065: Accounts own workspaces

- Status: partial; the relay side is settled by [ADR-0073](0073-the-control-plane-is-a-separate-process.md), [ADR-0074](0074-the-relay-verifies-a-session-jwt-against-jwks.md) and [ADR-0076](0076-the-owner-key-is-deleted.md)
- Date: 2026-10-25
- Shipped: `services/auth` — Better Auth organizations, magic link, passkeys, Google, invitations
  through `better-enrollment`, seats and capability flags — plus `workspaces` rows whose id is the
  document id and the `claim_workspace()` SQL.
- Remaining: the relay accepting an account session (the seat gate answers
  `account-check-unavailable`), a deployed auth service, and a billing front door in the app.
- Full text: [archive](../../../../history/decisions/0065-accounts-own-workspaces.md)

## Decision

An organization owns workspaces, and a workspace row's primary key is the document id, so claiming an
anonymous workspace is one conditional `UPDATE` that changes no id and breaks no share link. Identity,
invitations and entitlement move to three successors — ADR-0067, ADR-0069 and ADR-0068 — while the
org-owns-many-workspaces model itself stays.

## Consequences

- Claiming is safe to retry and needs no reissued links.
- Seats are enforced server-side or not at all; the relay is the place that must read them.
- Until the relay accepts an account, an account is a front door to nothing on this deployment.
- The invite-key tables and bespoke redemption route are gone, so the plugin's invariant is the only one.

## Settled 2026-10-26

- Attendance at the relay: [ADR-0074](0074-the-relay-verifies-a-session-jwt-against-jwks.md) accepts a
  Better Auth session JWT, so the `account-check-unavailable` refusal above goes.
- The deployed auth service: [ADR-0073](0073-the-control-plane-is-a-separate-process.md) makes it a
  control-plane route, which is the same deployment question with a process boundary.
- The billing front door: [ADR-0077](0077-sign-up-is-open.md) opens sign-up and
  [ADR-0078](0078-billing-runs-on-the-auth-plugin.md) carries the subscription.
- Claiming: [ADR-0076](0076-the-owner-key-is-deleted.md) makes `onLinkAccount` the only hand-over, and
  the conditional `UPDATE` on the document id survives it.
