# ADR-0080: Local commands are the gate evidence

- Status: superseded
- Superseded by: ADR-0098, itself withdrawn 2026-11-08; the gate that exists is suite-dev's ADR-0002
- Date: 2026-10-26
- Related: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `docs/how-to/test-and-verify.md`
- Shipped: the local gates run (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`), and e2e is
  tiered into named areas (`e2e:smoke`, `e2e:canvas`, `e2e:collab`, `e2e:views`).
- Remaining: the policy written where contributors read it (`AGENTS.md`,
  `docs/how-to/test-and-verify.md`), and the exit condition below.

## Decision

Every gate names a local command, and the evidence for a change is that command's output in the change.
GitHub Actions is not a gate: `gh run list` reports every run in this repository as `startup_failure`
in 0s, so no workflow has ever produced a job here. The workflows stay in `.github/workflows/`,
unmaintained and unclaimed, because a runner would run those files.

## Rejected alternatives

- Keep CI in the gate list and mark it expected-failing. A gate that cannot pass is a line everyone
  learns to skip, which is the state this record ends.
- Delete the workflows. They are the artefact a runner would execute, and deleting them turns
  re-enabling into a rewrite.
  **Reversed 2026-11-06** by suite-dev's ADR-0002, which removed them: the files had never run, and
  keeping them made a service look present. They are recoverable with
  `git log --diff-filter=D -- .github/workflows`, which satisfies the concern without the artefact.
- Build a self-hosted runner now. It needs a host, credentials and a maintenance owner before there is
  a released product to protect.

## Consequences

- A change is verified on the machine that made it, by a named command, and the change is the record
  of that output.
- Nothing catches a regression that only appears on a clean checkout, on another platform, or with a
  fresh dependency install.
- This is a temporary evidence source with a named exit: a repository runner, or an Actions
  entitlement on the repository, re-enables `ci.yml` and `release.yml`, and this record is superseded
  by that change.
- A reviewer has to ask for the command output; a missing green check is not evidence of failure.
