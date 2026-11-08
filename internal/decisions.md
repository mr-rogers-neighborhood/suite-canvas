# Decisions

One line per decision record: what was decided, whether it shipped, and where the evidence lives.
This is the index for "why is the code shaped this way", not a second copy of the arguments.

## How to read this

- **Trust the current page first.** An accepted decision has been folded into
  [reference/architecture.md](../reference/architecture.md); that section describes what the code does
  today. The record is the argument that produced it.
- **Read the full text for the argument**, not the outcome: the alternatives, the forces, and the
  consequences somebody accepted at the time.
- **A partial or open record is deliberately terse.** It says what shipped and what did not, so nobody
  builds on a decision that never landed.
- **"Accepted (in part)" is not pending work.** The missing half was decided elsewhere — 0014's typed
  relations became references under ADR-0019 — and a row only gets a live record when work is genuinely
  outstanding.
- **A record is never edited to match today.** A later record supersedes it, and the Status column says
  which.

The policy and the list of live records are in [decisions/README.md](decisions/README.md); the
copyable shape is [decisions/TEMPLATE.md](decisions/TEMPLATE.md). Every full text — accepted,
superseded, and the long version of the open ones — is in
[archive/decisions/](../../history/decisions).

## Numbering

Numbers are allocated in order and are never reused. `0001`, `0013`, `0030` and `0032–0036` were never
written, or were removed with the scene surface. The gaps are intentional: nothing below is renumbered
to close them.

## The log

| ADR | Decision in one line | Status | Where it lives now |
| --- | --- | --- | --- |
| 0002 | pnpm workspaces plus Turborepo, one package per bounded surface. | accepted | [§ Toolchain](../reference/architecture.md#toolchain) · [full text](../../history/decisions/0002-pnpm-monorepo.md) |
| 0003 | A typed object graph: a Zod-validated schema over a CRDT wrapper, never raw CRDT writes. | accepted | [§ Document model](../reference/architecture.md#document-model) · [full text](../../history/decisions/0003-typed-object-graph.md) |
| 0004 | Every node is a collaborative editor, not a rendered string. | accepted | [§ Content and presence](../reference/architecture.md#content-and-presence) · [full text](../../history/decisions/0004-node-content-and-presence.md) |
| 0005 | Presence lives in flow space, and drags are tracked live. | accepted | [§ Content and presence](../reference/architecture.md#content-and-presence) · [full text](../../history/decisions/0005-flow-space-presence.md) |
| 0006 | Connectors are node-owned; magnetic placement and layer order are explicit. | accepted | [§ Boards, sections and placement](../reference/architecture.md#boards-sections-and-placement) · [full text](../../history/decisions/0006-connectors-and-layers.md) |
| 0007 | Connectors link to connectors, with direction control and link layers. | accepted | [§ Links and routing](../reference/architecture.md#links-and-routing) · [full text](../../history/decisions/0007-connector-links.md) |
| 0008 | Links stay live while dragging, reconnect, and carry path styles. | accepted | [§ Links and routing](../reference/architecture.md#links-and-routing) · [full text](../../history/decisions/0008-live-links-and-path-styles.md) |
| 0009 | Connector and link drags publish live presence. | accepted | [§ Content and presence](../reference/architecture.md#content-and-presence) · [full text](../../history/decisions/0009-live-drag-presence.md) |
| 0010 | A workspace holds boards, boards hold cards, and a placement is not a card. | accepted | [§ Document model](../reference/architecture.md#document-model) · [full text](../../history/decisions/0010-workspace-boards-and-cards.md) |
| 0011 | One library dock, one drawer, and chrome that lives inside the card. | accepted | [§ Inspector and interaction](../reference/architecture.md#inspector-and-interaction) · [full text](../../history/decisions/0011-library-dock-and-card-chrome.md) |
| 0012 | Records are field-granular, so edits to different fields merge. | accepted | [§ Document model](../reference/architecture.md#document-model) · [full text](../../history/decisions/0012-field-granular-records.md) |
| 0014 | Types, fields, sections and views form the semantic model; typed relations became references. | accepted (in part) | [§ Types, fields and views](../reference/architecture.md#types-fields-and-views) · [full text](../../history/decisions/0014-semantic-model.md) |
| 0015 | Loro is the CRDT engine. | accepted | [§ Document model](../reference/architecture.md#document-model) · [full text](../../history/decisions/0015-loro-as-crdt-engine.md) |
| 0016 | Types, fields, tags and properties are the semantic core. | accepted | [§ Types, fields and views](../reference/architecture.md#types-fields-and-views) · [full text](../../history/decisions/0016-semantic-core.md) |
| 0017 | Sections are spatial containers on a board. | accepted | [§ Boards, sections and placement](../reference/architecture.md#boards-sections-and-placement) · [full text](../../history/decisions/0017-spatial-sections.md) |
| 0018 | Orientation surfaces, multi-object selection and panel editing. | accepted | [§ Content and presence](../reference/architecture.md#content-and-presence) · [full text](../../history/decisions/0018-orientation-and-multi-object.md) |
| 0019 | References, not typed links: a backlink index, not a relation store. | accepted | [§ Types, fields and views](../reference/architecture.md#types-fields-and-views) · [full text](../../history/decisions/0019-references-not-typed-links.md) |
| 0020 | `main` plus the Loro document are the plan of record. | accepted | [§ Document model](../reference/architecture.md#document-model) · [full text](../../history/decisions/0020-main-and-loro-plan-of-record.md) |
| 0021 | Card-level sharing is a per-card room; recorded and deferred. | superseded | [ADR-0022](../../history/decisions/0022-share-projection-links.md) replaced it for S1 · [full text](../../history/decisions/0021-sharing-seam-deferred.md) |
| 0022 | A share link is a capability over a live projection room. | accepted | [§ Sync, sharing and durability](../reference/architecture.md#sync-sharing-and-durability) · [full text](../../history/decisions/0022-share-projection-links.md) |
| 0023 | A selection projection shares part of a board. | accepted | [§ Sync, sharing and durability](../reference/architecture.md#sync-sharing-and-durability) · [full text](../../history/decisions/0023-selection-projections.md) |
| 0024 | One compactor per workspace, and a version vector as the delete proof. | accepted | [§ Document model](../reference/architecture.md#document-model) · [full text](../../history/decisions/0024-multi-tab-persistence-and-leader-election.md) |
| 0025 | Client durability is a snapshot plus an update log, with a stated offline boundary. | accepted | [§ Sync, sharing and durability](../reference/architecture.md#sync-sharing-and-durability) · [full text](../../history/decisions/0025-client-durability-and-offline-scope.md) |
| 0026 | MIT licence, and how a release is identified. | accepted | [§ Licensing, limits and operations](../reference/architecture.md#licensing-limits-and-operations) · [full text](../../history/decisions/0026-license-and-release-policy.md) |
| 0027 | Crash reporting stays inside a stated privacy boundary. | accepted | [§ Licensing, limits and operations](../reference/architecture.md#licensing-limits-and-operations) · [full text](../../history/decisions/0027-crash-reporting-and-privacy.md) |
| 0028 | The limits page is generated, and checked for drift. | accepted | [§ Licensing, limits and operations](../reference/architecture.md#licensing-limits-and-operations) · [full text](../../history/decisions/0028-published-limits.md) |
| 0029 | A portal is a card with a `board` field, not a reserved property. | accepted | [§ Document model](../reference/architecture.md#document-model) · [full text](../../history/decisions/0029-portal-board-field.md) |
| 0031 | Whiteboard cards, with element-level Loro binding. | accepted | [§ Document model](../reference/architecture.md#document-model) · [full text](../../history/decisions/0031-whiteboard-cards-and-loro-binding.md) |
| 0037 | A saved view is a lens over the canvas. | accepted | [§ Types, fields and views](../reference/architecture.md#types-fields-and-views) · [full text](../../history/decisions/0037-a-saved-view-is-a-lens.md) |
| 0038 | A type's template is a card the new card is copied from. | accepted | [§ Types, fields and views](../reference/architecture.md#types-fields-and-views) · [full text](../../history/decisions/0038-a-type-template-is-a-card.md) |
| 0039 | A link points at an endpoint of a kind. | accepted | [§ Links and routing](../reference/architecture.md#links-and-routing) · [full text](../../history/decisions/0039-a-link-points-at-an-endpoint-of-a-kind.md) |
| 0040 | A board and a section are identities, not types. | accepted | [§ Boards, sections and placement](../reference/architecture.md#boards-sections-and-placement) · [full text](../../history/decisions/0040-a-board-and-a-section-are-identities.md) |
| 0041 | Alpha core is a closed feature set, and the gate says so. | accepted | [§ Scope and sequencing](../reference/architecture.md#scope-and-sequencing) · [full text](../../history/decisions/0041-alpha-core-is-a-closed-feature-set.md) |
| 0042 | Media metadata is fields, not media types. | accepted | [§ Types, fields and views](../reference/architecture.md#types-fields-and-views) · [full text](../../history/decisions/0042-media-metadata-is-fields.md) |
| 0043 | A view is a lens, a database or a render. | accepted | [§ Types, fields and views](../reference/architecture.md#types-fields-and-views) · [full text](../../history/decisions/0043-a-view-is-a-lens-a-database-or-a-render.md) |
| 0044 | One `Target` primitive for every "here is the thing I mean": presence, follow, goto, handbook. | accepted | [§ Links and routing](../reference/architecture.md#links-and-routing) · [full text](../../history/decisions/0044-one-target-primitive.md) |
| 0045 | Handbook articles are cards on a designated board. | accepted | [§ Handbook, tutorials and tours](../reference/architecture.md#handbook-tutorials-and-tours) · [full text](../../history/decisions/0045-handbook-articles-are-cards.md) |
| 0046 | The shell derives its colour from the theme. | accepted | [§ Styling and theming](../reference/architecture.md#styling-and-theming) · [full text](../../history/decisions/0046-the-shell-derives-its-colour.md) |
| 0047 | A view can be a card, and an embed is one concept. | accepted | [§ Types, fields and views](../reference/architecture.md#types-fields-and-views) · [full text](../../history/decisions/0047-a-view-can-be-a-card-and-an-embed-is-one-concept.md) |
| 0048 | Links paint beneath cards and keep the dot they were dropped on. | accepted | [§ Links and routing](../reference/architecture.md#links-and-routing) · [full text](../../history/decisions/0048-links-paint-beneath-cards.md) |
| 0049 | A mind-mapping gesture, and patterns as reusable layout recipes. | partial | [open record](decisions/open/0049-a-mind-map-mode-and-patterns.md) · [full text](../../history/decisions/0049-a-mind-map-mode-and-patterns.md) |
| 0050 | One inspector, driven by what is selected. | accepted | [§ Inspector and interaction](../reference/architecture.md#inspector-and-interaction) · [full text](../../history/decisions/0050-one-inspector.md) |
| 0051 | One style vocabulary over the edges of a surface. | accepted | [§ Styling and theming](../reference/architecture.md#styling-and-theming) · [full text](../../history/decisions/0051-one-style-vocabulary-over-edges.md) |
| 0052 | A link is a route: two anchors, stored bends, and a path mode. | accepted | [§ Links and routing](../reference/architecture.md#links-and-routing) · [full text](../../history/decisions/0052-a-link-is-a-route.md) |
| 0053 | Supertags: a card carries a set of types plus a primary one. | accepted | [§ Types, fields and views](../reference/architecture.md#types-fields-and-views) · [full text](../../history/decisions/0053-supertags-are-multi-type.md) |
| 0054 | A tutorial is a card, and a tour is its timeline. | accepted | [§ Handbook, tutorials and tours](../reference/architecture.md#handbook-tutorials-and-tours) · [full text](../../history/decisions/0054-a-tutorial-is-a-card.md) |
| 0055 | Hover-peek names an entity anywhere it appears. | proposed | [open record](decisions/open/0055-hover-peek-names-an-entity.md) · [full text](../../history/decisions/0055-hover-peek-names-an-entity.md) |
| 0056 | Card Settings owns entity defaults; runtime-owned fields are read-only. | proposed | [open record](decisions/open/0056-card-settings-owns-defaults.md) · [full text](../../history/decisions/0056-card-settings-owns-defaults.md) |
| 0057 | Fields can compose: rating, group and list. | accepted | [§ Types, fields and views](../reference/architecture.md#types-fields-and-views) · [full text](../../history/decisions/0057-fields-can-compose.md) |
| 0058 | A tour is one document rendered on three surfaces. | accepted | [§ Handbook, tutorials and tours](../reference/architecture.md#handbook-tutorials-and-tours) · [full text](../../history/decisions/0058-a-tour-is-one-document-on-three-surfaces.md) |
| 0059 | A type blueprint is a card, and a kit is a tag. | proposed | [open record](decisions/open/0059-a-type-blueprint-is-a-card.md) · [full text](../../history/decisions/0059-a-type-blueprint-is-a-card.md) |
| 0060 | A card's outline is paint; a rollup collapses it to its header. | partial | [open record](decisions/open/0060-shape-strip-and-rollup.md) · [full text](../../history/decisions/0060-shape-strip-and-rollup.md) |
| 0061 | Three ways to draw a link: connect, thread, web. | accepted | [§ Links and routing](../reference/architecture.md#links-and-routing) · [full text](../../history/decisions/0061-three-ways-to-draw-links.md) |
| 0062 | A link carries no data: it is a fence, not a feature. | accepted | [§ Links and routing](../reference/architecture.md#links-and-routing) · [full text](../../history/decisions/0062-a-link-carries-no-data.md) |
| 0063 | Placement is a mode too: a run of cards, in a shape. | accepted | [§ Boards, sections and placement](../reference/architecture.md#boards-sections-and-placement) · [full text](../../history/decisions/0063-placement-is-a-mode-too.md) |
| 0064 | Two axes — what the canvas is for, and what the next click does. | accepted | [§ Inspector and interaction](../reference/architecture.md#inspector-and-interaction) · [full text](../../history/decisions/0064-two-axes-and-a-cursor-that-says-so.md) |
| 0065 | Accounts own workspaces; invite keys bring people in; billing is open. | partial | [open record](decisions/open/0065-accounts-own-workspaces.md) · relay side settled by [0073](decisions/open/0073-the-control-plane-is-a-separate-process.md), [0074](decisions/open/0074-the-relay-verifies-a-session-jwt-against-jwks.md), [0076](decisions/open/0076-the-owner-key-is-deleted.md) · [full text](../../history/decisions/0065-accounts-own-workspaces.md) |
| 0066 | One modifier vocabulary, and a purpose that explains a selection. | accepted | [§ Inspector and interaction](../reference/architecture.md#inspector-and-interaction) · [full text](../../history/decisions/0066-one-modifier-vocabulary-and-a-purpose-that-explains.md) |
| 0067 | The account is the identity; the key is plumbing. | partial | [open record](decisions/open/0067-the-account-is-the-identity.md) · key as transport settled against it by [0076](decisions/open/0076-the-owner-key-is-deleted.md) · [full text](../../history/decisions/0067-the-account-is-the-identity.md) |
| 0068 | A system workspace authors what workspaces start with. | proposed | [open record](decisions/open/0068-a-system-workspace-authors-what-workspaces-start-with.md) · [full text](../../history/decisions/0068-a-system-workspace-authors-what-workspaces-start-with.md) |
| 0069 | Billing runs on the Stripe plugin; the licence token stays our proof. | superseded | [superseded by 0078](decisions/open/0078-billing-runs-on-the-auth-plugin.md) · [record](decisions/open/0069-billing-runs-on-the-stripe-plugin.md) · [full text](../../history/decisions/0069-billing-runs-on-the-stripe-plugin.md) |
| 0070 | One Postgres control plane, and document bytes never in it. | partial | [open record](decisions/open/0070-one-postgres-control-plane.md) · process boundary settled by [0073](decisions/open/0073-the-control-plane-is-a-separate-process.md), relay reads by [0074](decisions/open/0074-the-relay-verifies-a-session-jwt-against-jwks.md) · [full text](../../history/decisions/0070-one-postgres-control-plane.md) |
| 0071 | Style is derived, not configured. | accepted | [§ Styling and theming](../reference/architecture.md#styling-and-theming) · [full text](../../history/decisions/0071-style-is-derived-not-configured.md) |
| 0072 | An annotation is a card that points into a source. | proposed | [open record](decisions/open/0072-an-annotation-is-a-card-that-points-into-a-source.md) · [full text](../../history/decisions/0072-an-annotation-is-a-card-that-points-into-a-source.md) |
| 0073 | Two processes behind one Caddy: the relay keeps sockets and SQLite; a control plane owns Postgres, Better Auth and Stripe. | partial | [open record](decisions/open/0073-the-control-plane-is-a-separate-process.md) |
| 0074 | The relay verifies a Better Auth session JWT against a cached JWKS, and holds no identity table. | proposed | [open record](decisions/open/0074-the-relay-verifies-a-session-jwt-against-jwks.md) |
| 0075 | Hosted entitlement is minted from the subscription row; self-hosting keeps a signed licence file. | partial | [open record](decisions/open/0075-hosted-entitlement-is-minted-from-the-subscription.md) |
| 0076 | The owner key is deleted; anonymous local use hands over through `onLinkAccount`. | proposed | [open record](decisions/open/0076-the-owner-key-is-deleted.md) |
| 0077 | Sign-up is open; an invitation is an organization feature. | proposed | [open record](decisions/open/0077-sign-up-is-open.md) |
| 0078 | Billing is `@better-auth/stripe`; the custom handler, checkout and store are deleted. | proposed | [open record](decisions/open/0078-billing-runs-on-the-auth-plugin.md) |
| 0079 | Docs and marketing are Astro, docs on Starlight; the app stays a Vite SPA. | proposed | [open record](decisions/open/0079-docs-and-marketing-are-astro.md) |
| 0080 | Local commands are the gate evidence, with a named exit back to CI. | superseded | [open record](decisions/open/0080-local-commands-are-the-gate.md) · superseded by 0098 |
| 0095 | The library is the view surface: a flat rail of saved views beside code-defined system lists. | partial | [record](../../history/decisions/0095-the-library-is-the-view-surface.md) |
| 0096 | A query is an expression tree with a canonical text surface; one tree, two renderers. | partial | [record](../../history/decisions/0096-a-query-is-an-expression-tree-with-a-text-surface.md) · [grammar](../reference/query-language.md) |
| 0097 | The agent runs in a microVM with a private clone, and the MCP servers stay on the host. | partial | [open record](decisions/open/0097-the-agent-runs-in-a-microvm.md) |
| 0098 | The pipeline is a container over a clean export of HEAD; its summary is the deploy gate. | accepted | [open record](decisions/open/0098-the-pipeline-is-a-container.md) |
