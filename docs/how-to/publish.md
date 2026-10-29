# Publish a copy of the source

The repository is public, so this page is not a step anybody has to take today. It is the runbook for
the other direction: you have a fork, a private tree, or a build of your own, and you want it readable
and cloneable without leaking a key. Everything before the flip is reversible; the flip itself is not.

## 1. Scan the whole history, not the tree

A working-tree scan cannot see a key that was committed and deleted an hour later, and those are
exactly what a reader's clone contains:

```sh
pnpm security:history
```

`gitleaks` is what runs (`scripts/security-secrets.mjs --history`). Read the findings rather than the
count: a fixture key in a deleted test helper is not a credential, and a live key is, wherever it sits.
`.gitleaks.toml` holds the allowlist, and each entry there is a decision that a path or a value is not
a secret.

Widening that allowlist to a path that still exists hides the next real key behind it. Prefer the
value, or the specific deleted file, and say why in the commit that adds the entry.

## 2. Check what a reader would trip over

A public repository is four things at once: a build, a documentation set, an image and an identity.
Walk each one before flipping:

| Question | Why it matters |
| --- | --- |
| Does a fresh clone pass `pnpm docs:check`? | Links into files that are not published fail only for the reader |
| Does `.dockerignore` exclude anything private? | A directory that is gitignored can still enter every image |
| Does the README describe the product, or the project's history? | A stranger reads the README first and knows nothing |
| Does the version line match the tags? | A README that says alpha beside a `v1.0.0` tag is a contradiction |

`pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check && pnpm docs:symbols && pnpm shape` has to
be green on the commit that flips the switch, because it is the last run nobody outside can see.

## 3. Flip the visibility

```sh
gh repo edit --visibility public --accept-visibility-change-consequences
gh repo edit --add-topic local-first,crdt,collaboration,canvas,typescript
```

This is the irreversible step. Forks, indexes and archives keep whatever was public, and un-publishing
does not take it back.

## 4. Confirm the gate actually runs

`.github/workflows/ci.yml` is in the tree. A workflow on a private repository with no runner minutes
sits in `startup_failure` with zero jobs, so the local gate is the only real one until the repository
is public: public repositories get hosted runners.

```sh
gh run list --limit 5
gh run watch
```

Then make it count: **Settings → Branches → Add branch protection rule** for `main`, requiring the
`quality` check (and `e2e` once it is stable). Prove it with a deliberately failing commit on a branch
and confirm the merge button refuses.

A workflow that exists and does not run is the failure this step exists to end. Do not describe a
repository as gated until a run is visible in Actions.

## 5. Tag the release

The manual path in [Release and roll back](release.md) is unchanged by publishing; it is the same
build, tag and digest record. `v0.1.0-alpha.1` is the first tag on this history.
