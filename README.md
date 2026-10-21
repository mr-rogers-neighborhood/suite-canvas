# Suite

A local-first, collaborative canvas. Every node is a rich-text card; edits sync live and the
canvas keeps working offline.

![Suite](docs/assets/preview-dark.png)

## Quick start

```sh
pnpm install
pnpm dev          # canvas app (http://localhost:5173) + collab server (:1234)
```

Open two browser windows at the same URL — including `?doc=<any-id>` to work in a separate
document — and edits, carets, and presence appear in both.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Canvas app + Hocuspocus collab server |
| `pnpm storybook` | Component workshop on :6006 |
| `pnpm verify` | lint → typecheck → unit tests → build (what CI runs) |
| `pnpm lint` / `pnpm lint:fix` | Biome |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm test` | Vitest (graph + canvas) |
| `pnpm e2e` | Playwright (boots app + collab server) |
| `pnpm build` | Builds `@suite/graph` then the canvas app |
| `pnpm clean` | Removes build output and caches |

## Layout

```
apps/canvas          React 19 + Vite + Tailwind v4 app (React Flow canvas, Tiptap editors)
apps/collab-server   Hocuspocus WebSocket server
packages/graph       @suite/graph — Zod schema + typed Yjs document layer
e2e                  Playwright tests
docs/                Architecture, conventions, ADRs
```

## How it works

A single `Y.Doc` per document is the source of truth:

- `nodes` / `edges` — typed graph entities (`Y.Map`)
- `content` — per-node rich text (`Y.Map<Y.XmlFragment>`), edited with Tiptap

`y-indexeddb` persists locally; Hocuspocus syncs when online. Presence (`user`, `pointer`,
`focus`, `dragging`, plus editor carets) travels over Yjs awareness. All graph writes go through
`GraphDocument`, which validates with Zod. See [docs/architecture.md](docs/architecture.md).

## Publishing

`pnpm build` produces a static site in `apps/canvas/dist` and the typed library in
`packages/graph/dist`. The build resolves `@suite/graph` from source in development
(`development` export condition) and from `dist` in production, so a clean checkout always
builds via `pnpm build` (Turbo builds the dependency first).

Deploy `apps/canvas/dist` to any static host and point `VITE_COLLAB_URL` at your Hocuspocus
server:

```sh
VITE_COLLAB_URL=wss://collab.example.com pnpm build
```

## Docs

- [AGENTS.md](AGENTS.md) — repo map, rules, and workflow for AI agents
- [docs/architecture.md](docs/architecture.md) — data flow and layers
- [docs/conventions.md](docs/conventions.md) — coding standards
- [docs/decisions/](docs/decisions/) — architecture decision records
