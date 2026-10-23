# Changelog

Notable changes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) with a pre-release
suffix while the product is in alpha.

A release is the commit a `v*` tag points at. The image built for that tag is
`ghcr.io/<owner>/suite:v<version>`; the digest recorded in the release notes is
the artifact to roll back to. See [docs/release.md](docs/release.md).

## [0.2.0-alpha.1] - 2026-10-23

The first tagged alpha. Everything here is usable self-hosted; hosted billing is
not open.

### Added

- Attachments: image bytes stored by the relay, uploaded and served per
  workspace, included in backup and restore.
- Multi-tab safety: one writer per workspace via Web Locks, with a
  version-vector fallback, so two tabs cannot delete each other's unmerged
  edits.
- Client durability: an error boundary around the canvas, `persist()` with a
  visible storage state, a typed quota path instead of a silent failed save, and
  an explicit offline scope ("the open tab keeps working; a reload while
  offline is not supported in Alpha").
- A local diagnostics bundle and opt-in crash reporting against a self-hosted
  GlitchTip profile, off by default.
- A blob format tag on stored snapshots, plus N−1 workspace and per-store
  fixture tests.
- `docs/limits.md`, generated from the enforcement code and checked for drift.
- `docs/release.md`: tag, image, rollback and smoke procedure.
- `scripts/docs-check.mjs`: link, code-fence, retired-term and version checks.
- `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
- Dependabot for `npm` and `github-actions`, weekly and grouped.
- A tag-driven release workflow that pushes the runtime image to GHCR and
  opens a GitHub release with the changelog section and image digest.
- The build version is reported by `/api/admin/status` and `/metrics`
  (`suite_build_info`).

### Changed

- The workspace document layer is `WorkspaceDocument` and its React binding is
  `useWorkspaceSnapshot`; the old names are gone from the docs as well as the
  code.
- `README.md`, `AGENTS.md`, `docs/testing.md` and `docs/billing.md` describe the
  product that exists: six stores, attachments shipped, current test counts.
- Marquee selection is covered by a regression spec, and local drag easing is
  render-only with one CRDT commit per gesture.

### Fixed

- Settings, licence claims and attachments were lost when a container was
  recreated; all six stores are configured on the `suite-data` volume.
- A deleted workspace could be written back by its live room seconds later; the
  room is closed on delete.
- The stale light preview asset, which showed the retired sync engine, is
  removed.

### Removed

- Hosted checkout is closed for the alpha: the Stripe webhook is not deployed,
  `SUITE_BILLING_ENABLED` defaults to `0`, and no upgrade CTA exists in the app.

## Version 0.1.0

The untagged pre-alpha line. No release artifact was published; `package.json`
carried `0.1.0` while the tree was the only distribution.
