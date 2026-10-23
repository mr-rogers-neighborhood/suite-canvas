# ADR-0031: Whiteboard cards and element-level Loro binding

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0006](./0006-connectors-and-layers.md), [ADR-0015](./0015-loro-as-crdt-engine.md), [ADR-0022](./0022-share-projection-links.md), [ADR-0030](./0030-scene-projection-lod-and-real-portals.md), [`docs/architecture.md`](../architecture.md) §Document model

## Context

A typed card is an editor, not a drawing surface. Users need to sketch: a diagram, a wireframe, a
freehand region of a board that has no field schema and no place in the typed graph. Excalidraw is
the obvious editor — mature, MIT-licensed, keyboard-accessible, and its scene format is stable — but
using it raises three questions the document model has to answer before any UI exists.

1. **Where does the drawing live?** A whole-scene JSON blob is trivial to store and impossible to
   merge: two people drawing in different corners of the same whiteboard overwrite each other.
2. **Who owns undo?** Excalidraw has its own history, Loro has the workspace history. Two live
   histories over one surface produce two truths about what the last gesture was.
3. **How does the drawing behave at distance and in a share?** A whiteboard must have a card face
   like every other card, must count as content in a projection, and must not smuggle a second live
   canvas into the scene.

A fourth question — should a whiteboard embed a live portal — is answered by ADR-0030: recursion
belongs to the board scene, not to an embedded editor.

## Decision

1. **`whiteboard` is a built-in card type.** It is seeded with the other starter types, has a glyph
   and a title, and participates in the same placement, tag, search, trash and undo machinery as
   every other card. On the board it is an ordinary card with a cached preview; opening it uses the
   existing focus surface rather than a new page.

2. **Drawings live in a `drawings` root map.** The map mirrors `content`/`titles`: one key per
   whiteboard card, holding `elements`, `order`, `tombstones`, `version` and `updatedAt`. A drawing
   is workspace document state inside the single `LoroDoc`, not an attachment and not a sidecar
   file.

3. **Elements are field maps, not values.** `elements` is a `LoroMap` keyed by element id, whose
   value is another `LoroMap` of Excalidraw field → value. Each element id is stable; each field is
   its own map key, following the field-granular rule ADR-0006 set for cards. Two people editing
   different fields of one element keep both edits.

4. **Z-order is a movable list.** `order` is a `LoroMovableList<elementId>`, so moving one element
   forward does not renumber the scene and concurrent moves keep their intent.

5. **Deletes leave tombstones until purge.** A deleted element keeps its id and a tombstone marker
   in the drawing until an explicit purge. A concurrent delete and undo converge instead of
   resurrecting an element with a different identity. Purge is the one command that removes
   tombstones, and it is bounded by the card.

6. **Loro owns undo; Excalidraw's history is scoped or disabled.** One Loro transaction covers a
   gesture, the capture origin identifies the whiteboard card, and Excalidraw's own history is
   suppressed inside the focus surface or scoped to that surface. `Cmd-Z` on the board and inside the
   whiteboard walk the same canonical stack; there is no second undo model.

7. **Binding is diffed, not streamed.** `initialData`/`updateScene` project the Loro drawing into
   Excalidraw; `onChange` diffs by element id and writes only changed fields; echo suppression uses
   the Loro subscription origin so a remote update calls `updateScene` without writing back. There
   are no per-frame document writes.

8. **Text elements use `LoroText` where feasible.** Character-wise merging is the default for text
   content. If a field cannot be represented as `LoroText`, it is documented as whole-value LWW as a
   known limitation rather than silently pretending to merge.

9. **The card face is a derived SVG preview.** A debounced `exportToSvg` is cached as an SVG/asset
   for the card face; `compact` and `icon` LOD fall back to the whiteboard glyph. The preview is a
   cache of the scene, never truth, and invalidation follows drawing changes.

10. **Shares and export include drawings.** A projection that contains a whiteboard copies its
    `drawings` entry under the same redaction rules as body text. Portable export includes the scene
    JSON and/or an SVG preview. Search indexes the card title and optionally text elements; it does
    not deep-search the whole scene.

11. **No live portals inside a drawing.** A drawing may contain a link or shape reference to a card
    or board, but it does not embed a live board scene. Recursive live boards belong to the board
    scene (ADR-0030); an embedded editor is not a second surface for portals.

## Rejected alternatives

- **A whole-scene JSON blob only.** Cheapest first version and a merge disaster: concurrent drawing
  resolves last-write-wins for the entire whiteboard, and undo removes work the user never touched.
- **Excalidraw's built-in collaboration as truth.** It would introduce a second CRDT, a second
  presence channel and a second undo stack for one card type, and the drawing would no longer be
  part of the workspace document or its projections.
- **A full Excalidraw fork.** Owning an editor fork to add Loro binding means owning upstream
  rendering, accessibility and upgrade debt. The binding belongs at the document boundary.
- **Storing the drawing as an attachment.** Attachments are bytes with a lifetime of their own; a
  whiteboard is editable, searchable content that must participate in undo, shares and export.
- **Live portals inside drawings.** Two nested live canvases double the gesture and editor cost and
  make the drawing's coordinate space depend on the board scene.

## Consequences

- **A whiteboard is content, so it inherits content obligations.** Trash, restore, publish,
  redaction, export and the N−1 format all have to learn `drawings`, exactly as they know
  `content`/`titles`.
- **Element-level binding is more code than a blob.** The payoff is concurrent editing, field-granular
  writes and a single undo stack; the cost is a diff/echo layer that needs tests for every gesture
  shape.
- **Text fidelity is explicit.** `LoroText` per text element is the target; a documented LWW
  fallback is acceptable only where the editor's model cannot expose a text container.
- **Undo is a gate, not a detail.** If Excalidraw's history cannot be suppressed or scoped cleanly,
  the card ships without that surface rather than with two competing histories.
- **Previews are cache.** A stale preview is a rendering bug, never a document inconsistency; a
  rebuild always reproduces it from `drawings`.
- **No live nested boards in a drawing.** A user who wants a board inside a whiteboard is pointed at
  the scene: place a portal on the board that contains the whiteboard, not inside the drawing.
