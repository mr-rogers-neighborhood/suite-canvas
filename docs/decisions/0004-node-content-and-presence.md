# ADR-0004: Every node is a collaborative editor

- **Status:** accepted; CRDT engine and presence store amended by [ADR-0015](./0015-loro-as-crdt-engine.md)
- **Date:** 2026-10-20

## Context

Nodes started as plain records with a side-panel editor. We want the canvas to be the product:
click a node, edit it in place, collaborate on it live. That needs per-node rich text that syncs,
plus presence so collaborators can see where each other are.

We also had to choose how much UI to hand-roll: Tiptap ships formatting *machinery*, and the
temptation is to build a bespoke toolbar component around it.

## Decision

1. **One node kind (`note`) for now.** Every node renders as a Tiptap editor. The zod
   discriminated union stays so kinds can return.
2. **Content lives in the same `Y.Doc`**, as `content: Y.Map<Y.XmlFragment>` keyed by node id.
   `GraphDocument` owns access (`getContent`, `removeContent`, `createNote`) and cascades content
   deletion with the node.
3. **Use Tiptap's built-in `BubbleMenu`** (`@tiptap/react/menus`) for the floating toolbar instead
   of a custom popup component, and `useEditorState` for editor-derived state. Tiptap does not
   ship prebuilt formatting buttons (docs: "the markup and styling is totally up to you"), so
   only the `<button>` markup is ours.
4. **Presence rides Yjs awareness** through the Hocuspocus provider: `user`, `pointer` (canvas
   cursor), `focus` (focused node). Editor carets/selections use `yCursorPlugin` from
   `@tiptap/y-tiptap` on a separate `editorSelection` field.
5. **React Flow owns transient UI state** (`useNodesState`/`useEdgesState` for drag position and
   selection); the CRDT stays the source of truth and persistence happens on drag stop.
6. **Document identity is addressable** via `?doc=<id>`, used for both the IndexedDB key and the
   Hocuspocus room.

## Consequences

- Editing is in-place and fully collaborative; the side-panel editor is gone.
- Deleting a node removes its edges and content, so no orphaned CRDT data.
- Presence is one channel for canvas and editor, which keeps awareness payloads small.
- No custom positioning/show-hide logic to maintain; upgrades come from Tiptap.
- Formatting buttons are still hand-written markup, but confined to `NodeCard`.
- Hosting multiple documents now works without code changes beyond the query param.
