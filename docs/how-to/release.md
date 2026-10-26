# Release and roll back

A release is a tag, an image built from it, the digest that identifies that image, a smoke test against
a host, and a rollback path. This page is written against `0.2.0-beta.1`; every release edits the tag
and the digest recorded below.

## What a release is

| Thing | Value |
| --- | --- |
| Version | `0.2.0-beta.1` in `package.json` and the newest `CHANGELOG.md` heading |
| Git tag | `v0.2.0-beta.1` on the release commit |
| Image | `ghcr.io/<owner>/suite:v0.2.0-beta.1`, also `:sha-<12>` and `:latest` |
| Identity | the image digest, `ghcr.io/<owner>/suite@sha256:…`, in the release notes |
| Change record | the matching `CHANGELOG.md` section |
| Evidence | the Beta gate rows in the internal roadmap |

`SUITE_VERSION` is baked into the image at build time, so a running container reports what it is:
`version` in `/api/admin/status`, `suite_build_info{version="…"} 1` in `/metrics`, and the
`server ready` line. The policy behind the scheme is ADR-0026 in
the internal decision log.

The lead creates the tag after integration. A workstream does not push one.

## Cut one

1. `package.json` and the newest `CHANGELOG.md` heading both say `0.2.0-beta.1`.
2. `node scripts/docs-check.mjs` and `node scripts/generate-limits.mjs --check` are clean.
3. The gate is green on the commit being tagged: `pnpm verify` and `pnpm e2e`, in that order, with
   nothing already listening on `:5173` or `:1235`. The tiers are in
   [test-and-verify.md](test-and-verify.md).
4. `git tag -a v0.2.0-beta.1 -m "Suite 0.2.0-beta.1"`.
5. `git push origin v0.2.0-beta.1`.

`.github/workflows/release.yml` then runs three jobs:

| Job | Does | Fails when |
| --- | --- | --- |
| `preflight` | Installs, compares `GITHUB_REF_NAME` with `package.json`, runs both docs checks | The tag and the version disagree, or a doc is stale |
| `image` | Builds the `runtime` target with `SUITE_VERSION=<tag>` and pushes `:<tag>`, `:sha-<12>` and `:latest` to GHCR | The build fails |
| `release` | Opens a GitHub release whose body is the changelog section plus the image digest and a rollback link | `CHANGELOG.md` has no section for the version |

Record the digest from the run. It is the artefact every later rollback names.

### When Actions cannot run

Every workflow on this account still ends in `startup_failure` with zero jobs, which is account state
rather than workflow content. If that is still true at the tag, build and push by hand with the same
three tags and the same build argument, record the digest in the release notes, and say the image was
built manually so nobody assumes `release.yml` produced it.

```sh
docker build --target runtime --build-arg SUITE_VERSION=v0.2.0-beta.1 \
  -t ghcr.io/<owner>/suite:v0.2.0-beta.1 -t ghcr.io/<owner>/suite:latest .
docker push ghcr.io/<owner>/suite:v0.2.0-beta.1 && docker push ghcr.io/<owner>/suite:latest
docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/<owner>/suite:v0.2.0-beta.1
```

Do not tag unless the local gate is green on the exact commit. The tag is the only quality claim this
project can currently make.

## Smoke test the release

Against the host that will serve it, before announcing anything:

```sh
SUITE_IMAGE=ghcr.io/<owner>/suite:v0.2.0-beta.1 docker compose pull app
SUITE_IMAGE=ghcr.io/<owner>/suite:v0.2.0-beta.1 docker compose up -d
docker compose ps                                     # app healthy, caddy up
curl -fsS https://$SUITE_DOMAIN/health                # {"ok":true}
curl -fsS --oauth2-bearer "$SUITE_ADMIN_TOKEN" https://$SUITE_DOMAIN/api/admin/status | head -c 400
curl -fsS --oauth2-bearer "$SUITE_ADMIN_TOKEN" https://$SUITE_DOMAIN/metrics | grep suite_build_info
```

`/api/admin/status` must report `"version":"0.2.0-beta.1"` and `suite_build_info` must carry the same
tag. Then, by hand: open a workspace, upload an attachment, reload, open the same workspace in a second
tab, and confirm the published limits still match what the server reports on a refusal
([reference/limits.md](../reference/limits.md)). A container that reports the wrong version is not a
release, however healthy `/health` looks.

## Rollback

Rollback is re-pinning the previous image. It needs no code change and no build.

1. Find the last good digest, either in the previous GitHub release body or with
   `docker image inspect ghcr.io/<owner>/suite:v<previous> --format '{{index .RepoDigests 0}}'`.
2. Set `SUITE_IMAGE` to that digest in `.env` and recreate `app` only:

   ```sh
   SUITE_IMAGE=ghcr.io/<owner>/suite@sha256:<digest> docker compose up -d app
   ```

3. Confirm `/health` answers and `/api/admin/status` reports the expected `version`.
4. If the release changed a stored format (a schema bump, a new store, a backup manifest change), the
   older binary may refuse the newer data. Stop `app`, restore the pre-upgrade backup with
   `deploy/restore.sh --force` ([operate.md](operate.md)), then start the older image. An older binary
   against newer data is not a rollback.
5. Record the digest restored, the time, and whether a restore was needed, in the release notes.

`caddy` never moves during a rollback. It serves a static bundle from its own image and proxies to
`app`.

## Not in Beta

The tag workflow deliberately omits image signing and verification on pull, SBOM generation and
attestation, multi-architecture images, self-hosted runners, and a staging environment or canary. There
is one host and one tag. Adding any of them changes `release.yml` and should land with an ADR rather
than by habit.
