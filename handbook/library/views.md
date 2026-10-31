---
title: Views, collections and renders
description: "What a view is, the four ways a collection is drawn, and what a render adds."
order: 21
targets:
  - kind: ui
    id: views-surface-controls
---

A view has a **kind**, which says how its result is read rather than what it selects.

**Collections** are rows of cards. A `Table` shows every field as a column; a `Grid` shows tiles; a `List`
shows one line each; a `Board` shows the cards where they sit on their board, drawn small, with the ones you
have not placed named underneath. Whichever you pick, a cell writes through to the card, so a table is an
editor of the same records the board draws.

**Renders** are for shape rather than detail. A `Graph` draws the selected cards and the links between them;
`Bars` and `Line` aggregate — count the cards, or sum or average a number field — and bucket them by type,
tag or section.

**Grouping** is one control over the query: no grouping, by section, by type, by tag, or by any field whose
value is already a label. Groups are drawn with their counts, and pressing a group narrows *your* surface to
it without changing the view for anyone else. A chart's bars work the same way: press one to see what is in
it.

Two things always follow the same rule. Changing a **kind, presentation, grouping or sort** edits the view,
and everyone sees it. Changing what you are **looking at** — the mode, a drill-down, a hidden column — is
yours alone, and nothing about it is written.
