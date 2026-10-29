# Release and roll back

A release is a tag, an image built from it on the host that serves it, the image id that identifies
it, a smoke test against a host, and a rollback path. This page is written against `0.1.0-alpha.1`; every
release edits the tag and the id recorded below.

## What a release is

| Thing | Value |
| --- | --- |
| Version | `0.1.0-alpha.1` in `package.json` and the newest `CHANGELOG.md` heading |
| Git tag | `v0.1.0-alpha.1` on the release commit |
| Image | `suite:v0.1.0-alpha.1`, built on the host that runs it and also tagged `suite:local` |
| Identity | the image id from `docker image inspect --format '{{.Id}}' suite:v0.1.0-alpha.1` |
| Change record | the matching `CHANGELOG.md` section |
| Evidence | the `pnpm verify` run and the security scan output, quoted in the release notes |

`SUITE_VERSION` is baked into the image at build time, so a running container reports what it is:
`version` in `/api/admin/status`, `suite_build_info{version="…"} 1` in `/metrics`, and the
`server ready` line. The policy behind the scheme is ADR-0026 in
the internal decision log.

The lead creates the tag after integration. A workstream does not push one.

## Cut one

1. `package.json` and the newest `CHANGELOG.md` heading both say `0.1.0-alpha.1`.
2. `node scripts/docs-check.mjs` and `node scripts/generate-limits.mjs --check` are clean.
3. `pnpm verify` is green on the commit being tagged, and a full `pnpm e2e` passed on that same commit,
   in that order, with nothing already listening on `:5173` or `:1235`. A tag is the milestone where
   the full suite runs; the commands are in [test-and-verify.md](test-and-verify.md).
4. `git tag -a v0.1.0-alpha.1 -m "Suite 0.1.0-alpha.1"`.
5. `git push origin v0.1.0-alpha.1`.

`.github/workflows/release.yml` describes three jobs, and Actions is off on this repository, so none of
them has ever run. They are kept for the day it is turned back on (the command is in
[Test and verify a change](test-and-verify.md)); the manual path below is the release.

| Job | Does | Fails when |
| --- | --- | --- |
| `preflight` | Installs, compares `GITHUB_REF_NAME` with `package.json`, runs both docs checks | The tag and the version disagree, or a doc is stale |
| `image` | Builds the `runtime` target with `SUITE_VERSION=<tag>` and pushes `:<tag>`, `:sha-<12>` and `:latest` to GHCR | The build fails |
| `release` | Opens a GitHub release whose body is the changelog section plus the image digest and a rollback link | `CHANGELOG.md` has no section for the version |

Nothing on this page depends on either workflow file, and neither is the release: the image is built
on the host that serves it, tagged there, and rolled back to by tag. That path needs no runner, no
registry credential and no account entitlement, which is why it is the one written down.

### Build the image on the host

The build argument is the tag, and the two `-t` names are what the host later rolls back to and runs:

```sh
git checkout v0.1.0-alpha.1
docker build --target runtime --build-arg SUITE_VERSION=v0.1.0-alpha.1 \
  -t suite:v0.1.0-alpha.1 -t suite:local .
docker image inspect --format '{{.Id}}' suite:v0.1.0-alpha.1
```

Record the image id in the release notes. A host-built image has no `RepoDigests`, so the id is the
identity every later rollback names, and `docker image ls` shows it next to the tag.
`deploy/deploy.sh` runs the same build with the tag at `HEAD`, plus the backup, the rollback tag and
the restart.

Do not tag unless the local gate is green on the exact commit. The tag is the only quality claim this
project can currently make.

## Smoke test the release

Against the host that will serve it, before announcing anything:

```sh
sed -i -E 's|^#?[[:space:]]*SUITE_IMAGE=.*|SUITE_IMAGE=suite:v0.1.0-alpha.1|' .env
docker compose up -d --no-build app                   # the new tag; Caddy keeps running
docker compose ps                                     # app healthy, caddy up
curl -fsS https://$SUITE_DOMAIN/health                # {"ok":true}
# The operator API answers a session, so this runs on the box: SUITE_METRICS_LOCAL=1 lets a
# loopback request read /metrics with no credential, and the version stamp lives there.
curl -fsS http://127.0.0.1:1235/metrics | grep suite_build_info
```

`/api/admin/status` must report `"version":"v0.1.0-alpha.1"` and `suite_build_info` must carry the same tag,
because `SUITE_VERSION` reaches the process verbatim. Then, by hand: open a workspace, upload an
attachment, reload, open the same workspace in a second tab, and confirm the published limits still
match what the server reports on a refusal ([reference/limits.md](../reference/limits.md)). A
container that reports the wrong version is not a release, however healthy `/health` looks.

## The image scan

`pnpm security:image <tag>` is Trivy against the built image, HIGH and CRITICAL only and
`--ignore-unfixed`, because a finding with no fixed version cannot be closed by rebuilding. Run it on
all three targets a deployment ships:

```sh
docker build --target runtime       --build-arg SUITE_VERSION=v0.1.0-alpha.1 -t suite:scan-app .
docker build --target control-plane --build-arg SUITE_VERSION=v0.1.0-alpha.1 -t suite:scan-cp .
docker build --target web -t suite:scan-web .
pnpm security:image suite:scan-app && pnpm security:image suite:scan-cp && pnpm security:image suite:scan-web
```

The two Node images scan clean. The first run of this did not, and what it found was worth the
trouble twice over:

- The npm and pnpm CLIs inside the base image carried 13 HIGH advisories between them
  (`brace-expansion`, `picomatch`, `undici`, `sigstore`, `ip-address`, `pacote`), none reachable from
  this application and none patchable from this lockfile. They were build tools that had no reason to
  ship, so `server-runtime` deletes them.
- The `caddy` image carried a CRITICAL brotli decoder overflow and a HIGH curl use-after-free in its
  Alpine packages, which `RUN apk upgrade --no-cache` closes.

What remains on `web` is six HIGH findings inside the `caddy` binary itself (go-jose, `x/net`, the Go
stdlib). Nothing here can reach those: `caddy:2-alpine` is the newest tag, and the fixes are in Go
modules Caddy has not released yet. A release records them in its notes rather than pretending they
are absent, and the next image rebuild picks them up.

## Rollback

Rollback restarts `app` on the tag taken before the upgrade. It needs no code change and no build, and
on a host build it is the only rollback there is: a build overwrites `suite:local`, so the pre-upgrade
tag is what names the previous image.

1. Find the tag. `deploy/deploy.sh --list` prints every `suite:rollback-*` on the host, and the release
   notes record the version each upgrade started from.
2. Point `app` at it and recreate that service only:

   ```sh
   deploy/deploy.sh --rollback suite:rollback-v0.1.0-alpha.1
   # by hand: SUITE_IMAGE=suite:rollback-v0.1.0-alpha.1 docker compose up -d --no-build app
   ```

3. Confirm `/health` answers and `/api/admin/status` reports the expected `version`.
4. If the release changed a stored format (a schema bump, a new store, a backup manifest change), the
   older binary may refuse the newer data. Stop `app`, restore the pre-upgrade backup with
   `deploy/restore.sh --force` ([operate.md](operate.md)), then start the older image. An older binary
   against newer data is not a rollback.
5. Record the tag restored, its image id, the time, and whether a restore was needed, in the release
   notes.

`caddy` never moves during a rollback. It serves a static bundle from its own image and proxies to
`app`.

## Not in a release

A release omits image signing and verification on pull, SBOM generation and attestation,
multi-architecture images, self-hosted runners, and a staging environment or canary. There is one host
and one tag. Adding any of them changes `release.yml` and should land with an ADR rather than by habit.
