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

## Verification tiers

`pnpm check` after each edit batch, `pnpm verify` before every commit, `pnpm e2e:smoke` when the change
is user-visible but not big, and `pnpm e2e` only for a big commit, a merge or a tag. A change inside
one area can use `pnpm e2e:canvas`, `pnpm e2e:collab`, or `pnpm e2e:views`. A big commit touches the
graph schema or CRDT, sharing or auth, canvas gestures or links, persistence, release configuration,
or more than three user-visible changes.

## Shape

Pure core, imperative shell: schema, layout planning, projection and link geometry return data;
`WorkspaceDocument`, persistence, the provider, HTTP handlers and React hosts own state and I/O.
`remeda` for transforms that remove a loop, `neverthrow` `Result` at fallible boundaries.

## File conventions

Components are `PascalCase.tsx`, hooks are `useCamelCase.ts`, tests are co-located `*.test.{ts,tsx}`
and stories `*.stories.tsx`. Type-only imports use `import type`; imports order external packages,
`@suite/*`, then relative.
