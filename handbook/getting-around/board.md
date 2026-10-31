---
title: The board
description: "The canvas itself: panning, zooming, selecting, and what a press on a card does."
order: 10
targets:
  - kind: ui
    id: canvas-surface
---

The board is an infinite surface. Drag on empty space to pan; scroll or pinch to zoom; the zoom
control and "fit" sit in the corner beside the purpose control.

A press does different things depending on what it lands on and which modifier is held. On a card
it selects and opens the focus; on empty space it clears the selection and starts a marquee. With
Shift it adds to the selection. With Alt it does the gesture the current tool names — a link, a
thread, a web, a pattern — and a click during that modifier commits it rather than previewing.

Cards stay where you put them. Position is part of the document, so a card moved on this board is
moved for everyone on it, and a card can appear on several boards at once. Nothing about the
camera is shared: zooming out to see the whole board does not move anyone else's view.

The board is also a document, not a page. Every edit is a CRDT operation, which is why two people
can type in different cards at the same time and why the canvas keeps working offline.
