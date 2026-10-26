# Contributing

[docs/how-to/contribute.md](docs/how-to/contribute.md) is the full guide, from branch to merge. This
page is the checklist.

## Setup

```sh
pnpm install          # also installs husky, lint-staged and commitlint
pnpm dev              # canvas on :5173, relay on :1234
```

Node 22 or newer and pnpm 12. Use pnpm; npm and yarn write a lockfile this repository does not read.

## Verify

```sh
pnpm check            # after each edit batch: biome, tsc, changed Vitest files
pnpm verify           # the per-change gate: lint, typecheck, tests, stories, build, docs, shape
```

E2E runs on request. Start it when the maintainer asks for a run or names a commit milestone, and
pick the narrowest area script that covers the change:

```sh
pnpm e2e:smoke        # boot, launcher, one board
pnpm e2e:canvas       # board, cards, editor
pnpm e2e:collab       # sync, presence, attachments
pnpm e2e:views        # library, saved views, trash
pnpm e2e              # the full suite; a milestone action, not a per-change one
```

The tier table is in [docs/how-to/test-and-verify.md](docs/how-to/test-and-verify.md).

A user-visible change needs a test that fails without it. A bug fix gets a regression test committed
with the fix. A change that spans two clients needs a two-document test.

## Documentation is part of the change

- A command, port, store path or default changes with [docs/how-to/operate.md](docs/how-to/operate.md)
  or [docs/how-to/deploy.md](docs/how-to/deploy.md).
- `docs/reference/limits.md` is generated: run `node scripts/generate-limits.mjs`, never edit it.
- `node scripts/docs-check.mjs` fails on a broken link, an unbalanced fence, a retired term or a stale
  version.
- A decision that changes behaviour, ownership or a published number gets a record in the internal
  decision log, which is gitignored. Ask the maintainer for the template.

## Commits

Conventional commits, one logical change each: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
`chore:`. `commitlint` enforces the format on commit.

## Pull request checklist

- One logical change, with the test that proves it.
- `pnpm verify` green. Add an e2e run only if the maintainer asked for one.
- Docs updated in the same commit.
- No unrelated reformatting.
- No secrets, licence keys, webhook secrets or customer data.

## Dependencies

Add a dependency only with a stated reason, in the package that uses it.

## Security and conduct

Report a vulnerability per [SECURITY.md](SECURITY.md), never in a public issue. Participation is
covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). The repo rules for human and AI contributors are
in [AGENTS.md](AGENTS.md).
