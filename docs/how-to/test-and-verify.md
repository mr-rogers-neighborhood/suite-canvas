# Test and verify

Four tiers, each answering a question the one above it cannot. Everything runs from the repository
root.

| Tier | Command | What it proves |
| --- | --- | --- |
| Static | `pnpm lint` | Formatting, imports, the rules a linter can see |
| Types | `pnpm typecheck` | Every package compiles against the others |
| Unit | `pnpm test` | Pure logic: the schema, the store, the resolvers, the hooks |
| Shell | `pnpm e2e:desktop` | The built app opens a document |

## The gate

```sh
pnpm check
```

`pnpm check` is what a change runs against, and what CI would run: `biome check`, `turbo run typecheck`,
the tests covering what changed, the documentation symbol check, and the shape check. It is the same
command locally and remotely, because a gate that means something different in two places is two
gates.

## Types

`pnpm typecheck` runs `tsc --noEmit` per project through turbo, on the build output of the packages it
depends on. A type error in `@suite/graph` therefore fails the app that imports it, rather than hiding
until runtime.

## Unit tests

`pnpm test` runs every Vitest project: the graph, the Obsidian importer, the desktop main process, and
the renderer. The main-process project is the one to keep honest. The file store, the lock, recovery
and the page policy are node-environment tests with no Electron in them, which is what makes "never
lose a document" testable at all.

`pnpm test:changed` is the fast loop; `pnpm check` uses it, and `pnpm test` is what a release runs.

Component tests that render a surface live beside it as `*.test.tsx`. Storybook stories are checked
separately by `pnpm test:stories`, so a story that no longer renders fails a gate rather than a person.

## The desktop tier

```sh
pnpm e2e:desktop
```

Playwright launches the built shell, the same binary `package:dir` produces, opens a document, and
asserts what is on screen. It needs a display; on a headless machine wrap it in `xvfb-run`.

This tier catches what unit tests cannot: a page policy that blocks the bundle, a preload that stopped
exposing a channel, a protocol handler that refuses a path. All three look like a blank window.

## The cross-app tier

The suite's end-to-end tests live in `suite-dev`, not here, because they launch Start and the other
apps alongside Canvas. That repository stages the real binaries and runs them together; its `preflight`
script says what is missing on a machine.

## Shape and docs

- `pnpm shape` checks structural rules the type system cannot state: where `node:fs` may appear, which
  module may import `loro-crdt`, that the window never enables `nodeIntegration`.
- `pnpm docs:check` checks links, retired terms, a version that disagrees with `package.json`, the
  generated documentation indexes, and that the in-app handbook matches its Markdown source.
- `pnpm docs:symbols` checks that a path or a `pnpm` script a page names actually exists.

## What earns a test

The policy is written down once, in the `suite-dev` repository's decision records, because it governs
every repository. The short version applies here.

A test names a rule, not a function: "a saved view is a lens over the same cards" rather than
"`workspace.listViews`". It is worth writing where being wrong is expensive, which in this app means a
file write, a schema change, a permission gate, or parsing something that came from outside. A bug that
shipped earns a regression test.

Tests live beside the module and are deleted with the feature they cover. A test that breaks on every
refactor without a behaviour change is testing the implementation, and belongs rewritten or removed.

A test file past about 400 lines is split at its next change rather than in a sweep. Three are over
that line today: `apps/canvas/src/library/LibraryDrawer.test.tsx`,
`packages/graph/src/merge.test.ts` and `apps/canvas/src/cards/CardPanel.test.tsx`.

## Coverage and mutation

`pnpm coverage:graph` measures the document package with a threshold, because that is the code where a
silent wrong answer is worst. `pnpm mutation` and `pnpm mutation:quick` run Stryker against it. A
surviving mutant is a thin assertion, not a reason to write a test that asserts nothing.
