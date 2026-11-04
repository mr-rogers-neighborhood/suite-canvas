---
title: Selecting
description: "One click, a marquee, a modifier, and what a selection is for."
order: 20
---

A press on a card selects it. A press on empty space clears the selection and starts a marquee; drag
around what you want and release. Shift adds to the selection, or removes from it if the thing is
already in. `Shift` and the arrows extend, `Cmd-A` or `Ctrl-A` selects everything on the board, and
Escape clears.

What the box picks up is yours to say. The box icon in the corner of the canvas opens three toggles: cards,
sections and links. They combine, so a box can take the cards it touches without also sweeping up the arrows it
crosses, and all three start on.

A box that catches cards inside a section takes the section as well, drawn as a selection around them; the panel stays
with the cards, and Delete acts on them rather than on the frame. A box that catches nothing but a section is the
section alone, which opens its panel. A box always picks up something, so the last toggle on closes the menu instead
of switching itself off.

Everything selected wears the same outline, whatever it is: a card its ring, a link its accent line and a section a
ring around its edge in the section's own colour underneath. The box around the group wraps the largest thing in it,
so a frame and the cards inside it are one selection rather than a box around the cards alone, and the words beside
the box say how many of each you are about to act on.

Sections can be selected together. Hold Cmd or Ctrl and press another frame's header, or another row in the outline,
to add it; a box that crosses an outer frame and the frame inside it takes both. Dragging any member of a mixed
selection moves the whole of it — the cards, the frames, and anything nested inside them — as one piece.

The selection is UI state, not document state. It is not synced, it disappears when you leave the
board, and it is what several things read: the inspector, the outline, the commands that act on
"what is selected", and explain mode.

A multi-selection intersects rather than unions. Selecting a card and a section shows the tabs both
have, so a panel never offers a row that would write to only half of what you picked. Verbs that
count say the count — *Duplicate 4 cards* — because a plural is the only honest way to describe an
operation on a set.

The inspector follows the selection: it opens on a box as well as on a click, describing the last
thing you picked and how many of each kind you have. Its Style tab hands one colour to everything
selected — cards, links and frames, each in its own field — and the right-click Colour row does the
same, so colouring a mixed selection is one press, and one press of undo takes it back. A frame's
part of that is the only style it has: shape, sides and text size are hidden when a frame is in the
set, because those rows could not reach it.

Selection also decides what a modifier click does. With Alt held, the current gesture claims the
click; without it, a modifier click belongs to selection and never opens the inspector.
