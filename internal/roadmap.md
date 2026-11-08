# Roadmap

Suite is built in gate order. Each stage answers a question the previous one could not, and a gate
closes only when an outsider can inspect an artifact for it: a committed file, a test that runs, or a
URL. A verbal "we did that" does not close it. This page records position. The programme documents that argued each stage are history in
[archive/roadmap/](../../history/roadmap), and the reasoning behind individual choices is
[decisions.md](decisions.md).

## The stages, and why this order

| Stage | The question | What it may ignore |
| --- | --- | --- |
| Alpha | Could the team use it daily without losing work? | Other machines, other browsers, other operators, money |
| Beta | Could a stranger use it, and recover, with limits we publish? | Growth, organisations, ecosystem, encryption |
| V1 | Could more than one person own it: accounts, invitations, billing, scale? | Third-party extension, mobile as a commitment |
| V2 | Could it become a platform and a supported product? | Nothing; the deferred list lands here |

A claim cannot be tested before the thing it depends on exists. "A stranger recovers their work" is
unanswerable while the document layer can still lose a write, and "an organisation administers
members" is unanswerable while one workspace is the only unit of ownership. Built in the other
order, the product collects features that cannot be evidenced, which is the failure this page is
here to make visible.

Stages inherit open gates instead of resetting them. Alpha's durable-store, multi-tab and upgrade
gates are Beta's preconditions, which is why they are still listed. The
[crosswalk](#which-alpha-gate-lands-in-which-beta-gate) maps the two alphabets. Narrowing is also a
feature: a small claim with evidence beats a large claim with an assertion, and that is why "Not in
Beta" is a section of this page.

## What Beta means here

Beta is a trust claim. A stranger with no relationship to the operator and no ability to read the
source can use Suite for real work, and every failure they can reach is handled or published as a
known limit. Suite is in Beta, the release line it ships on, at version `0.2.0-beta.1`, and the
stage is open: of eleven Beta gates, one is closed, one is blocked, two have not been started, and
seven are measuring.

Beta carries no support contract, no migration guarantee beyond N−1 and no encryption. Documents,
backups and projections are plaintext, and the operator can read all of it. What it does promise is
checkable: the work can be exported, and each ceiling is published with a predictable failure at the
boundary.

## Current position

| | |
| --- | --- |
| Stage | V1 (release line `1.1.0`, tagged `v1.1.0`) |
| Version | `1.1.0`; the next tag is the one that follows a deployed `app.suite.run` |
| Alpha gates | superseded by the V1 set; `A3` retired with CI |
| Beta gates | superseded by the V1 set; `B1` retired with CI |
| Evidence source | local commands, not workflows |

Two things changed the gate model on 2026-10-26 and both are recorded as decisions rather than
silent edits. GitHub Actions has never produced a job on this repository, so `A3` and `B1` were
retired rather than left blocked forever: every gate now names the local command that proves it
(ADR-0080). And the owner key was deleted outright instead of being migrated, which moves recovery
from an operator ceremony into identity (ADR-0076).

Three rows below that were true when written and are not true now, so read them as history rather
than status: `B3` says there is no checkout surface (`@better-auth/stripe` shipped, ADR-0078), `B6`
still describes the owner key and recovery words (deleted, ADR-0076), and the operator surface no
longer has a token (`SUITE_ADMIN_EMAILS` and a session instead). The gate *claims* still hold; the
evidence sentences attached to them had aged. The [V1 gate table](#v1-gates) below is the current one.

The V1 requirement set is the acceptance list, not this page. What this page tracks is which of
those requirements has an artifact. See [v1.md](history/roadmap/v1.md) for the numbered rows and
[decisions.md](decisions.md) for the reasoning behind each fork.

## What shipped

The product loop works. The evidence around it is what Beta is for.

| Area | Where it lives |
| --- | --- |
| Typed object graph | `packages/graph/src/schema.ts`, `packages/graph/src/loro/WorkspaceDocument.ts` |
| Collaborative canvas | `apps/canvas/src/canvas/CanvasBoard.tsx`, `SectionLayer.tsx`, `PortalCard.tsx` |
| Card editors | `apps/canvas/src/editor/`, [ADR-0004](../../history/decisions/0004-node-content-and-presence.md) |
| Local-first persistence | `apps/canvas/src/collab/loroPersistence.ts`, `apps/canvas/src/storage/durability.ts`, [ADR-0024](../../history/decisions/0024-multi-tab-persistence-and-leader-election.md) |
| Relay | `apps/collab-server/src/server.ts`, `store/`, `projection/`, `http/` |
| Retrieval | `packages/graph/src/views.ts`, `references.ts`, `search.ts` |
| Portability | `packages/graph/src/workspaceFile.ts`, `packages/graph/src/portable.ts` |
| Accounts, partial | `apps/canvas/src/auth/`, `services/auth/sql/`, [ADR-0065](decisions/open/0065-accounts-own-workspaces.md) |
| Handbook and tours | `packages/graph/src/tutorial.ts`, [ADR-0045](../../history/decisions/0045-handbook-articles-are-cards.md) |
| Docs that check themselves | `scripts/docs-check.mjs`, `scripts/generate-limits.mjs`, `docs/reference/limits.md` |

## How a gate closes

| Status | Means |
| --- | --- |
| `open` | The artifact exists and is reachable |
| `measuring` | Some evidence exists, and a named piece does not |
| `unopened` | No work has started on the artifact |
| `blocked` | The artifact cannot be produced from this tree |
| `deferred` | Moved out of the stage, with a destination |
| `failed` | Still unopened or measuring across two consecutive release candidates |

A failed gate is cut or moved, never renamed. Gate IDs stay stable because the archive, the release
procedure and this page all cite them, so a row keeps its letter and number even when its scope
narrows.

The Beta declaration is itself an artifact: a tagged commit plus one page that links the eleven gate
artifacts, the published limits, the known limitations and the command that self-hosts the same
build. Until that page exists, the stage sits where the tables below say it does, whatever the
version string reads.

## Alpha gates

Alpha asked whether the team could use the product without losing work. These gates are what Beta
inherited; the programme document with their original wording is
[alpha.md](../../history/roadmap/alpha.md).

| Gate | Claim | Status | Evidence, or what is missing |
| --- | --- | --- | --- |
| A1 | Attachments, settings and licence state are durable | `open` | Every store points at `/data` in `compose.yaml`, and `SUITE_REQUIRE_DURABLE_STORES=1` makes boot refuse an unset, `:memory:`, relative or split layout; backup, restore and `deploy/drills/attachments-record.md`. |
| A2 | Multi-tab persistence cannot delete a peer's work | `open` | `apps/canvas/src/collab/loroPersistence.ts` with two-instance and leader-takeover tests; ADR-0024. |
| A3 | CI actually gates `main` | `blocked` | Not a code problem: every run is `startup_failure` with zero jobs (re-checked 2026-10-26), in this repo and a second one. The local gate is published in the release how-to. It unlocks with repo entitlement, billing or a self-hosted runner. |
| A4 | The product has an identity | `measuring` | `LICENSE`, `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` exist; the semver tag and the release page do not. |
| A5 | Billing is durable or explicitly closed | `open` | Closed path: the app has no checkout, `services/billing/src/handler/handler.ts` refuses an unsigned request, and a durable store sits behind `SUITE_BILLING_STORE`; see `docs/reference/billing.md`. |
| A6 | The client can fail without losing the page | `open` | `apps/canvas/src/shell/ErrorBoundary.tsx` and its test, `storage/durability.ts`, the grant state in `sharing/StoragePanel.tsx`, and an opt-in crash hook in `crash/`; ADR-0025, ADR-0027. |
| A7 | An old document opens in a new build | `open` | `apps/collab-server/src/store/persistence.ts`, N−1 fixtures in `apps/collab-server/src/fixtures/n-1/`, and `store/storeUpgrade.test.ts`. |
| A8 | The docs tell the truth | `open` | `scripts/docs-check.mjs` fails on dead links, retired names and version drift. The check is wired into CI, and that half has never executed (A3). |
| A9 | The limits are published | `open` | `scripts/generate-limits.mjs` writes `docs/reference/limits.md` from the constants, and `--check` fails when the page is stale. Evidence that the numbers hold under load is `B9`. |
| A10 | Both reported UX bugs are closed | `open` | Marquee ownership is fixed and both former `fixme` cases are real specs; local easing is render-only with one commit per drop (`apps/canvas/src/canvas/CanvasBoard.tsx`, `localEasing.ts`). |
| A11a | Real portals in a derived scene | `deferred` | The live scaled instance belonged to a scene surface that has been removed. A portal is a doorway again: a card with a `board` field, a miniature and a camera transition, on an unchanged data model. |
| A11b | Fractal layout presets | `closed` | The planner was cut with `packages/scene`. What survives is graph-owned: `packages/graph/src/layoutPlan.ts` commits one plan as a single undoable batch. |

The Alpha core surface ledger runs past A11 to A44 (connections, boards and tabs, sketches, arrange,
views, the handbook, annotations, the account gates) with its own shipped and in-flight states. It is
recorded only in [alpha.md](../../history/roadmap/alpha.md), because those rows move faster than this
page should.

## Beta gates

Beta asks whether a stranger can use the product and recover from it. These eleven gates are the exit
criteria; the programme document with their full acceptance text is
[beta.md](../../history/roadmap/beta.md).

| Gate | Claim | Status | Evidence, or what is missing |
| --- | --- | --- | --- |
| B1 | CI executes and gates `main` | `blocked` | The workflows are valid and ready. No run has produced a job, so there is no green run URL and no red-commit demonstration. The cause is account entitlement. |
| B2 | Release identity exists | `measuring` | The identity files are present. Missing a `v*` tag, a release page with upgrade notes, and a version that matches the declaration. |
| B3 | Money is durable, or billing is closed | `open` | Closed by design: no checkout surface, a handler that refuses unsigned requests, and a durable store behind `SUITE_BILLING_STORE`. `README.md` and `docs/reference/billing.md` both say hosted billing is not open; both still add "for the alpha", which is wording that lags the stage. |
| B4 | Data durability, server and client | `measuring` | Attachments drill record, backup and restore, two-tab compaction tests, error-boundary test, storage grant state. Missing a named quota-exceeded test and an assertion of the documented offline scope. |
| B5 | Upgrade path | `measuring` | N−1 fixtures, `storeUpgrade.test.ts`, `busy_timeout`, unknown-snapshot rejection. Missing a written N−1 policy statement. |
| B6 | Recovery is explainable, and normal when accounts exist | `measuring` | Owner key, recovery words, the `owner-recovery` and `recovery-words` e2e specs, claim-on-sign-in. Missing a device list with revoke, and an authorization test for a member acting across workspaces. |
| B7 | The supported browser set is tested | `unopened` | Playwright runs one project (Chromium). Missing Firefox and WebKit smoke, an iOS pass, and a written mobile in-or-out decision linked from the limits page. |
| B8 | Observability a stranger can use | `measuring` | `apps/canvas/src/shell/diagnostics.ts`, redacting crash consent and report. Missing an in-app support contact or a status page. |
| B9 | Scale evidence and published limits | `measuring` | The limits page is generated and drift-checked. Missing a load-test artifact that names the hardware and records event-loop lag, RSS and rebuild time. |
| B10 | Security and docs truth | `measuring` | `docs/reference/security-model.md`, `corsAllowlist.test.ts`, the docs check. `Dockerfile` still has no `USER`, and there is no SBOM or audit artifact. |
| B11 | A second operator can restore the release from the docs alone | `unopened` | `deploy/drills/` holds the attachments record only. `operator.sh`, a transcript naming a second operator and an empty questions ledger do not exist. |

B1 gates everything: every other gate's evidence comes from a run, a tag or a drill, and nothing
produced while no job executes can be trusted. B2 to B10 can run in parallel once B1 is green. B11 is
last because it exercises what the others produced.

Two gate rows deserve a plain reading. B6 is the one place where the choice of branch changed the
artifact: taking the account branch moves recovery into identity, so the gate now checks a claim
flow and an authorization boundary instead of an operator key ceremony. B4 is the widest row, and
the two missing pieces are assertions about existing behaviour, which makes it the cheapest open
gate to close.

### Which Alpha gate lands in which Beta gate

Most Beta gates repeat an Alpha claim, hardened for a stranger, which is why the earlier work still
matters here.

| Alpha | Beta exit gate | What changes |
| --- | --- | --- |
| A1, durable stores | B4 | Add a quota test and a stated offline scope, in addition to the recreate drill |
| A2, multi-tab safety | B4 | Same claim, with two tabs as a supported workflow |
| A3, CI gates `main` | B1 | Identical; still blocked |
| A4, release identity | B2 | Add the tag and the upgrade notes |
| A5, billing durable or closed | B3 | Closed path chosen; the gate is the public statement |
| A6, client durability | B4 | Add the offline-scope assertion |
| A7, N−1 upgrade | B5 | Add the written policy the tests implement |
| A8, docs truth | B10 | Add the security artifacts in the same gate |
| A9, limits published | B9 | Add the load test that proves the numbers |
| A10, UX bugs | none | Regression only; e2e covers it, and Beta has no separate gate |
| A11a, A11b | none | Deferred or cut; no Beta dependency |

## Next work, in dependency order

The V1 exit is a deployed `app.suite.run` whose paid door works, so the list below is what stands
between the tree and that launch rather than the Beta gate list. Each row names the artifact that
closes it.

| # | Work | Artifact that closes it | Depends on |
| --- | --- | --- | --- |
| 1 | The paid door: anonymous checkout, a `pending_checkout` row, and a webhook that creates the account, organization and membership, then mails a magic link | ADR-0083's remaining list, and an e2e that buys with a sandbox coupon and signs in | nothing; needs the sandbox keys, which exist |
| 2 | Close the sign-up form (`disableSignUp: true`) once 1 works, so an account is only born from a payment | a spec that the form refuses and a paid session still resolves | 1 |
| 3 | The local Compose stack green: Postgres control plane, relay, docs, Stripe webhook forwarding, and the mail transport actually delivering | `docker compose --profile docs up` from a clean host, with `/health`, `/metrics` and one sign-in | 1, because the variables change with it |
| 4 | The AWS runbook for `app.suite.run`: EC2 + EBS + Caddy, RDS, DNS-only on Cloudflare, secrets, first operator, restore drill | a second operator running it, and their questions closed in `docs/how-to/deploy.md` | 3 |
| 5 | Write the N−1 policy: what is guaranteed, for how long, and what happens to unknown data | a statement in `docs/reference/`, with the tests it describes | nothing |
| 6 | The offline scope in one sentence, asserted in a test, plus a quota-exceeded test | two tests and one sentence | 5 |
| 7 | A support route in the app and a status statement beside it | `apps/canvas/src/feedback/` gaining the route | nothing |
| 8 | A load-test artifact at the published limits, naming hardware and recording lag, RSS and rebuild time | one committed run | 6, because the limits must be stable first |
| 9 | Container as non-root, SBOM and audit result published | `Dockerfile` and one committed artifact | nothing |
| 10 | Firefox and WebKit smoke, one recorded iOS pass, and the mobile in-or-out decision | three specs and a decision record | nothing |

Rows 5, 7, 9 and 10 have no prerequisite, which is where an operator with an idle hour should start.
No row carries a date, because none of those estimates would survive contact with the work.

CI is not on this list. `A3` and `B1` were retired with the answer that local commands are the gate
(ADR-0080), and re-opening them is a decision rather than a task.

Two limits are recorded rather than scheduled, because each is a design decision with a published
consequence and neither blocks a launch. The relay's session JWT lives five minutes, so removing a
member from an organization leaves their open socket writable for up to that long (ADR-0074); an
enterprise tenant will want a disconnect channel, which needs the relay to reach the control plane on
a room's behalf and is therefore a change to the process boundary, not a timeout. And an unclaimed
workspace is reachable by whoever holds its id, which
[ADR-0084](../decisions/open/0084-a-device-key-adopts-an-anonymous-workspace.md) closes with a key the
browser holds.

## Not in Beta

Each item is deferred with a destination. The full list and its argument are in
[`beta.md` section 8](../../history/roadmap/beta.md#8-not-in-beta); the destinations are the
[V1](../../history/roadmap/v1.md) and [V2](../../history/roadmap/v2.md) programme documents.

| Deferred | Why not Beta |
| --- | --- |
| Internationalisation | Every string is English; translating is a surface-wide change and a support obligation |
| End-to-end encryption | No key directory or device trust, so encryption before identity produces unrecoverable-data cases |
| Card-document split | The benchmarks do not demand it yet, and the split has to stay a storage change. A review raised it again against the whole-workspace document: a workspace is one Loro document, so the relay and the browser hold all of it to project any of it. That is the cost this row defers, and it is a storage change rather than a schema one. |
| Multi-replica | Rooms, presence, projection and rate limits are single-process truth, so it needs leases; a configuration flag will not do |
| Plugin API and marketplace | Both would freeze the object model before it stabilises, and neither has a trust model |
| Version history and time travel | Undo exists; history is a storage and retention project of its own |
| Comments and threads | Attribution needs identity, which Beta only begins to add |
| Importers (Markdown, Notion, Heptabase) | Each is a parser, a mapping and a fidelity promise |
| Mobile as a supported platform | Beta decides the question; support is a separate commitment |
| Encrypted backups | Operator-readable backups are the support model here |

The test for this list is not sentiment. If an item moves into Beta, something else leaves or a gate
slips, because Beta's value is the narrowness of the claim.

## Where the rest is

- Why a choice was made: [decisions.md](decisions.md) has one line per record with the full argument
  linked. Read it before proposing a change of direction.
- The programme documents: [archive/roadmap/](../../history/roadmap) holds alpha, beta and the V1 and
  V2 plans in full, including the drift ledgers that record what was wrong when each was written.
  They are correct for their date. Treat them as history.
- The facts behind the claims: [reference/architecture.md](../reference/architecture.md) has the
  layer map and data flow, [reference/limits.md](../reference/limits.md) has every quota and its
  variable, and [reference/security-model.md](../reference/security-model.md) has what the relay can
  see.
- The design the gates protect: [design.md](design.md) says what the product is for, so a gate can be
  judged against it instead of against a checklist.

## Keeping this page honest

Re-read the statuses at every release candidate, against the commit being released. The last look
somebody took is not evidence. The rows above were checked against the tree on 2026-10-26, and the
counts under "Current position" derive from the tables, so they move with them.

Write down the piece that is missing. "Measuring" with a named missing artifact is useful; "mostly
done" is not a status. When a gate is cut or its scope narrows, the row says so and the archive keeps
the earlier claim. A gate that fails twice in a row is a planning failure, and the honest response is
to move the work and leave the goal where it is.

### What would change this page

- CI going green and billing becoming durable would move two rows toward closure. The rows stay, with
  the artifact linked, because the archive is the only place a claim is allowed to disappear.
- A stranger self-hosting from the docs without asking a question turns B11 from unopened into
  evidence, and B11 is the last row to close.
- A measured memory ceiling well below the current assumption would move the published limits and
  could change the Beta scope itself.
- A data-loss report after Beta entry reopens A1 and B4 as stop-the-line work, in the same change as
  the evidence.
