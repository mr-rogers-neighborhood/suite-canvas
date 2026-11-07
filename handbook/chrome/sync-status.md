---
title: Sync and people
description: "What the status pill means, what the Sync dialog does, and the words each state uses."
order: 50
targets:
  - kind: ui
    id: sync-status
---

The status pill is the product's only running commentary on a shared workspace. It has four things
to say, and it says them in the same place every time:

- **Local only** — nobody else has a copy. This is the default, and it is not a failure.
- **Syncing · 2** — this workspace is on more than one device, and the count is how many.
- **Host asleep** — the machine this workspace is shared from is not answering. Edits still save
  here, and they catch up when it wakes.
- **Waiting** — an invitation has been used, and the other person has not let this device in yet.
  It keeps saying so after the dialog is closed, because being let in is something you are waiting
  for, not a task you are in the middle of.

Clicking the pill opens the Sync dialog, which does one of three things depending on where the
workspace is:

**Not shared.** Two errands: *Share this workspace* asks where this machine can be reached — Start
shows that address — and *Join one somebody shared* takes an invitation you were sent.

**Shared.** One invitation to give away, and the devices already here with what each of them may do.
An invitation is a string, handed over however you like; whoever uses it is added, in the role the
invitation named. Each device has a **Remove** beside it, which takes it out of the workspace for
good: it can no longer read anything new, its own copy stays where it is, and the only way back in is
a fresh invitation. **Stop sharing on this device** leaves the workspace here and lets go of the copy
the other machines keep, which is why it is not the same as deleting anything.

**Shared, and nobody has answered about a way back in.** The dialog offers one file, once, with an
optional passphrase ([a way back in](target:ui:sync-status)). Declining is a decision, and it is
remembered.

**Waiting.** One line, and nothing to press. The invitation did the deciding; the other person only
has to accept it.

Every one of these is a read of what the machine sharing the workspace already knows. The dialog
never sends anything on its own, and nothing in it shows a fingerprint, a frame count or an epoch —
those are how it works, not what anyone is being asked to do.
