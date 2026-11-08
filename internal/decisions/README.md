# Architecture decision records

One decision per record, written once and then left alone. A later record supersedes it, and the old
one says so in its status line.

## Policy

- **One decision, one file.** `NNNN-a-decision-in-a-few-words.md`, four digits, zero-padded.
- **A record is immutable.** Do not edit it to match today: write a successor and link both ways.
- **Status** is `proposed`, `partial`, `accepted` or `superseded`. A `partial` record carries a
  `Shipped:` line and a `Remaining:` line; a superseded record names its successor.
- **New and open records stay terse:** at most 40 lines, the shape in [TEMPLATE.md](TEMPLATE.md).
- **Acceptance folds the decision into the current page.** The outcome belongs in
  [reference/architecture.md](../../reference/architecture.md) and the one-line summary in
  [explanation/decisions.md](../decisions.md); the full text moves to
  [archive/decisions/](../../../history/decisions).
- **Never renumber and never delete.** A withdrawn proposal leaves a gap, and the gap is recorded once
  below.

## Open and partial records

Only records with work still outstanding live here. Everything else is archived.

| ADR | Decision | Status |
| --- | --- | --- |
| [0049](open/0049-a-mind-map-mode-and-patterns.md) | A mind-mapping gesture, and patterns as reusable layout recipes | partial |
| [0055](open/0055-hover-peek-names-an-entity.md) | Hover-peek names an entity anywhere | proposed |
| [0056](open/0056-card-settings-owns-defaults.md) | Card Settings owns entity defaults | proposed |
| [0059](open/0059-a-type-blueprint-is-a-card.md) | A type blueprint is a card, and a kit is a tag | proposed |
| [0060](open/0060-shape-strip-and-rollup.md) | Shape and rollup | partial |
| [0065](open/0065-accounts-own-workspaces.md) | Accounts own workspaces | partial |
| [0067](open/0067-the-account-is-the-identity.md) | The account is the identity | partial |
| [0068](open/0068-a-system-workspace-authors-what-workspaces-start-with.md) | A system workspace authors what workspaces start with | proposed |
| [0070](open/0070-one-postgres-control-plane.md) | One Postgres control plane | partial |
| [0072](open/0072-an-annotation-is-a-card-that-points-into-a-source.md) | An annotation is a card that points into a source | proposed |
| [0073](open/0073-the-control-plane-is-a-separate-process.md) | The control plane is a separate process from the relay | partial |
| [0074](open/0074-the-relay-verifies-a-session-jwt-against-jwks.md) | The relay verifies a session JWT against JWKS | proposed |
| [0075](open/0075-hosted-entitlement-is-minted-from-the-subscription.md) | Hosted entitlement is minted from the subscription row | partial |
| [0076](open/0076-the-owner-key-is-deleted.md) | The owner key is deleted | proposed |
| [0077](open/0077-sign-up-is-open.md) | Sign-up is open, and an invitation is an organization feature | superseded |
| [0078](open/0078-billing-runs-on-the-auth-plugin.md) | Billing runs on the auth plugin | proposed |
| [0079](open/0079-docs-and-marketing-are-astro.md) | Docs and marketing are Astro, docs on Starlight | proposed |
| [0080](open/0080-local-commands-are-the-gate.md) | Local commands are the gate evidence | partial |
| [0081](open/0081-a-self-host-licence-arrives-in-the-environment.md) | A self-host licence arrives in the environment | accepted |
| [0082](open/0082-hosted-plans-sell-one-seat.md) | Hosted plans sell one seat | partial |
| [0083](open/0083-the-account-is-created-by-paying.md) | The account is created by paying | partial |
| [0084](open/0084-a-device-key-adopts-an-anonymous-workspace.md) | A device key adopts an anonymous workspace | proposed |
| [0094](open/0094-a-video-mark-is-a-span-of-time.md) | A video mark is a span of time | proposed |
| [0099](open/0099-the-relay-is-a-daemon-with-a-ui.md) | The relay is a daemon, and the hub is one of its hosts | proposed |

[0069](open/0069-billing-runs-on-the-stripe-plugin.md) is superseded by
[0078](open/0078-billing-runs-on-the-auth-plugin.md) and keeps its text here until the archive move.

## Accepted, superseded and full texts

| Where | What |
| --- | --- |
| [explanation/decisions.md](../decisions.md) | One row per ADR, with its status and where it lives now |
| [archive/decisions/](../../../history/decisions) | Every full text: accepted, superseded, and the long version of the open records |
| [reference/architecture.md](../../reference/architecture.md) | What the accepted decisions added up to, as the code stands today |

An accepted record is history: it stays correct about the decision that was taken even where an engine
or a name has since changed. `scripts/docs-check.mjs` exempts `archive/` and `decisions/` from
current-truth checks for that reason.

## Numbering

Numbers are allocated in order and are never reused. `0001`, `0013`, `0030` and `0032–0036` were never
written, or were removed with the scene surface. The gaps are intentional; nothing is renumbered to
close them.

## Writing one

Copy [TEMPLATE.md](TEMPLATE.md). Put a proposal under discussion in [`open/`](open); it only moves to
the archive once it is accepted — a terse record stays here while any part of it is outstanding.
