---
title: Pinned cards
description: "Keep a card in front of you while the board moves underneath it."
order: 30
targets:
  - kind: ui
    id: pinned-cards
---

Pinning lifts a card out of the board and into the shell. The pin lives in the card's header; the
card keeps its place on the board, drawn as a dimmed marker, so the placement is still the
document's record of where it belongs.

A pin ignores the camera and survives a board switch. That is the point: you pin the card you are
writing in, or the one you are copying from, and then you can zoom, pan or go and look at another
board without losing it.

Its geometry belongs to the shell, not the card. Dragging or resizing a pin never changes the card's
size or position on the board, which keeps pinning a reading aid rather than a second layout.

The body stays editable on the pin, and the board copy becomes a static face while it is pinned —
that is how one body keeps exactly one editor. Pins settle around each other and around the chrome
as the window changes size; a pin dropped somewhere illegal is moved on release rather than fighting
the pointer while it moves.

What is pinned is your own arrangement. It is never synced, never exported, and it goes when the
window does.
