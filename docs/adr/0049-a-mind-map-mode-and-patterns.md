# ADR-0049: A mind-mapping mode, and Patterns as reusable layout algorithms

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0017](./0017-spatial-sections.md) (spatial sections),
  [ADR-0040](./0040-a-board-and-a-section-are-identities.md) (boards and sections are identities),
  [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md) (a view is a lens, a database or a
  render), [ADR-0046](./0046-the-shell-derives-its-colour.md) (theming),
  `apps/canvas/src/canvas/arrangeCommand.ts` (the align/distribute stopgap)

## Context

Arrange landed as align and distribute, deliberately small (A17). The larger idea behind "Arrange"
is a **structure** the canvas could grow into: a way to lay cards out *by rule* rather than by hand,
and to keep that rule available afterwards.

Two shapes of that idea are already in the product's vocabulary and are easy to confuse:

- a **command** — run once, write placements, done (Arrange, one undoable batch);
- a **projection** — a live reading that follows the data (a saved view, a lens, a render:
  ADR-0043).

Mind-mapping sits between them. A person draws a structure, drops cards into it, and expects the
next card to land somewhere sensible — but also expects to be able to shove a card out of place
without the structure dragging it back.

So the question this ADR answers is not "how do we lay out cards" but "what is a layout that a person
can author, reuse and then break?"

## Decision (direction)

1. **A mind-mapping mode.** Entered from the UI and a keybinding, alongside thread mode. It changes
   what a drop *means*: a card dropped while the mode is on is placed by the active pattern rather
   than at the pointer. It is a mode, not a document state — like thread mode, it rides `useUiStore`
   and never writes.
2. **Patterns are first-class recipes.** A pattern is a versioned record: an algorithm from a closed
   built-in set (fan-out, tree, radial, grid-flow, …) plus its tunable rules, or a user-authored one.
   It is stored in the graph, not in code, so a pattern can be renamed, duplicated, shared and
   versioned the way types and views already are.
3. **Ghost cards are the pattern's promise made visible.** Both the mode and the pattern editor show
   the places the next cards would land as **ghost cards** — never real cards, never a document write.
   In the editor the ghosts fan out as more cards are *simulated*, so the shape of the rule is
   visible before anything exists.
4. **Two authoring surfaces, one model.** A pattern can be authored on a grid (explicit slots and
   adjacency) or on the canvas itself (draw the shape, and let the algorithm infer the rule); both
   edit the same record. A generated mode ("fan my design out for me") produces a record too, which
   the author can then edit — generation is a starting point, not a separate kind of thing.
5. **A pattern is a command with memory, not a live constraint.** Applying a pattern writes
   placements in one undoable batch (through `applyLayoutPlan`, as Arrange does). The pattern stays
   attached to what it produced so it can be re-applied or extended, but it never silently reflows a
   board someone has arranged by hand.

## Open questions (stated, not answered)

- **What does a pattern promise after the user rearranges?** Three answers are compatible and the
  choice is per-pattern, not per-product: (a) nothing — it is a one-shot command; (b) the pattern
  re-applies only to *new* cards, leaving existing placements alone; (c) the pattern is re-run
  explicitly ("apply again"), like a view refresh. The likely default is (b), because it is the only
  one that does not fight the person. This needs a prototype before it is decided.
- **Pattern versus view.** A view is a *reading* (it selects and orders cards, ADR-0043); a pattern
  is a *placement*. They are not exclusive: a database view could later render its rows *through* a
  pattern, and a pattern could be previewed as a view. Do not collapse them now.
- **Where the ghosts end.** In the mode, a ghost is a drop target; in the editor, a ghost is a
  simulated card. They should look different enough that nobody expects an editor ghost to become
  real.
- **Authoring on the canvas** implies reverse-engineering a rule from a drawn shape. That is the
  hardest part of the idea and the most likely to be cut if it does not feel good in a prototype.

## Amendment — 2026-10-25: where the mode sits now that there are two axes

The canvas grew a second axis ([ADR-0064](./0064-two-axes-and-a-cursor-that-says-so.md)): `purpose`
(explore · run · record · present) says what the canvas is *for*, `gesture` (place · thread · web ·
pattern) says what the next click *does*. This ADR's first decision — "a mind-mapping mode, entered
from the UI and a keybinding" — maps onto that pair without adding a third control:

1. **Mind-mapping is `purpose: run` with `gesture: pattern`.** "Placed by the active pattern rather
   than at the pointer" is exactly what a `pattern` run does once a pattern record exists; until then
   `pattern` is a *held* run that alternates branches (ADR-0063's third amendment), which is the same
   gesture with the rule the engine can honestly offer.
2. **No third axis for patterns.** A pattern editor is a destination (`run` + `pattern` opens it), not
   a mode; opening a panel is navigation.
3. **The ghosts this ADR asks for are the same primitive as the held stack.** "A card-shaped hint at a
   flow point" is one component: `HeldStackCursor` draws the next card today, and a pattern editor
   draws several stacked hints with the same renderer.
4. **Nothing else here changes.** A pattern is still a versioned recipe record, still additive-first,
   still "a command with memory, never a live constraint", and its record shape is still its own ADR —
   the open questions above are untouched and remain open.

## Consequences

- Arrange stays small and honest in the meantime: align and distribute is a command, and nothing in
  the canvas pretends a pattern exists.
- A pattern record needs a schema (algorithm id, version, rules, provenance) — an additive change to
  `@suite/graph`, in the same shape as a type or a view, and it will need its own ADR when the shape
  is known.
- Ghost cards need one shared primitive: the canvas already draws two kinds of ghost (a peer's
  library drag, a peer's connector draft), so "a card-shaped hint at a flow point" should become one
  component rather than a third copy.
- If the mode is ever added, the keybinding map becomes a prerequisite rather than a nicety.

## Amendment — 2026-10-25: the mode is `branch`; `pattern` means the recipe

The fourth gesture mode was called `pattern`, which borrowed this ADR's word for a *record* that does not
exist yet, and used it for the *shape* a click draws. The mode is now **`branch`**
([ADR-0061](./0061-three-ways-to-draw-links.md) amendment): a branch is a tree growing from the previous
placement, while a **pattern** stays what this ADR says it is — a versioned recipe, a command with
memory, saved and replayed.

Why the distinction matters beyond naming: a recipe can *produce* a branch, but a branch is not a recipe.
When patterns land they will appear in the command palette and in the rail, not as a fifth mode, because a
mode is how one click draws one relationship and a recipe is a plan.
