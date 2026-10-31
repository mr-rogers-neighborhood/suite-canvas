---
title: The library
description: "Every card, board and trashed record, with search, facets and saved views."
order: 10
targets:
  - kind: ui
    id: library-drawer
  - kind: ui
    id: library-search
  - kind: ui
    id: library-tabs
---

The library is the whole workspace in one list. It is a drawer over the board rather than a page, so
you can drag a row onto the canvas without losing your place.

Its sections are across the top — Inbox, Cards, Boards, Views, Sketches, Portals and Trash — with a
count beside each. Sketches and Portals are the Cards list narrowed to one built-in type, not a
second code path, so sorting, facets and selection work the same way everywhere.

Search and facets are the same query in two shapes: text on the left, then type, tag, section and
scope. The active view, if there is one, is a chip beside the tabs with an `×` that returns you to
the unfiltered list.

A row opens on its button, which is the row's only tab stop; the `⋯` menu or a right-click is how a
keyboard reaches Place, Trash and the rest. A press on the title lifts the row for a drag, because
dropping a card where you want it is the most common thing to do with one.

The drawer widens to the whole window when you ask it to. The floating width stays the default
because a row has to be draggable onto the canvas beside it.
