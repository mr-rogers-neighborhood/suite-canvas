# ADR-0035: Views, Pins, Portals and Sections

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0029](./0029-portal-board-field.md), [ADR-0030](./0030-scene-projection-lod-and-real-portals.md), [ADR-0033](./0033-interactive-scene-surface.md), [ADR-0034](./0034-ice-primary-rendering-engine.md), `packages/graph/src/views.ts`, `apps/canvas/src/components/ViewsBar.tsx`, `apps/canvas/src/components/BoardTabs.tsx`

## Context

The current UI uses **board** for two different things: a document container and the place a user
is looking. It also uses **Views** for saved search queries, while the app bar shows board tabs and
the library can scope a query to the active board. The result is three navigation concepts with
overlapping names, plus a destructive-feeling prompt when a card leaves a board.

The infinite canvas needs a clearer retrieval model. Users need to get back to a place, find a card
they remember, and mark a spot for collaborators without creating more containers. Portals already
provide one kind of navigation, Sections provide spatial grouping, and the scene outline provides a
tree. None of them is a bookmark.

The user's direction is explicit:

- Drop the user-facing word **Board**.
- **Views** are views, not containers.
- Add **Pins** alongside Portals and Sections, behaving like “drop a pin” in a map.
- The Views dropdown and library drawer replace the immediate unplace/delete prompt.
- A portal shows one canonical board through a view, and multiple placements are preserved.
- Selection is the same canonical selection in every view of a board.

## Decision

### 1. Boards remain internal containers; Views are the user-facing framing

No document migration is required. `boards` stays the container record in `WorkspaceDocument`, and
`SavedView` stays the saved-query record. The product stops calling a board a “board”:

- A **View** is what the user sees: a board's content plus a camera and, optionally, a filter.
- The top-bar board switcher becomes the **Views** switcher. Each existing board gets an implicit
  default View; no new container record is created.
- Existing `SavedView` records are surfaced as **saved filters** inside the Views library, not as a
  competing navigation hierarchy. Their `scope: "board"` still means “the board this View frames”.
- A named View that remembers a camera is an additive `SavedView` field (`rootBoardId`, camera,
  optional pin ids) in P1. Until that field exists, switching a View starts from the board's fitted
  camera; the choice is not persisted across reloads.

This is intentionally **rename-only at the data layer**. It gives the UI one noun without pretending
that a board is a saved query, and it keeps the existing portal and placement model intact.

### 2. A Pin is a spatial bookmark in document truth

A Pin is a small, labeled marker at an exact point on a board. It is not a card, a portal, a
section, or a View.

- **Shape:** `{ id, boardId, x, y, label, color, createdBy, createdAt, target? }`.
- **Target:** optional `{ kind: "card" | "section" | "view", id }`. The pin stays at its point; the
  target gives the pin a navigation action and a default label. Moving the target does not move the
  pin.
- **Truth:** pins live in a `pins` map in the same Loro document, validated by `@suite/graph`.
  They are workspace-shared in v1, like sections. A per-user private pin layer is a later map, not a
  field on this one.
- **Rendering:** a pin is visible at every LOD as a counter-scaled marker with a short label on
  hover, selection or nearby zoom. It clips to the same board instance as the content it sits on,
  so a pin inside a portal stays inside that portal.
- **Interaction:** “Drop a pin” is a canvas tool and a context-menu action. A click places it; a
  small inline editor sets the label; dragging writes one commit on release. Clicking a pin flies
  the camera to it and selects its target when it has one.
- **Retrieval:** the Pins list in the library and the Views switcher both list pins by label, board
  and target. A pin can be renamed or deleted from either, subject to the normal capability flags.
- **Shares:** a share includes only pins on boards in its projection. A pin never expands a share's
  scope and never reveals a target outside it.

### 3. A Portal is a shared board view, not a copy

- A portal card references a target board (ADR-0029). The target remains one canonical board with
  one set of cards, placements, sections and pins.
- Multiple portals to the same board are multiple **placements** of the same board view. They are
  preserved; placing a second portal does not clone the board or its contents.
- Selection is canonical. Selecting a card through one portal selects the same card in every other
  visible instance, the scene outline and the inspector.
- A drag or edit through any instance writes the canonical record once, then every instance
  repaints from the same placement. Live drag geometry is ephemeral per instance.
- Entering a portal is a camera move to that instance, not a board swap. Escape restores the exact
  previous camera checkpoint.
- A cycle stops at the repeated board path with a focusable stub; a depth cap protects pathological
  graphs. Both are view guards; the document may contain the cycle.

### 4. Sections remain spatial grouping

A Section is a rectangle that groups cards on one board. It is not a View and not a navigation
target by itself. It may be the target of a Pin. Moving a section moves its members as one
canonical batch, exactly as the scene surface does today.

### 5. Navigation lives in one place

The **Views** switcher and the library drawer are the retrieval surface:

- Views: the boards in this workspace, each with its default framing and any saved named views.
- Pins: spatial bookmarks, grouped by View.
- Saved filters: the existing query Views, grouped under the View they scope.
- Portals: reached in the canvas and in the outline; they are not duplicated as top-level tabs.
- Sections: reached in the canvas, the outline and search; they are not top-level tabs.

Removing a card from a View moves it to the Inbox. It is a non-destructive unplace, so it does not
open a confirmation prompt. Deleting a card is an explicit Trash action. Deleting a View is an
explicit library action with the same capability checks as today. The old immediate
“unplace/delete?” prompt is retired.

### 6. Multi-placement is preserved

A card may have a placement on several boards. Those are distinct canonical placements, not
duplicate cards. A board shown through several portals is one board view with several instances.
The bridge must therefore carry both identities:

```text
card id        canonical object
placement id   canonical card-on-board record
instance key   derived path of board instances through portals
view id        camera/framing choice, never content identity
```

A gesture resolves `instance → placement → canonical write`. Selection, presence and undo use the
canonical ids; painting, hit-testing and clipping use the instance key. A pin uses its board id and
point, and appears once per visible instance of that board.

## Consequences

- **One noun for users.** “Board” disappears from product copy; internals stay stable. The cost is a
  short period where code and UI vocabulary differ, which the glossary and ADR must make explicit.
- **Pins are cheap and useful.** They add a small document map, a marker renderer and one gesture.
  They do not create containers, references or new undo semantics.
- **Saved camera Views are deferred.** The rename lands first; persisted camera/framing is an
  additive `SavedView` change with a migration test, not a new entity invented in the UI.
- **Portals stay honest.** Shared board view plus multi-placement preserves the existing graph and
  avoids a board-clone protocol. The bridge is responsible for resolving instances correctly.
- **The prompt disappears only when the library can replace it.** Unplace must be reachable and
  obvious from the card menu and library before the confirmation is removed.
- **Pins are shared in v1.** A collaborator can see and move a pin. Private pins need a separate
  user-scoped map and are not promised by this ADR.

## Rejected alternatives

- **A new `View` container entity.** It would duplicate `boards`, force a migration and make portal
  targets ambiguous. A View is a framing over a board.
- **Pins as cards with a type.** Every pin would enter search, references, backlinks, exports and
  the library as content. A pin is navigation metadata.
- **Pins attached to cards and moved with them.** A map pin marks a place; if the target moves, the
  pin should not silently follow and lose the place the user marked. The optional target is a
  navigation action, not an anchor.
- **Cloning a board per portal.** It breaks canonical selection, multi-placement and one-undo-per-
  gesture, and creates a merge problem for every edit.
- **Keeping board tabs and adding Views beside them.** Two navigation hierarchies with overlapping
  names is the problem this ADR exists to remove.
