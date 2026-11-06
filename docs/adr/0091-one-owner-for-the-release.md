# ADR-0091: one owner for the release, and a highlight is put in your hand

Status: accepted, 2026-10-31. Extends ADR-0087 and ADR-0090.

## Context

Four surfaces could carry a highlight and the one thing a reader asked for — *put this on my board* — produced nothing
they could see. Reading it as a bug in one place was wrong: it was three bugs at one seam.

1. **Place named a board and no point.** `promoteAnnotation` wrote a placement only when given both `boardId` and
   `position`, so the reader's Place made a card and wrote nowhere. The card belonged to the inbox, the board showed
   nothing, and `annotation.cardId` was set anyway — so a second Place found the card, took the "already exists" branch
   and opened a focus surface on a card nobody could see. Two presses, both apparently dead.

2. **Two surfaces rolled their own gesture.** The library's row and the book's outline waited for four pixels of travel
   and then called `carry()` once, removing their own listeners. They never called `beginHighlightDrag`, so the root
   attribute that stops a drag from being a text selection was never set, and nothing owned the release. Promotion then
   depended on which `pointerup` fired first — the reader's own `finish`, which releases the carry, or the drop layer's
   listener, which reads it from a closure. On the reader's own drag it was a race; on the other two it was nothing.

3. **Nothing tested the seam.** The row tests asserted that a callback had been called. No test asserted that a card
   existed *and* was placed. The suite was green because it tested the halves.

## Decision

**A board without a point is unrepresentable.** `promoteAnnotation` takes
`Placement = { onBoard: { boardId, position } } | { inbox: true }`. A caller that names a board must say where, so the
branch that wrote neither cannot be reached again. The inbox stays, because a card in a reader's hand honestly has no
board yet.

**Place hands the card over; it does not place it.** The card is made in the inbox and pushed into `usePlaceStackStore`
— the mechanism the library's "Place cards" already uses. The focus surface is concealed while a stack is in hand,
which is the same rule it already applied while a highlight was carried: *an overlay steps aside when you have
something in your hand*. Pressing Place again before putting the first card down calls `add` rather than `start`, so
placing four highlights in a row fills one stack instead of four inbox entries. A highlight whose card is already on a
board opens that card; one whose card is waiting in the inbox is handed back rather than duplicated.

**One owner for the release.** `highlightDrop.ts` holds a registered dropper; the board registers the only one, because
the board is the only thing that can turn a screen point into a flow point. `beginHighlightDrag.finish` calls
`dropHighlight` when the gesture carried, whatever the caller passed. The drop layer keeps the ghost and the conversion
and loses its `pointerup` listener, so there is no ordering left to depend on. A `pointercancel` releases without
offering the highlight: a cancelled gesture carries zero coordinates, and treating it as a drop placed the card at the
canvas origin.

**All four sources use the one gesture.** The library row and the outline row call `beginHighlightDrag` directly, which
gives them the threshold, the root attribute and the cancel path for free.

**A highlight's type is called a kind.** A kind is what a highlight *is*; a type is what a card *is*. The library
already offered **Types** for card types, and two buttons labelled Types one tab apart is a label that teaches nothing.

**The kinds editor belongs to the shell.** It is opened from the library, from the raise surface and from a card, so it
cannot be owned by any of them: mounted inside the drawer it was unmounted by closing the drawer, and the drawer's
escape layer closed both at once. It is a store flag and a host, with a fixed header and footer around a scrolling body,
because a panel that scrolled as one block took its only visible way out off the screen.

**A promoted card wears its passage.** A strip above the body, not a replacement for it: the reader writes *around* the
passage, so the writing must survive. **Keep it** de-links — `setAnnotationCard(id, null)` clears the record's card,
the card's `annotation` field is cleared as the app, and the quote already in the body is the reader's own text from
then on.

## Consequences

- `setAnnotationCard` accepts `null`, so a link can be taken back without deleting the highlight or the card.
- `promoteAnnotation`'s placement is a union; every test call site says which it means.
- `NodeCard` reads the workspace to decide whether to draw the strip — one `getType` and one `getAnnotation` per card,
  through the card's own `annotation` property rather than by scanning every highlight.
- `HighlightDropLayer` no longer listens for anything, so a highlight can only land once per release.

## Open

- Place lands at the pointer, so a reader who presses Place and then presses the dock gains a card wherever that is.
- Reopen goes back to the book's remembered chapter, not necessarily to the highlight's chapter.
- Several cards from one highlight still have no visible group.
- **Keep it** lives on the card's strip, so it is on the board and not in focus mode. The panel shows the read-only
  `Highlight` property without an unlink beside it; a field's renderer gets a value and not the card, so the action
  would need a section rather than a field kind.
