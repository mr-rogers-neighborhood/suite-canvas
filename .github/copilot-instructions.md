# Copilot instructions — Suite

These instructions apply to this repository. Keep them concise; see [AGENTS.md](../AGENTS.md)
for the full map and [docs/conventions.md](../docs/conventions.md) for detailed standards.

## Always

- Use pnpm (never npm/yarn) and run commands from the repo root.
- Graph data mutations must go through `@suite/graph` (`GraphDocument`), never raw Yjs.
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
