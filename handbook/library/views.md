---
title: Views
description: "One query, three ways to show it: a lens on the board, a collection, or a render."
order: 30
targets:
  - kind: ui
    id: views-presentation
---

A view is a question about the workspace, saved with a name. The question is a context — words to
match, types, tags, sections and cards you pinned by hand — and the answer is shown in one of three
ways:

- a **lens** highlights those cards on the board and fades everything else;
- a **collection** shows them as a table, a grid or a list;
- a **render** shows them as a graph, or as a bar or line chart of a count.

The kind never changes which cards are in the view. Two views that share a context select the same
cards whatever they draw, which is why switching the kind of a saved view keeps its result.

A collection and a render open in [the presentation](target:ui:views-presentation), a reading over
the board with the card count and an Edit button. A lens is drawn on the board itself, with a strip
along the bottom naming the view, counting what is on this board and offering the boards the rest of
the context sits on. Cards in the inbox are counted and named, never invented: they have no position
on a board, so there is nothing to highlight.

Nothing in a view copies a card. A view is a rule, so a card renamed, retyped or trashed changes the
result the moment it happens, and a view never holds a stale list of the cards it used to match.
