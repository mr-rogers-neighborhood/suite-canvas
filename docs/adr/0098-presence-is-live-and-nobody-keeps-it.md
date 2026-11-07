# ADR-0098: presence is live, and nobody keeps it

- Status: accepted
- Date: 2026-11-06
- Related: [ADR-0004](./0004-node-content-and-presence.md), [ADR-0005](./0005-flow-space-presence.md), [`apps/desktop/src/main/sync/service.ts`](../../apps/desktop/src/main/sync/service.ts), [`packages/protocol/src/relay.ts`](../../../suite-sync/packages/protocol/src/relay.ts)

## The problem

Cursors, selections, who is editing which card, and which board somebody is on have been built in
this app for months and have had nowhere to go since the hosted tier was deleted. Sync now carries
document updates; it had no way to carry anything that should not be kept.

## Decision

**A presence message is forwarded and forgotten.** The host verifies who sent it, relays it to the
room, and never numbers, appends or writes it down. A cursor in the frame log would be a document
that grows every time somebody moves their mouse.

- **It is not a frame.** A frame carries the group's application ciphertext, which ratchets per
  message: one dropped cursor would leave a gap in the secret tree that the next *document* update
  had to work around. Presence is sealed with a key derived from the group instead
  (`exportKey(group, "suite/presence", workspaceId)`), so it can be late, out of order or absent and
  cost nothing. The key changes with the epoch, so forward secrecy is unchanged.
- **Membership, not write permission, is the check.** A reader whose cursor nobody could see would
  make "collaboration" mean collaboration between editors. The host refuses a presence message from
  a device with no role, and from a device speaking for another one.
- **A peer is forgotten after three missed beats.** The ephemeral store expires a peer that has been
  quiet for fifteen seconds against a five-second heartbeat, so a closed laptop and a crash look the
  same. What a person sees is a dot that fades, not a device list that lies.
- **The workspace is the scope, not the board.** Somebody reading another board is still here, and
  the title bar says so. Cursors already show where someone is on *this* board; "elsewhere in this
  workspace" is the rest of the answer.

## Consequences

Presence is the first thing this architecture sends that nobody keeps, which means the test that
matters asserts *absence*: after a real relay, the store holds no frame for it. A bug here would
either grow a document with cursors or drop them silently, and only the store scan catches the first.
