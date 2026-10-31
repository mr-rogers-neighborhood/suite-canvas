---
title: Interaction mode
description: "Read, edit or lock the board — three answers to \"what does a click do\"."
order: 90
targets:
  - kind: ui
    id: interaction-mode
---

Reading a board and editing it are the same click, so the click needs a mode. The control beside
undo and redo cycles three:

- **Inspect** is the default. A press on a card focuses its text and opens the inspector.
- **Quiet** focuses the text and leaves the inspector shut. The deliberate doors still open it —
  the link count on a card, or *Card info* in the context menu — because a door you aimed at is not
  an accidental click.
- **Locked** makes the board read-only for you. Cards cannot be dragged, selected, connected or
  edited, a double-click on empty space adds nothing, and the board's own keys go quiet. Panning and
  zooming still work, and Escape still works.

Every kind answers the mode, not only notes: a portal opens no panel under quiet and neither walks
through nor opens one under locked; a section press decides between clearing, ignoring and
selecting; a link keeps its selection under quiet, because a selected link is what Delete acts on.

The control names the mode you are in rather than the one a press would give you, so a board that
looks frozen says why.
