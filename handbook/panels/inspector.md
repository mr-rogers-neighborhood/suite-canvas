---
title: The inspector
description: "One panel for whatever is selected, with Details, Content and Style, and what each tab is for."
order: 10
targets:
  - kind: ui
    id: card-inspector
  - kind: ui
    id: inspector-tabs
---

The inspector is about one thing at a time: the selected card, the selected section, or the
selected link. It is where a property is edited without leaving the board, and it is the only
place that edits one.

Its tabs are chosen by what is selected rather than by a setting. A card gets **Details**,
**Content** and **Style**; a portal gets Details, Contents and Style; a section gets Details and
Contents, because its paint is the one colour it owns and everything else is the theme. Selecting
several things takes the tabs they have in common instead of adding them up
([inspector tabs](target:ui:inspector-tabs)).

Details holds the type and its fields. Content holds the body, when the card has one. Style holds
the icon, the colour and anything else about how it looks. The body can also be written on the
card itself; both surfaces edit the same text, and only one of them is editable at a time, so two
cursors can never fight over one paragraph.

Closing the inspector is not a way to lose work: it reads the document and writes through it
immediately, with no draft kept in the panel.
