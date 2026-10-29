# Coding conventions

The rules as rules. The model they serve is [architecture.md](architecture.md). The procedure that
applies them is [../how-to/add-a-feature.md](../how-to/add-a-feature.md), and the gate is
[../how-to/test-and-verify.md](../how-to/test-and-verify.md).

## Shape: pure core, imperative shell

Pure modules take data and return data: schema, records, planning (`layoutPlan`), projection, publish
planning, link geometry, name derivation. No DOM, no Loro, no `fetch`, no timers, and a test that needs
none of them.

Shell modules own state or I/O: `WorkspaceDocument` and its domain modules, `LoroIndexeddbPersistence`,
the collab provider, the projection worker, HTTP handlers, React host components.

Dependencies point inward. A pure module that imports `loro/WorkspaceDocument.ts` is a bug; the graph
layer passes plain values down and interprets results up.

One owner per piece of state. Document truth lives in Loro through `WorkspaceDocument`, UI state lives in
Zustand, and transient view state may live in React. Never keep a second copy.

## Files and folders

Folder by feature, not by file type: `apps/canvas/src/{canvas,cards,library,panels,command,field,shell,sharing,session,store,collab,editor,theme}`,
`apps/collab-server/src/{http,store,projection,config,sync}`,
`services/auth/src/{identity,organizations,invitations,licensing,http,store}`, and
`packages/graph/src/loro/<domain>`.

Each folder exposes one `index.ts` and nothing else as public surface. No barrel files that re-export
everything. The facade (`WorkspaceDocument`) and the folder index are the API.

Co-locate `*.test.ts(x)` and `*.stories.tsx` with the code they cover.

One primary export per file; small helpers stay private. Named exports only, with `App` at the entry as
the one default. Size is a signal: around 400 lines, look for a seam. `pnpm shape` fails a source file
over 900 lines. The 400 number is a prompt, the 900 number is the gate.

Components are `PascalCase.tsx`, hooks are `useCamelCase.ts`, other modules are `camelCase.ts`.

## Naming

Functions read `verbNoun`: `placeCard`, `moveSectionsBatch`, `applyProjection`. Predicates read `isX`,
`hasX` or `canX`: `isSelfLink`, `canManageSchema`. Conversions read `toX` and `fromX`; `parseX` returns a
`Result` and `assertX` throws.

Hooks are `useX`, component props are `XProps`, tagged error types are `XxxError`.

A type pluralises by derivation: read `typePluralName(type)` where a type labels a set, and `type.name`
where it labels one card.

Tests describe the unit under test and use `it("should …")` for the behaviour.

## Data and errors

Prefer plain readonly objects, discriminated unions and exhaustive `switch`.

No boolean-flag arguments. Take a small options object, or write two named functions.

`Result<T, E>` from `neverthrow` belongs at fallible boundaries: parsing, validation, HTTP handlers,
licence and admission checks. Use `ok` and `err`, then `map`, `andThen` or `match`, and convert once at
the seam; `services/auth/src/http/response.ts` holds the single error to status mapping.

Throw for programmer errors and invariants only, and never a bare `Error("…")` across a module boundary.
Define a tagged error type.

`remeda` is for transforms where it removes code or a loop. Do not wrap a one-liner.

`zod` is the source of truth for persisted shapes: derive types with `z.infer`, never duplicate an
interface, and validate on every write.

No new dependency without a stated job and the correct package.

## Refactor on sight

Fix these when the file is already open. Each one has a failure mode.

| Smell | Smallest fix |
| --- | --- |
| A whole-record write where two fields can change independently | Write the leaf field, or use a map per record |
| A derivation stored back into the document | Recompute at read time |
| An effect that exists to run one user action | Run it in the handler |
| A second copy of geometry, formatting, or presence rules | One helper, one call site |
| A read share that can write | Check the capability at the mutation |
| A log line with a token, email, or document body | Redact at the logger |

`pnpm shape` enforces the mechanical half: file length, parameter count, banned dynamic-code APIs, one
`WorkspaceDocument.observe` call site, and no raw Loro writes to graph roots outside `@suite/graph`.
`pnpm docs:symbols` enforces that every backticked path, root script, and ADR reference in the docs
resolves.

An `ADR-NNNN` reference is shorthand for a decision record in the maintainers' decision log, which is
not published with the source. The id is stable and quotable; the surrounding prose states the
decision, so nothing here depends on reading the record itself.

## TypeScript

Strict mode stays on, including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax` and `isolatedModules`. Do not weaken it.

No `any` without a `// biome-ignore lint/suspicious/noExplicitAny: <reason>` and a real reason. Prefer
`unknown` with narrowing, and discriminated unions.

Type-only imports use `import type`. Write `.js` extensions in `@suite/graph` relative imports, because
the package emits ESM.

## Imports

External packages, then `@suite/*` workspace packages, then relative imports, separated by blank lines.
Biome's `organizeImports` enforces it; run `pnpm lint:fix`.

## Domain language

A workspace is one `LoroDoc`, one sync room and one IndexedDB entry. A board is a view inside it. A card
is the object, with content, primary type, tags, properties and connectors, and exists with or without a
board. A placement is where a card sits on one board, so say "place" and "remove from board" and never
"delete". Trash is the soft delete through `deletedAt`; "delete forever" belongs to purging.

Never write "node", "document" or "note" for these. A node is a React Flow node, a note is the built-in
card type, and a document is the whole workspace document. The full list is [glossary.md](glossary.md).

## Libraries first

Use the library's own primitive before writing UI or state plumbing: Tiptap's `BubbleMenu` and
`useEditorState`, React Flow's `useNodesState`, `useEdgesState` and `ViewportPortal`, Zustand selectors.
Hand-roll only what the library leaves out, such as the buttons inside `BubbleMenu` or the canvas context
menu.

## React

Function components with hooks, no classes.

Derive document data through the workspace snapshot store (`useWorkspaceSnapshot`, `useCard`,
`useCards`) and never a `useState` copy. Never call `WorkspaceDocument.observe` from a component: the
store owns the single subscription and selectors stay atomic. Keep components small and split
presentational pieces into the feature folder.

## State

Zustand holds UI state only. Document data is owned by the Loro doc.

One editable surface per card per client. A card's title and body may be mounted on several surfaces, and
only one is editable, decided by `editingSurface` in the UI store. Never add a second cursor store or
peer id to work around it.

## Navigation

Reveal requests go through the UI store's `focusTarget` (`focusCard`, `focusSection`): a surface asks and
the canvas moves. Never call `setCenter` or `fitBounds` from a panel.

A reveal changes the view only. It writes nothing and does not change selection unless the surface also
selects.

## Presence and coordinates

Broadcast presence in flow coordinates (`screenToFlowPosition`), never raw screen pixels, and render the
overlay inside `<ViewportPortal>` so it follows pan and zoom.

Never render a shared cursor store across editors without filtering by Loro container, and publish carets
only from the focused editor.

Persist positions to the CRDT on drag stop only; live positions travel through `EphemeralStore`. Dragging
a connector dot means "connect", while repositioning uses the selected grab handle.

Do not publish a pointer position while a local editor or canvas gesture is active. Peers show the name
on the interacted element and the pointer returns on the next move.

## References and rich text

A property block in a body is a view. It carries a `fieldId` and writes through `setProperty` and
`clearProperty`; values live in the card index so facets and dashboards never parse text.

Blocks are inserted from the body, not the panel. `/property` and `@` hand over to the one picker, and
removing a block removes the view only.

One stored style, many views. A value renders through `displayTemplate(field)` by `ValueTemplate`; never
format a value by hand, never write a template into a value, and never prepend a marker the template does
not name.

A `@card.field` chip is a link. It stores `cardId` and `fieldId` and renders the live value.

References are derived and rebuildable. `references.<cardId>` is maintained from mention nodes; never
hand-write it, never store a backlink on a card, and fix the index or let `ensureReferences` do it when
content disagrees.

A semantic link never creates a placement. Only an explicit place action puts a card on a board.

No schema writes from the editor. Field creation stays in type settings, because body undo excludes
structural origins.

Arrow descriptions are free text. Arrows stay untyped, and meaning belongs to a property name.

A label drag is a gesture. Publish `labelDrag` and persist once on release.

The `@` list has three row kinds: `field` for a block on this card, `card` for a mention, `reference` for
another card's field. Own fields come first, then cards.

A suggestion is previewed. The completion is a widget decoration, so arrowing cannot write into the card
or land in the undo stack.

## Data layer

Never mutate `WorkspaceDocument` internals from the UI. Add typed methods to `packages/graph` instead, and
let every `set*` method validate with its Zod schema.

Undo is split by scope: never add structural changes to an editor's history, and never put text in the
document's `UndoManager` scope.

Write fields, not records. Prefer `mutateCard`, `mutateEdge`, `updatePlacementPosition`,
`updatePlacementSize`, `moveConnector` and `reconnectEdge` over `setCard` and `setEdge`.

Reads never create shared state: use `peekContent` and `peekTitle` for fragments, and let creation paths
insert containers. Rely on record identity to skip re-renders, and never rely on it flipping.

Membership is a collection write: `setCardTypes`, `addCardType`, `removeCardType`, `addCardTag`,
`removeCardTag`, `setProperty`, `clearProperty`. Never replace a whole map.

Removing a field, switching a type or removing a tag leaves values dormant on purpose. Do not clean up
other records; a later explicit command owns that. Required fields are advisory and never block a write.

Section membership is derived. Read with `sectionMembership` and `sectionForCard`, write a drag with
`moveSectionsBatch`, and write geometry on release rather than during a gesture.

One commit per gesture. Never loop a single-record method over a selection, because that produces N undo
steps.

## Testing

Unit-test pure logic in `packages/graph`: schema, records and the `WorkspaceDocument` domain modules.

Multi-client behaviour gets a two-document test. Drive both documents through conflicting edits, sync
with `doc.export({ mode: "update" })` and `doc.import(...)` in both directions, then assert the merge.
`workspace.convergence.test.ts` fuzzes this across seeds, so add a seeded case for a new kind of write.

React Testing Library covers non-trivial UI in `apps/canvas`, and Playwright covers journeys in `e2e`.
Tests run under Node's runner in `services/billing` and Vitest elsewhere; the tiers are in
[../how-to/test-and-verify.md](../how-to/test-and-verify.md).

## Commits

Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. The subject is imperative
and at most 72 characters; commitlint enforces it.
