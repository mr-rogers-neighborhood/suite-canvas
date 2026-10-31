---
title: Properties
description: "Fields on a card, and the blocks that show one inside a body."
order: 20
---

A card's properties are the fields its type gives it. They are edited in the inspector's Details
tab, and they are what views filter and sort on, so a field that matters to a query is worth adding
to the type rather than writing into the body.

A field has a kind, and the kind decides how it is edited: text, number, select, date, link, and so
on. A select carries its own options and colours. A value outlives a lens: hiding a field in one
board's display does not delete anything.

A property block shows one field inside a card's body, which is how a card can be read as a record
rather than as prose. It is the same value the inspector edits; the block is a renderer, not a copy,
so editing either place changes one number.

A mention with a dot — `@card.field` — reads another card's field. It stays live: rename the field
and the chip follows, delete the card and the chip says the reference is gone rather than showing
stale text.
