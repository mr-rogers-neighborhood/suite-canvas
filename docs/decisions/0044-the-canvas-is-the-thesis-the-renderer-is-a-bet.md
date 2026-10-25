# ADR-0044: The canvas is the thesis; the renderer is a bet

- **Status:** proposed — **open for the human**, not a decision the fleet may take
- **Date:** 2026-10-24
- **Related:** [ADR-0034](./0034-ice-primary-rendering-engine.md), [ADR-0040](./0040-the-type-graph-is-withdrawn.md), [ADR-0041](./0041-links-may-end-on-a-board.md), [ADR-0042](./0042-editing-happens-in-one-place-at-a-time.md), [ADR-0043](./0043-what-a-card-face-says.md), [`docs/roadmap/ice-parity.md`](../roadmap/ice-parity.md) §9

## Context

Three surfaces have existed: a React Flow board, a `@suite/scene` renderer, and the ICE desk. React
Flow is deleted; ICE is the only surface ([ADR-0034](./0034-ice-primary-rendering-engine.md)), and
its parity work is done — the matrix's P0 rows are closed and thirteen lab scenarios assert the
behaviour on the real desk.

What remains is a *product* question that the engineering cannot answer: was the infinite canvas the
right place to spend a year, and is ICE the right way to hold it. It has to be recorded, because
otherwise every future session re-litigates it from taste.

The facts as of `5c318ec`:

| Fact | Value |
| --- | --- |
| ICE-side production code (`apps/canvas/src/ice`) | 23,131 lines |
| Product-side production code (everything else in the canvas app) | 29,936 lines |
| Share of the app that is engine integration | ~44% |
| Engine | `@vibecook/ice@0.16.0` — third party, MIT, `vibefield/infinite-canvas-engine` |
| Engine gaps the app works around | no `setPosition` (entities respawn instead of moving), a container's inside compiled once at spawn, entity identity per frame, **one text raster channel** (rich text is invisible on the sheet), a shared 16 MB ink shelf, card creation superlinear (~3.5 s at 1k, ~90 s at 5k placements) |
| What the engine makes impossible or expensive | accessibility tree, rich text on the sheet, 5k-class workspaces (unmeasured frame time) |
| What React Flow could not do | one flat node space, so a Board inside a Board was a scaled DOM board inside a camera — a camera trick, not topology ([ADR-0034](./0034-ice-primary-rendering-engine.md)); per-node DOM cost at scale; zoom limits |

## Decision

**Keep the infinite canvas as the product thesis. Stop treating the renderer as the thesis.** The
canvas is what a reader is buying; the engine is a bet that may be re-made without changing the
promise.

Three consequences follow, and they are the part that binds future work:

1. **The differentiator is the semantic layer, not the GPU.** Spatial arrangement, containment,
   typed objects, links that carry meaning, an inbox that needs no home, and retrieval that does not
   require remembering where a thing was put. A canvas without those is a zoom demo; a product with
   them does not need DeepZoom.
2. **The design target must be declared, because it decides the engine.** If a real workspace is
   50–200 objects, ICE's advantages are invisible and its 44% is pure cost — a DOM or canvas-2D
   surface would ship faster and feel better. If it is 1,000–5,000 objects with real nesting, only an
   ICE-class engine can hold it and the 44% is the price of the moat. Both answers are legitimate;
   not answering is not.
3. **If the bet is re-made, the fallback preserves the idea.** A DOM/SVG or tldraw-style canvas keeps
   the desk metaphor and loses deep nesting at scale. React Flow is not the fallback: going back buys
   comfort at a ceiling this project already rejected.

## Consequences

Easier: the roadmap stops being about parity and becomes about the semantic layer — placement that
proposes itself (fractal layout, templates, board suggestions), retrieval (⌘K reveal), and
collaboration, which is where the product can actually differentiate from Heptabase and Obsidian
Canvas.

Harder, and knowingly accepted:

- **A rented engine carries ~44% of the codebase.** Its roadmap is not ours; every missing API is a
  workaround with a comment. A fork is possible (MIT) and expensive.
- **Two capabilities are permanently out of reach while the sheet is a raster**: rich text on the
  card face (read it in the inspector, [ADR-0043](./0043-what-a-card-face-says.md)) and an
  accessibility tree for the canvas.
- **The gate is a real session, not a test suite.** Thirteen lab scenarios prove the desk does what
  it says; they cannot prove that a person wants to spend an evening in it.

## The test that settles it

Two weeks, one spine: capture → organise into a Board → link with meaning → find it again →
collaborate, in one sitting, without wanting to stop. If the remaining friction is product-shaped
(placement, retrieval, templates), keep going. If every fix still needs engine work, the engine is
the answer and the canvas survives the change of renderer.

Three tasks with three Obsidian users — one of them family — beats any opinion in this file. "I love
the idea" is the cheapest signal in product; "I moved my research into it" is the only one that
counts.
