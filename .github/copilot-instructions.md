# Copilot instructions — Suite

Read [AGENTS.md](../AGENTS.md) for the repo map, rules and feature path, and
[docs/README.md](../docs/README.md) for the documentation sections. Coding standards are in
[docs/reference/conventions.md](../docs/reference/conventions.md).

## Always

- Read `.scratchpad.md` first: `pnpm scratchpad`. It is the author's queue between passes, and a
  `#PRIORITY` line is the next thing to do.
- Use pnpm, never npm or yarn, and run commands from the repo root.
- Graph data goes through `@suite/graph` (`WorkspaceDocument`), never raw Loro.
- Zustand holds UI state only; document data is CRDT-owned.
- Keep TypeScript strict; no `any` without a justified `biome-ignore` comment.
- Conventional commit messages; docs change with the code they describe.
- Run the local gate on every change: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm docs:check`,
  `pnpm docs:symbols`, `pnpm shape`. E2E runs on request only: never start Playwright unless the owner
  asks for a run or names a commit milestone.
- GitHub Actions gates nothing. Never claim a workflow gates `main`; name the local command instead.

## Verification

`pnpm check` is the edit loop: biome, `tsc` across the workspace, and `vitest run --changed`, plus the
docs symbol and shape checks. `pnpm verify` is the same set with the story suite, the billing tests and
the build added, and it runs the scratchpad first.

Playwright sits outside both. A full `pnpm e2e` is a milestone action the owner names, and a narrower
`pnpm e2e:smoke`, `pnpm e2e:canvas`, `pnpm e2e:collab` or `pnpm e2e:views` is what you run when the
owner asks for a run and one area covers the change. `.github/workflows/ci.yml` is present and unrun;
it is not a check on `main`.

## Shape

Pure core, imperative shell: schema, layout planning, projection and link geometry return data;
`WorkspaceDocument`, persistence, the provider, HTTP handlers and React hosts own state and I/O.
`remeda` for transforms that remove a loop, `neverthrow` `Result` at fallible boundaries.

## File conventions

Components are `PascalCase.tsx`, hooks are `useCamelCase.ts`, tests are co-located `*.test.{ts,tsx}`
and stories `*.stories.tsx`. Type-only imports use `import type`; imports order external packages,
`@suite/*`, then relative.
