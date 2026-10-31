---
title: Projections
description: "Casting a view onto your board: outlined cards, faded everything else, and a bar that explains it."
order: 100
targets:
  - kind: ui
    id: views-projection-bar
---

A projection is a view cast onto your board. The cards it selects are outlined, everything it does not
select fades, and a bar at the bottom says which view this is.

It is **yours**. Another person on the same board sees their own board, and if they project something you
do not. The projection is remembered in this browser, so reopening the tab returns to the view you were
reading, and it disappears if someone deletes the view — a bar naming a record nobody can open would be a
promise the app could not keep.

The bar is also where a context that spans boards explains itself. The chips are the boards the view
touches, with counts; pressing one moves you there with the projection still on. Cards in the inbox are
counted and named but never drawn, because an unplaced card has no position to outline.

**Outline** and **Fade** are the two switches, and they are yours as well: they describe how you like to
read, not what the view means. **Open** goes to the layer on the same view, and the cross stops projecting.
