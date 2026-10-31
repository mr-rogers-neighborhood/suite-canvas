---
title: Hover peek
description: "Resting on a mention, a backlink or an outline row names what it points at."
order: 20
targets:
  - kind: ui
    id: peek-surface
---

A rest on anything that names something else draws a small card: what it is, what kind of thing it
is, and one line of context. A card reads the same way in the outline rail, in an article and on a
link endpoint, because all three ask the same resolver.

Three rules make it feel like a reading rather than a popup:

- It opens after a rest, not on the way past. A pointer crossing five mentions on the way to a click
  should not open five cards.
- Nothing is written. A hover is not an edit, it does not change the selection, and it is not
  published to collaborators.
- It does not move the camera. Opening the card is what scrolls the thing into view.

Escape, a press anywhere, a scroll and a zoom all dismiss it. A reference to something deleted says
"removed" rather than vanishing, so a backlink to a trashed card reads as history.

The card never takes focus itself: a hover that stole focus would interrupt typing, and a keyboard
reader who tabbed to the trigger is already where they meant to be.
