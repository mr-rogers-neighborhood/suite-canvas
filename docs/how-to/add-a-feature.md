# Add a feature

The data flow fixes the order: the document package owns the shape, the workspace document owns the
write, the snapshot store owns the read, and the component renders. Skip a step and the feature works
until two clients disagree.

The example throughout is a `dueAt` date on a card. The same steps cover a new field kind, an edge
attribute or a board setting.

## 1. Model it in `@suite/graph`

Schema first. Everything persisted is a Zod schema in `packages/graph/src/schema.ts`, and the
TypeScript type is derived from it rather than written twice.

- Add or extend the schema (`cardSchema`, `edgeSchema`, `boardSchema`, …) and export the inferred
  type beside it.
- A new constrained value is a `z.enum` built from an `as const` tuple, so the UI can iterate it.
- Shape changes are additive and optional, so an old document still parses. Bumping a stored format is
  an explicit decision, not a side effect of adding a field.
- Update `packages/graph/src/schema.test.ts` with the parse and reject cases. The loop is
  `pnpm exec vitest run packages/graph/src/schema.test.ts`.

## 2. Put the write on `WorkspaceDocument`

Graph writes go through the typed wrapper in `packages/graph/src/loro/`. The method lives in the module
that owns the record (`cards/`, `placements.ts`, `edges.ts`, `sections.ts`, `boards.ts`) and is
re-exported from `WorkspaceDocument.ts`.

- Prefer a field write over a whole-record write: `mutateCard`-style methods keep concurrent edits to
  other fields from resolving last-write-wins. Do not add a `setCard(wholeRecord)` path for one field.
- Validate with the Zod schema at the boundary. Every `set*` method does, and a new one must too.
- Keep reads side-effect free: `peekContent`/`peekTitle` for fragments, and only creation inserts.
- Commit once per gesture, so `Cmd-Z` undoes the whole drop rather than N single-record steps.
- Add the method's test beside the module (`packages/graph/src/loro/cards/*.test.ts`). If the write can
  conflict with another client, add a seeded case to `merge.property.test.ts`.

## 3. Expose it to the UI

Read through the snapshot. The store holds one subscription and hands components plain objects.

Read a collection with `useWorkspaceSnapshot()` from `apps/canvas/src/store/workspaceStore.ts`, and a
single record with `useCard(cardId)` or `useCards(ids)`. `workspaceSnapshotStore.ts` projects the
document into the snapshot; widen it there when the new value must reach a component, and keep
selectors atomic (`useCanvasStore((s) => s.graph)`).

Never call `WorkspaceDocument.observe` from a component, and never copy document data into `useState`
or Zustand. Zustand holds selection, active card and menus only. UI state the feature adds (an open
panel, a pending gesture) belongs in `useUiStore.ts`.

## 4. Build the surface

Components live in the folder that owns the surface, under `apps/canvas/src/`:

| Folder | Surface |
| --- | --- |
| `canvas/` | The board, cards on it, sections, connectors, placement and the outline rail |
| `cards/` | The card face, the panel, the body and title editors, field controls |
| `editor/` | The Tiptap nodes, marks, suggestion menus and collaboration plugin |
| `field/` | Field kind registration and the composing kinds |
| `library/` | The drawer, its filters, rows and drag-out |
| `chrome/` | Title bar, board tabs, views bar, dock |
| `panels/` | Container panel, link inspector, type settings |
| `dialogs/` | Modal shell, context menu, confirmations |
| `command/` | The command registry, palette and ranking |
| `styles/`, `theme/` | Style rules, the appearance dialog, theme tokens and resolution |
| `presence/`, `cursor/` | Peer cursors, name tags, avatars, the status cursor |

One component per file, named export, `PascalCase.tsx`. The two reference pages are the map for this
work: [reference/editing.md](../reference/editing.md) for text, fields, chips and undo, and
[reference/ui.md](../reference/ui.md) for the shell, focus and theme rules.

Use the library primitive before writing plumbing: Tiptap `BubbleMenu`, `useEditorState` and
`useNodesState`/`useEdgesState` on the board, Zustand selectors. A card may be mounted on several
surfaces, so consult `editingSurface` in the UI store rather than starting a second editor. A reveal
goes through `focusTarget` (`focusCard`, `focusSection`); a panel never calls `setCenter` or
`fitBounds`. A modal panel gets `useFocusTrap` from `apps/canvas/src/dialogs/useFocusTrap.ts`, a menu
gets `menuKeyDown` from `apps/canvas/src/dialogs/menuKeys.ts`, and Escape is registered with
`useEscapeLayer` rather than a listener of its own. Format values through `displayTemplate(field)` and
`ValueTemplate` instead of formatting by hand; that rule and its history are in
[reference/editing.md](../reference/editing.md).

## 5. Story and test

Tests sit beside the thing they test: `apps/canvas/src/cards/NodeCard.test.tsx` covers the card face,
`apps/canvas/src/field/compositeKinds.test.tsx` covers the composing field kinds, and
`packages/graph/src/schema.test.ts` covers the schema.

- A story (`*.stories.tsx`) when the surface is visual, with the states a reviewer would ask about:
  default, empty, long content, error. Stories are what the visual baselines render.
- A React Testing Library test (`*.test.tsx`) for behaviour that is not trivially presentational. A
  new node, mark or field renderer also has to keep
  `apps/canvas/src/editor/editorSchemaContract.test.ts` passing; the procedure is in
  [change-the-editor.md](change-the-editor.md).
- A Playwright spec under the matching `e2e/tests/<area>/` folder when the behaviour only exists
  across the server and the browser. The areas today are `account`, `appearance`, `boards`, `boot`,
  `cards`, `collab`, `input`, `library`, `links`, `selection`, `sharing`, `views` and `visual`. Tag the
  happy path `@smoke` if that area already has a smoke test, since `pnpm e2e:smoke` runs exactly those.

## 6. Touch the server only if the feature reaches it

The collab server does not know about card fields; it stores documents. A feature reaches it when it
adds a route, a stored format, a quota or a metric, and each has one home:

| Concern | Home under `apps/collab-server/src` |
| --- | --- |
| Route, request parsing, CORS, rate limit | `http/` |
| Persisted file, migration, store schema | `store/` |
| Share projection, room, sweep | `projection/` |
| Socket, seat gate, room save | `sync/` |
| Env parsing, limits resolution | `config/` |
| Admin API, metrics, log line | `ops/` |

The account control plane has the same shape in `services/auth/src/` (`http/`, `identity/`,
`invitations/`, `licensing/`, `organizations/`, `store/`), and billing in `services/billing/src/`
(`handler/`, `stripe/`, `store/`, `ops/`).

A new quota is a constant in `config/limits.ts` plus a regenerated
[reference/limits.md](../reference/limits.md), never a hand-edited number. A new stored format needs an
N−1 fixture under `apps/collab-server/src/fixtures/n-1/` and a test that opens it.

## 7. Verify in tiers

```sh
pnpm check                    # while editing: lint, types, changed tests, docs symbols, shape
pnpm exec vitest run apps/canvas/src/cards   # one area, while iterating
pnpm verify                   # before the commit: lint, types, unit, stories, build, docs
pnpm e2e:smoke                # the feature is user-visible
pnpm e2e                      # schema/CRDT, sharing, gestures, persistence or >3 surfaces changed
```

Then update the docs that describe the new fact. A user-visible capability is worth a line in
the internal roadmap when it closes a gate, and a decision that changes
ownership gets an ADR. The tier rules are in [test-and-verify.md](test-and-verify.md); the standards
are in [reference/conventions.md](../reference/conventions.md).
