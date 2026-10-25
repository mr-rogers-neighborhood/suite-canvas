# ADR-0011: Library dock, drawer, and in-card chrome

- **Status:** accepted
- **Date:** 2026-10-21

## Context

With cards detached from boards (ADR-0010) the app needs somewhere to find and manage them, and the
card needs a place to show its title and its sharing relationships. The canvas is the primary
surface, so both must stay out of its way.

## Decision

1. **A mac-style floating dock**, bottom centre: `Library` with the Inbox count, a separator, and a
   card-type registry. It floats rather than occupying a bar so the canvas keeps its full height,
   and only its children take pointer events.
2. **A drawer above the dock**, not a side panel: tabs (see the amendment below for the current
   order), counts, empty states,
   `Escape` closes, and the panel isolates wheel and pointer gestures from the canvas. It is
   rendered in a portal so it can sit above React Flow's stacking context.
3. **Headers and footers live inside the card**, not in `NodeToolbar`. `NodeToolbar` counter-scales
   with zoom (constant screen size) and only renders for the sole selected node by default, both
   wrong for an expandable footer. In-card chrome grows the measured node, so connectors and links
   follow when the footer opens.
4. **The footer is a keyed section list.** Today it holds References (every placement, home marked,
   go/remove actions); Backlinks and Tags slot in later without touching the card layout.
5. **Hold to place uses pointer events, not HTML5 drag and drop.** The row lifts into a card ghost
   that follows the cursor and is centred on the drop point, which needs custom rendering (HTML5 drag
   images are opaque to styling) and works on touch. Pointer-down is prevented so the gesture cannot
   select text across the board.
6. **Clicking Place centres in the viewport with a stagger**, so repeated placements do not stack
   exactly and the card is visible immediately.
7. **Delete a board behind a dialog** that names the board, counts its cards, and offers keep-in-
   library vs move-to-trash. A destructive, multi-card operation should never be a single click.

## Amendment — 2026-10-25: the library's sections are questions, in a fixed order

The drawer has grown past the original three tabs one feature at a time, so the order and the
facet row are now stated rather than left to whoever adds the next tab.

1. **One order, always: Inbox → Cards → Sketches → Boards → Types → Trash.** It runs from "what
   arrived and needs a decision" to "what I made" to "the schema behind it" to "what I threw away".
   The order does not depend on counts, capabilities or what is open, except that **Trash is absent
   for a session that may not manage trash** — a tab you cannot act in is not a tab.
2. **Type facets are a property of a card list, so only Inbox and Cards have them.** Those are the
   only two tabs whose rows are typed cards. A Sketches row is a card filtered by *behaviour*, a
   Boards row is not a card, the Types tab *is* the schema, and Trash mixes everything — a facet row
   there would be a row of zeroes or a second way to do what the tab already did.
3. **A behaviour is not a facet.** Sketch and Portal are runtime-owned types (ADR-0040: a board and a
   section are identities, not types), so they never appear in the type facet row — offering them
   there reads as "you may author your own Sketch type", which the model forbids. A sketch is found
   in its own section; a portal is found in Boards (it is that board's presence on this one) and on
   the canvas. Their *defaults* are edited in Card Settings (ADR-0056), never in the type list.
4. **A tag is a filter, not a section.** Tags already filter rows inside a tab. A Tags tab would be a
   list of labels with no rows of their own, and tag *metadata* (once it exists) belongs in the type
   and Card Settings editors where the tag is defined. The one open question — whether a tag may
   carry metadata without becoming a type ("supertag lite", ADR-0053) — stays open and does not need
   a library section to answer it.
5. **Attachments and annotations do not get sections.** An attachment is never a row on a canvas: it
   is a cover, a media field or a drawing belonging to a card, so a section of unowned blobs would be
   a file manager whose rows cannot be acted on, and the bytes would still be owned by the card that
   names them. An annotation (A23) is *already a card* — it appears in Cards with its source field,
   and becomes an ordinary card when detached — so a separate section would list the same rows twice.
   If sources ever become first-class objects (v2), a **Sources** section is the shape to revisit,
   not an Attachments one.
6. **Every section answers the same four gestures**: search within it, filter the rows it owns, rows
   that act (open, place, locate), and bulk actions over a selection (A13). A new section that cannot
   answer all four is a panel, not a tab.

## Consequences

- The library is reachable from anywhere on the canvas without a mode switch or a sidebar.
- Card chrome grows with the card and scales with zoom like the content it belongs to.
- Title editing and body editing are separate presence fields (`focus.field`), so carets never paint
  into the wrong editor.
- Every new card type costs one registry entry plus its schema variant; the dock, header glyph and
  creation path read from that registry.
