# Coding conventions

## TypeScript

- Strict mode is on (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `isolatedModules`). Do not weaken these.
- No `any` without a `// biome-ignore lint/suspicious/noExplicitAny: <reason>` and a real reason.
- Prefer `unknown` + narrowing, `z.infer` types from schemas, and discriminated unions.
- Type-only imports use `import type`. Write `.js` extensions in `@suite/graph` relative imports
  (emitted ESM).
- Schemas are the source of truth for persisted shapes — derive types with `z.infer`, never
  duplicate interfaces.

## Files & naming

- React components: `PascalCase.tsx`; hooks: `useCamelCase.ts`; plain modules: `camelCase.ts`.
- Tests co-located as `*.test.{ts,tsx}`; Storybook stories as `*.stories.tsx`.
- One component per file, named export (no default exports for components; `App` is the
  exception and stays a default export at the entry).

## Imports

Order, separated by blank lines:
1. External packages
2. `@suite/*` workspace packages
3. Relative imports

Biome's `organizeImports` enforces this; run `pnpm lint:fix`.

## Libraries first

- Use the library's own primitive before writing UI or state plumbing: Tiptap's `BubbleMenu`
  for the floating toolbar, `useEditorState` for editor-derived state, React Flow's
  `useNodesState`/`useEdgesState` for transient canvas state, Zustand selectors for store reads.
- Only hand-roll what the library does not provide (e.g. formatting buttons inside `BubbleMenu`,
  the canvas context menu).

## React

- Function components with hooks; no class components.
- Derive document data via `useGraphSnapshot` (subscribes to the CRDT), not `useState` copies.
- Keep components small; split presentational pieces into `components/`.

## State

- Zustand for UI state only. Document data is owned by the Yjs doc.
- Store selectors should be atomic (`useCanvasStore((s) => s.graph)`) to limit re-renders.

## Presence and coordinates

- Broadcast presence in **flow coordinates** (`screenToFlowPosition`), never raw screen pixels;
  the overlay renders inside `<ViewportPortal>` so it follows pan/zoom.
- Never publish a shared "current selection" awareness field for multiple editors — filter
  remote carets by the peer's focused node id.
- Persist positions to the CRDT on drag stop only; live positions travel through awareness.

## Data layer

- Never mutate `GraphDocument` internals from the UI. Add typed methods to
  `packages/graph` instead.
- Every `set*` method validates with the Zod schema; keep it that way.

## Testing

- Unit-test pure logic (schema, `GraphDocument`) in `packages/graph`.
- Component tests (React Testing Library) for non-trivial UI in `apps/canvas`.
- E2E (Playwright) for user journeys in `e2e`.
- Name tests `should <behavior>`; describe by unit under test.

## Commits

Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Subject is
imperative and ≤ 72 chars. Commitlint enforces this.
