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
2. **A drawer above the dock**, not a side panel: tabs `Inbox | Cards | Trash`, counts, empty states,
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

## Consequences

- The library is reachable from anywhere on the canvas without a mode switch or a sidebar.
- Card chrome grows with the card and scales with zoom like the content it belongs to.
- Title editing and body editing are separate presence fields (`focus.field`), so carets never paint
  into the wrong editor.
- Every new card type costs one registry entry plus its schema variant; the dock, header glyph and
  creation path read from that registry.
