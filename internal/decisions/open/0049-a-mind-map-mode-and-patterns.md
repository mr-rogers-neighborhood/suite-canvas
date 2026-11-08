# ADR-0049: A mind-mapping mode, and Patterns as reusable layout algorithms

- Status: partial
- Date: 2026-10-25
- Shipped: `branch`, the fourth canvas gesture mode, draws a tree from the previous placement
  (`canvas/placeRun.ts`), and a batch of placements lands as one undoable step through
  `applyLayoutPlan`.
- Remaining: pattern records (a versioned recipe in the graph), the pattern editor with ghost
  previews, re-applying a pattern, drawing a shape to infer a rule, and the keybinding map.
- Full text: [archive](../../../../history/decisions/0049-a-mind-map-mode-and-patterns.md)

## Decision

Mind-mapping is an intent, not a third axis: it will be `purpose: run` with a pattern-driven gesture,
and `branch` is the gesture that exists today. A pattern is a versioned record in the graph — an
algorithm from a closed set plus its rules — applied as one batch, never as a live constraint on cards
someone has arranged by hand.

## Consequences

- Arrange stays small and honest until a pattern record exists; nothing claims one does.
- A pattern needs its own schema in `@suite/graph`, additive-first, in the shape of a type or a view.
- Ghost cards become one shared primitive instead of a third copy of a card-shaped hint.
- The open question — what a pattern promises after the user rearranges — is still unanswered and
  needs a prototype, not another paragraph.
