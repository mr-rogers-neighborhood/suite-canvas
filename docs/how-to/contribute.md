# Contribute a change

One change, from branch to merge. The coding standards are in
[reference/conventions.md](../reference/conventions.md), the repo map in [AGENTS.md](../../AGENTS.md),
and the local gate in [test-and-verify.md](test-and-verify.md).

## Set up

Node 22 or newer and pnpm 12.13.0, both pinned in `package.json`. Use pnpm; npm and yarn write a
lockfile this repo does not read.

```sh
pnpm install          # also installs the git hooks (husky, lint-staged, commitlint)
pnpm dev              # canvas on :5173, collab server on :1234
```

`.env.example` lists every variable a local run reads; copy it to `.env` only to change a default. The
canvas keeps its document in IndexedDB, so a hard reload does not lose work.

## Branch

`main` is integration. Branch from it and keep the branch to one logical change.

```sh
git switch -c feat/card-tags
```

Prefixes that match the commit types (`feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`) make
the intent readable in `git branch` and in the pull request list.

## Prove it

Run the local gate on every change:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check && pnpm docs:symbols && pnpm shape
```

`pnpm check` runs Biome, `tsc`, `vitest run --changed`, `pnpm docs:symbols` and `pnpm shape`, so it is
the one to repeat while editing. Playwright is not in the gate; [test-and-verify.md](test-and-verify.md)
has the e2e scripts for a run the owner asks for.

A user-visible change needs a test that fails without it:

- Bug fix: a regression test that reproduces the bug, committed with the fix.
- Behaviour: a unit test in the package that owns the logic, or an e2e spec in `e2e/tests/` when the
  behaviour only exists across a server and a browser.
- Multi-client behaviour: a two-document test. Drive both `WorkspaceDocument`s through conflicting
  edits, sync both ways with `doc.export({ mode: "update" })`, then assert the merge.
- Non-trivial UI: a React Testing Library test, and a Storybook story when the surface is visual.

## Document it in the same change

A decision that changes behaviour, ownership or a published number gets a record in the internal
decision log, with a one-line summary. The log and its template are not part of this repository; ask
the maintainer for the current copy.

A command, port, store path or default changes in the same commit as
[operate.md](operate.md) or [deploy.md](deploy.md). A quota changes in the constants, then
`node scripts/generate-limits.mjs` rewrites [reference/limits.md](../reference/limits.md); never edit
that page by hand.

Retired vocabulary fails `node scripts/docs-check.mjs`: the old name for the typed document layer, the
old name for the React binding, a stale store count, and a stale CRDT claim. Fix the sentence instead
of adding the exemption marker.

One canonical home per fact: commands in how-to, quotas in the generated reference, reasons in
explanation. Link to the home rather than copying it.

## Commit

Conventional commits, enforced by commitlint on `commit-msg`:

```text
feat: add tag editing to the card inspector
fix: keep section membership after a multi-card drop
docs: rewrite the test gate
```

The subject is imperative and at most 72 characters; the body explains why and names the trade-off. One
logical change per commit, because a formatting sweep in the same commit hides the change that matters.

## Open a pull request

Fill in `.github/PULL_REQUEST_TEMPLATE.md`: summary (what and why), approach (the choice a reviewer
would otherwise question), test plan (the commands you ran and their result), and the checklist:

- [ ] The local gate from [test-and-verify.md](test-and-verify.md) passes
- [ ] An e2e run passed if the owner asked for one
- [ ] Docs and conventions updated if needed

A reviewer will ask which test fails without this change, what happens on a second client and on a
reload, and whether the docs describing the touched command or number are in the same commit. Paste
the command output rather than asserting a green run: no workflow runs on this account, so a local
transcript is the evidence.

## Dependencies

Add one with a stated reason, to the package that uses it, and prefer a primitive the repo already
depends on. A major bump is a decision and lands on its own. `.github/dependabot.yml` groups minor and
patch updates weekly for `npm` and `github-actions`, though whether it runs depends on the same
account state that stops every workflow here, so assume you are the automation.

## Security and conduct

Never commit a secret, a licence private key, a webhook secret or real customer data. Report a
vulnerability privately through [SECURITY.md](../../SECURITY.md) rather than in a public issue.
Participation is covered by [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md).
