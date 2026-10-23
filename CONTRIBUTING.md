# Contributing

Suite is a pnpm monorepo: a React canvas, a Loro sync server, a typed document
package, and a small billing service that is not deployed for the alpha. The
rules below are the short version of [AGENTS.md](AGENTS.md) and
[docs/conventions.md](docs/conventions.md).

## Set up

```sh
pnpm install          # also installs the git hooks
pnpm dev              # canvas on :5173, collab server on :1234
```

Node 22 or newer and pnpm 12 are what CI uses.

## Before you open a change

```sh
pnpm verify           # lint, typecheck, unit tests, billing tests, stories, build
pnpm e2e              # Playwright; separate because it needs browsers
node scripts/docs-check.mjs
node scripts/generate-limits.mjs --check
```

`pnpm verify` and `pnpm e2e` are the gate. GitHub Actions is not executing on
this repository yet, so a green local run is the evidence; see
[docs/testing.md](docs/testing.md).

## What a change needs

- **Tests for behaviour.** A user-visible change has a unit test or an e2e spec
  that fails without it. Bug fixes get a regression test that reproduces the
  bug first.
- **A conventional commit.** `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `chore:`; `commitlint` enforces it. One logical change per commit.
- **No unrelated refactors.** A formatting sweep hides the change that matters.
- **Generated files stay generated.** `docs/limits.md` comes from
  `node scripts/generate-limits.mjs`; editing it by hand fails the check in CI.

## Documents are part of the change

- `docs/decisions/` holds ADRs. A decision that changes behaviour, ownership or a
  published number gets one; copy `docs/decisions/0000-template.md`.
- `docs/operations.md` is the runbook. If a change alters a command, a store
  path or a default, that page changes in the same commit.
- `docs/limits.md` is generated. If a change alters a quota, regenerate.
- Retired terms fail `scripts/docs-check.mjs`: `GraphDocument`,
  `useGraphSnapshot`, "three SQLite files", and a stale "Yjs". Historical
  documents under `docs/decisions/` and `docs/roadmap/` are exempt.

<!-- docs-check: retired-terms-allowed -->

## Dependencies

Add a dependency only with a stated reason, and put it in the package that uses
it. Dependabot proposes grouped weekly updates for `npm` and `github-actions`;
that is the only dependency automation.

## Security

Do not commit secrets, licence private keys, webhook secrets or real customer
data. Report a vulnerability per [SECURITY.md](SECURITY.md) rather than in an
issue.

## Conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
