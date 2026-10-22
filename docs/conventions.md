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

- **workspace** — one `LoroDoc`, one sync room, one IndexedDB entry.
- **board** — a view inside a workspace; has a name and a tab.
- **card** — the object (content, primary type, tags, properties, connectors). Exists with
  or without a board.
- **placement** — where a card sits on one board. "Place" and "remove from board", never "delete".
- **trash** — soft delete (`deletedAt`). "Delete forever" only when purging.

Avoid "node"/"document"/"note" for these concepts: `node` means a React Flow node, and `note` is
the built-in card type, not a synonym for card.

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
- Derive document data through the workspace snapshot store (`useWorkspaceSnapshot`, `useCard`,
  `useCards`), not `useState` copies. Never call `WorkspaceDocument.observe` from a component;
  the store owns the single subscription.
- Keep components small; split presentational pieces into `components/`.

## State

- Zustand for UI state only. Document data is owned by the Loro doc.
- Store selectors should be atomic (`useCanvasStore((s) => s.graph)`) to limit re-renders.
- **One editable surface per card per client.** A card's title and body may be mounted on several
  surfaces (canvas card, inspector, Library row, later a card tab), but only one may be editable at
  a time, decided by `editingSurface` in the UI store. Never start editing in a second surface
  without moving the surface first; never add a second cursor store or peer id to work around it.

## Navigation

- Reveal requests go through the UI store's `focusTarget` (`focusCard`, `focusSection`); a surface
  asks, the canvas moves. Never call `setCenter`/`fitBounds` from a panel.
- A reveal is a view change only: it writes nothing and does not change selection unless the
  surface also selects.

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

## References and rich text

- **A property block in a body is a view, never a store.** It carries a `fieldId` and writes through
  `setProperty`/`clearProperty`. Property values live in the card index so facets, queries and
  dashboards never parse rich text.
- **Blocks are inserted from the body, not from the panel.** `/property` (and `@`) hand over to the
  one picker, which lists this card's fields above every card; `/` never writes a property value and
  the panel never inserts a block. Removing a block removes the view only.
- **A `@card.field` chip is a link, not a copy.** It stores `cardId` + `fieldId` and renders the
  value live; clicking it opens that card's panel with the field focused, which is why the chip
  never needs an inline editor of its own.
- **References are derived and rebuildable.** `references.<cardId>` is maintained from mention
  nodes; never hand-write it, never store a backlink on a card, and never treat the index as
  authority when content disagrees — fix the index (or let `ensureReferences` do it).
- **A semantic link never creates a placement.** Mentions, property values and backlinks are
  references. Only an explicit place action puts a card on a board.
- **No schema writes from the editor.** Field creation stays in type settings, because the body
  editor's undo stack excludes structural origins; allowing it there produces edits that `Cmd-Z`
  cannot reach.
- **Arrow descriptions are free text.** Arrows stay untyped; meaning belongs to a property name or a
  description, not to a link-type registry.
- **A label drag is a gesture, not a stream.** Publish the in-flight offset as presence
  (`labelDrag`) and persist it once on release; never commit per pointer move.
- **The `@` list has three row kinds.** `field` inserts a block for this card, `card` inserts a
  mention, `reference` links to another card's field. Own fields first (they are the common case),
  then cards. Selecting a card opens its fields as a nested submenu, so the drill-in is visible
  rather than something you have to know; a query that names one card lists them directly, and a
  typed `.` re-queries as `@card.field`.
- **Completing a query is not an edit.** Arrow-key completion writes through a transaction with
  `setMeta("addToHistory", false)`, so arrowing through suggestions never fills the undo stack, and
  it is skipped for titles containing whitespace (the suggestion cannot span a space).

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
  object and drops it when any of its fields change, and the snapshot store reuses unchanged
  collections. Rely on identity to skip re-renders; never rely on it flipping.
- Type membership, tag membership and properties are collection writes: use
  `setCardTypes`/`addCardType`/`removeCardType`, `addCardTag`/`removeCardTag`, and
  `setProperty`/`clearProperty`. Never replace a whole `types`, `tags` or `properties` map.
- **A type name is singular; a collection label is not.** Read `typePluralName(type)` wherever a
  type labels a set (facets, group headings) and the bare `type.name` wherever it labels one card.
  The plural is optional and derived (`-s`, `-es` after a sibilant), so only irregular names need
  one stored.
- **Types add schema, never behaviour.** The primary type may change presentation (glyph, colour,
  template); no code may branch on a *combination* of types.
- Removing a field, switching a type or removing a tag leaves stored values dormant on purpose.
  Do not "clean up" other records in response; a later explicit command owns that.
- Required fields are advisory. Never block a write or an editor on a missing required field.
- **Section membership is derived, never stored.** Do not write a section id on a placement or a
  card. Use `sectionMembership`/`sectionForCard` for reads and `moveSectionsBatch` for a
  section drag (one commit for the section, contained sections and member placements).
- Section title and colour are individual field writes; geometry is written on release, not during
  a gesture. Auto-expand is a deliberate geometry write after a card drop.
- **One commit per gesture.** Moving several cards uses `movePlacements`; a section drag or a
  multi-drop that also grows sections writes both through `moveSectionsBatch`. Never loop a
  single-record method over a selection — that produces N undo steps.

## Testing

- Unit-test pure logic (schema, `WorkspaceDocument`) in `packages/graph`.
- Multi-client behaviour gets a **two-document test**: drive both `WorkspaceDocument`s through
  conflicting edits, sync with `doc.export({ mode: "update" })` / `doc.import(...)` both ways, then
  assert the merge. `workspace.convergence.test.ts` fuzzes this across seeds; add a seeded case
  there when you add a new kind of write.
- Component tests (React Testing Library) for non-trivial UI in `apps/canvas`.
- E2E (Playwright) for user journeys in `e2e`.
- Name tests `should <behavior>`; describe by unit under test.

## Commits

Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Subject is
imperative and ≤ 72 chars. Commitlint enforces this.
