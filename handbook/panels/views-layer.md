---
title: The views layer
description: "A mode for reading your workspace as data: the rail, the presentation, and the two states."
order: 90
targets:
  - kind: ui
    id: views-layer
---

The layer is where a view is read and edited. It opens from the views icon, from a view card, or from the
projection float, and it takes the whole window — a view is a surface, so it gets one.

It has two states, and the switch is in the header.

**Read** is where it opens. The presentation fills the window, the context is a sentence rather than six
inputs — the words, how many filters, whether it is board-scoped, how many cards you picked by hand, how
many groups — and a cell is a value. `Done` or `Back` takes you to the board.

**Edit** is the same surface with its controls: how the result is drawn, what it is grouped by, the column
sorts, and a `Context` drawer over the rail with the words, the scope, type, tag and section chips, the
pinned cards and an Advanced disclosure. A cell becomes an input and writes on Enter or blur, so typing in a
table is one write per value rather than one per keystroke.

On the left, every saved view with a live thumbnail, its kind and its count. Hovering a row offers **duplicate**
and **delete**; `D` and `Backspace` do the same from the keyboard, and the footer offers **Undo** after a
delete. Past eight views the rail groups them under *Collections* and *Renders*.

A saved view is editable by anyone who can change the workspace, and the change lands for everyone as it
happens. `Done` leaves, `Discard my edits` restores the record you opened. A new view is different: it is a
draft until `Create`, so starting one is cancellable and it only exists once you mean it.
