---
title: Board tabs
description: "How boards are opened, switched and pinned, and what a tab's peer avatars mean."
order: 20
targets:
  - kind: ui
    id: board-switcher
---

Boards are tabs, but the strip is a navigation rather than a workspace: switching a board replaces
the canvas, so the active tab is marked `aria-current`. Each tab carries the number of people
looking at that board, so "where is everyone" is answerable without opening the outline.

Two kinds of tab look the same and are different promises. An **open** tab is a board you have
visited; a **pinned** tab is one you asked to keep in front of you, and it stays in the strip
until you unpin it. `+` creates a new board.

Right-click a tab (or use its `⋯` menu) to rename it, give it a colour or an icon, pin it, or open
the library filtered to boards. The back control appears when the visit history has somewhere to
go, and it restores the viewport you left as well as the board.

A board that is reached through a [portal](target:ui:canvas-surface) opens the same way a tab
does, which is why the back stack exists for every route in: it should not matter how you got
somewhere, only that you can get back.
