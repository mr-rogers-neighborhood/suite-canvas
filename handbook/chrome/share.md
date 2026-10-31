---
title: Share
description: "Publishing a board as a link, and what a reader of that link can do."
order: 60
targets:
  - kind: ui
    id: share-action
---

**Share** publishes a board as a link. It is not a workspace invite: the link carries one board and
what is on it, and it is read-only.

The dialog that opens is the whole story of a share: the scope label a reader sees, the draft and
its conflicts, and the switch that revokes every link. A draft is previewed before it is published,
because publishing is what other people can see; a conflict is reported where the publish button is
rather than as a toast that cannot be acted on.

Revoking every link asks twice, inline, inside the dialog. That is the one confirmation in the app
that replaces the control instead of opening a second panel, so the thing about to be lost stays on
screen while you decide.

A workspace that is not in an account cannot publish, and the refusal names the plan rather than
the button. A share link is read-only for whoever opens it: they see the board, not the rest of the
workspace, and not the library.
