---
title: Links
description: "Drawing a link between two things, and what a link means."
order: 30
---

A link joins two entities on a board: a card, a section or another link. The current gesture decides
what a drag draws — a link, a thread, a web or a pattern — and a modifier previews the gesture
without committing it. Nothing is stored until the click, because these keys are also undo and
multi-select.

A link has its own record, a label and a direction, so it can be selected, styled, described and
found. It is not a child of either end: delete a card and the links that reached it are removed
deliberately rather than silently, and the history panel shows the change like any other.

Links are what the layout commands read. Arranging a selection radially, or as a web, or as a
pattern, uses the links between the selected things as the shape of the arrangement; with no links
it falls back to a plain grid.

A mention in a body is a reference rather than a link — a lighter thing, resolved by name at read
time — which is why a mention to a deleted card reads as removed instead of drawing a line to
nothing.
