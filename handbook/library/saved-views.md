---
title: Saved views
description: "A stored query, the menu that opens it, and how one gets created."
order: 20
targets:
  - kind: ui
    id: views-bar
---

A view is a stored query, not a stored result. Opening one copies its filters into the library's own
controls, and the list is computed fresh from the document, so a card added a minute ago is already
in a view that matches it.

The menu beside the board controls lists the views this workspace has. Choosing one filters the
library and remembers which view is active; **Place** on a row puts its results on the board in the
view's own order, which is how a filtered list becomes a layout.

**New view…** saves whatever the library is showing right now, including nothing: an unfiltered save
is "all cards", which is a legitimate starting point for a view you are about to narrow. The name
starts from the search text when there is one.

Renaming and deleting sit on each row. Deleting the view you are looking at returns you to the
unfiltered list rather than leaving the library filtered by a query that no longer exists.

Views are a development-only door for now: the bar ships behind a flag while the surface around it
is finished.
