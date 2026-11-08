# ADR-0068: A system workspace authors what workspaces start with

- Status: proposed
- Date: 2026-10-25
- Shipped: nothing.
- Remaining: the system-workspace flag, the seed-by-copy step at organization creation, and the
  publication path from a system workspace to its organizations.
- Full text: [archive](../../../../history/decisions/0068-a-system-workspace-authors-what-workspaces-start-with.md)

## Decision

A system workspace is an ordinary workspace flagged as the template source for the workspaces that
belong to an organization. Handbook articles, type blueprints and board templates are authored there
with the same primitives, and a new workspace starts as a copy rather than as a code path.

## Consequences

- Changing onboarding stops requiring a release.
- One more workspace per organization, with the same permissions model as any other.
- Updating already-created workspaces is not covered; the record only promises a starting point.
- Copy-on-create keeps the system workspace from becoming a live dependency of every document.
