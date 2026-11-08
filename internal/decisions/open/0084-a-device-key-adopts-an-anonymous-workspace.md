# ADR-0084: A device key adopts an anonymous workspace, and an id alone does not

- Status: proposed
- Date: 2026-10-28
- Related: [ADR-0076](0076-the-owner-key-is-deleted.md) (the record whose reasoning this extends), [ADR-0065](0065-accounts-own-workspaces.md) (the organization a claim lands in), `docs/reference/security-model.md` (the limit this closes), `apps/collab-server/src/http/access.ts`, `services/auth/src/http/routes.ts`
- Shipped: the limit is now documented as a limit rather than a footnote
  (`docs/reference/security-model.md`, "A named limit: an unclaimed workspace's id is its
  credential"), and the already-claimed refusal is tested in `workspaceHttp.test.ts`,
  `shareHttp.test.ts` and `attachmentHttp.test.ts`.
- Remaining: the key itself — minted by the first browser, presented on the anonymous join and on
  the claim, verified by the relay, and backfilled for workspaces that already exist without one.

## Decision

A browser that creates an anonymous workspace mints a **device key** and keeps it in the same store as
the workspace id. The relay records a hash of it against the workspace on first write and requires it
on every later anonymous join and on the claim that adopts the workspace into an account.

The key is invisible. There is no words list, no ceremony, no recovery path and nothing for the reader
to type or lose, which is the difference from the owner key ADR-0076 deleted: that key *was* the user
experience — 32 bytes, twelve recovery words and three ways to lose them — and deleting the ceremony
was right. Deleting the *idea* of a secret was not, and this record separates the two.

What it protects is one thing exactly: while a workspace is unclaimed, holding its id is currently the
same as owning it, and an id reaches a second person whenever the first one pastes a URL somewhere. A
key that never travels in a URL makes an id insufficient.

## Rejected alternatives

- **Leave the id as the credential and document the limit.** This is the status quo, and the honest
  answer for today, but it means a paste into a chat channel is an authorization decision. It is only
  defensible because a share link carries a slug rather than an id, which is a coincidence of the
  share design rather than a property of the workspace.
- **Bring back the owner key.** It existed, and it worked; it also put a recovery ceremony in front of
  a canvas that people open to draw. The failure was the ceremony, not the hash.
- **Bind the workspace to a browser fingerprint or an IP.** No stability across devices, no privacy
  story, and a false refusal is indistinguishable from data loss.
- **Server-side claim windows (first join wins, as today).** Already the rule; it does not help,
  because the attacker's join is the first one.

## Consequences

- Losing the device key is losing the anonymous workspace *on this browser*, which is already true of
  the document: the key lives beside the copy it guards. An export is still the way out, and a claimed
  workspace has an account instead.
- The relay's anonymous join gains a credential, so the handshake changes: an HTTP route registers
  the hash on first use, and the socket presents the key. Until a deployment requires it, an existing
  workspace without a key keeps working, which is what makes the rollout additive.
- A claim carries the key, so the "sign in and it comes with you" flow becomes a proof rather than a
  guess. `onLinkAccount` is where that lands.
- The client has one more thing to keep in step with the workspace id, and a mismatch must read as
  "this workspace belongs to another browser" rather than as a corrupt document.
