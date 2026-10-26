# Test and verify a change

Suite runs three test runners: Vitest for `@suite/graph`, the collab server, the auth service and the
canvas; Playwright for end-to-end journeys; `node --test` for `@suite/billing`, which sits outside the
pnpm workspace. Commands run from the repository root unless stated.

Spend the least time that still proves the change: run the smallest tier that covers what you
touched, and escalate only when the change deserves it.

## Pick a tier

| Tier | Command | Run it when | Covers |
| --- | --- | --- | --- |
| After each edit batch | `pnpm check` | Always. This is the edit loop. | `biome check`, `tsc` across the workspace, and the Vitest tests that reach the files you changed (`vitest run --changed`). |
| Before every commit | `pnpm verify` | Always, on the commit you intend to keep. No e2e. | lint, typecheck, unit and property tests (graph, server, auth, canvas), billing tests, story tests, and a full build. |
| A story or visual surface changed | `pnpm test:stories` | A `.stories.tsx` changed, or you touched a component a story renders. | The Storybook suite under jsdom plus axe in both themes. |
| A medium change | `pnpm e2e:smoke` | The change is user-visible but not in the categories below. | The specs tagged `@smoke`: boot, boards and sections, cards, links, selection, library, views, sharing, sign-in, collab. |
| A big commit, a merge, or a tag | `pnpm e2e` | See the rule below. | Every spec, headless and parallel. |
| You edited specs | `pnpm e2e:changed` | You changed several e2e specs and want all of them. | Playwright's `--only-changed origin/main`, which selects the specs touched since that ref. |
| While iterating | `pnpm e2e <spec>` / `pnpm exec vitest run <file>` | You want one failing test's output. | One file, or one test with `-t`/`-g`. |

A big commit touches the graph schema or the CRDT layer, sharing or auth, canvas gestures or links,
persistence and stored formats, release or deploy configuration, or more than three user-visible
changes. Those are the places where a green unit suite has missed the thing that broke, so they get
the full run. Anything else is a smoke run.

`pnpm check` between edits and `pnpm verify` before the commit is the whole contract; the two e2e
tiers are about how much confidence a change needs.

Two cheap checks run beside the tests and belong in every tier above the first:

```sh
pnpm docs:check                              # links, fences, prose, generated indexes, limits
pnpm docs:symbols                            # backticked paths, root scripts, ADR references
pnpm shape                                   # file length, observe call sites, raw Loro writes
```

`pnpm check` and `pnpm verify` run all three. `pnpm docs:check` alone is the fast pass while editing
prose.

## Projects

| Project | Runner | Scope | Command |
| --- | --- | --- | --- |
| `graph` | Vitest, node | `packages/graph/src/**/*.test.ts` | `pnpm exec vitest --project graph` |
| `server` | Vitest, node | `apps/collab-server/src/**/*.test.ts` (`http/`, `store/`, `projection/`, `config/`, `sync/`, `ops/`) | `pnpm exec vitest --project server` |
| `auth` | Vitest, node | `services/auth/src/**/*.test.ts` (`http/`, `identity/`, `invitations/`, `licensing/`, `organizations/`, `store/`) | `pnpm exec vitest --project auth` |
| `canvas` | Vitest, jsdom | `apps/canvas/src/**/*.test.{ts,tsx}` | `pnpm exec vitest --project canvas` |
| `e2e` | Playwright, chromium | `e2e/tests/**/*.spec.ts`, grouped by area (`boot/`, `boards/`, `cards/`, `links/`, `collab/`, `sharing/`, …) | `pnpm e2e` |
| billing | `node --test` | `services/billing/src/**/*.test.ts` | `pnpm --filter @suite/billing test` |

`pnpm test` is `vitest run` and covers all four Vitest projects. The e2e config starts what it needs
itself, a canvas dev server on `:5173` and a relay on `:1235` with rate limits raised, and reuses
servers already listening outside CI.

## One test at a time

```sh
# One unit file, or one test in it.
pnpm exec vitest run packages/graph/src/schema.test.ts
pnpm exec vitest run apps/collab-server/src/store/storeUpgrade.test.ts -t "refuses a store a newer build wrote"

# One spec, or one test in it. Extra arguments reach Playwright.
pnpm e2e e2e/tests/collab/collab.spec.ts
pnpm e2e -g "undoes a removal from the board"
```

A single spec is the right tool while iterating: it boots the same servers as the full run, so a pass
in isolation is real evidence. Treat it as weaker evidence when the failure depends on order or on
state an earlier spec left behind.

## Watching a failing run

`pnpm e2e:ui` opens a persistent Playwright window on <http://127.0.0.1:8181>: test tree, live browser
pane, timeline, and a DOM snapshot per step. One window at a time, since the port is pinned; a second
call fails with `EADDRINUSE`. Free it with `pnpm e2e:ui:stop`.

`pnpm e2e:headed` runs the real suite in a visible browser, one worker (`--workers=1`), sequential and
followable. Use it when the failure depends on execution order, and UI mode when you want to pause and
inspect.

`pnpm e2e:trace` opens the newest `trace.zip` from `e2e/test-results/`. Traces are kept on failure by
default; `SUITE_TRACE=on pnpm e2e` records one for every test.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CI` | unset | Selects the `github` reporter and stops server reuse. UI mode always reuses a listening server. |
| `SUITE_TRACE` | unset | `on` records a trace for every test; anything else keeps `retain-on-failure`. |

Artifacts land under `e2e/test-results/<test-slug>/`: `trace.zip` on failure, `test-failed-1.png` at
the moment of failure, and `video.webm` only when a retry happens. The reporter is `list` or `github`,
so there is no HTML report unless you pass `--reporter=html`.

## Reading a failure

An e2e spec that passes alone and fails in the suite is shared state: a leftover workspace, a server
started by an earlier spec, or real timing. Run `pnpm e2e:headed` with `--workers=1` to keep order and
watch the sequence.

A jsdom test that fails on a measurement is the wrong tool: layout, scrolling and
`getBoundingClientRect` are zero there, so the assertion belongs in an e2e spec or a story.

A graph test that fails only in the full run usually shares a seed or reuses a container across cases.
A 15 s timeout means real work.

A flaky test is a bug in the test. `--retries` exists for videos and traces on CI-shaped runs; do not
use it to turn a red test green locally.

## Coverage

`pnpm coverage` runs the whole Vitest suite with `@vitest/coverage-v8` and writes `coverage/`
(`coverage/lcov-report/index.html` for the browsable view). All four projects are measured; only
`@suite/graph` is gated, through one glob key in `coverage.thresholds` at the root of
`vitest.config.ts`. Server, auth and canvas are printed, not gated: their uncovered lines are socket,
SQLite and entry-point wiring that e2e already drives, and a threshold would invite assertion-free
tests.

## Mutation testing

Stryker asks whether a test would notice if an expression were wrong. It is a diagnostic for choosing
the next test, never a score to raise.

```sh
pnpm mutation:quick --mutate packages/graph/src/views.ts   # the normal way to try one file
pnpm mutation:server                                       # licence, limits, config
pnpm mutation                                               # the full graph run, minutes not seconds
```

Read `reports/mutation/<run>.html`. A survivor is a missing behaviour, an equivalent mutant, or tool
noise. Missing behaviour: add a test through the public API. Equivalent mutant: a
`// Stryker disable next-line` comment with the reason. Never close one with
`expect(result).toBeDefined()`.

## Property-based tests

Six fast-check suites exist, and they are where "it must hold for every input" belongs:

| Suite | Property |
| --- | --- |
| `packages/graph/src/sections.property.test.ts` | derived section membership under arbitrary placement moves |
| `packages/graph/src/merge.property.test.ts` | concurrent edits converge regardless of order |
| `packages/graph/src/search.property.test.ts` | query semantics hold across generated workspaces |
| `apps/canvas/src/session/recoveryWords.property.test.ts` | recovery-word encoding round-trips |
| `apps/collab-server/src/store/licence.property.test.ts` | licence parsing rejects every mutation |
| `apps/collab-server/src/config/limits.property.test.ts` | limit resolution order holds for any layer mix |

They run inside `pnpm test`. Add a case to the matching suite rather than a table of examples when the
invariant is the thing worth pinning.

## Visual baselines

`e2e/tests/visual/visual.spec.ts` keeps a small curated set of layout snapshots as committed PNGs under
`e2e/tests/visual/`, so a run needs no vendor service. Story surfaces are served from the built
Storybook on `:6006`; the app states run against the normal `webServer`.

```sh
pnpm --filter @suite/e2e e2e:visual            # check the baselines
pnpm --filter @suite/e2e e2e:visual:update     # rewrite them
```

`--update-snapshots` is the only supported way to change a baseline, and never the first thing to try.
A failure means the pixels moved: read `-diff.png` and `-actual.png` in `test-results/` and decide
whether the movement is the change you intended.

## The gate is local

GitHub Actions is enabled and the workflows pass `actionlint`, but every run, including a one-line
smoke job on a throwaway branch, ends in `startup_failure` with zero jobs and zero check runs. That is
account or repository state, not workflow content, and a token cannot fix it. Branch protection is
unavailable for the same reason.

So the evidence for a change is a green local run: `pnpm verify` on the commit, and `pnpm e2e` when the
change is a big one or, as [release.md](release.md) requires, on the exact commit being tagged.
`ci.yml` stays correct and ready (`quality` and `e2e` are the intended required checks), and nothing
here should claim CI gated a commit while that is true.
