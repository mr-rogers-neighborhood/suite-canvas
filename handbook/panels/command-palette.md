---
title: The command palette
description: "One query for finding things and doing things."
order: 40
targets:
  - kind: ui
    id: command-palette
---

The palette is opened from the search field, from `Cmd-K` or `Ctrl-K`, and from the shortcut sheet.
It searches cards and boards and runs commands in the same list.

Every command is described once, in one registry, with the group it belongs to, the surfaces that
list it, the capabilities it needs and a predicate over the current state. The library, the
inspector and the board's context menu read that same registry, which is why a read-only session
loses a command everywhere at once instead of in the surfaces someone remembered to guard.

Typing filters, the arrows move the highlight, Enter runs the row after closing, Escape closes. The
list is a combobox: focus stays in the field and the highlighted row is named to a screen reader, so
a keystroke never disappears into a list that took focus after the first character.

A command that has a shortcut prints it at the row's right edge, read from the same field the
shortcut sheet reads.
