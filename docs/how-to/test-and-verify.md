# Test and verify a change

Suite runs three test runners: Vitest for the workspace projects, Playwright for end-to-end journeys,
and `node --test` for `@suite/billing`, which sits outside the pnpm workspace. Commands run from the
repository root unless stated.

## The gate

Every change runs this, locally:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check && pnpm docs:symbols && pnpm shape
```

None of those commands needs a runner or an account. `pnpm check` runs Biome, `tsc`,
`vitest run --changed`, the `node --test` suite under `services/billing`, `pnpm docs:symbols` and
`pnpm shape`, which is why it belongs after each edit batch; it leaves out `pnpm docs:check` and the
full test run. `pnpm verify` adds the story suite, the build, and the two fast security scans
(`security:deps` and `security:secrets`, both described below).

The billing suite is in the edit loop because `pnpm test` cannot see it: those tests are `node --test`
and Vitest does not collect them. A rename that reached `deploy/stripe/fixtures.json` and not the tests
naming its tiers passed every fast run and only failed at `pnpm verify`, which is a bad trade for half
a second.

Playwright stays outside the gate. No contributor or agent starts it by default, and no change waits
on a run. E2E runs when the owner asks for it, or at a commit milestone the owner names. A full
`pnpm e2e` is a milestone action; when a run is asked for, an area script is the cheaper evidence.

### Verification is local

All verification gates in this repository are entirely local. `pnpm verify` runs the full set:
the gate, the story suite, the build, the billing suite, and the two fast security scans. Run it
before a commit you want fully checked, and on a tag.

## What each command runs

| Command | Covers | Run it |
| --- | --- | --- |
| `pnpm check` | Biome, `tsc` across the workspace, `vitest run --changed`, the billing suite, docs symbols, shape | After each edit batch |
| `pnpm lint` | Biome over the whole tree | The gate, and after a formatting sweep |
| `pnpm typecheck` | `tsc` across every workspace package | The gate, and after a type-only change |
| `pnpm test` | Every Vitest project | The gate, and before you report a result |
| `pnpm docs:check` | Relative links and anchors, code fences, banned prose, generated indexes, limits | A prose change, or a change to a limit |
| `pnpm docs:symbols` | Backticked paths, root scripts and ADR references that resolve | A page that names a command or a file |
| `pnpm shape` | File length, observe call sites, raw Loro writes | A change under `apps/` or `packages/` |
| `pnpm verify` | The gate plus the story suite, the build, `security:deps` and `security:secrets` | Before a commit you want fully checked, and on a tag |
| `pnpm test:stories` | The Storybook suite under jsdom plus axe, in both themes | A `.stories.tsx` changed, or you touched a component a story renders |

## Security scans

Four scans, one `pnpm` script each. Nothing here needs an external runner or account, and
each script exits non-zero on a finding, so the same command is a check and a gate.

| Command | Reads | Needs |
| --- | --- | --- |
| `pnpm security:deps` | the registry advisories for `pnpm-lock.yaml`, then every package's published signature | the network |
| `pnpm security:secrets` | every file in the checkout, then the staged diff from the pre-commit hook | Docker |
| `pnpm security:osv` | `pnpm-lock.yaml`, against the OSV database | Docker and the network |
| `pnpm security:image` | the package set inside a built image | Docker and a built image |

`security:deps` runs `pnpm audit --audit-level high` and then `pnpm audit signatures`. The second half
checks that each tarball came from the registry that published it, which is the part a lockfile alone
cannot tell you. A high or critical advisory, or a package with no verified signature, fails it.

`security:secrets` runs gitleaks in a pinned image (`zricethezav/gitleaks:v8.28.0`) with the rules in
`.gitleaks.toml`. That file allows the gitignored paths a working copy has (`.env`, `dist/`,
`storybook-static/`) and names each fixture credential the tests use, one value at a time, so test files
are not exempt as a class and a real key pasted into a test still fails. Findings print redacted, with
the file, the line and the rule. The same script runs from `.husky/pre-commit` as
`pnpm security:secrets --staged`, which scans the index: a credential stops the commit instead of
becoming a commit that has to be rewritten out of history.

`security:osv` runs OSV-Scanner (`ghcr.io/google/osv-scanner:v2.7.0`) against `pnpm-lock.yaml`. It reads
a different feed from `pnpm audit`, so the two report different sets of packages and different fixed
versions, and running both is the point. The switches:

```sh
pnpm security:osv --download   # copy the vulnerability database into ~/.cache/suite/osv-scanner
pnpm security:osv --offline    # scan with no network at all, from that cache
pnpm security:osv --licences   # also report packages outside the licence allowlist
```

`--offline` fails when the cache is empty rather than reporting nothing, so an offline run is evidence.
`--licences` checks the packages against a list in the script (MIT, Apache-2.0, ISC, BSD, 0BSD, CC0,
BlueOak, Python-2.0, Unlicense, Zlib) and it is opt-in: what it currently reports (MPL-2.0 through
lightningcss, ten LGPL-3.0-or-later packages, two `UNKNOWN`) is a licensing decision, and a build gate is
not where that decision is made.

`security:image` runs Trivy (`aquasec/trivy:0.76.1`) against `suite:local`, or against the image named
as its argument (`pnpm security:image ghcr.io/<owner>/suite:v0.1.0-alpha.1`). It reports HIGH and CRITICAL
only, and only findings with a fixed version, because a finding with no fix cannot be closed by
rebuilding the image. It is a release-time command: `pnpm verify` leaves it out because it needs a
built image. Build one with `docker build --target runtime -t suite:local .`.

Docker is the only prerequisite for three of the four. A missing daemon stops the command with an
instruction; no scan is skipped without saying so. `git commit --no-verify` is the only way past the hook.

## E2E on request

An e2e run starts its own canvas dev server on `:5173` and a relay on `:1235`, with rate limits raised
and a database per run. Every run passes through `e2e/scripts/preflight.mjs` first: if a port is already
in use, the run stops before a browser opens and names the process holding it.

| Command | Covers |
| --- | --- |
| `pnpm e2e:smoke` | The specs tagged `@smoke`: boot, boards and sections, cards, links, selection, library, views, sharing, sign-in, collab |
| `pnpm e2e:canvas` | Boot, boards, cards, links, selection, input, library, appearance |
| `pnpm e2e:collab` | Collab, sharing, account |
| `pnpm e2e:views` | Views |
| `pnpm e2e:changed` | Playwright's `--only-changed origin/main`: the specs touched since that ref |
| `pnpm e2e` | Every spec, the milestone run |
| `pnpm e2e:doctor` | Reports the processes holding the e2e ports, and stops nothing |
| `pnpm e2e:stop` | Stops only those listeners |
| `pnpm e2e:logs` | The tail of the captured Vite and relay logs under `e2e/.artifacts/` |

| Variable | Default | Meaning |
| --- | --- | --- |
| `CI` | unset | Selects the `github` reporter and retries a failed test once. Servers are always fresh outside UI mode. |
| `SUITE_WORKERS` | `3` | Playwright browser workers. Lower it to isolate a timing failure; raise it only on a machine with headroom. |
| `SUITE_TRACE` | unset | `on` records a trace for every test; anything else keeps `retain-on-failure`. |

Three workers keep the two-browser specs from starving the other browsers on one relay. Artifacts land
under `e2e/test-results/<test-slug>/`: `trace.zip` on failure, `test-failed-1.png` at the moment of
failure, and `video.webm` only when a retry happens. The reporter is `list` or `github`, so there is no
HTML report unless you pass `--reporter=html`.

## Projects

| Project | Runner | Scope | Command |
| --- | --- | --- | --- |
| `graph` | Vitest, node | `packages/graph/src/**/*.test.ts` | `pnpm exec vitest --project graph` |
| `importer` | Vitest, node | `packages/import-obsidian/src/**/*.test.ts`: the drop walk, markdown and frontmatter parsing, canvas colour mapping, and the vault as a whole | `pnpm exec vitest --project importer` |
| `licence` | Vitest, node | `packages/licence/src/**/*.test.ts` | `pnpm exec vitest --project licence` |
| `server` | Vitest, node | `apps/collab-server/src/**/*.test.ts` (`http/`, `store/`, `projection/`, `config/`, `sync/`, `ops/`) | `pnpm exec vitest --project server` |
| `control-plane` | Vitest, node | `apps/control-plane/src/**/*.test.ts` | `pnpm exec vitest --project control-plane` |
| `auth` | Vitest, node | `services/auth/src/**/*.test.ts` (`http/`, `identity/`, `invitations/`, `licensing/`, `organizations/`, `store/`) | `pnpm exec vitest --project auth` |
| `canvas` | Vitest, jsdom | `apps/canvas/src/**/*.test.{ts,tsx}`, with `apps/canvas/src/test/setup.ts` | `pnpm exec vitest --project canvas` |
| `e2e` | Playwright, chromium | `e2e/tests/**/*.spec.ts`, grouped by area (`boot/`, `boards/`, `cards/`, `links/`, `collab/`, `sharing/`, …) | `pnpm e2e` |
| billing | `node --test` | `services/billing/src/**/*.test.ts` | `pnpm --filter @suite/billing test` |

`pnpm test` is `vitest run` and covers every Vitest project in `vitest.config.ts`; `pnpm --filter
@suite/billing test` runs the billing suite outside it. UI mode is the one e2e command that reuses a
running server, so the window can stay open between runs.

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

`pnpm e2e:logs` prints the tail of the captured Vite and relay logs under `e2e/.artifacts/`. Read it
when a run stops producing test results or a browser loses its server. The relay log names the request
that failed; the Vite log names the file that triggered a reload.

## Reading a failure

An e2e spec that passes alone and fails in the suite usually depends on order or timing, not on a
server another spec started. Run `pnpm e2e:headed` with `--workers=1` to keep order and watch the
sequence.

A jsdom test that fails on a measurement is the wrong tool: layout, scrolling and
`getBoundingClientRect` are zero there, so the assertion belongs in an e2e spec or a story.

A graph test that fails only in the full run usually shares a seed or reuses a container across cases.
A 15 s timeout means real work.

A flaky test is a bug in the test. `--retries` exists for videos and traces when `CI` is set; do not
use it to turn a red test green locally.

## Coverage

`pnpm coverage` runs the whole Vitest suite with `@vitest/coverage-v8` and writes `coverage/`
(`coverage/lcov-report/index.html` for the browsable view). `coverage.include` names four sources:
`graph`, `licence`, `server` and `canvas`, so `importer`, `control-plane` and `auth` run without being
measured. Of the measured four only `@suite/graph` is gated, through one glob key in
`coverage.thresholds` at the root of `vitest.config.ts`. The others are printed, not gated: their
uncovered lines are socket, SQLite and entry-point wiring that e2e already drives, and a threshold would
invite assertion-free tests.

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

Five fast-check suites exist, and they are where "it must hold for every input" belongs:

| Suite | Property |
| --- | --- |
| `packages/graph/src/sections.property.test.ts` | derived section membership under arbitrary placement moves |
| `packages/graph/src/merge.property.test.ts` | concurrent edits converge regardless of order |
| `packages/graph/src/search.property.test.ts` | query semantics hold across generated workspaces |
| `packages/licence/src/property.test.ts` | licence parsing rejects every mutation |
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
