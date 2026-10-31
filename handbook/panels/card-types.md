---
title: Card types
description: "What a card is, and the fields and look its type gives it."
order: 50
targets:
  - kind: ui
    id: type-settings
---

A type is a shape for cards: a name, a glyph, fields, and optionally a look. A note is the type
every card falls back to; a sketch, a portal and a view are built in.

The type editor lists them and edits one: its name and plural, its glyph, its fields in order, its
templates, and its style. Fields carry a kind — text, number, select, date, link and so on — and the
kind decides how a value is edited and displayed everywhere the field appears.

Changing a type is a schema change, so it is gated by a capability rather than by the surface you
are in. Adding a field is additive and safe; removing one asks, because the values go with it.

A card can declare a type it has not been given yet. Installing it is previewed as a list of what
would be written, one checkbox per field, so a card that arrived from somewhere else never changes
shape without being shown what that means first.

Templates belong to a type, which is how "new card of this kind" can start with the fields a reader
actually uses.
