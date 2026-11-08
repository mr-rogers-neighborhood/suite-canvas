# ADR-0055: Hover-peek names an entity anywhere

- Status: proposed
- Date: 2026-10-25
- Shipped: nothing.
- Remaining: the peek surface, the target resolution for every entity kind, and the delay/dismiss
  rules.
- Full text: [archive](../../../../history/decisions/0055-hover-peek-names-an-entity.md)

## Decision

A hover that rests on any rendered entity — a mention, a reference, a link endpoint, a card in a
compact view — opens a small read-only peek that names it, states its type, and offers one route to
open it. The peek is a reading, never a write, so it cannot change what it describes.

## Consequences

- The same entity reads the same way wherever it appears, which is what makes the graph feel typed.
- One resolver is needed for every entity kind; a kind without a resolver gets no peek, not a wrong one.
- The delay and dismissal rules are the whole difficulty: too eager and it fights selection, too slow
  and nobody finds it.
- Peek must not become a second inspector; editing stays in the inspector.
