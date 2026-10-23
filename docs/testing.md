# Testing

Suite has two test runners: Vitest for unit and integration tests, and Playwright for end-to-end
tests against the real canvas and collab server. `services/billing` is outside the pnpm workspace and
runs on Node's built-in test runner.

Everything below runs from the repo root unless a command says otherwise.

## Layers and projects

| Project | Runner | Scope | Command |
| --- | --- | --- | --- |
| `graph` | Vitest, node | `packages/graph/src/**/*.test.ts` | `pnpm exec vitest --project graph` |
| `server` | Vitest, node | `apps/collab-server/src/**/*.test.ts` | `pnpm exec vitest --project server` |
| `canvas` | Vitest, jsdom | `apps/canvas/src/**/*.test.{ts,tsx}` | `pnpm exec vitest --project canvas` |
| `e2e` | Playwright, chromium | `e2e/tests/**/*.spec.ts` | `pnpm e2e` |
| billing | `node --test` | `services/billing/*.test.ts` | `cd services/billing && node --test "*.test.ts"` |

`pnpm test` is `vitest run` and covers the three Vitest projects. `pnpm e2e` runs Playwright
headless, fully parallel, with the `list` reporter locally and `github` on CI. The e2e config starts
both servers itself (canvas dev on `:5173`, collab server on `:1235` with rate limits raised) and
reuses them when they are already running outside CI.

## Current numbers

Snapshot on 2026-10-22 (counts grow as lanes land tests — recount before quoting them):

- Unit and integration: 104 test files — 1,278 Vitest tests across `graph`, `server` and `canvas`,
  plus 61 `node --test` tests in `services/billing`.
- End-to-end: 21 Playwright specs containing 132 tests, all in the single `chromium` project.

Recount them with:

```sh
pnpm exec vitest list | wc -l                                        # Vitest tests
cd services/billing && node --test "*.test.ts" | tail -20           # 61 tests
pnpm --filter @suite/e2e exec playwright test --list | tail -1      # 132 tests in 21 files
```

## Watching a run

**While a UI server is running, run individual specs from it rather than launching another.**

### `pnpm e2e:ui`

Opens a persistent Playwright UI window on <http://127.0.0.1:8181> (`playwright test --ui
--ui-host=127.0.0.1 --ui-port=8181`): a test tree, a live browser pane, per-step screenshots and a
timeline. This is the one a person uses while developing — step through a failing test, inspect the
DOM at each action, and scrub the timeline. The port is fixed, so the window keeps its URL between
runs. UI mode runs the same `webServer` entries and the same config as `pnpm e2e`.

```sh
pnpm e2e:ui                                 # persistent window on 127.0.0.1:8181
pnpm e2e:ui app.spec.ts                     # filter files (extra args are forwarded)
pnpm e2e:ui:stop                            # free 8181 when you are done
```

### One UI server at a time

The port is pinned, so a second `pnpm e2e:ui` fails with `EADDRINUSE` instead of opening a window.
That is not a fault — the server is already up. Just open
<http://127.0.0.1:8181/trace/uiMode.html> and click the spec in the tree, and free the port with
`pnpm e2e:ui:stop` when you are finished rather than restarting it.

UI mode also never starts a second set of servers: it reuses a canvas (`:5173`) or relay (`:1235`)
that is already listening even when `CI` is set, because spawning one on a taken port can only fail
and take the open window down. With nothing running it starts them as usual.

### `pnpm e2e:headed`

Runs the real suite with a visible browser, one worker at a time (`--headed --workers=1`), so tests
stay sequential and followable:

```sh
pnpm e2e:headed
pnpm e2e:headed -g "canvas app boots"       # one test
```

Prefer `e2e:headed` over `e2e:ui` when the failure depends on real execution order or timing across
tests, because UI mode runs whatever you click, on demand; use `e2e:ui` when you want to pause,
step through actions and inspect DOM snapshots instead.

Headed runs are slower than the parallel headless run and open one window at a time — use them to
observe, not as the gate. `pnpm e2e` stays the CI command.

### `pnpm e2e:trace`

Opens the newest `trace.zip` from `e2e/test-results` in the Playwright trace viewer. Traces are
written for failing tests by default; to get one for every test, see `SUITE_TRACE` below.

```sh
pnpm e2e:trace
SUITE_TRACE=on pnpm e2e && pnpm e2e:trace   # record every test, then open the newest trace
```

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `CI` | unset | Selects the `github` reporter and stops server reuse. UI mode is exempt: it always reuses a server that is already listening. |
| `SUITE_TRACE` | unset | `on` records a trace for every test. Anything else keeps `retain-on-failure`. |

`trace: "on"` is opt-in because it is the one setting that turns a fast run into a slow, disk-filling
one. Measured on this suite, a trace is about 100 KB for the 1.2 s boot test and 1.3 MB for a
two-client collab test, so a full 132-test run writes roughly 15–170 MB and spends extra time
serialising it; richer specs write the larger traces. The default `retain-on-failure` writes nothing
on a green run.

## Reading UI mode

- **Left pane** — the test tree per file, with pass/fail badges and a filter box. Click a test to run
  only it, or tick "watch" to re-run on file changes.
- **Top right** — the browser pane. During a run you can watch the page; afterwards, scrub the
  timeline to replay each action with a DOM snapshot before and after.
- **Bottom** — the action list with per-step timings. Selecting a step shows the source line, console
  output, network requests and the locator that matched, which is usually enough to tell a selector
  problem from a real product bug.
- **Pick locator / inspect** — the toolbar above the browser pane turns a click into a locator you
  can paste into the spec.

## Where artifacts land

Everything goes under `e2e/test-results/` (`outputDir`), one `<test-slug>-<project>/` folder per test:

| Artifact | When | Notes |
| --- | --- | --- |
| `trace.zip` | failing tests, or every test with `SUITE_TRACE=on` | `pnpm e2e:trace`, or `pnpm --filter @suite/e2e exec playwright show-trace e2e/test-results/<folder>/trace.zip`. Also drag-and-drop into <https://trace.playwright.dev>. |
| `video.webm` | on retry (`video: "on-first-retry"`) | Only produced when a retry happens; add `--retries=1` to record one per test. |
| `test-failed-1.png` | failing tests (`screenshot: "only-on-failure"`) | The final frame at the moment of failure. |

The reporter is `list`/`github`, so no HTML report is generated by default; UI mode and the trace
viewer replace it. Pass `--reporter=html` to `playwright test` if you want one.

## Coverage

`pnpm coverage` runs the whole suite with `@vitest/coverage-v8` and prints a summary plus an
`lcov` report under `coverage/` (`coverage/lcov-report/index.html` for the browsable view). All
three projects are measured; only `@suite/graph` is **gated**:

| Project | Gated | Why |
| --- | --- | --- |
| `packages/graph` | statements 85, branches 74, functions 93, lines 90 | A real behavioural suite already exists, so the floor can only go up. |
| `apps/collab-server` | no | Measured and printed. Much of it is socket and SQLite wiring that e2e covers; gating would invite assertion-free tests. |
| `apps/canvas` | no | 54% and dominated by entry points and hosts. e2e is what moves this number; add a unit test only where a pure function hides there. |

The gate is one glob key inside `coverage.thresholds` — `"packages/graph/src/**"`. Per-project
`test.coverage` blocks are accepted by the vitest types but **ignored at runtime**, which is why
the thresholds live at the root.

## Mutation testing

Coverage says a line ran; mutation testing checks that a test would notice if the line were
wrong. Stryker rewrites one expression at a time (a *mutant*), runs the tests that cover it, and
reports the mutant as killed (a test failed), survived (every test passed), or no-coverage. A
survivor is where the suite looked at the behaviour without pinning it. Here it is a diagnostic
for choosing the next test, not a number to raise.

Only the modules where a mistake is expensive are mutated:

| Run | Files mutated | Command | Typical cost (16 cores) |
| --- | --- | --- | --- |
| graph | `packages/graph/src/publish/*.ts`, `{projection,search,views,sections}.ts` | `pnpm mutation` | ~12 min, 2,700 mutants |
| server | `apps/collab-server/src/{licence,limits,config}.ts` | `pnpm mutation:server` | ~35 s, 1,080 mutants |
| quick | `packages/graph/src/search.ts`, or `--mutate <file>` | `pnpm mutation:quick` | ~45 s |

`pnpm mutation:quick --mutate packages/graph/src/views.ts` is the normal way to try one file: the
quick config has its own report and incremental file, so it never overwrites the full report.

### The three configs

`stryker.graph.config.mjs`, `stryker.server.config.mjs` and `stryker.quick.config.mjs` (which
imports the graph config). They are separate files because the two targets need different
`testFiles` scoping, and `.mjs` rather than JSON because each option's reason belongs next to it:

- `testFiles` is what keeps the server run affordable. The server project also holds socket and
  SQLite suites; without the whitelist, every mutant would drag them in. The graph run is pinned
  to `packages/graph/src/**/*.test.ts` so `vitest` never discovers the other projects.
- `vitest.related` is off: the test files are already scoped, and related mode would drop tests
  that reach a module through `index.ts`.
- `coverageAnalysis: "perTest"` is the default and the reason a mutant only runs the handful of
  tests that executed it (about 5–8 on average).
- `concurrency: "50%"` leaves half the machine for everything else. `timeoutMS: 10_000` and
  `timeoutFactor: 1.5` turn an infinite-loop mutant into a timeout instead of a hang.
- `ignoreStatic: true`: static mutants need a full environment reload per mutant and mostly guard
  import-time constants. Note that *hybrid* static mutants (covered at import and during a test)
  are still run on Vitest 5 and can be reported as false survivors — see the patch note below.
- `incremental: true` writes `reports/stryker-incremental-*.json`, which is **gitignored**: mutant
  ids and timings are per-machine, so a committed file would let a stale score look fresh. Adding
  a test id invalidates the survivors, so re-running after new tests retests them; use
  `--force` only when you want to ignore the cache completely.
- No `thresholds.break`. The `high`/`low` numbers only colour the report.

### Reading the report

`reports/mutation/graph.html` (and `server.html`, `quick.html`) opens in a browser. The tree is per
file; a red bar is a survivor, amber is a timeout or no-coverage. Clicking a mutant shows the exact
replacement, the covering tests, and — for a survivor — what the tests asserted instead. The JSON
next to it is the machine-readable form (`status`, `mutatorName`, `replacement`, `coveredBy`) and
is what the CI artifact holds. Both `reports/` and `.stryker-tmp/` are gitignored.

### Survivor triage rule

A survivor is never closed with a vacuous assertion (`expect(result).toBeDefined()`). Every
survivor is one of:

1. **A missing behaviour** — add a test that fails for the mutant and passes for the real code,
   through the public API. New tests go in `packages/graph/src/mutationGaps.test.ts`, one comment
   per test naming the mutation it kills; existing test files are left alone.
2. **An equivalent mutant** — only then, a `// Stryker disable next-line <Mutator>: <why this
   cannot change behaviour>` comment, in the source, next to the expression. "Hard to test" is not
   equivalence.
3. **Tool noise** — for example the hybrid static mutants above, or a survivor with
   `testsCompleted: 0`. Fix the scope or the patch; do not write a test around it.

### Why it is not a CI gate

The full graph run is minutes, not seconds, and the remaining survivors are a mix of equivalent
guards, unreachable defensive branches and static-mutant noise. A threshold would push people to
disable mutants instead of understanding them. Instead `.github/workflows/ci.yml` has a
`mutation` job on `schedule` and `workflow_dispatch` that runs `pnpm mutation` and uploads
`reports/mutation` as an artifact. It never fails a pull request.

### Vitest 5 patch

Stryker 10's vitest runner joins a suite chain with a space, but Vitest 5 matches
`testNamePattern` against names joined with `" > "`, so every covered mutant ran zero tests and
was reported Survived. Until [stryker-js#6214](https://github.com/stryker-mutator/stryker-js/pull/6214)
ships, `patches/@stryker-mutator__vitest-runner@10.0.0.patch` changes both copies of
`collectTestName` to the Vitest 5 separator. Remove the entry from `pnpm-workspace.yaml` and the
patch file once a release contains the fix.

## Property-based tests

Not configured yet.

## Visual baselines

`e2e/tests/visual.spec.ts` keeps a small, curated set of layout snapshots — ten, not one per story.
They are committed PNGs under `e2e/tests/visual/`, so a run needs no vendor service and CI gets a
real gate. The shared `playwright.config.ts` does not configure `snapshotPathTemplate`; the spec sets
it for its own file so baselines land in `e2e/tests/visual/` instead of the default
`e2e/tests/visual.spec.ts-snapshots/`.

What is covered:

- **Story surfaces** (served from the built Storybook on `:6006`): the three share-boundary states
  of `MentionChip` (default, not-shared, unavailable), `ShareDialog` on the selection scope,
  `LibraryDrawer` with an active query and highlighted results, `NodeCard` default and with
  expanded metadata, and `PropertyBlockChip`'s linked-card states.
- **Real app states** (against the normal `webServer` app): a board with two cards, a section and a
  connector after `Fit View`, plus the app bar at rest.

Skipped on purpose: `Connector` (a single 12 px dot; no story renders an edge with a description),
`EdgeDescriptionInput` (text-entry state that churns), and the operator panel's status screen (needs
a live relay and a valid admin token, and its uptime/counters change every second, so it cannot be a
stable baseline).

Run or update them:

```sh
pnpm --filter @suite/e2e exec playwright test visual              # check
pnpm --filter @suite/e2e exec playwright test visual --update-snapshots   # rewrite baselines
pnpm --filter @suite/e2e e2e:visual                              # same as the first, via the package script
```

`--update-snapshots` is the only supported way to change a baseline. Review the new images before
committing them.

**Never update a baseline to make a red test green without looking at the diff.** A failure means
the pixels moved; decide from `test-results/<test>/…-diff.png` and `…-actual.png` whether the product
change is intended. Updating first turns the suite into a rubber stamp.

Tolerances are set per call (`expectStable`), because the config is not ours to edit: fixed viewport
(1000×700 for stories, 1280×800 for the app), `deviceScaleFactor: 1`, `colorScheme: "light"`,
`animations: "disabled"`, `caret: "hide"`, `scale: "css"`, `threshold: 0.2` and
`maxDiffPixels: 60` for components / `250` for the full canvas. `threshold: 0.2` is pixelmatch's YIQ
distance and absorbs subpixel antialiasing and font-hinting differences between machines;
`maxDiffPixels` bounds what still slips through (a few glyph edges). 60 px is roughly 2–6 % of a chip
and 0.01 % of a card — far below the thousands of pixels any real layout shift moves — while 250 px
on the 1280×740 canvas covers its larger text area without hiding a moved card or connector.

Story baselines are tied to `apps/canvas/storybook-static`: the spec serves that directory with
`vite preview` on `:6006` (reusing an already-running server) and fails with a clear message if the
build is missing. Run `pnpm build-storybook` after changing a story, then update the affected
baselines. The app states use a fresh workspace per run, so they never inherit a previous run's
document.

## Search, views and organisational paths

Five specs cover the user paths that shipped with unit tests only:

| Spec | What it drives |
| --- | --- |
| `search.spec.ts` | a title hit with a `<mark>`, a body-only hit with its snippet, a card written after the index was already built, and the empty state clearing back to the full list |
| `views.spec.ts` | saving the current search as a view, exiting it, re-applying the same rows, then renaming and deleting it from the menu |
| `org.spec.ts` | duplicating a card (title copied, copy edited independently), moving a card to a second board, and quick capture plus its focus guard |
| `delete-workspace.spec.ts` | type-to-confirm gating, the launcher forgetting the workspace, this browser's cached document purged, and ownership released to another browser |
| `recovery-words.spec.ts` | the 24 words, a mistyped word refused with a readable line, recovery from the phrase, and passphrase recovery in a fresh context |

`e2e/tests/support.ts` holds only what these share: a per-test workspace id factory, `createNote`,
`openLibrary`, card locators, and `libraryRows`. Rows are `li[data-row-id]`; the title inside a row
is `library-title-<id>`, which is why a `library-item-` prefix selector is not used to count rows.

This spec found a real bug, and it is fixed: the relay's owner DELETE removed its rows, but the live
room was never closed — `WorkspaceRequestHooks.onDeleted` existed and `server.ts` never passed it — so
the room wrote the deleted document back a few seconds later. `server.ts` now passes `onDeleted`,
which closes the sessions, drops the in-memory room (`forgetRoomDocument`, so nothing can save again)
and schedules a projection sweep. Verified end to end: the document row is gone immediately and still
gone after six seconds, past the two-second save interval that used to resurrect it.

The class of bug — a hook the handler declares and the entry point forgets — now has a guard:
`apps/collab-server/src/wiring.test.ts` scans `server.ts` and fails if a defined hook is missing from
its call site. It is a source check because `server.ts` cannot be imported by a test without opening
sockets; it was written after three shipped bugs of exactly this shape (`onDeleted`, `rssBytes`,
`projectionRooms`).
