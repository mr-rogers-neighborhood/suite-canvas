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

The version in `package.json` is what the next tag must say. Today it is `0.1.3`, so the next release
is tagged `v0.1.7` if nothing changed the number, or a new one if it did.

`apps/desktop/package.json` and `apps/desktop/suite.app.json` carry the **app's** version and must
agree with it: the tag, the manifest and the package describe one commit.

```sh
git tag -a v0.1.6 -m "v0.1.6"
git push origin main v0.1.6
```

## The package

`electron-builder` writes the artifact and the feed file beside it:

```sh
pnpm --filter @suite/desktop build
cd apps/desktop && pnpm exec electron-builder --linux AppImage --publish never
```

That produces `suite-canvas-<version>-x86_64.AppImage` and `latest-linux.yml` in
`apps/desktop/release`. The yml is what an updater reads: a version, the artifact's
name, its sha512 and its size. Nothing else needs generating.

The Linux package is the one this repository produces today. macOS and Windows are
configured and need a signing identity this repository does not have.

## Publishing

The manifest's `update.feed` is this repository's `releases/latest/download`, a
stable redirect to the newest release's assets. So publishing is uploading the
artifact and the yml to a GitHub Release whose tag is the version:

```sh
gh release create v0.1.2 \
  apps/desktop/release/suite-canvas-0.1.2-x86_64.AppImage \
  apps/desktop/release/latest-linux.yml \
  --title "Suite Canvas 0.1.0" --notes-file notes.md
```

`latest/download` then serves that yml, both to the app's own updater and to the
hub when a person presses Check for updates. One URL, so the two cannot disagree.

## Signing the feed

An update feed is one URL, and anything that can answer it can offer a version. The
artifact's sha512 protects a download, not the manifest that named it, so the
manifest is signed:

```sh
node ../suite-dev/scripts/sign-release.mjs apps/desktop/release/latest-linux.yml
```

That writes `latest-linux.yml.sig` beside it, base64, and prints the key's
fingerprint. Upload both. An app refuses a manifest that does not verify against the
key pinned in `@suite/desktop`, and the hub applies the same check before it shows a
version.

The private key is at `~/.config/suite/update-key.pem` on the publisher's machine,
or wherever `SUITE_UPDATE_KEY` points. **It is not in this repository and must not
be.** Two consequences worth stating plainly:

- Back it up somewhere you control. Anyone holding it can push an update to every
  install; losing it means no further updates for installs that have the current
  public key pinned.
- A new key is a new trust root. Rotating it means every installed app needs a
  release signed by the *old* key first, or it will refuse the next one.

The public half is `SUITE_UPDATE_PUBLIC_KEY` in `@suite/desktop`, with
`updateKeyFingerprint()` to check that what you signed with is what the apps pin.

## What is still missing

**A release workflow.** The gate runs before every push, in this repository and in the others, but a release is still built and
signed by hand on one machine, which is how two releases end up produced two different ways.

There is no CI service to hand the key to, so it stays where it is: `~/.config/suite/update-key.pem`,
used by `suite-dev/scripts/sign-release.mjs`. If that ever changes, note two things before moving it
into a repository secret. A secret is **not a backup** — GitHub never shows it again, so the offline
copy stays the only one you can restore from. And a secret is readable by any workflow that runs on a
tag, so the release workflow must be the only one allowed to run on one.

Until then the key stays on one machine, and releases stay a deliberate act.
