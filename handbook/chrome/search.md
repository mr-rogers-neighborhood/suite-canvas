---
title: Search and the command bar
description: "One field that finds cards and boards and runs commands."
order: 40
targets:
  - kind: ui
    id: command-bar
---

The search field in the title bar opens the [command palette](target:ui:command-palette). It is
deliberately one surface: a separate page search and a separate command list would be two places
to look for the same thing, and two rankings that could disagree.

What it finds is whatever the palette's providers offer: cards by title, boards by name, and the
commands the current state allows. `Cmd-K` or `Ctrl-K` opens it from anywhere on the board, and the
field prints that shortcut because it is the one key worth learning first.

The field is a button, not an input. Nothing is typed until the palette is open, so the title bar
never holds a half-finished query that the canvas behind it knows nothing about.
