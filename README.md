# Suite

A local-first, collaborative canvas for connected thinking. A **workspace** owns its **cards** and
the **boards** they appear on: cards are objects first (they can sit in the Inbox, or on several
boards at once), and boards are views. Edits sync live and the canvas keeps working offline.

![Suite](docs/assets/preview-dark.png)

## Quick start

```sh
pnpm install
pnpm dev          # canvas app (http://localhost:5173) + collab server (:1234)
```

The app opens on the **workspace launcher**: start a blank workspace, open a `.suite` backup, or
pick a recent workspace. Recent workspaces are local metadata only.

Open two browser windows at the same URL — including `?workspace=<any-id>` to work in a separate
workspace (`?doc=` still works as an alias) — and edits, carets, titles, and presence appear in
both. Board tabs in the app bar switch boards inside the same workspace.

The dock at the bottom of the canvas opens the **library**: cards taken off a board land in the
**Inbox**, the **Cards** tab lists everything in the workspace, and the **Trash** tab restores or
purges what you deleted. Clicking a card type creates a card on the current board.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Canvas app + Loro collab server |
| `pnpm storybook` | Component workshop on :6006 |
| `pnpm verify` | lint → typecheck → unit tests → build (what CI runs) |
| `pnpm lint` / `pnpm lint:fix` | Biome |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm test` | Vitest (graph + server + canvas) |
| `pnpm e2e` | Playwright (boots app + collab server) |
| `pnpm build` | Builds `@suite/graph` then the canvas app |
| `pnpm clean` | Removes build output and caches |

## Layout

```
apps/canvas          React 19 + Vite + Tailwind v4 app (React Flow canvas, Tiptap editors)
apps/collab-server   Loro WebSocket sync server
packages/graph       @suite/graph — Zod schema + typed Loro document layer
e2e                  Playwright tests
docs/                Architecture, conventions, ADRs
```

## How it works

A single `LoroDoc` per workspace is the source of truth:

- `boards` — named boards in this workspace
- `cards` — workspace-level objects with one primary type, tags, typed properties, connectors and
  `deletedAt`; content lives independently of any board
- `types` / `tags` — type definitions with fields, and freeform workspace labels
- `placements` — where a card sits on a board (`x`, `y`, `z`, `createdAt`); one per card and board
- `sections` — board-scoped rectangles; a card's section is derived from geometry, never stored
- `edges` — described links drawn on a board, dormant while an endpoint is off it
- `references` — a derived index of mention targets, rebuilt from card content
- `content` / `titles` — per-card body and title rich text (Loro maps shaped by
  `loro-prosemirror`), edited with Tiptap

A card keeps its identity when it moves between boards; a mention, a `card` property or an arrow
is a reference, while only an explicit place action puts a card on a board.

`LoroIndexeddbPersistence` persists locally; the `loro-websocket` sync server flushes each room to
SQLite (`SUITE_DB`, default `apps/collab-server/suite.documents.sqlite`) so a workspace survives a
server restart. Presence (`user`, `pointer`, `board`, `focus`, `dragging`, plus editor carets) and
the canvas gesture channel ride Loro `EphemeralStore`s; they are not persisted in the document. All
writes go through `WorkspaceDocument`, which validates with Zod. See
[docs/architecture.md](docs/architecture.md).

## Workspace files

`Share` copies a link that grants collaborative editing of that workspace. It is link-based, not an
account or ACL.

`File → Export backup…` writes a versioned `.suite` file containing the exact Loro snapshot. Import
it from the launcher; it always opens as a **new** workspace and never merges into the open
document. `File → Export JSON…` and `Export Markdown…` are readable projections for other tools;
they are export-only, not import formats.

## Publishing

`pnpm build` produces a static site in `apps/canvas/dist` and the typed library in
`packages/graph/dist`. The build resolves `@suite/graph` from source in development
(`development` export condition) and from `dist` in production, so a clean checkout always
builds via `pnpm build` (Turbo builds the dependency first).

Deploy `apps/canvas/dist` to any static host and point `VITE_COLLAB_URL` at your Loro sync
server:

```sh
VITE_COLLAB_URL=wss://collab.example.com pnpm build
```

## Docs

- [AGENTS.md](AGENTS.md) — repo map, rules, and workflow for AI agents
- [docs/architecture.md](docs/architecture.md) — data flow and layers
- [docs/conventions.md](docs/conventions.md) — coding standards
- [docs/decisions/](docs/decisions/) — architecture decision records
