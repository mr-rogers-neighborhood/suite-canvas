# ADR-0068: A system workspace authors what workspaces start with

- **Status:** proposed
- **Date:** 2026-10-25
- **Related:** [ADR-0045](./0045-handbook-articles-are-cards.md) (handbook articles are cards), [ADR-0040](./0040-a-board-and-a-section-are-identities.md), [ADR-0038](./0038-a-type-template-is-a-card.md), [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md), [ADR-0065](./0065-accounts-own-workspaces.md), [ADR-0067](./0067-the-account-is-the-identity.md)

## Context

Everything a workspace is born with lives in code today. `WorkspaceDocument.ensureDefaultTypes()` seeds
Note, Concept, Source and the built-in Portal type; the handbook's built-in articles (ADR-0045) are
described as "a workspace seed"; board templates, card templates and the placement defaults all have
their own homes. Changing any of it means a release.

That is fine while one person authors the product and wrong the moment there is a hosted cohort: a
customer with its own vocabulary, a self-host operator with its own onboarding, or an author who wants
the handbook to describe *their* board conventions rather than ours.

The primitives to fix it already exist. A handbook article **is a card**; a type template **is a card**;
a board **is an identity**. So the content is already authorable — what is missing is a place to author
it that is obviously *not* one of the workspaces you work in, and a way to ship what you wrote.

There is also an admin app today (`apps/canvas/src/admin`) which is operations-only: status, rooms,
shares, fixtures, workspaces. It reads server state and mutates none of the document graph.

## Decision

**The system workspace is a workspace.** Same primitives, same canvas, same editor — flagged as the
template source for the workspaces that belong to an organization.

1. **One system workspace per organization, seeded by copy.** At organization creation the system
   workspace is copied from a **deployment template** (a `.suite` file shipped with the build). There is
   no runtime inheritance and no merge chain: the copy is the org's content from then on, and the
   deployment template only matters for the next organization. Dropping back to deployment-only later
   means deleting a copy step, not unpicking a hierarchy.
2. **It holds what a new workspace is born with** — handbook articles (ADR-0045 cards whose subject is a
   `Target`), **blueprints** (board templates), object types with their fields and glyphs, card
   templates, and defaults such as the placement options. Nothing new is invented; every one of those is
   already a card, a type or a board.
3. **Publishing is versioned, and applying is additive.** Publishing snapshots the system workspace as
   a version. Applying a version to a workspace *adds what is missing and changes nothing a person has
   touched* — the rule `ensureDefaultTypes()` already follows, where an existing Portal type is left
   exactly as it is, renames included. A "what would change" diff is shown before applying, and an
   update can be ignored.
4. **Provenance travels with the content.** Seeded entities carry `origin: system` and the
   `systemVersion` that delivered them, so "reseed" can be honest about what it will and will not touch,
   and so a workspace can show *"3 new articles, 1 type gained a field"* rather than a bare button.
5. **A system entity is a template, not a live link.** Applying a version *copies* into the workspace;
   nothing keeps a pointer back. There is no portal into the system workspace, because a live dependency
   would make an org's documentation change under a reader who did not ask, and would make deleting the
   system workspace break theirs.
6. **Blueprints become a shareable bundle.** The same content — types with fields, a board, its cards,
   handbook articles — in one file, installable from the library's **Browse blueprints** entry point.
   Designed here so the panel's output *is* the artifact users trade later; built after the panel.
7. **The admin panel is one surface, not two.** The existing token-gated `/admin` is simplified and
   combined with this: a content canvas tab bound to the system workspace, plus people and organizations
   (`admin` plugin), an **admissions queue** (ADR-0067 §7), and auth audit events. The five debug panels
   collapse into fewer, better-named ones. Two admin surfaces would be two products.
8. **Access is the existing role model.** Owner and admin may author and publish; members may read the
   published result through the workspace it was copied into. No new permission system.
9. **Trust is stated, not assumed.** A deployment that can push content into every workspace can push a
   lie. The mitigations are structural: provenance fields, additive-only application, a visible version,
   and — for self-host — the fact that the operator already holds the documents.

## Consequences

- **Changing the defaults stops being a release.** A new article, a renamed type, a new blueprint
  template is authored in the canvas and published.
- **A customer can document its own vocabulary** and publish it to its own workspaces, which is the
  difference between a product handbook and *their* handbook.
- **The first build is small**: a flag, a seed step, a publish record, provenance fields and a diff.
  Everything expensive (bundles, cross-org sharing, an editor UI for defaults) is additive.
- **Two sources of truth become one.** `ensureDefaultTypes()` keeps its job of making a *fresh* workspace
  valid, but the moment an organization publishes, the published version is what new workspaces copy.
  The code seed and the published version must therefore agree on ids — the code seed is the floor, not
  a competing set.
- **Risk: reseed is a trust surface** and could become a distribution channel for junk. Additive-only
  application and the visible diff are the answer; a "force" mode is deliberately not designed.

## Rejected alternatives

- **Keep seeding from code.** Every content change is a deploy, and a customer can never describe their
  own conventions.
- **Runtime inheritance** (deployment default merged with an org override, forever). The user asked for
  per-organization scope *without* unnecessary complexity, and the complexity is entirely in the merge.
  A copy has the same product outcome and one code path.
- **A live-linked system workspace** (portals into the system boards). Makes documentation mutate under
  readers, and makes deletion catastrophic.
- **A separate document format for system content.** The whole point is that it is authored with the
  same canvas; a second format needs a second editor, a second importer and a second set of bugs.
- **A second admin surface for content.** Two admin surfaces, two token models, two places to look.
- **A "force reseed" that overwrites user edits.** Convenient once, unrecoverable forever.
