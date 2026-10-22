# ADR-0018: Orientation surfaces, multi-object selection and panel editing

- **Status:** accepted
- **Date:** 2026-10-21

## Context

Sections ([ADR-0017](./0017-spatial-sections.md)) made a board spatially organized, but once a
board holds more than a screen of cards there is no way to answer "where am I?" or "where is that
card?". Two questions forced a decision:

1. **Should sections filter the Library?** A section is board-scoped derived geometry, while the
   Library is a workspace-wide list. A global "sections" facet would merge same-named regions from
   different boards into one meaningless option.
2. **Can the Library edit a card?** The inspector was deliberately information-only so that a card
   never had two editable rich-text editors. Reading properties without being able to fix them is a
   dead end, and a future card tab would need the same panel.

Heptabase's own surfaces settle the first question. Their Card Library filters by **tags and
properties** only; sections appear as a **whiteboard table of contents**, as deeplink targets
(`v0.284`, `v1.56`) and as AI context (`v1.71`). Sections are navigation to a region, not retrieval
across a workspace. Their guidance is explicit that whiteboards and sections serve knowledge work
while tags, properties and table views serve archival records.

For the second question, the real constraint is not "how many editors" but **how many authors**.
The shared `CursorEphemeralStore` keeps a single local cursor per tab, and peer carets are
content-anchored, so a panel editor can publish the same caret a canvas editor would. What must be
prevented is two editors accepting keystrokes for the same card.

## Decision

1. **Sections are a board-scoped facet, never a global one.** The Library gains an
   `All | <board>` scope on the Cards tab. In board scope the Sections facet lists that board's
   regions (indented by nesting) and selecting one includes its descendants; `Unsorted` is an
   explicit option. "Group by section" is a presentation transform over the same derived data. No
   card or placement stores a section, and nothing new is persisted.

2. **Sections remain navigation.** A collapsible left **outline rail** lists the active board's
   section tree with counts and peer presence; the card's **Where** block shows
   `Board › Section › Subsection` breadcrumbs; both focus the target through one UI-store
   **focus primitive** (`focusTarget` with a nonce), which the canvas consumes by moving its
   viewport once the node exists. No document writes.

3. **One editable surface per card per client.** `editingSurface: "canvas" | "panel"` plus
   `panelOwner: "inspector" | "library" | null` join `editingNodeId`/`editingField`. The canvas card
   is editable only when the surface is `canvas`; the inspector only when the panel is owned by the
   inspector, a Library row only when it is owned by the library. Both surfaces may be mounted, and
   only the owning one receives the shared `cursorStore`; the read-only twin re-reads the container
   through the sync plugin's mapping so it never goes stale. Peer carets are content-anchored, so
   the caret published from a panel still renders in the collaborator's canvas card. Undo stays per
   editor, as it already does for title and body.

4. **The card panel is one presentational component.** `CardPanel` renders title, type, tags,
   properties, Where and the body editor; the inspector is a shell around it, an expanded Library
   row hosts the same component, and a future card tab only adds a shell and routing. This is the
   seam for card-as-document without building it now.

5. **Multi-selection is UI state with one commit per gesture.** Shift, Ctrl and Cmd toggle
   membership; Shift-drag draws a partial marquee; `Cmd/Ctrl+A` selects the board. Dragging a
   selection writes every placement through one `movePlacements` call, and any section growth is
   part of the same undo step through `moveSectionsBatch`. Nothing about membership is stored.

6. **Multi-object presence stays one payload.** `DraggingState.nodeIds` carries the dragged set; the
   leader publishes only its anchor position, and peers derive the other members from their stored
   placements plus the anchor delta — the same derivation used for section drags. Peer selection
   rings already work because `SelectionState.nodeIds` is a list.

## Consequences

- Orientation is read-only and derived: renaming or moving a section updates the rail, the
  breadcrumbs and the Library without a migration.
- The Library stops being a flat list without becoming a sidebar: scope, facet and grouping are
  presentation, and row expansion mounts an editor only for the open row.
- The card tab is a routing exercise, not another editor rewrite.
- The "one editable surface" rule must be respected by any new surface (card tab, focus mode,
  embeds). A shared test asserts it.
- Shift doubles as the marquee key and an additive click key; both are verified against pane
  panning.
- Rich-text editing in the Library is a normal field-level write, so peers see it as an ordinary
  change and no new conflict class is introduced.
