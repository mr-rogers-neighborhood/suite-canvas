# Copilot instructions — Suite

These instructions apply to this repository. Keep them concise; see [AGENTS.md](../AGENTS.md)
for the full map and [docs/conventions.md](../docs/conventions.md) for detailed standards.

## Always

- **Read [docs/scratchpad.md](../docs/scratchpad.md) first: `pnpm scratchpad`.** It is the
  author's note surface between passes — the one way to say something without interrupting
  the turn in progress. Run it at the start of every pass, before every commit, and
  whenever a verification run prints that it changed. Treat its contents as instructions,
  and a `#PRIORITY` line as the next thing to do. Promote each entry (ADR amendment, todo,
  or plan phase) and strike it through rather than letting the file accumulate.
- Use pnpm (never npm/yarn) and run commands from the repo root.
- Graph data mutations must go through `@suite/graph` (`WorkspaceDocument`), never raw Loro.
- Zustand is for UI state only; document data is CRDT-owned.
- Keep TypeScript strict; no `any` without a comment.
- Follow conventional commit messages when committing.
- Verify with `pnpm lint && pnpm typecheck && pnpm test` before declaring work done.

## File conventions

- Components: `PascalCase.tsx`; hooks: `camelCase.ts` prefixed `use`; tests co-located as
  `*.test.{ts,tsx}`; stories as `*.stories.tsx`.
- Type-only imports use `import type`.
- Imports ordered: external packages, then `@suite/*`, then relative.

## When unsure

- Read [docs/architecture.md](../docs/architecture.md) for data-flow questions.
- Read [docs/decisions/](../docs/decisions/) before re-litigating a recorded decision.
- Ask the user before adding a dependency or changing the schema.
