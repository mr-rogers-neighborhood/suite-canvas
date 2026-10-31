---
title: Undo and redo
description: "What undo reaches, and the one case the document cannot explain on its own."
order: 80
targets:
  - kind: ui
    id: undo-redo
---

Undo steps the workspace's own history, so it reaches structure — a card, a section, a link, a
placement — rather than the words inside a card that the text editor is currently holding.

One case needed help. When a run or a stack has just placed cards and you undo it, the card should
come back to your hand rather than disappear into the inbox with nothing on screen to explain where
it went. Every undo path goes through the same function for that reason: the keyboard, these
buttons, the palette and the version history panel. A card that comes back on one route and
vanishes on another is worse than one that never comes back.

Undo is per-document and collaborative. It steps the history this workspace already keeps, and it
is an ordinary change, so it syncs and can itself be undone.
