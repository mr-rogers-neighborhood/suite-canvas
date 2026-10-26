# Changelog

Notable changes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). A pre-release suffix
says a line is not ready to be depended on.

A release is the commit a `v*` tag points at. The image built for that tag is
`ghcr.io/<owner>/suite:v<version>`; the digest recorded in the release notes is
the artifact to roll back to. See [docs/how-to/release.md](docs/how-to/release.md).

## [1.0.0] - 2026-10-26

The first release with accounts. Two processes, one identity, and a payment path
that can be completed in test mode without touching the Stripe dashboard.

### Added

- `apps/control-plane`: a second server process that owns Postgres, Better Auth
  and Stripe. It mounts route modules it does not know by name, so the relay
  keeps its sockets, its SQLite stores and its projection and gained no `pg`
  dependency.
- Sign-up in the browser: email and password, magic link, passkeys and Google.
  Email verification is required, Turnstile is used when configured, and the
  sign-in route is rate limited.
- Organizations, members with roles, invitations, a device list with revoke, and
  MFA for admin actions.
- Billing through `@better-auth/stripe`: checkout, the customer portal, the
  webhook, trials and plan limits. `pnpm stripe` sets up the fixtures and
  `pnpm stripe --listen` forwards deliveries to the control plane.
- A session JWT minted by Better Auth's `jwt()` plugin and verified at the relay
  against a cached JWKS. Five-minute TTL, re-minted on every room join.
- Account export and account deletion, with a per-store report of what was
  removed and what was not.
- `packages/licence`: the licence token format and its Ed25519 verifier, shared
  by the relay and the billing service.
- `SUITE_LICENCE`: a self-hosted instance takes a signed licence at boot and
  runs at its tier. An expired, wrong-key or malformed token refuses to start.
- `apps/site`: the marketing page at `suite.run`. `apps/docs` moved to Astro and
  Starlight, still serving the dashboard, the four sections, `llms.txt`,
  `llms-full.txt` and Markdown for every page.
- A toast layer and a live-region announcer; a connection banner that
  distinguishes "not authorised" from "offline"; a save indicator separate from
  the sync dot.
- An Obsidian vault importer: folders become boards, `.canvas` geometry becomes
  placements, frontmatter maps onto type fields, wikilinks resolve, and every
  loss is reported.
- Version history with a revertable restore, starter templates, annotations
  anchored on a quote, type blueprints installed as a name-keyed diff, hover
  peek, a rollup summary, radial layout, and a closed error-code catalogue.
- Published cards have a slug and a reader URL that survives a reload and needs
  no account.
- `deploy/stripe/`: fixtures, a setup script and a test clock for renewals.

### Changed

- A persisted document is written off the event loop, by a worker that owns the
  only write connection and applies batches in arrival order.
- A projection rebuild writes only the entries that differ. Share build p50 fell
  from 20.5 s to 2.0 s on the load fixture; socket p99 from 862 ms to 22 ms.
- Every store sets WAL, `busy_timeout` and a schema stamp, and refuses a file
  stamped by a newer build.
- Peer, document, card, projection-build and per-room backpressure limits are
  enforced with named codes and published from the constants.
- The container runs non-root with a read-only root filesystem, no added
  capabilities and resource limits.

### Fixed

- A board above roughly 240 cards never reached a peer: the relay's join backfill
  sent one `DocUpdate` that `loro-protocol` refuses to encode above 256 KiB. The
  relay now fragments, and a 2.1 MiB board syncs.
- Arrow keys moved a focused card and the move was never saved.
- A fresh deployment could not create its first organization, because a seat
  check read a licence row nothing wrote.
- A paying organization was enforced at the free tier, because a subscription
  never reached `organization_licences`.
- Six menus never took focus, so their arrow keys were dead. Five dialogs
  declared `aria-modal` without a trap. Library rows were pointer-only.
- The in-app reduced-motion setting never reached JavaScript.

### Removed

- The owner key, in full: the claim, rotate and status routes, the URL fragment,
  `.suitekey` files, 24-word recovery phrases, `reset-owner`, and the
  `workspaces.sqlite` owner hash. There is no migration; see the upgrade notes.
- The hand-written Stripe webhook, checkout, portal, event verification and
  store, replaced by the plugin.

### Upgrade notes

This release cannot read a workspace that was shared by owner key.

- A `.suitekey` file or a 24-word recovery phrase no longer opens anything.
- A URL containing `#owner=` is treated as a plain workspace URL.
- An anonymous workspace opens, edits and exports as before, and does not sync.
  It is local-only until an account claims it, which is also when it can be paid
  for. Claiming does not change the workspace id.
- A deployment moving from `0.2.0-beta.1` keeps its six SQLite stores. Postgres
  is new: run the migrations by starting the control plane with
  `SUITE_AUTH_MIGRATE` on, which is the default.
- Billing now reads `STRIPE_PRICE_TIERS` and the plugin's table. The retired
  `SUITE_BILLING_STORE=dynamodb` and `SUITE_BILLING_TABLE` are ignored.

## [0.2.0-beta.1] - 2026-10-26

The first Beta line. Docs are the four Diátaxis sections plus a dashboard, the
docs site serves the same Markdown, and the e2e suite has a fast smoke gate.

### Added

- `apps/docs`: a Fumadocs site over `docs/`, with full-text search, a tabbed
  dashboard, `llms.txt`, `llms-full.txt` and a Markdown view of every page.
- `pnpm check` (lint, typecheck, changed tests), `pnpm e2e:smoke` (critical
  paths) and `pnpm e2e:changed` (specs changed since `origin/main`).
- `pnpm docs:check` now also verifies the generated section indexes and the
  house prose rules.
- `scripts/sync-docs.mjs` and `scripts/generate-doc-indexes.mjs` keep the site
  and the section indexes derived from `docs/`.

### Changed

- Documentation is `docs/README.md` plus `tutorials/`, `how-to/`, `reference/`
  and `explanation/`. Decision records, programme roadmaps and design history
  live in the local-only `internal/` tree.
- `@suite/graph` is split into domain modules behind `WorkspaceDocument`;
  `apps/canvas` feature folders replace the flat `components/` directory; the
  relay and the auth/billing services are folderised.
- The default test loop is `pnpm check`. Full e2e is a deliberate gate before a
  big commit, a merge or a tag.

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
- Portals: a portal card points at another board, renders a snapshot miniature,
  and enters it through a 320 ms camera transition with a back stack. Peer dots
  appear on portal cards and board tabs.
- Card focus: double-clicking a card, or choosing Edit in the inspector, opens
  the same card surface over the canvas; Escape restores the board.
- Workspace identity: the title bar shows an editable workspace name, new
  workspaces get a friendly default, and the browser title follows the name.
- A single-icon theme menu (Light, Dark, Auto) with a reduced-motion-aware
  sun/moon transition; Views is a text menu beside the workspace name.
- The `/`, `@`, and context menus scroll/flip to keep the active row and
  submenu visible, and app-bar controls share one 24 px row.
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
  recreated; all six stores are configured on the `suite-data` volume, and
  `SUITE_REQUIRE_DURABLE_STORES=1` refuses a disposable layout at boot.
- Opening a second client could loop on an uncached board-presence object; the
  map is now memoised on the peer set.
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
