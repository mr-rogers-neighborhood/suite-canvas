# AGENTS.md — Suite

Local-first, collaborative canvas application (Heptabase-style infinite canvas with a
semantic, typed object graph). This file is the entry point for AI agents (Copilot, Cursor,
Claude Code, …). Read it first; keep it high-signal.

## Stack

- **Monorepo:** pnpm workspaces + Turborepo (task caching)
- **Canvas app** ([apps/canvas](apps/canvas)): React 19, Vite, TypeScript, Tailwind CSS v4,
  Zustand (UI state), Tiptap 3 (every node is an editor). The target surface is ICE
  (`@vibecook/ice`, WebGPU) hosting the pure `@suite/scene` projection and the real `NodeCard` in a
  screen-space DOM overlay ([ADR-0034](docs/decisions/0034-ice-primary-rendering-engine.md)). ICE is
  the only canvas surface: the React Flow boards and the scene surface were removed once the port
  reached parity, and `?canvas=` no longer selects an engine. React Flow survives only as the
  package `NodeCard`/`Connector` import for `Handle`, inside the ICE card roots.

- **Collaboration:** Loro (CRDT) as the single source of truth, IndexedDB snapshot/update
  persistence, `loro-websocket` for sync (client provider + [apps/collab-server](apps/collab-server))
- **Typed object graph:** [packages/graph](packages/graph) (`@suite/graph`) — Zod schemas +
  a typed Loro wrapper (`WorkspaceDocument`)
- **Quality:** Biome (lint + format), Vitest + React Testing Library, Playwright e2e,
  Storybook, commitlint (conventional commits)

## Repo map

| Path | Purpose |
| --- | --- |
| `apps/canvas` | The React canvas app (launcher, board, editor, collab provider, Zustand store) |
| `apps/collab-server` | Loro WebSocket sync server |
| `packages/graph` | `@suite/graph` — schema, types, typed Loro layer, workspace file and portable export |
| `e2e` | Playwright end-to-end tests |
| `docs/` | Architecture, conventions, ADRs (read [docs/conventions.md](docs/conventions.md) before big changes) |
| `.github/` | CI, PR/issue templates, [copilot-instructions.md](.github/copilot-instructions.md) |

## Commands

```sh
pnpm install          # install (also prepares git hooks)
pnpm dev              # run canvas + collab-server (turbo)
pnpm lint             # biome check .
pnpm lint:fix         # biome check --write .
pnpm typecheck        # tsc across all packages (turbo)
pnpm test             # vitest (workspace mode)
pnpm e2e              # playwright
pnpm build            # turbo build (graph dist + canvas)
pnpm storybook        # storybook dev server
```

## Architecture in one paragraph

A single `LoroDoc` per workspace is the source of truth. `boards` (containers — ADR-0039), `views`
(cameras), `cards`, `placements`, `types`, `tags`, `edges`, the derived `references` index, and
per-card rich text (`content`/`titles`) live in the same doc; the `pins` map joins them under
[ADR-0035](docs/decisions/0035-views-pins-and-portals.md). `@suite/graph` validates every write with
Zod before it reaches the CRDT. The doc is persisted offline as a Loro
snapshot plus an update log in IndexedDB and synced by the `loro-websocket` provider when online.
The workspace id comes from `?workspace=<id>` (`?doc=` is a legacy alias). Zustand holds **UI
state only** (selection, active node, context menu) — never document data. ICE owns the camera,
spatial index and GPU faces; it never owns document truth, and its native undo is disabled for
document gestures. Every node is a Tiptap editor; formatting uses Tiptap's built-in `BubbleMenu`,
and presence (`user`, `pointer`, `focus`, `dragging`, carets) rides Loro `EphemeralStore` channels.


## Rules (non-negotiable)

1. **Never write raw Loro for graph data.** All node/edge/content mutations go through
   `WorkspaceDocument` (or new typed methods you add to `@suite/graph`).
2. **Document truth never lives in Zustand, React state, or localStorage.**
3. **Schema changes are additive-first.** Updating `packages/graph/src/schema.ts` requires
   updating its tests; bumping a schema is an explicit decision (see ADRs).
4. **TypeScript strict.** No `any` without a comment; prefer `unknown` + narrowing.
5. **Prefer library primitives over hand-rolled UI**: Tiptap `BubbleMenu` / `useEditorState`,
   React Flow `useNodesState` / `useEdgesState` / `ViewportPortal`. See
   [docs/conventions.md](docs/conventions.md).
6. **Presence uses flow coordinates** (`screenToFlowPosition`) and is drawn in `<ViewportPortal>`;
   document positions persist on drag stop, live drag positions ride `EphemeralStore`.
7. **Conventional commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
8. **Verify before claiming done:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (and `pnpm build`
   when touching the graph package or build config).

## Definition of done for a feature

- Schema/types updated in `@suite/graph` + unit tests
- UI implemented with a Storybook story where visually relevant
- Component/unit tests where behavior is non-trivial
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all green

## Adding a feature (typical path)

1. Model it in `packages/graph/src/schema.ts` (node/edge kinds) + tests.
2. Expose typed accessors/mutations on `WorkspaceDocument`.
3. Consume it in `apps/canvas` via `useWorkspaceSnapshot` / the Zustand store.
4. Add a Storybook story + tests.
5. Run the full verification set above.

## Guardrails

- Prefer small, focused changes; do not refactor unrelated code.
- Follow import order and naming in [docs/conventions.md](docs/conventions.md).
- Do not add dependencies without a stated reason (and add them to the correct package).
- Keep `AGENTS.md` and `copilot-instructions.md` short and current when conventions change.
