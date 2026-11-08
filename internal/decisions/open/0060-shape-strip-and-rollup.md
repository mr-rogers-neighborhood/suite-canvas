# ADR-0060: Shape and rollup

- Status: partial
- Date: 2026-10-25
- Shipped: silhouettes and per-side edge paint on the style surface
  (`styles/surface/StyleTab.tsx`), so a card's outline is already paint.
- Remaining: the rollup engine and its collapse control, the header-only chrome rule, and outlines
  built from route primitives. The four-sided chrome strip was cut from the record itself.
- Full text: [archive](../../../../history/decisions/0060-shape-strip-and-rollup.md)

## Decision

A card's only chrome is the header it already has; content gets everything below it, and a silhouette
never clips its own text. A rollup is the same idea for collapse: a card reduced to its header line,
with a count of what it hides, rather than a second body surface.

## Consequences

- The outline is paint, so one style vocabulary covers cards, sections and links.
- A rollup needs a truthful summary and a way back; a summary that lies is worse than no collapse.
- Custom outlines built from link routes stay a direction, not a shipped feature.
- Sections with many cards remain hard to scan until the rollup lands.
