# ADR-0072: An annotation is a card that points into a source

- Status: proposed
- Date: 2026-10-25
- Shipped: nothing.
- Remaining: the range field on a card, the target contract for PDF pages and video timecodes, and the
  reader/player choice.
- Full text: [archive](../../../../history/decisions/0072-an-annotation-is-a-card-that-points-into-a-source.md)

## Decision

An annotation is an ordinary card carrying a `target` plus a range into the source, so it can project as
a card, appear in the library, drop onto a canvas and detach into a plain card. Three renderings — a
margin note, a highlight, a quoted excerpt — sit over that one record.

## Consequences

- No annotation object class and no second comment thread: the card is the unit.
- Media stays a field, so a PDF page or a timecode is metadata, not a new card kind.
- A range must survive an edited source; what "stale" means is part of the contract.
- Choosing a reader is a dependency decision, and this record names it as the remaining unknown.
