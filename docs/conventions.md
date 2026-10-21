# Coding conventions

## TypeScript

- Strict mode is on (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `isolatedModules`). Do not weaken these.
- No `any` without a `// biome-ignore lint/suspicious/noExplicitAny: <reason>` and a real reason.
- Prefer `unknown` + narrowing, `z.infer` types from schemas, and discriminated unions.
- Type-only imports use `import type`. Write `.js` extensions in `@suite/graph` relative imports
  (emitted ESM).
- Schemas are the source of truth for persisted shapes — derive types with `z.infer`, never
  duplicate interfaces.

## Domain language

Use the workspace vocabulary consistently, in code and in copy:

- **workspace** — one `Y.Doc`, one sync room, one IndexedDB entry.
- **board** — a view inside a workspace; has a name and a tab.
- **card** — the object (content, connectors, kind). Exists with or without a board.
- **placement** — where a card sits on one board. "Place" and "remove from board", never "delete".
- **trash** — soft delete (`deletedAt`). "Delete forever" only when purging.

Avoid "node"/"document"/"note" for these concepts: `node` means a React Flow node, and `note` is a
card kind.

## Files & naming

- React components: `PascalCase.tsx`; hooks: `useCamelCase.ts`; plain modules: `camelCase.ts`.
- Tests co-located as `*.test.{ts,tsx}`; Storybook stories as `*.stories.tsx`.
- One component per file, named export (no default exports for components; `App` is the
  exception and stays a default export at the entry).

## Imports

Order, separated by blank lines:
1. External packages
2. `@suite/*` workspace packages
3. Relative imports

Biome's `organizeImports` enforces this; run `pnpm lint:fix`.

## Libraries first

- Use the library's own primitive before writing UI or state plumbing: Tiptap's `BubbleMenu`
  for the floating toolbar, `useEditorState` for editor-derived state, React Flow's
  `useNodesState`/`useEdgesState` for transient canvas state, Zustand selectors for store reads.
- Only hand-roll what the library does not provide (e.g. formatting buttons inside `BubbleMenu`,
  the canvas context menu).

## React

- Function components with hooks; no class components.
- Derive document data via `useGraphSnapshot` (subscribes to the CRDT), not `useState` copies.
- Keep components small; split presentational pieces into `components/`.

## State

- Zustand for UI state only. Document data is owned by the Loro doc.
- Store selectors should be atomic (`useCanvasStore((s) => s.graph)`) to limit re-renders.

## Presence and coordinates

- Broadcast presence in **flow coordinates** (`screenToFlowPosition`), never raw screen pixels;
  the board `EphemeralStore` overlay renders inside `<ViewportPortal>` so it follows pan/zoom.
- Never render a shared cursor store across editors without filtering by Loro container; a peer's
  caret belongs only to the editor whose mapping contains it. Publish carets only from the focused
  editor.
- Connector drags persist on release only; live positions stay in component state.
  Dragging a connector dot means "connect"; repositioning uses the selected grab handle.
- Persist positions to the CRDT on drag stop only; live positions travel through `EphemeralStore`.
- Do not publish a pointer position while a local text editor or canvas gesture is active. Peers
  render the name on the interacted element instead, and restore the pointer on the next move.

## Data layer

- Never mutate `WorkspaceDocument` internals from the UI. Add typed methods to
  `packages/graph` instead.
- Every `set*` method validates with the Zod schema; keep it that way.
- Undo is split by scope: never add structural changes to an editor's history, and never put text
  in the document's `UndoManager` scope (`cards`/`placements`/`edges`/`boards` only).
- Write **fields**, not records: prefer `mutateCard`/`mutateEdge`, `updatePlacementPosition`,
  `updatePlacementSize`, `moveConnector`, `reconnectEdge` over `setCard`/`setEdge`. A whole-record
  write makes concurrent edits to other fields of that record resolve last-write-wins.
- Reads must never create shared state. Use `peekContent`/`peekTitle` for fragments; only creation
  paths insert them.
- Record identity is stable until that record changes: `WorkspaceDocument` caches the materialised
  object and drops it when any of its fields change, and `useWorkspaceSnapshot` reuses unchanged
  collections. Rely on identity to skip re-renders; never rely on it flipping.

## Testing

- Unit-test pure logic (schema, `WorkspaceDocument`) in `packages/graph`.
- Multi-client behaviour gets a **two-document test**: drive both `WorkspaceDocument`s through
  conflicting edits, sync with `Y.encodeStateAsUpdate`/`Y.applyUpdate` both ways, then assert the
  merge. `workspace.convergence.test.ts` fuzzes this across seeds; add a seeded case there when you
  add a new kind of write.
- Component tests (React Testing Library) for non-trivial UI in `apps/canvas`.
- E2E (Playwright) for user journeys in `e2e`.
- Name tests `should <behavior>`; describe by unit under test.

## Commits

Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Subject is
imperative and ≤ 72 chars. Commitlint enforces this.
