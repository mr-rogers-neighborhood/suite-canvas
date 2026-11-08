# ADR-0026: MIT licence, and how a release is identified

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0002](./0002-pnpm-monorepo.md), `docs/release.md`, `CHANGELOG.md`

## Context

The alpha is about to be handed to people outside the maintainer's checkout. Three questions have to
be answered together, because each one constrains the others:

1. **What may they do with the code?** Nothing in the tree said. A repository with no licence grants
   no rights, which is the wrong default for a self-hosted product whose whole pitch is "run it
   yourself".
2. **What is a release?** `package.json` said `0.1.0`, `git tag` was empty, and the only distribution
   was the working tree. A self-hoster had no way to name the thing they were running.
3. **How does a self-hoster go back?** Publishing an image is half of a release; the other half is
   being able to return to the previous one when the new one is wrong. There was no written
   procedure, and no artefact identity to roll back to.

The repository is private at Alpha. That matters for evidence: GitHub Actions does not execute
(`startup_failure`, zero jobs) and branch protection is unavailable on a private free repository, so
a release cannot point at a green CI run yet.

## Decision

1. **MIT.** `LICENSE` carries the full MIT text. The product is a single codebase with no
   separately-licensed component, and MIT matches what the self-hosting pitch promises: take it,
   run it, change it.
2. **Private at Alpha, tagged and changelogged.** The repository stays private while the API and the
   data format can still move. A release is a `v*` tag on an integration commit, and the tag is the
   only version that counts.
3. **One identity per release.** `package.json` version, the tag `v<version>`, the newest
   `CHANGELOG.md` heading, and the image tag all carry the same string. The first release is
   `0.2.0-alpha.1`, so a pre-release suffix marks the alpha line without inventing a fourth scheme.
4. **The image is identified by its digest, not its tag.** The tag workflow pushes
   `ghcr.io/<owner>/suite:<tag>`, `:sha-<12>`, and `:latest`, and the GitHub release records the
   digest that was pushed. A tag can be moved; a digest cannot.
5. **The build reports itself.** `SUITE_VERSION` is baked into the image, and `/api/admin/status`,
   `/metrics` (`suite_build_info`) and the startup line report it. "Which build is this" is
   answerable from the running container.
6. **Rollback is re-pinning a digest.** `docs/release.md` records the procedure: set `SUITE_IMAGE` to
   the previous digest, recreate `app`, check `/health` and the reported version. A rollback across a
   stored-format change also restores the backup taken before the upgrade; an older binary is never
   pointed at newer data and called rolled back.
7. **No signing, no SBOM, no provenance in Alpha.** Image signing (cosign), SBOM generation and
   attestation are V1 work. They add a key-management surface and a verification step on every
   self-hoster's pull, for a threat — a tampered `ghcr.io` image — that is real but not the alpha's
   risk. Adding them later is a change to one workflow and a new ADR.
8. **The local gate is the release gate while Actions cannot execute.** `pnpm verify` plus
   `pnpm e2e` on the tagged commit are the evidence, and `docs/testing.md` says so plainly. A tag is
   not cut on a claim of CI that did not run.

## Consequences

- A self-hoster can name, verify and roll back what they run, without a vendor account.
- MIT means a fork may compete with the hosted product. That is accepted: the hosted product's
  defensibility is the service, not the source.
- Keeping the repository private delays public CI and public branch protection. The release evidence
  is therefore local and recorded, which is weaker and is labelled as weaker.
- A digest in the release notes is only useful if it is captured at push time. The workflow does
  that; a manual release must paste it by hand, and `docs/release.md` says so.
- Version bumps now touch three files (`package.json`, `CHANGELOG.md`, `docs/release.md`); the docs
  check fails if they disagree, which is cheaper than discovering it at tag time.
- Image signing and SBOM are deferred with an owner (V1) rather than a vague "later".

## Alternatives considered

- **Apache-2.0** — a better fit for a corporate contribution story, which does not exist yet. MIT's
  brevity wins while the contributor base is one person.
- **Public repository at Alpha** — would enable Actions and branch protection immediately, but
  exposes a moving data format and an API that is not settled. Rejected for Alpha, revisited at Beta.
- **Calendar or build-number versioning** — `2026.10.0` would say nothing about compatibility. Semver
  with a pre-release suffix keeps the eventual 1.0 meaningful.
- **`latest` only** — one moving tag means a rollback has nothing to name. Rejected.
