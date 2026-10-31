---
title: Sync, people and storage
description: "What the status pill means, and the one panel that explains saving."
order: 50
targets:
  - kind: ui
    id: sync-status
---

The status pill is the product's only running commentary on whether your work is safe. It stays
quiet when everything is written, and its colour and wording change when it is not.

Opening it shows the sync panel:

- **Connection** — whether the relay is reachable, and why it is not.
- **Unsent changes** — what this tab still has to send.
- **This device's copy** — where the workspace is stored here, and what the browser has promised
  to keep. A copy the browser may clear under pressure is said plainly, because closing the tab
  would then lose what is not exported.
- **The relay's room** — the name this workspace syncs under, with the account's claim on it.
- **Storage** — how full the origin is, with *Export a copy* when it gets close.
- **The plan wall** — a workspace the account does not hold is refused with a reason, and the
  panel is where the door to plans is.

Every one of these is a read. The panel never retries by itself except through the *Try again*
action it offers, which is why a failure has a visible button rather than a loop.
