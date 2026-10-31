---
title: The outline
description: "The board's section tree, and the toggle that shows it."
order: 110
targets:
  - kind: ui
    id: outline-control
  - kind: ui
    id: board-outline
---

The outline is the board's structure in reading order: every section, with the cards it holds, and
the people currently on each. It is a rail beside the canvas, and the toggle beside version history
opens it (`[`).

It exists because a large board is hard to navigate by eye. A press on a row moves the camera to
what the row names, so the rail is a table of contents rather than a second copy of the board. Peer
avatars on a row answer "where is everyone" without a scan.

The rail hides itself while a board has no sections, because a tree with nothing in it is a panel
that would only ever be closed again.

Resting on a row names what it points at rather than travelling to it — the
[hover peek](target:ui:peek-surface) reads the same way here as everywhere else.
