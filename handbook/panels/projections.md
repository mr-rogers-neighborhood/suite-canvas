---
title: Projections
description: "Casting a view onto your board: outlined cards, faded everything else, and a float that explains it."
order: 100
targets:
  - kind: ui
    id: views-projection-float
---

A projection is a view cast onto your board. The cards it selects are outlined, everything it does not
select fades, and a small float sits over the board saying which view this is. Drag it by its handle to put
it wherever you are not reading; it comes back to that corner next time, and it steers around the dock.

It is **yours**. Another person on the same board sees their own board, and their own float, if they
project something you do not. The projection is remembered in this browser, so reopening the tab returns to
the view you were reading, and it disappears if someone deletes the view — a float naming a record nobody
can open would be a promise the app could not keep.

The float is also where a context that spans boards explains itself. The chips are the boards the view
touches, with counts; pressing one moves you there with the projection still on. Cards in the inbox are
counted and named but never drawn, because an unplaced card has no position to outline.

**Outline** and **Fade** are the two switches, and they are yours as well: they describe how you like to
read, not what the view means. **Open** goes to [the layer](target:ui:views-layer) on the same view, and the
cross stops projecting.

## Picking

Picking cards into a view is a projection being built, so it looks like one. The layer steps out of the
window, your view is cast over the board, and every press on a card adds it — and a second press takes it
out again. The float changes to say what you are picking for and how many are in.

**Done** takes you back to the layer on that view. **Cancel** puts back exactly the pins that were there
before you started, even if you wandered to another board in between.
