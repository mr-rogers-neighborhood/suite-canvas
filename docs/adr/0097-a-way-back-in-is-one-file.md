# ADR-0097: a way back in is one file, and it is the device

- Status: accepted
- Date: 2026-11-06
- Related: [ADR-0021](./0021-sharing-seam-deferred.md), [`apps/desktop/src/main/sync/kit.ts`](../../apps/desktop/src/main/sync/kit.ts), [`packages/contracts/src/syncKits.ts`](../../../suite-start/packages/contracts/src/syncKits.ts)

## The problem

The hub cannot read a workspace, so it cannot restore one, and MLS has no escrow. If every device
in a workspace is lost, the workspace is gone — and the person has no way to know that until it
happens. A recovery file is the only safety net the architecture can offer, so it has to be real,
small and explainable.

## Decision

**A recovery file carries the device, not the data.** It holds two things: the Ed25519 identity the
hub has pinned, and the MLS group state that can read what was sealed to it. Restoring it on a new
machine makes that machine *this device* — same id, same place in the group — and the document it
opens is whatever the person still has on disk.

That is what makes it a recovery rather than a backup: whoever holds the file **is** this device,
which is also why the file's protection is the only design question it has.

- **Plain by default, with a passphrase offered.** A person keeping a file somewhere they already
  trust is the common case, and a forgotten passphrase is a third way to lose a workspace. The
  passphrase exists for the case where the file will travel — a cloud folder, a USB stick in a bag.
- **scrypt, then AES-256-GCM.** The passphrase is never written down; the salt and nonce are.
  A wrong passphrase and a corrupt file are the same failure to a cipher and different failures to
  a person, so the message names the passphrase when one was supplied.
- **Offered once, right after a workspace becomes shared, and a decline is remembered.** The offer
  lives in the sync dialog and survives closing it, because the person may need to find a folder
  first. Declining is recorded in `sync-kits.json` for the hub's pane to read, so the interface is
  honest without nagging.
- **A restored group is a moment.** Frames that came before the file was written cannot be replayed:
  an application message needs the history it builds on, and a commit cannot be applied by the device
  that authored it. A restored device is therefore *in* the workspace and can read what comes next,
  and it needs a snapshot from a peer before it can read what happened in between. That is a gap in
  the product, not in this decision, and it is written down rather than papered over.

## What it is not

- Not a copy of the workspace. Exporting the document is a different gesture with a different promise.
- Not a second key. The identity inside is the one the hub already knows; a different key would be
  refused at the door, which is the property that makes the hub's pinning worth anything.
- Not shareable between devices: two machines cannot hold one identity, because the hub pins a key
  per device id and a second claimant is refused. Restoring *replaces* a device, it does not clone one.
