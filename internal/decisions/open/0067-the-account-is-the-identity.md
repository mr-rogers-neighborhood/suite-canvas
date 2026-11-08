# ADR-0067: The account is the identity

- Status: partial; the key as transport is settled against this record by [ADR-0076](0076-the-owner-key-is-deleted.md), and the front door by [ADR-0077](0077-sign-up-is-open.md)
- Date: 2026-10-25
- Shipped: the sign-in dialog, admission gate, claim-on-sign-in, invited-account passwords and the
  retirement of the passphrase path (`apps/canvas/src/auth/`), on top of `services/auth`.
- Remaining: the relay accepting an account session instead of an owner key, a deployed identity
  service, and the decision about what "Open recovery key…" becomes.
- Full text: [archive](../../../../history/decisions/0067-the-account-is-the-identity.md)

## Decision

The account is the identity and the owner key is transport: a person signs in, their workspaces are
claimed by one `UPDATE`, and the key is never named, copied or pasted in the normal flow. Import stays
account-free, and everything that needs a second party — sync, collaboration, shares, publishing,
billing — needs the account.

## Consequences

- One recovery story replaces four names for one secret.
- Offline use survives: a `.suite` import is fully usable with no account.
- The owner file survives as an advanced local-only path, not as the identity.
- Until the relay reads a session, the account layer is built but not load-bearing.

## Settled 2026-10-26

- The key as transport: [ADR-0076](0076-the-owner-key-is-deleted.md) deletes it, with no migration for
  issued keys, so "the owner file survives as an advanced local-only path" is decided against.
- The front door: [ADR-0077](0077-sign-up-is-open.md) opens sign-up and keeps invitations as an
  organization feature, so an account is reachable without one.
- What stays open here is deployment only, and [ADR-0073](0073-the-control-plane-is-a-separate-process.md)
  tracks it.
