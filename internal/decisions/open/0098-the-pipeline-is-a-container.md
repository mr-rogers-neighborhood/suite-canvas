# ADR-0098: The pipeline is a container over a clean export

- Status: **withdrawn 2026-11-08**
- Date: 2026-11-04
- Supersedes: 0080 (which is also superseded by suite-dev's ADR-0002)
- Related: `scripts/ci.mjs`, `scripts/docker.mjs`, `Dockerfile`, `.husky/pre-push`,
  `deploy/deploy.sh`, `docs/how-to/test-and-verify.md`
- Shipped: **nothing in this list.** Corrected below.

## Why this is withdrawn

This record said a container pipeline was shipped, and it was not. Checked on 2026-11-08:

- `pnpm ci`, `ci:fast`, `ci:local` and `deploy` are not in `package.json`, and
  `git log -S'ci:fast'` finds no commit that ever added them.
- `scripts/docker.mjs` has no history. `git log --all --diff-filter=A --name-only` never lists it.
- `deploy/deploy.sh` was added and later removed; it does not read a `summary.json`.
- `reports/ci/c3831c4/` exists on disk and is gitignored, which is the only surviving evidence that
  something ran once.

An accepted record describing a system that is not there is worse than no record: it is the thing a
later reader trusts when deciding what to build next. That is how this repository ended up with three
different descriptions of its own pipeline.

**What actually gates a change here** is `pnpm check`, run by the `pre-push` hook, and the cross-repo
runner in `suite-dev`. See suite-dev's [ADR-0002](https://github.com/mr-rogers-neighborhood/suite-dev/blob/main/docs/adr/0002-the-gate-runs-here.md),
which is the surviving decision.

**What is worth keeping from this record** is one observation: a gate run against a warm working tree
can be green while a fresh checkout of the same commit fails. That claim is now made by
`node scripts/ci.mjs --fresh` in `suite-dev`, which exports `HEAD` and gates the export. It is the
only idea here that survived contact with the tree.

## Decision

`pnpm ci` is the pipeline. It writes `git archive HEAD` into `reports/ci/<sha>/workspace` and runs the
stage table there, in the `ci` stage of the Dockerfile, so the toolchain is Node 22 rather than
whatever the host has. Stages that need no network run in a second pass with `--network none`. Every
stage writes a log and a result; the run writes `summary.json`, which `deploy/deploy.sh` reads before
it builds anything.

This closes the exit condition ADR-0080 named. It is not a hosted runner: nothing is triggered by a
push to `origin`, and there is still no workflow file.

## Rejected alternatives

- **Re-enabling GitHub Actions.** ADR-0080 records why that failed: every run reported
  `startup_failure` in 0 s, so no job ever started. An entitlement problem is not a YAML problem.
- **Forgejo or Woodpecker now.** Both would work, and both want a host with a public endpoint plus
  webhook access to GitHub. Deferred, not rejected: the pipeline is one command, so a runner is a
  wrapper around `pnpm ci` rather than a second implementation.
- **Dagger.** A good pipeline-as-code tool, and one more daemon and dependency to own for a stage table
  that already fits in one file.
- **`pnpm verify` as the pipeline.** It runs against the working tree, so a warm `node_modules`, a
  gitignored `.env` or a stale `dist/` can make it green. That is a different claim from "a fresh
  clone of this commit passes".
- **Running the security scanners inside the pipeline image.** Each already runs a pinned image, and
  would need the Docker socket inside the container, which is the one mount this design refuses.

## Consequences

- A green `summary.json` for a commit is the release evidence, and the deploy path enforces it.
  `--allow-dirty` is the deliberate override and it now skips the check too.
- The pre-push hook costs a fresh export and install. Sharing the pnpm store keeps that to seconds,
  and `SKIP_CI=1` exists for a throwaway branch.
- `reports/` is gitignored and the last five runs are kept, so the evidence has a lifetime and
  nobody has to decide when to delete it.
- A change that only passes with a warm cache now fails in a named stage instead of at the next
  release.
