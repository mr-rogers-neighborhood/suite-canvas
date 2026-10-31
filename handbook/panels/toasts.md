---
title: Toasts
description: "The small messages that appear over the board, and what they are for."
order: 70
targets:
  - kind: ui
    id: toast-layer
---

A toast is for something that happened and cannot be acted on in place: a save that failed, a
browser that will not keep the workspace, a storage warning, a copy that succeeded. One line and, at
most, one action.

They are deliberately not the way the product reports everything. A refusal that belongs to a form
appears in the form; a conflict belongs beside the button that caused it; a dialog asks. The toast
layer is the fallback for the cases with no surface to own them, which is why it is mounted once at
the shell root and never inside a card.

A screen reader hears the same news through a live region. The two are separate on purpose: the
toast is the visual stack, and the announcement is what a reader who is not looking needs.

Storage warnings cross once. A stage has to fall back and climb again before the same line is
repeated, because a banner that re-fires on every keystroke is a banner that gets ignored.
