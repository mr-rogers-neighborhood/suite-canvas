# ADR-0033: A surface is judged by a spike, not by sunk cost

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0030](./0030-scene-projection-lod-and-real-portals.md), [ADR-0032](./0032-ice-engine-deferral.md), `apps/canvas/src/canvas/`, `docs/roadmap/alpha.md`

## Context

Between 2026-10-23 and 2026-10-25 the canvas was ported to ICE (`@vibecook/ice@0.16`) and taken to
feature parity with this React Flow surface: 35 commits, roughly 35,000 added lines, of which
23,000 were engine integration. The port worked. It also produced a surface that one person could
not read, could not trust, and could not debug without an agent, and whose links still did not look
right after a fleet spent six hours on them.

The engine is a third-party WebGPU-only kernel with no `setPosition`, per-frame entity identity, and
a compile-once model for container contents. Every one of those properties leaked into our code.
The lesson is not "ICE was bad"; it is that **we could not have known this without the port**, and
that we only stopped because the code became unreadable rather than because a measurement failed.

The React Flow surface at `491b64a` is restored as the product of record. The ICE work is preserved
whole on branch `archive/ice` and tag `ice-parity-2026-10-23`.

## Decision

**A surface merges only when it beats this one on a written, measured checklist.** Prose arguments
about architecture do not count; sunk cost does not count; a demo does not count.

The checklist a candidate surface must pass before it may replace the product of record:

1. **Scale.** 250 cards across 4 nesting levels at 55 fps at fit and 40 fps zoomed 4×, measured
   with a harness on the same machine, not estimated.
2. **Continuity.** Entering and leaving a Board is a camera move over the same scene: no remount, no
   blank frame, and the child contents visible for the whole move.
3. **Legibility.** Titles readable to about 30% zoom; any card accepts an editor on click at any
   zoom, with no mode change.
4. **Depth.** A link between a card at level 3 and a card at level 1 is one continuous visible path
   that crosses the Board wall.
5. **Readability.** The surface is at most 2,500 lines, and the gates above are green in
   `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

A candidate that fails 1 or 2 is not a renderer choice, it is the wrong product; we stop and say so
rather than shipping the prototype. A candidate that passes all five is merged.

## Consequences

- `491b64a` is the product of record until a candidate passes. Work that improves the product
  (inspector binding, persistence, editing, tests) lands here first, so no branch carries the whole
  app.
- `archive/ice` is reference, not a fallback. Its design decisions worth keeping — one editor at a
  time, a card face contract, a debug state bridge, a scenario harness — are re-derived small on the
  winning surface instead of imported at 23,000 lines.
- The next candidate is PixiJS 8 on branch `pixi`, because it keeps the canvas thesis (nested
  containers, free camera, depth) while being a library a person can read, and because it falls back
  to WebGL where ICE could not.
- Timeboxes are part of the rule: a candidate that has not passed within its stated timebox is
  recorded as a measured negative result, in this log, and the branch is abandoned.
