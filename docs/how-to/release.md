# Release

A release is a tag, a package and a note. Canvas is one app in a suite of four, and each ships its own
version, because they release on their own schedules.

## Before the tag

```sh
pnpm check          # lint, typecheck, the changed tests, docs symbols, shape
pnpm build          # the graph package and the standalone renderer bundle
pnpm e2e:desktop    # the shell, launched for real
```

`pnpm check` is the gate a change runs against and the same one a release must pass. A release note
says what changed for a person, not what changed for a file.

## The tag

The version in `package.json`, the tag and the changelog describe the same commit. A tag that disagrees
with the package is the failure this rule exists to prevent, because an updater resolves a version, not
an intention.

The version in `package.json` is what the next tag must say. Today it is `0.1.0-alpha.3`, so the next
release is tagged `v0.1.0-alpha.3` if nothing changed the number, or a new one if it did.

```sh
git tag -a v0.1.0-alpha.3 -m "v0.1.0-alpha.3"
git push origin main v0.1.0-alpha.3
```

## The package

`apps/desktop` builds the shipped article:

```sh
pnpm --filter @suite/desktop package:dir    # an unpacked binary, for a check
pnpm --filter @suite/desktop build          # the renderer bundle and the compiled main process
```

The Linux package is the one this repository produces today. macOS and Windows are configured and need
a signing identity this repository does not have; an unsigned build is not something to hand a person.

## What is not here yet

Self-update. The plan is `electron-updater` against GitHub Releases with signed manifests, so the feed
is one nobody has to trust blindly. Until that exists, a release is installed by hand and there is no
`latest.yml` to point an app at.
