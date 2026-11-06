# ADR-0093: a mark is a place you can reach

Status: accepted, 2026-10-31. Extends ADR-0088 and ADR-0091.

## Context

The reader had the model right and the manners of a first pass. Four things were wrong, and three of them shared a
cause: the surface was built to *draw* correctly rather than to be *used*.

1. `paintHighlights` wrapped each match with `Range.surroundContents`, which throws whenever the range partially
   contains an element — a bold word, a link, a paragraph break. The `catch` was empty, so a passage over any of those
   simply was not painted, while the comment above it promised the reader would be told.
2. Worse, an anchor taken **across a paragraph break could never be found again**. `chapterTextIndex` joined text nodes
   with nothing between them, while a browser's selection across two paragraphs comes back normalised to single spaces.
   The quote and the page disagreed about where a space was, and the wrong one won.
3. A painted mark was `mark[data-annotation-id]` with no `tabindex` and no `role`, and a comment referring to "the
   marks' own Enter handler" described a handler that did not exist. A highlight was mouse-only.
4. The chapter was `font-size: 13px` and `max-width: 68ch` in CSS with no way to change either, no position beyond the
   chapter path, and no page keys — while `appearance.ts` already owned exactly this sort of preference.

## Decision

**A mark is painted per text node.** The match is segmented against the chapter's own text index, not against a DOM
range: for each run, the intersection of the passage with the run is arithmetic. Every wrap then sits inside one text
node, where `surroundContents` cannot fail, and a crossing passage becomes adjacent marks sharing the highlight's id.
What still cannot be placed is counted and reported under the header, because of the three outcomes (a right mark, a
visible wrong mark, no mark at all) silence is the only one the reader cannot act on.

**Two paragraphs are two words apart.** The index separates block-level runs with one space, and a whitespace-only node
contributes its space and no run. Offsets inside every other node are unchanged, so the map back into the DOM stays
exact. This is what makes a cross-paragraph anchor resolvable at all.

**A mark is a control.** `tabindex="0"`, `role="button"`, an `aria-label` from the excerpt, Enter or Space to raise,
the menu key or Shift+F10 for its menu, and the focus ring the rest of the app already uses. The library row and the
panel row remain the tab-order path; this makes the passage itself one.

**Reading is its own appearance group.** Text size, measure and page join density and radius in `appearance.ts`
(ADR-0071): device preferences, published as attributes and variables on `<html>`, with the CSS owning the consequence.
They are separate from the canvas knobs because a reader at midnight wants a dim page at 17px without their boards
turning sepia.

**A position is where you were, not which chapter.** `bookStore` keeps `{ path, offset }` and reads a bare path written
by an older build as the top of that chapter. The progress rule and the stored offset are written from the scroll
through refs rather than through state, because a render repaints the chapter and its marks and a reader dragging the
scrollbar would be causing sixty of them a second.

## Consequences

- `PaintReport` came out of the painter so the reader can say "one highlight is not in this chapter".
- `chapterTextIndex` gained block separation and a `BLOCKS` set; `rangeOf` is unchanged.
- The reader owns a `keydown` listener on `window` that stands aside for a field, a live selection, a menu or the raised
  surface — the four things that own a key more than a page turn does.
- `BookHighlights` counts cards instead of claiming "on the board", which it could not check, and filters by kind and by
  "not a card yet".

## Open

- Search inside a book still waits for the `AnnotationMedium` registry, so PDF and video search arrive with it.
- The unplaced count is per chapter, not per book: a highlight filed against another chapter is expected, not missing.
