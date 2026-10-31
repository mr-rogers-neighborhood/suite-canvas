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
- Docs and marketing: Astro in `apps/docs` (Fumadocs) and `apps/site`. The app is a Vite SPA
  served at `app.suite.run`; neither Astro project hosts it.
- Quality: Biome, Vitest and React Testing Library, Playwright, Storybook, commitlint.

## Repo map

| Path | Purpose |
| --- | --- |
| `apps/canvas` | The canvas app: launcher, boards, cards, editor, library, panels, collab provider, Zustand store |
| `apps/collab-server` | Loro WebSocket relay, six SQLite stores, projection worker, attachments |
| `apps/control-plane` | Control plane: Postgres, accounts, operator admin, billing and feedback modules |
| `apps/docs` | The documentation site |
| `packages/graph` | `@suite/graph`: schema, types, typed Loro layer, workspace file and portable export |
| `services/auth` | Accounts, organizations, invitations, licensing. Built and tested, not mounted |
| `services/billing` | Licence and Stripe webhook verification, run with `node --test` |
| `e2e` | Playwright specs, tagged `@smoke` for the smoke tier |
| `docs` | Developer documentation: tutorials, how-to, reference and explanation |
| `handbook` | The user handbook: one Markdown article per interface element and system, shown in the app and on the docs site |
| `deploy` | Caddyfile, headers, backup and restore scripts, drill records |
| `scripts` | `docs-check`, `generate-limits`, `scratchpad`, `db-verify` |

## Commands

```sh
pnpm install          # also installs the git hooks
pnpm dev              # canvas on :5173, relay on :1234
pnpm check            # the edit loop: biome, tsc, changed Vitest files, billing tests, docs symbols, shape
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

`pnpm check` runs Biome, `tsc`, `vitest run --changed`, the `node --test` billing suite,
`pnpm docs:symbols` and `pnpm shape`, so it is the one to repeat after each edit batch; it leaves out
`pnpm docs:check` and the full test run.
`pnpm verify` adds the story suite, the billing tests and the build.

Playwright is not part of the gate. When the owner asks for a run, the area scripts (`pnpm e2e:smoke`,
`pnpm e2e:canvas`, `pnpm e2e:collab`, `pnpm e2e:views`) are narrower than `pnpm e2e`; [the how-to
page](docs/how-to/test-and-verify.md) has each one.

All verification gates are local, so every gate claim in this repo names a local command.

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
10. All verification gates are local. Every gate claim names a local command.

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

Decision records are kept by the maintainers and are not published; an `ADR-NNNN` reference in a
comment is shorthand, and the prose around it states the decision.

## Tools for the deployment

`.mcp.json` at the workspace root is the live source for tools, in the portable `mcpServers`
format: `cloudflare` (`https://mcp.cloudflare.com/mcp`), `resend` (`https://mcp.resend.com/mcp`) and
`cloudwatch` (`awslabs.cloudwatch-mcp-server`, `suite` profile, `us-east-2`). `.vscode/mcp.json` still
carries `stripe`, which VS Code forwards to the session. None of them carries a secret: each
authenticates with OAuth on first use, and Stripe is authorised against the **sandbox** so a live charge
is never one tool call away.

Every server names its tools in an explicit `"tools"` allowlist. `"tools": ["*"]` took the loaded surface
to 182 against a 128-tool limit, and most of that surface went unused: `resend` offered 99 tools of which
four had ever run, and none of the 19 CloudWatch tools had run at all. Naming the tools is what keeps the
session inside the limit, so `"*"` is the thing to avoid rather than a default to copy. To bring a tool
back, add its name from the server's `tools/list` response.

<!-- BEGIN AWS Agent Toolkit rules -->

# AWS guidance for the new AWS experience

This project is on the **new AWS experience**, in the `suite` CLI profile, Region **us-east-2**. Where
this guidance conflicts with the project's own instructions above, the project's instructions win.

- Say **project** rather than account, **team member** rather than IAM user, and **AWS Settings**
  (`settings.aws.com`) for billing, spend limits and project management. Resources are viewed in the AWS
  Management Console.
- Every Regional resource goes in **us-east-2**. `us-east-1` is only for CloudWatch Logs or WAF entries
  that a global resource requires, and an inventory checks both.
- Nothing cross-Region: no replication, no multi-Region keys, no StackSets, no Lambda@Edge. Route 53
  geolocation, latency and failover routing do not exist here.
- Human access is managed by AWS; do not create IAM users for people. Service roles and instance profiles
  are the way services get permissions.
- Spend limits live in AWS Settings → Billing, and only a project owner can change one. Sudden "Access
  Denied" on operations that used to work is a spend limit until proven otherwise.
- If a service misbehaves, `aws freetier get-account-plan-state` first, then the Free Tier or Paid Tier
  supported-services list for this experience. A service missing from both needs advanced features
  activated.
- For any AWS task, call `aws___search_documentation` with topic `agent_skills` and load the matching
  skill with `aws___retrieve_skill` before acting, even when the answer seems known.
- Before finishing, ask whether to clean up the resources that were created for a one-off task or keep
  them; this account pays for what stays.

<!-- END AWS Agent Toolkit rules -->
