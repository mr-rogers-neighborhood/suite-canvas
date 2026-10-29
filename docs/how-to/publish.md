# Publish the source

This page is the runbook for the one transition a repository makes once: from a tree only its author
reads to a repository anybody can clone, audit and build. It is written for `0.1.0-alpha.1`, the
first public release.

The order matters. Everything before the flip is reversible; the flip itself is not.

## 1. Scan the whole history, not the tree

A working-tree scan cannot see a key that was committed and deleted an hour later, and those are the
ones a reader's clone contains:

```sh
pnpm security:history
```

The answer on this repository, recorded here because a claim about secrets is only worth the scan
behind it:

```
743 commits scanned.
79.02 MB scanned.
no leaks found
```

Two findings were examined before the allowlist in `.gitleaks.toml` was widened, and neither is a
credential:

- Six deleted test helpers, the largest being the billing suite's fixture module, held fixture keys.
  The one `sk_test_…` among them is refused by Stripe: `GET /v1/account` with it answers `401`.
- The rest were fixture owner keys and share tokens, which the allowlist already named by value; the
  path entries exist so a history scan does not repeat a known false positive forever.

A live path is still scanned. Widening the allowlist to a path that still exists would hide the next
real key behind it.

## 2. Clear the blockers

A public repository is four things at once: a build, a documentation set, an image and an identity.
Each of these was wrong on the day before the flip, and each is cheap:

| Blocker | Why it matters | Fix |
| --- | --- | --- |
| Documentation linked into a private tree | `docs/` pointed at `internal/decisions/…`, which `.gitignore` excludes, so a fresh clone failed `pnpm docs:check` and the site build errored on unresolved links | ADR references are plain `ADR-NNNN` text, and `reference/conventions.md` says the log is not published |
| The private tree in the build context | `.dockerignore` had no `internal` rule, so decisions and the roadmap entered every image | one rule in `.dockerignore` |
| A README claim about self-hosting | it said a self-hosted relay "means asking for a licence"; a relay with no `SUITE_LICENCE` runs ungated | corrected, and `reference/billing.md` describes what a licence is actually for |
| A version line the code does not support | `1.1.0` with tags `v1.0.0`…`v1.1.0` beside a README that says alpha | `0.1.0-alpha.1`, with a CHANGELOG entry that says the 1.x tags predate the release |
| Internal handover documents | `WHAT-CHANGED.md` is a commit-by-commit note for an absent reviewer | deleted |
| Infrastructure identifiers | one comment carried the production host address | placeholder |

`pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check && pnpm docs:symbols && pnpm shape`
has to be green on the commit that flips the switch, because it is the last run nobody outside can
see.

## 3. Flip the visibility

```sh
gh repo edit --visibility public --accept-visibility-change-consequences
gh repo edit --add-topic local-first,crdt,collaboration,canvas,typescript
```

This is the irreversible step. Forks, indexes and archives keep whatever was public, and un-publishing
does not take it back.

## 4. Confirm the gate actually runs

`.github/workflows/ci.yml` is present and had never run: every workflow on the account ended in
`startup_failure` with zero jobs, which is why `docs/how-to/test-and-verify.md` names the local
command as the only gate. Public repositories get hosted runners, so publishing is what fixes it.

```sh
gh run list --limit 5
gh run watch
```

Then make it count: **Settings → Branches → Add branch protection rule** for `main`, requiring the
`quality` check (and `e2e` once it is stable). Prove it with a deliberately failing commit on a
branch and confirm the merge button refuses.

A workflow that exists and does not run is the exact failure this step exists to end. Do not describe
the repository as gated until a run is visible in Actions.

## 5. Tag the release

The manual path in [Release and roll back](release.md) is unchanged by publishing; it is the same
build, tag and digest record. `v0.1.0-alpha.1` is the first tag on the public history.

## What stays private

The decision log, the roadmap and the design notes in `internal/` do not ship. They are the
author's working memory, they name people and plans that are not part of the product, and they were
never written for an audience. `docs/` carries what a reader needs: the reasoning is restated in the
prose, and an `ADR-NNNN` reference is shorthand that does not need to resolve.

If they are ever published, the right time is a deliberate release with its own edit pass, not a side
effect of making the code public.
