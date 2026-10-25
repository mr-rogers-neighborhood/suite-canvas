# ADR-0036: The canvas is React Flow, and there is one of it

- **Status:** accepted
- **Date:** 2026-10-25
- **Supersedes:** [ADR-0030](./0030-scene-projection-lod-and-real-portals.md)
- **Related:** [ADR-0029](./0029-portal-board-field.md), [ADR-0031](./0031-whiteboard-cards-and-loro-binding.md), [`docs/architecture.md`](../architecture.md) §Rendering

## Context

The repository has carried three answers to "what paints the board":

1. **The flow surface** (`apps/canvas/src/canvas/CanvasBoard.tsx`, React Flow). It is the default,
   the editing surface, and the only surface with end-to-end coverage — every Playwright spec opens
   the app without a `canvas` parameter.
2. **The scene surface** (`apps/canvas/src/scene`, on React Flow, driven by `@suite/scene`). ADR-0030
   made it "the product of record": nested live portals, discrete LOD bands, a scene outline, a
   camera-only focus path, fractal layout. It renders `nodesDraggable={false}`, calls itself
   *"Scene preview — read-only projection of the workspace graph"*, and cannot create, move or edit
   anything.
3. **A Pixi spike** (branch `pixi`), which began porting the scene to a second renderer so it could
   become editable.

ADR-0030's rationale was that a portal which swaps boards is "a board swap wearing a zoom costume",
and that a self-similar canvas — where a portal is a live, scaled board at depth — is the product's
identity. That is a real idea. It is also the reason the project ended up maintaining two surfaces
and then attempting a third engine: the declared target was never the surface people actually use.

The loop that creates value today is: open a board, place a card, type into it, connect it, type it,
tag it, find it again. That loop lives entirely in the flow surface, and its quality — not the
number of renderers — is what the product is judged on.

## Decision

**React Flow (`CanvasBoard`) is the only canvas surface.** The scene surface and the scene-only
parts of `@suite/scene` (scene tree, LOD bands, outline, spatial index) are removed. The pure layout
planner (`packages/scene/src/layout.ts` and `geometry.ts`) stays, because the flow editor's fractal
layout command uses it.

Concretely:

1. **One surface in the app.** `App.tsx` renders `CanvasBoard` unconditionally. The `?canvas=scene`
   flag, `SceneBoard`, `SceneLayer`, `SceneOutline`, the outline adapter and their stories/tests are
   deleted.
2. **Portals stay, as doorways.** A portal is still a card whose `board` field points at a board
   (ADR-0029), with a live miniature and the camera transition on entry
   (`PortalCard`, `PortalNode`, `PortalTransitionLayer`). It is not a live nested instance and does
   not expand in place.
3. **Layout stays a one-shot command.** Recipes plan against a snapshot and commit as one
   field-granular batch in one undo step. There is no live reflow, and there never was.
4. **The object graph is untouched.** `portal` type, `board` field kind, cycle legality, shares that
   render an unshared target as *Unavailable board*, and whiteboard cards (ADR-0031) all stand.
5. **A second engine needs a new decision, not a flag.** Reviving Pixi or ICE requires an ADR that
   names the measured user problem the current surface cannot solve.

## Rejected alternatives

- **Finish the scene surface as the editor.** It needs drag, marquee, selection, inline Tiptap
  editing, connectors, sections, whiteboards, resize and context menus — that is the flow surface
  rebuilt against a projection layer, plus an engine adapter to keep the DOM cards. The measured
  payoff is nested live portals, which is one feature, not the product.
- **Keep both surfaces indefinitely.** Two surfaces means two mental models, two drag semantics, one
  e2e-covered and one not, and every shell feature rendered twice. That is how the third engine
  became thinkable.
- **Delete portals too.** The `board` field kind and the doorway are cheap, already shipped, and
  genuinely useful as a link between boards. Only the *live nested instance* claim was expensive.
- **Keep `@suite/scene` intact for future reuse.** An unused scene/LOD/outline implementation is a
  second model of rendering that drifts from the one that ships. Dead code with good tests still
  rots; the layout planner is the part with a live caller.

## Consequences

- **The self-similar canvas goal is withdrawn.** No LOD bands, no recursive live boards, no
  fractal-as-navigation. Fractal layout remains a command you run on a board you can see.
- **`packages/scene` shrinks to geometry and layout.** Its layout tests and the flow editor's
  layout command keep their value; the scene tests go with the code.
- **The e2e suite finally matches the product.** It was already flow-only; now there is nothing else
  to cover.
- **ADR-0029 stands; ADR-0030 is superseded.** The data model for portals was never the problem.
- **Fewer decisions to keep true.** `docs/architecture.md`, `AGENTS.md` and the alpha roadmap stop
  describing a target surface that does not exist, which is the drift this ADR exists to end.
