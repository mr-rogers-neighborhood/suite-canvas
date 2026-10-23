# Release and rollback

How an alpha is cut, what artefact identifies it, and how to go back one. The
version this page is written against is `v0.2.0-alpha.1`; every release edits the
tag and the digest recorded below.

## What a release is

| Thing | Value |
| --- | --- |
| Version | `0.2.0-alpha.1` in `package.json` |
| Git tag | `v0.2.0-alpha.1` on the release commit |
| Image | `ghcr.io/<owner>/suite:v0.2.0-alpha.1`, also published as `:latest` |
| Identity | the image digest (`ghcr.io/<owner>/suite@sha256:…`) recorded in the release notes |
| Change record | the matching section of [CHANGELOG.md](../CHANGELOG.md) |
| Evidence | the gate rows in [roadmap/alpha.md](roadmap/alpha.md) |

`SUITE_VERSION` is baked into the image at build time, so a running container
reports exactly what it is: `/api/admin/status` returns `version`, `/metrics`
carries `suite_build_info{version="…"} 1`, and the startup line names it.

The tag is created by the lead after integration, not by a workstream. Nothing
in a workstream pushes a tag.

## Cutting a release

1. `package.json` version and the newest `CHANGELOG.md` heading agree
   (`node scripts/docs-check.mjs` enforces this).
2. `node scripts/generate-limits.mjs --check` and `node scripts/docs-check.mjs`
   are clean.
3. The gate is green on the commit: `pnpm verify` and `pnpm e2e`
   (see [testing.md](testing.md) for why this is local for now).
4. Tag the integration commit: `git tag -a v0.2.0-alpha.1 -m "Suite 0.2.0-alpha.1"`.
5. Push the tag: `git push origin v0.2.0-alpha.1`.

`.github/workflows/release.yml` then builds the runtime target, pushes
`:<tag>` and `:latest`, and opens a GitHub release whose body is the changelog
section for that version plus the pushed image digest.

> **Alpha caveat.** GitHub Actions currently ends every workflow in
> `startup_failure` with zero jobs on this account (see
> [testing.md](testing.md#the-local-gate) and the Phase 0 findings). If that is
> still true when the tag is pushed, run the same steps by hand — `docker build
> --target runtime --build-arg SUITE_VERSION=v0.2.0-alpha.1 -t <image> .`,
> `docker push`, then `gh release create` — and record the digest in the release
> notes. Do not tag unless the local gate is green.

## Smoke test a release

Run against the host that will serve it, before announcing the tag:

```sh
SUITE_IMAGE=ghcr.io/<owner>/suite:v0.2.0-alpha.1 docker compose pull app
SUITE_IMAGE=ghcr.io/<owner>/suite:v0.2.0-alpha.1 docker compose up -d
docker compose ps                       # app healthy, caddy up
curl -fsS https://$SUITE_DOMAIN/health  # {"ok":true}
curl -fsS -H "authorization: Bearer $SUITE_ADMIN_TOKEN" \
  https://$SUITE_DOMAIN/api/admin/status | head -c 400   # "version":"0.2.0-alpha.1"
curl -fsS https://$SUITE_DOMAIN/metrics | grep suite_build_info
```

Then open a workspace, upload an attachment, reload, open the same workspace in
a second tab, and confirm the limits page matches what the server reports on
refusal: [limits.md](limits.md).

## Rollback

Rollback is re-pinning the previous image. It is not a code change and does not
need a build.

1. Find the last good digest: the previous GitHub release body, or
   `docker image inspect ghcr.io/<owner>/suite:v<previous> --format '{{index .RepoDigests 0}}'`.
2. Set `SUITE_IMAGE` to that digest in `.env` and recreate `app` only:

   ```sh
   SUITE_IMAGE=ghcr.io/<owner>/suite@sha256:<digest> docker compose up -d app
   ```

3. Confirm `/health` answers and `/api/admin/status` reports the expected
   `version`.
4. **If the release changed a stored format** (a schema bump, a new store, a
   backup manifest change), the older binary may refuse the newer data. Stop
   `app`, restore the backup taken before the upgrade with `deploy/restore.sh`,
   then start the older image. Do not run an older binary against data written by
   a newer one and call it rolled back.
5. Record what happened in the release notes: digest restored, time, and whether
   a backup restore was needed.

`caddy` does not need to move during a rollback; it serves a static bundle from
the image and proxies to `app`.

## Not in the alpha

These are V1 work and are deliberately absent from the tag workflow:

- Image signing (cosign / keyless) and signature verification on pull.
- SBOM generation and attestation (SPDX or CycloneDX, `provenance: true`).
- Multi-architecture images, multi-OS CI matrices, self-hosted runners.
- A staging environment or a canary. There is one host and one tag.

Adding any of them is a change to `.github/workflows/release.yml`, and should
land with an ADR rather than by habit.
