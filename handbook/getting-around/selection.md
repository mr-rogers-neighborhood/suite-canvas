---
title: Selecting
description: "One click, a marquee, a modifier, and what a selection is for."
order: 20
---

A press on a card selects it. A press on empty space clears the selection and starts a marquee; drag
around what you want and release. Shift adds to the selection, or removes from it if the thing is
already in. `Shift` and the arrows extend, `Cmd-A` or `Ctrl-A` selects everything on the board, and
Escape clears.

The selection is UI state, not document state. It is not synced, it disappears when you leave the
board, and it is what several things read: the inspector, the outline, the commands that act on
"what is selected", and explain mode.

A multi-selection intersects rather than unions. Selecting a card and a section shows the tabs both
have, so a panel never offers a row that would write to only half of what you picked. Verbs that
count say the count — *Duplicate 4 cards* — because a plural is the only honest way to describe an
operation on a set.

Selection also decides what a modifier click does. With Alt held, the current gesture claims the
click; without it, a modifier click belongs to selection and never opens the inspector.
