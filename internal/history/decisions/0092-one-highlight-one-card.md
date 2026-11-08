# ADR-0092: one highlight, one card, and schema 6

Status: accepted, 2026-10-31. Amends ADR-0089 and ADR-0090.

## Context

ADR-0089 gave a highlight parts, and ADR-0090 gave each part a destination drawn from its kind. One of those
destinations was `own-card`: a part that became a card of its own, so a paragraph could be cut into several notes in
one gesture.

It read well and behaved badly. A press of **Place** made a number of cards nobody could predict from the outside — the
button had to say "Place 2 cards" to warn you — and no single undo put the result back. The mapping stopped being a
statement about what a card says and became a statement about how many cards exist, which is a much larger thing to
attach to a colour.

## Decision

**A highlight produces exactly one card.** Its parts fill that card's title and properties. Nothing a kind's recipe says
can change how many things appear on the board, so **Place** always means one card, and the raise surface says the same
word however the passage was cut up.

**The destination is deleted, and the schema moves to 6.** The data-model how-to is explicit: an existing field that
changes meaning needs a version bump and a decision first. A part that said "a card of its own" now means "the passage",
so `SCHEMA_VERSION` goes 5 to 6.

**There is no migration script.** The how-to says so, and the reason holds: a document is repaired by the normalising
reader. `readParts` and `readStyle` in `packages/graph/src/loro/annotations.ts` rewrite a stored
`{ kind: "own-card" }` to `{ kind: "body" }` before parsing. This is not politeness — a record that fails
`annotationPartSchema` is skipped by `readAnnotation`, so the alternative is a reader's highlight silently ceasing to
exist. The words are not lost by dropping the destination: the passage is already the card's first block.

## Consequences

- `PromoteResult.ownCardIds` is gone, and `handOverHighlight` carries one id instead of a list.
- The raise surface loses the destination and its "Place N cards" count; the kinds editor loses the slot.
- A legacy document opens with its highlights intact, one card each, and the part that asked for its own card folds
  into the passage.
- `docs/reference/data-model.md` and `docs/how-to/change-the-data-model.md` both said the schema was 4, two bumps out
  of date. Corrected while bumping.

## Open

- A reader who genuinely wants three notes from one paragraph makes three highlights today. If that turns out to be
  common, the answer is a "split into highlights" action on the raised surface, not a second card per press.
