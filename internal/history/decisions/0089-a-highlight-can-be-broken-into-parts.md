# ADR-0089: a highlight can be broken into parts, and a part says where it goes

Status: accepted, 2026-10-31. Extends ADR-0087; amends the promotion rule it recorded.

## Context

Titling a highlight from its first few words is what Heptabase and Obsidian do, and it fails exactly when it matters:
the concept usually arrives *after* the clause that sets it up, so the title becomes the setup. The author's
complaint is structural rather than cosmetic — there is nothing in those tools that knows where the important words
are, because a highlight is one undifferentiated string.

The second complaint was smaller and the same shape: a highlight's type could only be changed from the palette you get
once, at the moment you select it.

## Decision

**A part is a range inside the quote, and nothing else.** `{ start, end, target }`, where the offsets index the
annotation's own quote. The quote is text, so a range of it is stable under reflow for exactly the reason the quote
is, and a part inherits the annotation's own resolution: if the highlight still finds its words, its parts still find
theirs.

A second `quote/prefix/suffix` per part was the tempting alternative and it is wrong: a sub-quote is frequently
ambiguous *inside its own paragraph*, and offsets never are.

**A target is a destination, not a promise.** `title`, `body`, `field:<name>`, or `own-card`. A named property is
created on the promoted type when it is missing, because a recipe has to survive a type change and an id-bound recipe
would not.

**`own-card` is a target, not a second subsystem.** So "one card per highlight" and "a card per part" are one
mechanism at different cardinalities, and the default path still makes one card.

**The raise surface is where a highlight is taken apart.** A press on a highlight — in the book or on the card it
became — raises it: the backdrop blurs, the quote sits alone at reading size, ranges are selectable there. This is the
decision that made the rest easy. A paragraph cannot be cut up where it sits, because the sentence is buried in a
chapter and the range would be chosen blind. It also dissolves a gesture conflict that would otherwise need
engineering: with parts chosen on a raised surface, a **press** no longer has to double as "select inside a highlight",
so a press can simply raise and a drag can simply carry.

**A style suggests; a highlight decides.** The style carries a recipe — the targets it expects — and the highlight
stores the parts it was actually broken into. Neither duplicates the other: the style says which destinations exist for
this kind of note, and the reader says which words go where, every time.

**One promotion per highlight.** `promoteAnnotation` opens the card a highlight already has instead of making a second
one; making another is `again`, an explicit row. Before this, a second promote overwrote `cardId` and orphaned the
first card from the record — reachable by accident as soon as a click menu exists.

**A promoted card quotes the whole passage.** Parts carve pieces out of what was marked, but the blockquote keeps the
whole quote: a card that silently dropped the rest would be a card about a sentence nobody can find again.

## Consequences

- Parts are written whole (`setAnnotationParts`) rather than per part. Two people editing different parts of one
  highlight would produce ranges that overlap or leave gaps — a shape neither chose.
- A part that overlaps another is refused in the surface, because which one a card used would otherwise depend on
  order rather than on the reader.
- The library's Annotations tab lists **highlights**, not only their cards, and a drag promotes. It is its own
  component rather than a `LibraryItem`, because an item is a card or a board and a highlight is neither — the same
  arrangement `LibraryMediaList` already has.
- The book gains a Highlights panel beside Contents: the marks a reader has made, with the placed ones marked, which
  is where an unplaced highlight lives.
- The cover cache became three-state (`pending`/`none`/`ready`) in the same pass. Two states made "not read yet"
  indistinguishable from "read, no cover", so a first paint that raced an upload gave up until a refresh.

## Open

- Editing a highlight's quote would need its parts remapped; nothing edits the quote today.
- Several cards from one highlight share the property and the source but have no visible group.
- The Inbox stays cards-only. A highlight is not a card, and mixing them would make inbox-zero mean nothing.

## Amendment — 2026-11-01: one card means never overwriting the link, and the passage is not in the body

This ADR says "**One promotion per highlight.** `promoteAnnotation` opens the card a highlight already has instead of
making a second one; making another is `again`, an explicit row", and that "**A promoted card quotes the whole
passage.** ... the blockquote keeps the whole quote". Neither survived contact with the promotion contract.

**`again` was never an interface.** It had one call site in the whole repository, and that call site was its own test. It
was an escape hatch that could only produce what the rule forbids: a second card whose existence the record cannot know
about, because the record holds one `cardId` and the write overwrote the first. So it is gone, and the rule is enforced
instead of advised. A highlight whose card is in the trash is **reported** rather than replaced, since a card in the
trash may be restored with everything the reader wrote in it, and promotion re-reads the record from the document before
deciding, so a surface holding a stale copy cannot make the second card either.

**The whole passage is the card's strip, not its body.** Promotion writes no body (see the amendment to ADR-0087), so a
part carving pieces out of what was marked cannot shorten what the card shows: `AnnotationCardFace` reads the record, and
the record keeps the whole quote. The words a part covers go where the reader mapped them, and nothing is dropped.

The rest of this ADR holds: parts are ranges inside the quote, written whole; a target is a destination, not a promise;
a part outside the recipe is kept and shown; the raise surface is where a highlight is taken apart.
