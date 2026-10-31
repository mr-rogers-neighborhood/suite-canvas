---
title: The views editor
description: "Where a view is written: a context, a kind, and how that kind presents it — with the board visible behind."
order: 90
targets:
  - kind: ui
    id: views-editor
---

The editor opens as a sheet on the right, so the board stays in front of you while you build the
question. A saved view sits on the left; the right pane is three steps, top to bottom.

**Context** is what is in the view. Words to match, a choice between titles, bodies or both, and
chips for types, tags and sections. Cards you add by hand are pinned beside the query — the two
combine, and the read-out tells you which is which (`12 cards · 3 pinned · 2 boards`). A pin that
points at a trashed card is reported rather than quietly dropped.

**Kind** is how the result is shown: a lens, a collection or a render.

**Presentation** depends on the kind: outlines for a lens, a table, grid or list for a collection,
a graph or a chart for a render.

Everything previews as you type. With **Live preview** on — and it is on by default — a lens fades
and outlines the board immediately, and a collection or render takes the board area behind the
sheet. Nothing is written until you press Save, so you can try a view without committing it, and
closing the sheet leaves the draft applied and labelled `Preview · name` on the strip, with Edit
beside it. Cancel throws the draft away and puts back whatever was applied before.

Save writes the view, applies it and closes. A view the reader may not save — because they cannot
change the workspace's configuration — says so instead of offering a button that would fail.
