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

`electron-builder` writes the artifact and the feed file beside it:

```sh
pnpm --filter @suite/desktop build
cd apps/desktop && pnpm exec electron-builder --linux AppImage --publish never
```

That produces `Suite Canvas-<version>.AppImage` and `latest-linux.yml` in
`apps/desktop/release`. The yml is what an updater reads: a version, the artifact's
name, its sha512 and its size. Nothing else needs generating.

The Linux package is the one this repository produces today. macOS and Windows are
configured and need a signing identity this repository does not have.

## Publishing

The manifest's `update.feed` is this repository's `releases/latest/download`, a
stable redirect to the newest release's assets. So publishing is uploading the
artifact and the yml to a GitHub Release whose tag is the version:

```sh
gh release create v0.1.0 \
  "apps/desktop/release/Suite Canvas-0.1.0.AppImage" \
  apps/desktop/release/latest-linux.yml \
  --title "Suite Canvas 0.1.0" --notes-file notes.md
```

`latest/download` then serves that yml, both to the app's own updater and to the
hub when a person presses Check for updates. One URL, so the two cannot disagree.

## Before the first public release

**Signing is not wired yet, and an updater that trusts an unsigned manifest is
worse than one that never updates.** Two things are missing, in order:

1. A publisher key, generated once, with the private half in CI and the public half
   pinned in the app. The manifest is signed, and the app refuses one that does not
   verify.
2. A CI job that builds on a tag and signs, so a release is produced by the same
   process every time rather than by hand on one machine.

Until both exist, a build here is for testing self-update locally, not for handing
to a person.
