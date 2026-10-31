---
title: Version history
description: "The saved points a workspace already has, and restoring one."
order: 100
targets:
  - kind: ui
    id: history-toggle
---

A version is a point in the workspace's own log, not a copy taken on a schedule. The panel lists
them with relative times, and picking one shows what a restore would change before you press the
button.

Restoring writes an ordinary change. It syncs like any other edit, and **Undo** puts it back — which
is why the panel offers Undo immediately after a restore rather than asking for a confirmation
first and then leaving you with nothing to do about it.

The preview matters because a restore reaches every change after the point, for you and for
everyone else on the workspace. The panel says so in the same place it says what would be lost,
rather than in a second dialog nobody opens.
