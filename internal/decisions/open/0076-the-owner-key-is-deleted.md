# ADR-0076: The owner key is deleted

- Status: proposed
- Date: 2026-10-26
- Related: [ADR-0067](0067-the-account-is-the-identity.md) (the record this replaces), [ADR-0074](0074-the-relay-verifies-a-session-jwt-against-jwks.md), [ADR-0077](0077-sign-up-is-open.md)
- Shipped: nothing. The owner key is still the credential a sync connection presents
  (`apps/collab-server/src/sync/seatGate.ts`).
- Remaining: deleting the key, its files and its protocol, and wiring `onLinkAccount` as the only hand-over.

## Decision

The owner key goes, with no migration for keys already issued. `.suitekey` files
(`apps/canvas/src/session/ownerKit.ts`), the 24-word phrase
(`apps/canvas/src/session/recoveryWords.ts`), the `#owner=` fragment
(`apps/canvas/src/session/ownerKey.ts`), the claim and rotate routes
(`apps/collab-server/src/http/workspaceHttp.ts`) and `admin reset-owner`
(`apps/collab-server/src/ops/admin.ts`) are removed. Anonymous local use continues through Better
Auth's `anonymous` plugin, and `onLinkAccount` (`services/auth/src/identity/betterAuth.ts`) is the
only hand-over. Local-first use is a product promise and it never needed a key.

## Rejected alternatives

- Keep the owner key as an advanced path for self-hosters. Two credentials mean two seat gates, two
  recovery stories and two ways to lose a workspace, and the relay already refuses the account
  principal because it cannot tell the two apart.
- Migrate issued keys into accounts on first sign-in. The keys were never identity, so the migration
  would invent a mapping the server cannot verify, and it keeps the claim protocol alive for one more
  release.
- Keep the recovery phrase as a local backup of an account session. It would be a second secret for the
  same account, with its own storage and its own loss mode.

## Consequences

- Anyone holding an exported `.suitekey` after this change cannot reopen their workspace on a server.
  The file stops being read and no support path restores it.
- A `.suite` import is still fully usable with no account.
- A workspace's identity is its document id, so the claim protocol's conditional `UPDATE` becomes
  `onLinkAccount`'s row move and no id changes.
- The relay accepts one credential, and the seat gate's `account-check-unavailable` refusal goes away.
