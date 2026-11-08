# ADR-0090: a type knows its properties, and four ways carry a highlight

Status: accepted, 2026-10-31. Extends ADR-0089; the mention attribute is new.

## Context

ADR-0089 gave a highlight parts, each with a destination. That was a reader choosing a destination every time — which
works, and asks the same question over and over. The thing that actually knows which properties a card has is the card
**type**: a Claim has a Question and a Source because somebody decided it does, and a reader marking a Claim should not
be re-deciding that.

The second gap was carrying. A highlight could be dragged to the board from the chapter and from the library's list,
which is two places of four a reader thinks in: the book's own outline, and the place a highlight is most often
mentioned, a card's body.

## Decision

**The type is the mapping.** `AnnotationStyle` already carried `templateTypeId` (the card type it produces) and `recipe`
(the destinations it expects). No schema changed: this pass gives those two a **surface** and makes them the shape of
the raise surface.

**Slots, with an escape hatch.** The raise surface draws one row per recipe destination, unfilled until words are
assigned; selecting words in the passage fills the armed row. `Add a part` appends a destination the type did not
expect, and a part that exists outside the recipe is shown rather than hidden. A mapping is a suggestion with teeth,
not a cage — the reader who needs a seventh part should not have to edit a schema to get it.

**The mapping is edited where mappings live.** A Types dialog from the library's Annotations tab: colour, name, card
type, ordered slots. The raise surface links to it and never grows a second, half-featured copy. A mapping is a
decision about a *kind* of note, and that decision does not belong in the moment of marking one. Choosing a card type
seeds the slots from that type's own text properties, so the mapping starts from what the type already knows.

**The passage keeps the colour; the parts are dotted.** One tint had to give way: a fill per part turns a single
highlight into a patchwork and loses the fact that it is one mark. The colour says what kind of thing this is, the
dots say which words the machine will read, and each part's row names its destination in words.

**Four sources, one carry.** The chapter's painted mark, the book's outline, the library's list, and an `@` mention
inside a card. All four put an annotation id into `useHighlightDrag`, and one `HighlightDropLayer` promotes on release
over the canvas. Where a highlight lands is decided once, so no source can invent a different answer.

**A mention of a highlight is a mention of a passage.** The mention node gains `annotationId`, the `@` picker gains a
section for the reader's marks, and the chip shows the words in the highlight's colour with a dotted rule. Pressing it
opens the card the highlight became, or the book when it has none. A deleted highlight's chip says it is gone, because
every reference in this app owns its broken state. `RICH_TEXT_NODE_ATTRIBUTE_NAMES.mention` gains the attribute, or
publishing would reject any document that contains one.

## Consequences

- `patchAnnotationStyle` accepts a `recipe`, so the mapping is written through the setter that already existed rather
  than a new one.
- The mention chip is a dispatcher with no hooks of its own, so each chip keeps its hooks unconditional. A component
  that returned early before its hooks would be a rules-of-hooks violation wearing a comment.
- `rankItems` reads the workspace for highlights, so a test that fakes a workspace has to know about them — the fake
  now does, which is the honest cost of the picker having a second kind of row.

## Open

- A type's mapping is per workspace; presets that ship a mapping are a later question.
- Several cards from one highlight still have no visible group.
- PDF and video media, unchanged from ADR-0087.
