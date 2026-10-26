# AGENTS.md

Suite is a local-first, collaborative canvas: React 19 on a React Flow surface, one Loro document per
workspace, and a typed object graph validated by Zod. This file is the entry point for AI agents.

Read [docs/README.md](docs/README.md) for the four documentation sections, and
[docs/how-to/test-and-verify.md](docs/how-to/test-and-verify.md) before running tests.

## Stack

- pnpm workspaces and Turborepo.
- Canvas: React 19, Vite, TypeScript, Tailwind CSS v4, Zustand for UI state, React Flow
  (`@xyflow/react`), Tiptap 3 for every card.
- Document: Loro CRDT, IndexedDB snapshot and update log, `loro-websocket` for sync.
- Graph: `@suite/graph` with Zod schemas over a typed `WorkspaceDocument`.
- Docs and marketing: Astro in `apps/docs` (Starlight) and `apps/site`. The app is a Vite SPA
  served at `app.suite.run`; neither Astro project hosts it.
- Quality: Biome, Vitest and React Testing Library, Playwright, Storybook, commitlint.

## Repo map

| Path | Purpose |
| --- | --- |
| `apps/canvas` | The canvas app: launcher, boards, cards, editor, library, panels, collab provider, Zustand store |
| `apps/collab-server` | Loro WebSocket relay, six SQLite stores, projection worker, attachments |
| `apps/docs` | The documentation site |
| `packages/graph` | `@suite/graph`: schema, types, typed Loro layer, workspace file and portable export |
| `services/auth` | Accounts, organizations, invitations, licensing. Built and tested, not mounted |
| `services/billing` | Licence and Stripe webhook verification, run with `node --test` |
| `e2e` | Playwright specs, tagged `@smoke` for the smoke tier |
| `docs` | Tutorials, how-to, reference and explanation |
| `deploy` | Caddyfile, headers, backup and restore scripts, drill records |
| `scripts` | `docs-check`, `generate-limits`, `scratchpad`, `db-verify` |

## Commands

```sh
pnpm install          # also installs the git hooks
pnpm dev              # canvas on :5173, relay on :1234
pnpm check            # the edit loop: biome, tsc, changed Vitest files, docs symbols, shape
pnpm lint             # biome check
pnpm typecheck        # tsc across the workspace
pnpm test             # every Vitest project
pnpm docs:check       # links, fences, prose, generated indexes, limits
pnpm docs:symbols     # backticked paths, root scripts, ADR references
pnpm shape            # file length, observe sites, raw Loro writes
pnpm verify           # the local gate plus billing, stories and the build
pnpm build            # graph dist, then the canvas bundle
pnpm storybook        # component workshop on :6006
pnpm e2e:smoke        # the @smoke Playwright specs
pnpm e2e:canvas       # boot, boards, cards, links, selection, input, library, appearance
pnpm e2e:collab       # collab, sharing, account
pnpm e2e:views        # views
pnpm e2e              # every Playwright spec
pnpm e2e:doctor       # report processes holding the e2e ports
pnpm e2e:stop         # stop only those processes
pnpm e2e:logs         # tail the captured Vite and relay logs
```

## Verify

The gate is local and it runs on every change:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check && pnpm docs:symbols && pnpm shape
```

`pnpm check` runs Biome, `tsc`, `vitest run --changed`, `pnpm docs:symbols` and `pnpm shape`, so it is
the one to repeat after each edit batch; it leaves out `pnpm docs:check` and the full test run.
`pnpm verify` adds the story suite, the billing tests and the build.

Playwright is not part of the gate. When the owner asks for a run, the area scripts (`pnpm e2e:smoke`,
`pnpm e2e:canvas`, `pnpm e2e:collab`, `pnpm e2e:views`) are narrower than `pnpm e2e`; [the how-to
page](docs/how-to/test-and-verify.md) has each one.

GitHub Actions gates nothing. `.github/workflows/ci.yml` stays in the tree and needs a runner to run,
so every gate claim in this repo names a local command.

## Rules

1. Graph data goes through `@suite/graph`. Never write raw Loro for document data.
2. Document truth never lives in Zustand, React state or localStorage. Zustand holds UI state only.
3. Schema changes are additive first. `packages/graph/src/schema.ts` changes with its tests, and
   bumping the schema version needs a recorded decision.
4. TypeScript stays strict. No `any` without a justified `biome-ignore`; prefer `unknown` and
   narrowing.
5. Prefer the library primitive: Tiptap `BubbleMenu` and `useEditorState`, React Flow `useNodesState`,
   `useEdgesState` and `ViewportPortal`.
6. Presence uses flow coordinates and renders in `<ViewportPortal>`. Positions persist on drag stop;
   live drag positions ride `EphemeralStore`.
7. Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
8. No new dependency without a stated job and the right package.
9. E2E runs on request, never by default. No contributor or agent starts Playwright unless the owner
   asks for a run or names a commit milestone, and no change waits on one. The per-change gate is the
   local set under [Verify](#verify).
10. GitHub Actions gates nothing. A workflow file in the tree is not a check on `main`, and every gate
    claim names a local command.

## Code shape

Pure core, imperative shell: schema, layout planning, projection and link geometry take data and
return data, with no DOM, Loro, `fetch` or timers; `WorkspaceDocument`, persistence, the provider, HTTP
handlers and React hosts own state and I/O. Dependencies point inward, one owner per piece of state.

`remeda` is for transforms that remove a loop; do not wrap a one-liner. `neverthrow` `Result<T, E>`
belongs at fallible boundaries: parsing, validation, HTTP handlers, licence and admission checks.

[docs/reference/conventions.md](docs/reference/conventions.md) has the file, naming, error and import
rules, and [docs/reference/glossary.md](docs/reference/glossary.md) fixes the vocabulary.

## Scratchpad

`.scratchpad.md` is the author's queue between passes, gitignored and per-machine. `pnpm scratchpad`
prints it and marks what you read; `pnpm verify` runs it first. Promote an entry to a decision record,
a todo or a plan phase, then strike it through.

## Feature path

1. Model it in `packages/graph/src/schema.ts` with tests.
2. Expose typed accessors and mutations on `WorkspaceDocument`.
3. Consume it in `apps/canvas` through `useWorkspaceSnapshot` and the Zustand store.
4. Add a Storybook story and component tests.
5. Run the local gate under [Verify](#verify). E2E only when the owner asks for it.

## Definition of done

Schema and types in `@suite/graph` with unit tests, UI with a story where it is visual, a test where
behaviour is non-trivial, docs updated in the same change, and the local gate under [Verify](#verify)
green. E2E is not part of it unless the owner asked for a run.

Recorded decisions live in `internal/decisions/`, which is gitignored and local-only; ask the
maintainer for the current copy before re-litigating one.
