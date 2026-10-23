# Beta — strangers can use it with known limits

- **Status:** living document. It records the Beta contract and the evidence required to claim it.
- **Stage:** entry requires Alpha gates A1–A10; exit requires Beta gates B1–B10.
- **Provenance:** the 2,544-line audit and design discussion, re-checked against the tree containing
  [ADR-0019](../decisions/0019-references-not-typed-links.md) through
  [ADR-0023](../decisions/0023-selection-projections.md). ✅ claims were checked against this tree;
  ◐ claims need re-verification.
- **Related:** [Alpha](./alpha.md) · [V1](./v1.md) · [V2](./v2.md) ·
  [ADR-0020](../decisions/0020-main-and-loro-plan-of-record.md) ·
  [design-inspirations.md](../design-inspirations.md) · [architecture.md](../architecture.md) ·
  [operations.md](../operations.md) · [billing.md](../billing.md) ·
  [security-model.md](../security-model.md) · [testing.md](../testing.md)

## How to read this document

Beta is a stage gate, not a feature release. It adds little product surface; it proves that what
already exists survives a user who is not the operator.

- **No dates, durations, or effort estimates are used.** Sequencing is by gate, dependency, and
  evidence artifact.
- **The tree moves.** Open a cited path before acting on a claim. ✅ means verified at the check
  date, not permanently.
- **Markers:** ✅ verified in this tree; ◐ audit-reported and needs re-verification; ○ decision or
  hypothesis.
- **Gate rule:** a gate is open only when its evidence artifact is linked. Discussion does not close
  a gate.
- **Terms:** gate, trigger, artifact, bet, plan of record, and marker are defined in
  [alpha.md §Terms](./alpha.md#terms).

### Scope boundaries

- In scope: durability, upgrade, identity, billing, client resilience, browser coverage, scale
  evidence, security review, support, and published limits.
- Out of scope: new product surface. Beta adds almost no features.
- Not a schedule. The only numbers here are limits, defaults, and measured results.

---

## 1. Definition and entry

### 1.1 Definition

> **Beta: a stranger, with no relationship to the operator and no ability to read the source, can use
> Suite for real work, and every failure mode they can reach is either handled or published as a
> known limit.**

| Term | Meaning |
| --- | --- |
| **Stranger** | Not the team. The app must survive hardware, browsers, and storage the operator does not control. |
| **Real work** | A workspace the user would be upset to lose, on a device that may close and a network that may drop. |
| **Known limits** | Published ceilings for workspace size, attachment budget, open rooms, and concurrency, with predictable failure at each boundary. |

### 1.2 Beta is a trust claim

Beta is not a feature count. It requires four artifacts:

1. **Proof that tests ran.** A green, required check on the deployed commit.
2. **Proof that data survives.** An attachment on disk after a container recreate; two tabs that do
   not delete each other's edits; an old document that opens.
3. **Proof that failures are bounded.** A published limit, a load test at that limit, and documented
   behaviour at the boundary.
4. **Proof that a stranger recovers.** One screen that explains what they hold, what happens if they
   lose it, and what the operator will and will not do.

If any of these is missing, the stage is Alpha. Per the audit, the product loop is Beta-ish and the
evidence is Alpha. ◐ (audit §"Stage scorecard")

### 1.3 Entry: Beta entry is Alpha exit

Beta inherits the Alpha gates. The table below records what Beta needs from each gate; it does not
redefine them.

| Alpha gate | Beta dependency | If it is not closed |
| --- | --- | --- |
| A1 — attachments, settings, and licence state durable | Every Beta user may upload an image; hosted entitlement must survive restart | Container recreate loses files or entitlement; Beta is a data-loss stage |
| A2 — multi-tab compaction cannot delete another tab's edits | Beta users open two tabs by default | Silent offline data loss under a supported workflow |
| A3 — CI executes, green on `main`, branch protection | Every Beta claim of "tested" | No evidence exists for any other gate |
| A4 — release identity (licence, `SECURITY.md`, `CHANGELOG.md`, tag) | A stranger must know what they are running and what they may do with it | "Free and open source" is legally unbacked; no version to support |
| A5 — billing either durable or publicly "not open" | Beta must not take money it cannot record | Charging for a service whose ledger is a `Map` |
| A6 — client durability minimum (persist, error boundary, crash signal) | Beta runs on machines we do not control | Blank screens with no diagnostic; eviction with no warning |
| A7 — N−1 upgrade test for stored documents and databases | Beta ships to people who already have documents | Upgrade becomes a silent corruption event |
| A8 — docs truth pass | Beta's limits page is a document | The published limits contradict the code |
| A9 — published capacity limits | Beta needs a boundary it can defend | The first large workspace becomes an outage, not a limit |
| A10 — both reported UX bugs closed (marquee, local smoothing) | Beta is judged on interaction quality as well as correctness | A page-breaking interaction ships to strangers |

**Decision (○):** Beta entry is declared only when A1–A10 each have an evidence artifact linked from
[alpha.md](./alpha.md), and the commit those artifacts describe is the commit tagged for Beta.

**Decision (○):** Beta takes the capability-link branch. Accounts are optional and may not ship in
Beta; Better Auth is a V1 requirement (V1-9 through V1-12). If accounts are pulled into Beta, B6 uses
the account branch and the operator-recovery procedure is retired. Beta does not claim both.

#### Gate crosswalk

The three documents use different gate alphabets. This table is the canonical mapping; other
documents refer to it rather than renumbering.

| Alpha gate | Beta exit gate(s) | V1 acceptance |
| --- | --- | --- |
| A1 — attachments, settings, licence durable | B4 | V1-1, V1-6, V1-7, V1-14 |
| A2 — multi-tab compaction | B4 | V1-2 |
| A3 — CI gates `main` | B1 | V1-34 |
| A4 — release identity | B2 | V1-36 |
| A5 — billing durable or closed | B3 | V1-14, V1-15, V1-17 |
| A6 — client durability | B4 | V1-3, V1-4, V1-23 |
| A7 — N−1 upgrade | B5 | V1-5, V1-8 |
| A8 — docs truth | B10 | V1-35 |
| A9 — published capacity limits | B9 | V1-19, V1-20, V1-22 |
| A10 — UX bugs closed | — (regression covered by e2e) | — (closed in Alpha) |
| — | B6 — recovery | V1-9, V1-10, V1-11, V1-12 |
| — | B7 — browser matrix | V1-34 (cross-browser check) |
| — | B8 — observability and support | V1-13, V1-23, V1-24, V1-25 |
| — | B9 — scale evidence | V1-18, V1-19, V1-20, V1-21, V1-22 |
| — | B10 — security and docs | V1-26, V1-27, V1-28, V1-29, V1-30, V1-31, V1-32, V1-35 |

### 1.4 What Beta does *not* mean

- Beta is **not** "production-ready". It is "safe enough to trust with work you can export".
- Beta is **not** a support contract. Self-service and published limits replace a promise of
  availability.
- Beta does **not** imply a migration guarantee beyond N−1. It implies that the N−1 path is *tested*.
- Beta does **not** imply encryption. Backups, documents, and projections are plaintext; the operator
  can read everything. That must be on the known-limitations page in plain language.

---

## 2. Thesis and scope

### 2.1 The Beta thesis

> **Local-first, single-node, capability-linked collaboration is a complete product for a small team
> — and a stranger should be able to adopt it without an account, without a sales call, and without
> trusting us with anything they cannot export.**

Beta is intentionally narrow: it states what the product is before accounts exist, so that adding
accounts later is an option rather than a rewrite.

### 2.2 In scope for Beta

| Decision | Beta position | Why now |
| --- | --- | --- |
| **Single node** | One relay process, one SQLite data directory, published limits | Multi-replica is a v1.1-class project; adding it now would be a rewrite ([ADR-0020](../decisions/0020-main-and-loro-plan-of-record.md), [operations.md §Known gaps](../operations.md)) |
| **Local-first default** | The document in the browser is the source of truth; the relay persists and authenticates | Already true; Beta must make the client side of that claim durable |
| **Capability links** | Owner link, editor/viewer tokens, board/card/selection projections stay anonymous bearer capabilities | Shipped and coherent ([ADR-0022](../decisions/0022-share-projection-links.md), [ADR-0023](../decisions/0023-selection-projections.md)); giving them up would be a product regression |
| **Optional accounts** | Anonymous stays the default; an account is an *optional ownership layer* for recovery, devices, and paid sync | Fixes the worst support scenario — "I lost my browser and my file, and whoever opens the link first owns my workspace" |
| **Hosted paid + self-host parity** | One architecture, one image family, feature-flagged account service | The editions table is a product promise; a tier-specific document architecture would fork the test matrix |
| **One Loro document per workspace** | No index/card split in Beta | 5,000 cards ≈ 12 MB, ~25 ms export ◐; the split is an evidence-triggered v1/v2 decision |
| **Postgres for the control plane only** | Arrives *with* Better Auth, not before; document BLOBs stay opaque | Better Auth needs `users`/`sessions`/`accounts`/`verifications`; once that exists, licences/usage/audit belong beside it ○ |

### 2.3 Explicitly out of scope for Beta

| Not in Beta | Why not | Where it lives |
| --- | --- | --- |
| **Multi-replica** | Rooms, presence, projection state, and rate-limit counters live in one process; SQLite is local | [V1](./v1.md) topology ladder T0→T4; [V2](./v2.md) Bet F |
| **End-to-end encryption** | No accounts, no key directory, no device trust; E2EE before identity creates a support burden | [V2](./v2.md) Bet G, if ever |
| **Full mobile support** | One `max-width: 640px` rule in the stylesheet; touch gestures unscoped | Beta decides **in or out**; full support is [V2](./v2.md) Bet G |
| **i18n** | All strings are hardcoded English | [V2](./v2.md) Bet G |
| **Index/card document split** | Benchmarks do not demand it; the split is a storage change behind `DocumentStore` | [V1](./v1.md) / [V2](./v2.md) Bet F |
| **Plugin API, marketplace, comments, version history, importers** | Each is a product surface with its own trust and test cost | [V2](./v2.md) |

### 2.4 Target topology at the end of Beta

```
                        ┌──────────────────────────────┐
   stranger's browser ──┤ Caddy (TLS, CSP, no-referrer)│
                        └───────┬───────────────┬──────┘
                                │               │
                    /api/auth/* │               │ /api/*, /ws
                                ▼               ▼
                     ┌─────────────────┐  ┌──────────────────────────┐
                     │ Auth service    │  │ Collab server (1 process)│
                     │ Better Auth     │  │ rooms · presence         │
                     │ own database    │  │ projection worker        │
                     │ JWKS endpoint   │  │ rate limits              │
                     └────────┬────────┘  └───────────┬──────────────┘
                              │                       │
                     auth DB (≈ small)      documents / shares / workspaces
                                            settings / licences / attachments
                                            (all under /data, all in backup)
```

Beta's only topology change is the additional auth process: one auth service, one auth database,
one JWKS endpoint, and `workspace_members` as the authorization table. The document plane does not
move. ○ (audit §"Better Auth in parallel is the right shape")

**Non-negotiable:** the standalone edition never requires an account, and a self-host can run with
the auth service absent. Accounts are a hosted-edition capability behind a flag.

---

## 3. P0 Beta blockers

Eight blockers stand between the current tree and the Beta claim. Each one is a **trust** blocker,
not a feature gap. The pattern below is repeated for each: status, why it blocks, the fix, and the
evidence that closes it.

### 3.0 Summary

| # | Blocker | Current status | Gate |
| --- | --- | --- | --- |
| P0-1 | CI has never executed a job | ✅ 21 runs, all `startup_failure`, 0 jobs | B1 |
| P0-2 | No release identity | ✅ no `LICENSE`/`SECURITY.md`/`CHANGELOG.md`/`CONTRIBUTING.md`, `0.1.0`, 0 tags, 0 releases | B2 |
| P0-3 | Billing cannot take money | ✅ process-local store; docs say it **must** be replaced | B3 |
| P0-4 | Local-first durability incomplete | ✅ no service worker, no `navigator.storage.persist()`, no quota UX, no error boundary | B4 |
| P0-5 | Single-node hard ceiling | ✅ one process owns rooms/presence/projection/rate limits; SQLite local | B9 |
| P0-6 | Browser matrix is one engine | ✅ Chromium only in Playwright and CI | B8 |
| P0-7 | Schema evolution has no tested path | ✅ schema version stamped to current on open; no migration/backfill | B5 |
| P0-8 | No freeze point | ◐ audit saw 49 modified files; ✅ today the tree is clean but nothing is tagged | B1, B2 |

---

### P0-1 — CI has never executed a job

**Status.** ✅ Every workflow run in the repository concludes `startup_failure`: the audit counted
19 and a re-check on 2026-10-23 counted 21, and each lasts 0s. The runs span the whole history of `main`, from
the first feature push to the latest commit, and the registered `CI` workflow has never completed.
◐ Zero jobs per run is audit-reported. The YAML is valid — `actionlint` exits 0 against
`.github/workflows/ci.yml` ◐ — and the failure predates the current workflow content, which points
at the account or repository level rather than a YAML bug: the audit observed other private
repositories on the same account failing identically. ◐

The workflow that *would* run is real and well-shaped: jobs `quality` (lint, typecheck, unit,
billing, coverage report, story tests, build), `mutation`, `e2e` (Playwright), and `image` (runtime
image to GHCR). ✅ `.github/workflows/ci.yml:18-19,77-78,111-112,142-143`

**Why it blocks Beta.** Every other gate in this document is "we tested X". A stranger has no reason
to believe any of it while no commit has ever been gated. The repo's own README, testing doc, and
mutation reports describe a quality culture that has never been executed in public. That is the
smallest trust failure to fix and the most costly to leave unresolved.

**Fix.**

1. Diagnose the startup failure at the account/repo level (Actions permissions, billing/plan state,
   workflow registration). The YAML is not the suspect.
2. Run `quality` and `e2e` to green on `main`, then make them **required** checks.
3. Add branch protection on `main`: required `quality` + `e2e`, no direct pushes, no force-push, a
   review for changes to `.github/`, `Dockerfile`, `deploy/`, and `services/billing/`.
4. Re-run the mutation job on its schedule so the "report only" gate has a baseline artifact.

**Acceptance evidence.**

- A workflow run URL on `main` where `quality` and `e2e` both conclude `success`, with the job list
  and the commit SHA visible.
- Branch protection configured, screenshotted or exported via `gh api`, naming the required checks.
- A deliberate red commit (a failing test on a throwaway branch) showing the required check blocks
  merge — the gate can fail, not just pass. ◐ (the audit notes a commit whose message claims to
  "prove the tests can fail"; no CI artifact proves it because CI never ran)

**Depends on:** nothing. This is the first gate because it is the evidence source for the rest.

---

### P0-2 — No release identity

**Status.** ✅ There is no `LICENSE`, `SECURITY.md`, `CHANGELOG.md`, or `CONTRIBUTING.md` at the
repository root. `package.json` declares `"version": "0.1.0"` and `"private": true`. There are zero
git tags and zero GitHub releases (`git tag | wc -l` → 0; `gh release list` → empty). The Dockerfile
carries `ARG SUITE_VERSION=0.0.0` as a placeholder stamped into `/metrics` and the startup log.

Meanwhile [docs/billing.md:12](../billing.md) states: *"The app is free and open source, and the
licence gates the relay."* ✅ Without a license file, that sentence is not legally true. It is the
kind of drift that turns a support conversation into a legal one.

**Why it blocks Beta.** A stranger cannot answer three questions: *what am I running*, *what may I do
with it*, and *how do I report a vulnerability privately*. Beta without those is a distribute-only
stage; with them, self-hosting becomes possible without an email thread.

**Fix.**

1. **Choose a license** (○ recommendation: AGPL-3.0 for the server, or a source-available license if
   hosted resale is a concern — this is a business decision, not an engineering one). The choice
   must match the sentence in the billing doc.
2. Add `SECURITY.md` with a private reporting channel, a scope statement, and a disclosure policy.
3. Add `CHANGELOG.md` in Keep-a-Changelog form, seeded from the existing conventional commits.
4. Adopt semver for the product, tag releases, and stamp the tag into the image
   (`SUITE_VERSION` already exists as the mechanism ✅ `Dockerfile`).
5. Add `CONTRIBUTING.md` only if external contributions are actually accepted; otherwise say so
   explicitly in the README.

**Acceptance evidence.**

- `LICENSE` at the root, referenced from `README.md`, consistent with `docs/billing.md`.
- `SECURITY.md` with a working private channel.
- A signed or annotated tag matching the image's `SUITE_VERSION`, and a release page that names the
  schema version and the upgrade notes.
- A `CHANGELOG.md` entry for the tagged version.

**Depends on:** P0-1 (a tag is only meaningful if the commit was gated).

---

### P0-3 — Billing cannot take money

**Status.** ✅ `services/billing/handler.ts:268` creates a **module-level** store:
`const sharedStore = memoryStore();`. The store itself is a pair of `Map`s
(`services/billing/store.ts:48-50`) that survive a warm container and nothing else.
[docs/billing.md:181](../billing.md) is candid: the in-process store *"only survives a warm container
and **must** be replaced before the endpoint takes real money."*

What is also missing, per the same doc ✅ `docs/billing.md:213`:

- No live Stripe test-mode handshake test, no SES delivery test, no deployed DynamoDB test.
- Signing-key rotation is a **cut-over, not a background job**: between flipping the public key and
  re-issuing, every active token stops verifying. `docs/billing.md:103-127` describes the window and
  says a two-key grace period "would remove the window; that is a change to `licence.ts`".

**Why it blocks Beta.** If Beta takes money, a Lambda cold start can forget a paid customer, a
retried webhook can mint twice, and a rotation can pause every paying relay. If Beta does not take
money, that must be said **publicly and in the UI**, not left as an ambiguity in a doc.

**Fix — choose one, explicitly (○ decision).**

- **Option A — close billing for Beta.** Mark hosted billing "not open" in the UI, the pricing page,
  `docs/billing.md`, and the README. Keep the code path, disable the endpoint. Beta then only needs
  P0-1..P0-2 for release identity.
- **Option B — make billing durable (recommended if hosted revenue is part of Beta).** A DynamoDB
  table with conditional writes: `EVENT#<event id>` claim rows with TTL for idempotency,
  `CUSTOMER#<customer id>` rows for the licence record. Migration of the `BillingStore` interface is
  already designed ✅ `docs/billing.md:181`. Add a two-key grace window to `licence.ts` so rotation
  is not an outage.

Either way, the *product* must not be able to take a payment it cannot record. A disabled checkout is
acceptable; a memory-backed checkout is not.

**Acceptance evidence.**

- Option A: the checkout entry point returns a "not open" state in production; the claim appears in
  the pricing page, README, and `docs/billing.md`.
- Option B: a Stripe **test-mode** end-to-end run that completes checkout, receives
  `checkout.session.completed`, `invoice.paid` (renewal), `customer.subscription.updated` (cancel),
  and a duplicate delivery, and shows exactly one licence and one workspace quota granted. Plus a
  rotation rehearsal that re-issues without a paused relay.

**Depends on:** P0-1 (the E2E must be a required check), and the identity decisions in §4.3 (a
subscription must attach to *someone*).

---

### P0-4 — Local-first durability is incomplete

**Status.** ✅ None of these exist in `apps/canvas`:

- No service worker, no web manifest, no PWA plugin (`grep` over `apps/canvas/src`, `index.html`,
  `vite.config.ts` returns nothing). Offline reload has no guaranteed app shell.
- No `navigator.storage.persist()` call anywhere. IndexedDB can be evicted under storage pressure.
- No quota-exceeded handling around `collab/loroPersistence.ts`.
- No React error boundary, no `componentDidCatch`, no `window.onerror`, no
  `unhandledrejection` handler. A render error is a blank screen.
- No client crash reporting or telemetry of any kind.

And one **active data-loss path** independent of all of the above: `compact()` writes *this tab's*
snapshot and then deletes **every** update row for the workspace ✅
`apps/canvas/src/collab/loroPersistence.ts:160-180`. Two tabs share the database and the workspace
key; each has its own `LoroDoc` ◐ (`store/useCanvasStore.ts`). Offline, tab A's compaction can delete
tab B's unmerged edits.

**Why it blocks Beta.** "Local-first" is the product's core promise. Eviction, a blank screen, or a
tab deleting another tab's work are exactly the failures a stranger will not forgive — and will
report as "it lost my work", which is the one bug class Beta cannot afford.

**Fix.** See §4.1. In short: Web Locks + BroadcastChannel for multi-tab, `persist()` on first
interaction, quota/eviction UX with an export escape hatch, an error boundary with a recovery route,
opt-in crash reporting, and an explicit decision about offline reload (service worker or a published
"offline = open tab" scope).

**Acceptance evidence.**

- A two-instance IndexedDB test where one instance compacts and the other reloads with its edits
  intact.
- A Playwright test that forces a render error and asserts a recovery screen, not a blank page.
- A test that stubs `navigator.storage.persist()` to `false` and asserts the UI warns and offers
  export.
- A quota-exceeded simulation that produces a user-visible message and never a silent save failure.

**Depends on:** P0-1.

---

### P0-5 — Single-node architecture is a hard ceiling

**Status.** ✅ `compose.yaml` describes one `app` service; rooms, presence, projection state, and
rate-limit counters live in that process; SQLite files live on one local volume. The operations doc
says it plainly: *"Rooms, presence, projection state and rate-limit counters live in one process.
Running two `app` containers against one volume corrupts locking assumptions and splits live state"*
✅ `docs/operations.md` §"Known gaps and risks".

The memory math is the ceiling in one line: `SUITE_PROJECTION_ROOMS_MAX` defaults to 128 rooms, and
the benchmark puts a 5,000-card workspace at ≈12 MB, so **128 × 12 MB ≈ 1.5 GB on a 1 vCPU / 2 GB
box** before counting the Node heap, the WASM runtime, and Caddy ◐ (audit; benchmark source
`packages/graph/bench`).

**Why it blocks Beta.** A ceiling is fine. An *unpublished* ceiling is a surprise outage: the first
customer with a 5,000-card board and a dozen share links finds it for us.

**Fix.** Do not add replicas. Instead: (a) measure, (b) publish, (c) fail predictably at the
boundary. §4.7 defines the load test; §6 defines the limit table; the existing quota behaviour —
*degrade, never drop a save* ✅ `docs/operations.md` §"Limits in force" — is the right model to
extend.

**Acceptance evidence.**

- A load test at the published target (rooms, peers, workspace size) with event-loop lag and RSS
  recorded, reproducible from a script in the repo.
- The limits table published on a public page **and** enforced/echoed in the admin surface.
- A documented, tested behaviour at each boundary (over-quota workspace: saves keep working, new
  shares refused).

**Depends on:** P0-1 (the load test must run in CI or be a recorded artifact with a commit).

---

### P0-6 — Browser matrix is one engine

**Status.** ✅ Playwright runs a single project —
`projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]`
(`e2e/playwright.config.ts:73`). CI installs only `chromium` for both the story tests and the e2e job
(`.github/workflows/ci.yml:62,129`). Mobile is effectively unscoped: the stylesheet contains one
640 px breakpoint ✅ `apps/canvas/src/styles/global.css:797` (plus a `min(640px, …)` width at `:677`).

**Why it blocks Beta.** Suite is a WASM + IndexedDB + WebSocket app. Safari/WebKit is a materially
different runtime for all three: different IndexedDB quota and eviction behaviour, different
WebSocket/proxy behaviour, different WASM memory limits. A stranger on a Mac or an iPhone is not an
edge case; they are the median stranger.

**Fix.** Add Firefox and WebKit projects for a **smoke** subset (load, open workspace, edit, sync two
clients, open a share link, reload offline), not the full 160-test declaration set. Keep Chromium as
the full matrix. Run one real manual pass on iOS Safari and record the result.

**Acceptance evidence.**

- Playwright config with `chromium`, `firefox`, `webkit` projects and a documented smoke tag.
- A CI run showing all three green on the smoke subset.
- A recorded manual iOS Safari pass: what worked, what degraded, what is blocked (with screenshots).
- A written **mobile decision**: in scope (with a named subset) or explicitly out (with a
  known-limitations entry).

**Depends on:** P0-1, P0-4 (offline assertions need persistence and the error boundary to exist).

---

### P0-7 — Schema evolution has policy but no tested upgrade path

**Status.** ✅ `packages/graph/src/loro/WorkspaceDocument.ts:1326-1327` stamps
`meta.schemaVersion` to `SCHEMA_VERSION` on open whenever it differs. There is no migration function,
no backfill, and no recorded per-version transformation. The workspace *file* parser is stricter and
better: it rejects a newer schema and a newer file version with an explicit message ✅
`packages/graph/src/workspaceFile.ts:135-141`, with tests ✅ `workspaceFile.test.ts:41-49`.

The gap is the **document**, not the file. A Beta user's document was written by an older build; the
current build will happily relabel it as current without proving the shape is current.

**Fix.** A migration runner on both sides (§4.2): ordered, idempotent steps keyed by version;
`PRAGMA user_version` and `busy_timeout = 5000` on every server database; N−1 fixtures for the
document and for each SQLite store; a blob format tag (`loro-snapshot-v1`) so a stored snapshot
declares what it is.

**Acceptance evidence.**

- `schemaVersion` N−1 fixture documents that open, migrate, and round-trip losslessly with a
  documented diff.
- An N−1 database fixture per store that boots, migrates, and serves a request.
- A test asserting that opening a *newer* document fails loudly rather than silently stamping.
- The blob format tag present in the store, with a rejection path for an unknown tag.

**Depends on:** P0-1.

---

### P0-8 — The tree is a moving target

**Status.** At audit time: 49 modified files, +2,922/−2,306, 19 untracked, and 87 commits ◐.
**Re-verified now:** `git status --porcelain` is empty, `main` has 89 commits, and there are still
**0 tags** ✅. So the churn has landed — but nothing marks *what* landed, and there is no
reviewable freeze point.

**Why it blocks Beta.** A stage claim attaches to a commit. Without a tagged, gated, reviewed commit,
"Beta" describes a working directory, not a release. The audit's own observation is the sharpest
version of this: *"Beta requires a freeze point and a reviewable diff. This is an Alpha characteristic
by definition."* ◐

**Fix.** Tag the Beta candidate only after B1–B9 pass. Freeze the tree for the Beta declaration
window: no feature merges, fixes only, each fix gated by the same required checks. Publish the exact
commit SHA with the limits page.

**Acceptance evidence.** A tagged commit whose required checks are green, whose diff since the
previous tag is reviewable, and whose SHA appears on the published limits/known-limitations page.

**Depends on:** P0-1, P0-2.

---
## 4. Workstreams

Each workstream below states the goal, the current state with evidence, the change, and the
**acceptance evidence** that closes it. Workstreams are ordered by dependency, not by importance:
durability first, because everything else assumes data survives.

| # | Workstream | Closes | Depends on |
| --- | --- | --- | --- |
| 4.1 | Data durability | P0-4, B4, B6 | — |
| 4.2 | Upgrade path | P0-7, B5 | 4.1 (fixtures need a stable store) |
| 4.3 | Identity and recovery | B6 | 4.1 (claim flow needs a durable workspace) |
| 4.4 | Billing | P0-3, B3 | 4.3 |
| 4.5 | Client resilience | P0-4, B4 | 4.1 |
| 4.6 | Platform matrix | P0-6, B8 | 4.5 |
| 4.7 | Scale evidence | P0-5, B9 | 4.1 |
| 4.8 | Security review | B10 | 4.3, 4.7 |
| 4.9 | Support and docs | B10 | all of the above |

---

### 4.1 Data durability

**Goal.** No supported workflow loses data, and every loss that is still possible is published.

#### 4.1a Attachments on `/data`, in backup, in restore, in ops

| Claim | Evidence | Status |
| --- | --- | --- |
| Attachment DB path defaults to the process working directory | `apps/collab-server/src/attachments.ts:79-80` — `env.SUITE_ATTACHMENTS_DB?.trim() \|\| "suite.attachments.sqlite"` | ✅ |
| Compose sets the other stores under `/data` but not attachments | `compose.yaml:37-39` sets `SUITE_DB`, `SUITE_SHARES_DB`, `SUITE_WORKSPACES_DB`; no `SUITE_ATTACHMENTS_DB` | ✅ |
| `.env.example` does not mention attachments | `grep SUITE_ATTACHMENTS_DB .env.example` → nothing | ✅ |
| Backup and restore enumerate stores explicitly | `deploy/backup.sh`, `deploy/restore.sh` cover documents/shares/workspaces (+ baselines); no attachments | ✅ |
| Ops still says nothing stores attachments | `docs/operations.md:80` — "Reserved for attachments; nothing stores them yet" | ✅ |
| Security model still says "three SQLite files" | `docs/security-model.md:72`; also `README.md:168,183` | ✅ |

**Change.** Set `SUITE_ATTACHMENTS_DB=/data/attachments.sqlite` in `compose.yaml` and document it in
`.env.example`; add attachments to the backup manifest (row count, byte total, checksum), to
`restore.sh`'s accepted set, and to the restore verification. Also set `SUITE_SETTINGS_DB` and
`SUITE_LICENCE_DB` to `/data`; both currently default to `:memory:` (`compose.yaml:40-41`). Update
`README.md`, `docs/operations.md`, and `docs/security-model.md` with one canonical sentence:

> Six stores exist in code (`documents`, `shares`, `workspaces`, `settings`, `licences`,
> `attachments`). `compose.yaml` configures five. Attachments currently defaults to the process
> working directory, and settings and licences default to `:memory:`; all three are lost when the
> container is recreated.

**Acceptance evidence.**

- An integration test that starts the server, uploads an image, **recreates the container**, and
  reads the image back with a byte-for-byte match.
- A backup manifest containing an attachment row/bytes/checksum line, and a restore that fails
  loudly when the attachment file is missing from the snapshot.
- The correctness test for the whole loop: back up, restore into a scratch volume, open the
  workspace, and see the image *and* its `.suite` export include the bytes.
- A container-recreate test is the minimum; the stronger version backs up while the server runs and
  restores from that snapshot.

**Dependency note.** This is the smallest change with the largest consequence, and it is the Beta
gate most likely to be skipped because the UI looks fine without it — the document still renders a
placeholder, so data loss presents as a sync bug. Treat a green UI as evidence of nothing.

#### 4.1b Multi-tab: one writer, no cross-tab deletion

| Claim | Evidence | Status |
| --- | --- | --- |
| `compact()` writes this tab's snapshot, then deletes **all** update rows for the workspace | `apps/canvas/src/collab/loroPersistence.ts:160-180` | ✅ |
| No `BroadcastChannel`, no Web Locks, no leader election in the persistence path | `grep BroadcastChannel\|navigator.locks` over `apps/canvas/src` → nothing | ✅ |
| Each tab holds its own `LoroDoc`; the store is created at module load | `apps/canvas/src/store/useCanvasStore.ts` | ◐ |
| A `tabId` exists but identifies, it does not coordinate | `apps/canvas/src/collab/tabId.ts` | ✅ |

**Decision to make.** Two implementable designs:

- **A — single writer (recommended).** A Web Lock
  (`navigator.locks.request('suite-compact:<workspace>')`) elects one tab to compact; the elected
  tab broadcasts its snapshot version vector over `BroadcastChannel` so other tabs can trim their
  own applied updates. Non-leader tabs never delete rows they did not write.
- **B — per-tab update logs.** Every tab writes to its own update store; compaction deletes only
  updates covered by the snapshot's version vector (`doc.version()` comparison), not by workspace id.

A is simpler and matches the "one writer" model used on the server; B survives a leader crash with
less coordination. Either way the invariant is: **no tab deletes an update it cannot prove is
contained in a snapshot.**

**Acceptance evidence.**

- A `fake-indexeddb` test with two `LoroIndexeddbPersistence` instances on the same workspace: A
  compacts while B holds unmerged edits; B reopens; B's text is present.
- A Playwright test with two real tabs, one offline; tab A reloads and compacts; tab B's offline
  edit still syncs when it reconnects.
- A regression test that fails if `compact()` deletes update keys without a version-vector check.

#### 4.1c `navigator.storage.persist()`

**Change.** Request persistent storage after the first meaningful interaction (first edit or first
import), not on load — browsers weight a user gesture. Store the answer and surface it in a storage
panel inside the existing menu: *persisted*, *best-effort*, or *denied*. On denial, say what it means
in one sentence and offer export.

**Acceptance evidence.** A unit test for the request/record path; a Playwright test that stubs
`persist()` to `false` and asserts the visible warning and the export affordance; a note in the
security model about what "persisted" does and does not guarantee.

#### 4.1d Quota and eviction UX

**Change.** Wrap IndexedDB writes in a typed error path: `QuotaExceededError` → user-visible state
("this device is out of space; your last save did not reach local storage; export now"), not a
console warning. Show `navigator.storage.estimate()` usage in the storage panel. Never fail a save
silently; the server quota rule — *degrade, never drop a save* ✅ `docs/operations.md` §"Limits in
force" — should hold on the client too.

**Acceptance evidence.** A simulated quota failure test (fake-indexeddb or a stubbed `add`) that
produces the visible state and preserves the in-memory document; a Playwright run that fills a quota
via a stub and asserts the export path still works.

#### 4.1e Offline scope: service worker or an explicit boundary

**Decision to make (○ recommendation: explicit boundary for Beta).**

- **Option A — "offline = an open tab".** Publish it: a reload while offline fails; unsaved work
  lives in the tab. Combined with `persist()`, quota UX, and the error boundary, this is an
  defensible local-first claim, and it avoids the hardest failure mode of a service worker: serving
  a stale app shell against a newer server protocol.
- **Option B — service worker app shell.** Adds offline reload, at the cost of cache versioning,
  update prompts, and a new class of "why is my build stale" bugs that only appear on strangers'
  machines.

Beta may ship A. Beta may not ship *neither*: the limitation must be written where a user finds it,
and the offline banner must explain what will happen on reload. Reversal trigger: if session data or
support reports show reload-while-offline is a common path, promote B into Beta rather than letting
the limitation stand.

**Acceptance evidence for A.** A known-limitations entry with the exact sentence used in the UI; a
Playwright test that goes offline, reloads, and asserts the documented outcome (a clear message, not
a blank page); a test that an open tab keeps editing while the socket is down and rejoins without a
reload ✅ (rejoin behaviour exists — `docs/operations.md` §"Offline re-join").

#### 4.1f RPO, RTO, and the restore drill

**Current state.** `deploy/backup.sh` uses SQLite `.backup` per database, records integrity checks,
SHA-256, and row counts into `manifest.txt`, and optionally uploads to S3 ✅ `docs/operations.md`
§"Back it up". `deploy/restore.sh` verifies manifest sizes/hashes, runs `PRAGMA integrity_check`,
stops `app`, replaces files **and stale `-wal`/`-shm` sidecars**, restarts, and waits for `/health` ✅.
A drill has been performed and recorded, including a 50-row uncheckpointed-WAL check ✅
`docs/operations.md` §"Drill performed".

What is missing: attachments in the snapshot (§4.1a), and a *published* recovery objective.

**Define and publish (○):**

| Objective | Definition for Beta | How it is proven |
| --- | --- | --- |
| **RPO** | The last successful snapshot, plus whatever the live WAL holds since the last save interval. There is **no point-in-time recovery** and no continuous archiving. | Manifest timestamp + save interval documented; stated on the limits page |
| **RTO** | Whatever the restore drill measures on the reference instance — published as measured, not promised ahead of measurement. | Timed drill transcript (start → `/health` 200) committed beside the runbook |
| Cross-file consistency | The snapshot is per-database, not one transaction; a share created between file copies can lack its projection until the next rebuild | Documented; option to stop `app` for a byte-exact snapshot ✅ `docs/operations.md` §"Back it up" |

**Acceptance evidence.**

- A restore drill that includes an attachment, run against a snapshot containing one, with the
  transcript attached to the release artifact.
- The limits page stating RPO/RTO in the terms above, with the drill transcript linked.
- A failing-drill test: corrupt one byte in a snapshot and assert `restore.sh` refuses before touching
  the volume.

#### 4.1g `.suite` round-trip including attachments and damage

**Current state (strong).** The file format is at version 2 and includes an `attachments` section
keyed by node id ✅ `packages/graph/src/workspaceFile.ts:8-10,47`. Older files without the key still
import (default `{}`) ✅. Export warns about missing images and names the cards rather than silently
writing a partial backup ✅ `apps/canvas/src/session/workspaceTransfer.ts` (via
`WorkspaceActions.tsx:100-110`). The launcher imports `.suite` files ✅
`apps/canvas/src/launcher/WorkspaceLauncher.tsx:273`.

**Change.** Make the round-trip a test, not a feature: export → import → compare document, attachment
bytes, and ids; corrupt the base64; delete an attachment from the envelope; assert the documented
outcome for each.

**Acceptance evidence.** Three fixtures (complete, corrupt, missing-image) with expected outcomes
asserted in the graph test suite and one end-to-end export/import in Playwright.

---

### 4.2 Upgrade path

**Goal.** An old workspace and an old database open on a new build without loss, and a new one
refuses to open on an old build instead of corrupting it.

| Claim | Evidence | Status |
| --- | --- | --- |
| The document stamps `meta.schemaVersion` to the current version on open, with no migration step | `packages/graph/src/loro/WorkspaceDocument.ts:1326-1327` | ✅ |
| The file parser rejects a newer schema and a newer file version | `packages/graph/src/workspaceFile.ts:135-141`; tests at `workspaceFile.test.ts:41-49` | ✅ |
| Server stores migrate ad hoc (`PRAGMA table_info` + `ALTER TABLE` per store) | `apps/collab-server/src/shares.ts`, `settings.ts`, others | ◐ |
| No `PRAGMA user_version` and no `PRAGMA busy_timeout` anywhere in the server source | `grep -rn "busy_timeout\|user_version" apps/collab-server/src` → nothing | ✅ |
| No N−1 fixture for a stored document or a database | no fixture directory; no test named for N−1 | ◐ |
| Documents are opaque `state BLOB` rows keyed by room name | `apps/collab-server/src/persistence.ts` | ✅ |

**Change.**

1. **One migration runner** (shared helper is enough) used by every SQLite store: `PRAGMA
   user_version`, an ordered list of steps, each logged at boot with from→to. A step is either a
   no-op by construction or an explicit, guarded transformation.
2. **`busy_timeout = 5000` on every connection.** WAL allows one writer; an admin command or the
   backup script against a live DB can hit `SQLITE_BUSY` immediately today.
3. **N−1 fixtures.** One stored document per historical schema version (or at least N−1), one
   database file per store. The test boots the current build against them and asserts a served
   request.
4. **Blob format tag.** Write `loro-snapshot-v1` beside the blob (or as a prefix/companion column)
   so a stored snapshot declares its format; an unknown tag refuses to load rather than guessing.
5. **Client IndexedDB versioning.** Name the database version and the snapshot record shape
   explicitly; a mismatch either migrates or clears with a documented, user-visible message — never a
   silent `deleteDatabase` on someone's only copy.

**Acceptance evidence.**

- A boot log line per store: `migrating shares 3 → 4` (or `no migration needed`), captured in a test.
- A test that a `busy_timeout`-sensitive write waits instead of throwing (hold a write lock in a
  second connection, then write).
- N−1 fixtures committed with a documented provenance ("written by commit `<sha>`, schema v3").
- A test that a future-schema document and a future-tag blob both fail loudly with a user-facing
  message.

**Explicit non-goal.** Beta does not promise N−2. It promises that the N−1 path is tested and that
older files fail with a message rather than a crash.

---

### 4.3 Identity and recovery

**Goal.** One screen explains what a user holds and what happens if they lose it — and, for paying
users, an account is the recovery path instead of a key.

#### 4.3a The five-terms / three-artifacts problem

The cryptography is not the problem. The UX exposes the implementation: **five terms for three
artifacts**, and two of the terms sound like the same thing while having opposite properties. ◐
(audit §"On the passphrase/recovery system")

| Term the user sees | What it is | Survives | Blast radius |
| --- | --- | --- | --- |
| **Owner link** (`#owner=…`) | The live owner key in a URL fragment | Nothing — it is a credential | Full workspace |
| **`.suitekey` file** | The same key in a plaintext JSON file | Lost browser | Full workspace |
| **24 recovery words** | The same 32-byte key encoded for paper (BIP-39-shaped, Suite's own list) | Lost browser + lost file | Full workspace |
| **Passphrase** | PBKDF2-derived key from user-chosen words; **rotates** the key | Lost browser + file + new device | Full workspace; invalidates old links and old files |
| **Operator `reset-owner`** | A server-side reset; the next claimant owns it | Everything | Full workspace, with a race |

**Why it is confusing (◐, and it will not fix itself):**

1. **Recovery words are not a second factor.** They encode the same secret. "Words" plus "passphrase"
   appears to be layered security; the two are alternative keys.
2. **The passphrase is a high-blast-radius rotation** buried inside a recovery dialog. It invalidates
   editor links and old `.suitekey` files. That deserves its own *Rotate owner key* flow with a
   consequences screen.
3. **There is no device or access inventory.** No "open on 3 devices, last seen…", no per-device
   revoke, no notification when a new device claims the workspace.

**Change.** One **"Workspace access"** screen that replaces the vocabulary with a state, not a
taxonomy:

```
Workspace access
  ● This device        browser, last used …            [Sign out]
  ● Recovery file      .suitekey saved                 [Replace] [Download again]
  ○ Account            not connected                   [Connect an account]   ← hosted only
  ● Recovery key       saved                            [Show instructions]
  ── Advanced ──
     Rotate owner key…   (invalidates links; shows exactly which)
```

Rules for the screen:

- **Say what each artifact *is for*, not what it is called.** "A file that gets you back in if this
  browser is lost."
- **Passphrase moves under Advanced → Rotate owner key**, with the consequences listed *before* the
  confirm.
- **Recovery words are labelled "the same key on paper",** never as a second factor.
- **An account, when present, is the primary path**; the owner key becomes break-glass/export.

#### 4.3b Strength: generation, scoring, and the KDF

| Claim | Evidence | Status |
| --- | --- | --- |
| PBKDF2-HMAC-SHA-256, 600,000 iterations, workspace-derived salt | `apps/canvas/src/session/ownerKey.ts:530,563-568` | ✅ |
| The choice is documented as weaker than Argon2id, for a dependency reason | `ownerKey.ts:517-522` — WebCrypto has PBKDF2 everywhere, Argon2 needs native/WASM | ✅ |
| The relay stores only a SHA-256 hash of the owner key | `docs/security-model.md` §"What the relay can see" | ✅ |

**The residual risk, stated plainly.** If the owner-hash database leaks, PBKDF2 cost is the only
barrier between a weak human passphrase and owner access. A user-chosen four-word phrase is exactly
the kind of secret that gets reused and guessed.

**Change (○ recommendation).**

1. **Generate** a six-word phrase for the user by default; keep "choose my own" as the secondary path.
2. **Score** anything the user types (a zxcvbn-style estimate, vendored or implemented locally — no
   network call, because this is a key), refuse the weakest bucket, and explain *why* in one line.
3. **Evaluate Argon2id via WASM** behind a flag and measure: unlock time on a mid-range laptop, bundle
   size, and whether the CSP (`'wasm-unsafe-eval'` is already allowed ✅ `deploy/Caddyfile:29`)
   permits it. Adopt only if the numbers beat PBKDF2-600k at equal unlock cost.
4. **Version the KDF parameters** in the stored record so a future default can coexist with old keys.

**Acceptance evidence.** Unit tests for generation (word count, uniqueness, no ambiguous words),
scoring thresholds, and KDF round-trip; a benchmark note comparing PBKDF2-600k and Argon2id at the
same target unlock cost; a UI test that a weak passphrase is refused with an explanation.

#### 4.3c Accounts: Better Auth in parallel, as an ownership layer

**Decision (○, recommended): accounts are optional, hosted-first, and additive.**

Anonymous/local-first stays the default. A workspace can remain account-less exactly as today. "Save
to account" attaches a workspace to a user; from then on the account is the primary recovery and
multi-device path, and the owner key becomes break-glass/export. Shared links stay anonymous
capability URLs — that is a product strength and it does not change.

**Topology.** Caddy routes `/api/auth/*` to the auth service; `/api/*` and `/ws` stay with the collab
server. The auth service has **its own database** — `users`, `sessions`, `accounts`, `verifications`
— backed up separately; it is small. The collab server does **not** read the auth database. It
verifies a short-lived **JWT** against the auth service's **JWKS** endpoint, which keeps the two
services independently restartable and upgradeable. ◐ (Better Auth JWT/JWKS plugin design; needs a
prototype to confirm the exact claim shape)

**Methods, in order.** Passkeys first (a natural fit for a local-first app; SimpleWebAuthn under
Better Auth), then Google, then magic link, then passwords — or no passwords at all. Add CSRF
protection, email verification, session revocation, and rate limits from the first commit that
accepts an account. Accounts are a bigger attack surface than capability links: account takeover now
means "all my workspaces".

**Sessions give Beta the UX it lacks:** device list, revoke one, revoke all, last seen, and a
new-device email (SES already exists for billing ✅ `services/billing/email.ts`). That is exactly
what the recovery-key model cannot offer.

**Authentication is not authorization.** A valid session must not grant access to every workspace.
Add `workspace_members(workspace_id, user_id, role)` and check it on **every** room join and every
publish. Share links remain anonymous capability tokens for guests. Two separate checks:
*who are you* (JWT) and *what may you open* (membership).

**Claim, do not migrate.** Existing workspaces attach to an account when the owner proves possession
of the owner key **once** (the same proof the claim flow already performs). After that the account is
the primary path. No big-bang migration, no data rewrite, no operator involvement.

**Admin.** Admin MFA and a scoped admin token are part of this workstream: today one bearer secret can
read every workspace's metadata and share list ✅ `apps/collab-server/src/adminHttp.ts:235-241` and
`docs/operations.md` §"Known gaps and risks". Scopes (read-only / mutate / delete), a separate
hostname, an IP allowlist, and an audit row per mutation are the minimum for a paid Beta.

**Cost.** One more process, one more database, email deliverability, OAuth client secrets, and PII
obligations (privacy policy, terms, deletion). On the reference box that is affordable; the PII
obligation is the real cost, not the RAM. ◐

**Acceptance evidence.**

- A session can be listed and revoked; a revoked session cannot join a room (test).
- A JWT from the auth service is accepted by the collab server; an expired or foreign-signed JWT is
  refused (test).
- A user without a `workspace_members` row cannot open a workspace they know the URL of (test) —
  the authorization test, separate from the authentication test.
- The claim flow: an anonymous workspace with an owner key attaches to an account; the old owner link
  still works as break-glass; a wrong key cannot claim.
- A self-host build with the auth service absent starts, claims, and shares exactly as today (parity
  test).
- Admin: a read-only token cannot delete; every mutation writes an audit row.

---

### 4.4 Billing

**Goal.** Money in, entitlement out, and neither can be lost by a restart.

| Claim | Evidence | Status |
| --- | --- | --- |
| The deployed webhook's store is process-memory | `services/billing/handler.ts:268` (`const sharedStore = memoryStore()`) | ✅ |
| The store is two `Map`s | `services/billing/store.ts:48-50` | ✅ |
| The docs mandate replacement before real money | `docs/billing.md:181` | ✅ |
| No live Stripe/SES/DynamoDB test exists | `docs/billing.md:213-216` | ✅ |
| The relay verifies one Ed25519 public key | `docs/billing.md:103-127`; `apps/collab-server/src/licence.ts` | ✅ |
| Rotation has a customer-visible window | `docs/billing.md:114-127` | ✅ |
| Billing imports app source | `services/billing/issue.ts` → `../../apps/collab-server/src/licence.ts` | ◐ |

**Change.**

1. **Durable store (DynamoDB or equivalent) with conditional writes.** `EVENT#<event id>` rows with a
   TTL, written with `attribute_not_exists` so a replayed webhook cannot mint twice;
   `CUSTOMER#<customer id>` rows for the licence record. Keep the existing `BillingStore` interface
   so the change is an implementation, not a fork.
2. **Stripe is billing, not identity.** Tie a subscription to the user with
   `client_reference_id` (Checkout) and `metadata.user_id` (subscriptions), and store
   `stripe_customer_id`, `subscription_id`, `status`, `current_period_end`. Never treat "owns the
   Stripe email" as owning a workspace: if someone pays before signing up, send a magic link, verify
   the address, then attach the subscription. Otherwise a typo'd or shared billing email becomes an
   account-takeover path.
3. **Checkout + Customer Portal.** Checkout creates the subscription; the Portal handles cards,
   invoices, cancels, and plan switches. The Portal removes the most support work per line of code we
   write.
4. **Webhooks, explicitly enumerated:** `checkout.session.completed` (mint first licence),
   `invoice.paid` (renewal, never earlier than what the customer holds), `invoice.failed` (dunning
   state), `customer.subscription.updated` (plan/tier/proration changes),
   `customer.subscription.deleted` (lapse to read-only, not deletion). Every handler is idempotent
   and records the raw event id.
5. **Dunning, grace, refunds, chargebacks, tax, proration.** Dunning: a failed invoice starts a grace
   state that keeps sync working while the customer fixes payment; the relay already does the right
   thing at expiry — the claim gate answers `402` with "local editing still works", and existing
   projections keep resolving ✅ `docs/billing.md:154,162-163`;
   `apps/collab-server/src/workspaceHttp.ts:356`. Refunds and chargebacks revoke entitlement at the
   end of the paid period, not instantly, unless fraud is indicated. Tax is Stripe Tax or explicit
   manual tax handling — decide, do not leave implicit.
6. **Server-side entitlement.** The relay verifies the licence (Ed25519) at join; a hosted account
   additionally checks the subscription server-side. Never trust a client-reported tier.
7. **Rotation with a grace window.** Accept two public keys during rotation so re-issuance is not an
   outage; retire the old key only after the store shows every active customer re-issued.
8. **Stop billing importing app source.** Extract `packages/licence` (token format, sign, verify,
   types) used by relay, canvas, and billing. This also removes the client/server parser drift ◐.

**Acceptance evidence.**

- A test-mode E2E against real Stripe: checkout → webhook → licence → sync allowed; cancel → period
  end → read-only; duplicate delivery → one licence; failed invoice → dunning → recovery.
- A replay test against the durable store proving conditional-write idempotency.
- A rotation rehearsal with both keys accepted, then one retired, with no paused relay.
- A refund and a chargeback scenario, each ending in the documented entitlement state.
- A test that a webhook with a missing or wrong signature is refused and logged.

---

### 4.5 Client resilience

**Goal.** No blank screens, and every crash leaves a usable trail.

| Claim | Evidence | Status |
| --- | --- | --- |
| No React error boundary or global error handler in the canvas | `grep ErrorBoundary\|componentDidCatch\|window.onerror\|unhandledrejection apps/canvas/src` → nothing | ✅ |
| No crash reporting or telemetry SDK | no Sentry/PostHog/OTel dependency ◐ | ✅ |
| Reconnect/rejoin without reload is implemented | `apps/canvas/src/collab/loroProvider.ts` `rejoin()`; `docs/operations.md` §"Offline re-join" | ✅ |
| Sync status is a single state machine shown in the title bar | `nextConnectionStatus` in `loroProvider.ts` | ✅ |

**Change.**

1. **Top-level error boundary** with three actions: *reload*, *export this workspace first* (if the
   document is still readable), and *copy diagnostics*. The boundary must never be the only copy of
   the document.
2. **Opt-in crash reporting.** Off by default, a single toggle in settings, no content in the payload
   — error name, message, stack, build version, browser, and a workspace **id hash**, never text,
   titles, or attachment names. This is a privacy decision as much as an engineering one and belongs
   in `docs/security-model.md`.
3. **Persistence wiring** (§4.1c–e): persist, quota UX, and the offline scope decision.
4. **Diagnostics bundle** (shared with §4.9): one click produces a redacted JSON/text file a user can
   attach to a support message. This is what replaces "can you open the console?".

**Acceptance evidence.**

- A Playwright test that forces a render error in a card body and asserts the boundary + export
  affordance, not a white screen.
- A test that the crash toggle defaults to off and that the payload contains no document text
  (snapshot the payload shape).
- A diagnostics bundle fixture reviewed for secrets (no tokens, no owner key, no share URLs).

---

### 4.6 Platform matrix

**Goal.** The second browser is not a surprise, and mobile is a decision rather than a default.

| Claim | Evidence | Status |
| --- | --- | --- |
| Playwright runs one project | `e2e/playwright.config.ts:73` | ✅ |
| CI installs only Chromium | `.github/workflows/ci.yml:62,129` | ✅ |
| Mobile layout is one breakpoint | `apps/canvas/src/styles/global.css:677,797` | ✅ |
| `docs/testing.md` documents the Chromium-only matrix | `docs/testing.md:30` | ✅ |

**Change.** Three Playwright projects (`chromium` full, `firefox` + `webkit` smoke), a documented
smoke tag, and one recorded manual iOS Safari pass. Then write the mobile decision:

- **In:** a named subset (open, pan/zoom, edit text, create a card) with a touch-specific checklist.
- **Out:** an explicit "desktop only" statement on the limits page, plus a viewport warning in the
  app rather than a broken layout.

**Acceptance evidence.** CI run with all three projects green on the smoke subset; the iOS pass
recorded with screenshots and a list of degradations; the mobile decision referenced from
`docs/testing.md` and the limits page.

**Known hazard.** WebKit's IndexedDB eviction and WASM memory behaviour differ; a WebKit smoke that
only loads the page proves nothing. The smoke must edit, sync two clients, and reload.

---

### 4.7 Scale evidence

**Goal.** Beta publishes a boundary it has measured, and the box fails at that boundary predictably.

| Anchor | Value | Evidence | Status |
| --- | --- | --- | --- |
| Projection rebuild, 500-card board | ~0.6 s, 1.04 MiB projected | `docs/operations.md` §"Capacity" (`packages/graph/bench/projection.bench.ts`) | ✅ |
| Projection rebuild, 2,000-card board | ~3.4 s, 4.15 MiB | same | ✅ |
| Projection rebuild, 5,000-card board | ~8.3 s, 10.39 MiB | same | ✅ |
| 200-card selection, 5,000-card board | ~0.9 s, 550 KiB | same | ✅ |
| Five editors, 200 edits | converge in ~0.9–1.1 s | `apps/collab-server/src/roomsLoad.test.ts` | ✅ |
| Boot with 486 stored links | 3.62 GB RSS before; 119 MiB after on-demand rooms | `docs/operations.md` §"Capacity" | ✅ |
| Room ceiling default | 128 projection rooms | `SUITE_PROJECTION_ROOMS_MAX` ◐ | ◐ |

**The memory math Beta must publish.** 128 open projection rooms × ≈12 MB per 5,000-card workspace
≈ **1.5 GB** on a 1 vCPU / 2 GB box, before the Node heap, the WASM runtime, and Caddy. That single
sentence explains more Beta outages than any other number in this document. ◐ (audit; benchmark
source in `packages/graph/bench`)

**Change.**

1. **Load test at the published target**, not at a convenient one: N workspaces, M open rooms, K
   concurrent peers, one workspace at the published maximum card count, shares open, saves running.
2. **Measure event-loop lag, not just latency.** A synchronous `node:sqlite` write per dirty room per
   save tick blocks every WebSocket message; the metric that catches it is p99 lag during saves ◐
   (`apps/collab-server/src/server.ts` `saveInterval: 2000`; `persistence.ts` full-state upsert).
3. **Record RSS, room count, save duration, projection rebuild time, and error rate** in a committed
   artifact with the machine's specs.
4. **Publish the limits** in §6 and link the artifact.

**Acceptance evidence.** A reproducible load script (committed), a result artifact naming the
hardware, and the limits page quoting only numbers that appear in that artifact. A limit that is not
in the artifact is not a limit; it is a hope.

---

### 4.8 Security review

**Goal.** A threat model a stranger can read, and the obvious blast-radius items closed.

| Claim | Evidence | Status |
| --- | --- | --- |
| Container runs as root; no `USER` in the runtime image | `Dockerfile` (no `USER`) | ✅ |
| Empty `SUITE_ALLOWED_ORIGINS` becomes `*` | `apps/collab-server/src/config.ts:277` | ✅ |
| Admin API is one unscoped bearer token | `apps/collab-server/src/adminHttp.ts:235-241`; `docs/operations.md` §"Known gaps" | ✅ |
| Hosted share links default to a 30-day expiry; self-host defaults to never | `docs/operations.md` §"Links: hosted expiry and last used" | ✅ |
| Last-used exists, coarse (at most one write a minute) | same | ✅ |
| CSP is enforcing, not report-only | `deploy/Caddyfile:29` | ✅ |
| No Dependabot/Renovate config, no `pnpm audit` in CI, no SBOM | `.github/` has no dependabot.yml; no audit step in `ci.yml` | ✅ |
| Two dependencies are locally patched | `patches/` (`loro-websocket`, `loro-prosemirror`); guard test exists | ✅ |

**Change.**

1. **Threat model** in `docs/security-model.md`, with four new sections: *Assets*, *Adversaries*,
   *Trust boundaries*, *Accepted risks*. Named scenarios at minimum: stolen laptop, leaked share
   link, leaked owner link, compromised admin token, malicious collaborator, XSS, dependency
   compromise, hostile self-host operator, database theft, backup theft.
2. **Data inventory.** Which store holds what, sensitivity, retention, backup coverage. This is the
   artifact that would have caught the attachments omission before an audit did.
3. **Incident response**, one page per compromise: rotate owner key, revoke shares, rotate admin
   token, rotate licence key, restore from backup, notify users, preserve logs.
4. **CORS default deny.** No header unless an origin is configured; `*` requires an explicit opt-in.
   Update the tests, `.env.example`, and the security model together — they currently disagree
   (`docs/security-model.md` says allowlist, code returns `*`).
5. **Non-root, read-only runtime.** Add `USER`, a read-only root filesystem where feasible, and
   resource limits. The image also keeps dev dependencies because the server runs via `tsx` ✅
   `Dockerfile`; note the trade-off explicitly rather than leaving it implicit.
6. **Admin scoping + MFA + audit** (§4.3c), and a separate hostname or IP allowlist for `/admin`.
7. **CSP reporting rollout.** Keep the enforcing policy; add a `report-to` endpoint and a report-only
   trial for a stricter successor policy before enforcing it.
8. **Dependency scanning and SBOM:** `pnpm audit` as a required (or report-only first) CI step,
   Dependabot/Renovate for the workspace and Actions, an SBOM artifact per image, and secret scanning
   on the repo.
9. **Share hygiene:** keep the expiry option, show the access/last-used list in the share dialog, and
   add an "expires" default that matches the hosted behaviour.

**Acceptance evidence.** The four new security-model sections merged; a CORS test matrix (unset →
no header; allowlist → exact origin; explicit `*` → `*`); `docker run` as a non-root uid succeeding;
an admin-scope test; a generated SBOM attached to a release; an `pnpm audit` run in CI.

---

### 4.9 Support and docs

**Goal.** A stranger can find out what is broken, what is limited, and how to ask for help — without
emailing the operator to read SQLite.

| Claim | Evidence | Status |
| --- | --- | --- |
| No status page, no support contact in the app, no diagnostics export | no such surface found in `apps/canvas` ◐ | ◐ |
| No privacy policy, terms, DPA, or user-facing delete | no such docs at root or in `docs/` | ✅ |
| Operator commands exist for delete/reset | admin CLI + `/admin` panel | ✅ |
| Docs drift is real and specific | see table below | ✅ |

**Documentation drift to fix in the same pass** (it is a trust artifact, not housekeeping):

| Doc claim | Reality | Where |
| --- | --- | --- |
| "`services/billing` is outside the pnpm workspace" | It **is** a member via `services/*` — `docs/billing.md:205` says so | `docs/testing.md:4` |
| "104 test files, 1,278 tests, 132 e2e" | Audit counted 142 files, ~1,392 unit, ~160 e2e ◐; the doc already warns counts grow | `docs/testing.md:28-30,37` |
| "Three SQLite files" | Six stores exist in code; compose configures five; attachments defaults to CWD; settings/licences default to `:memory:` | `README.md:168,183`; `docs/security-model.md:72` |
| "Attachments reserved; nothing stores them yet" | Attachments are implemented and wired | `docs/operations.md:80`; `limits.ts` comment |
| `GraphDocument` / `useGraphSnapshot` | `WorkspaceDocument` / `useWorkspaceSnapshot` | `AGENTS.md:83-84` |
| `preview-light.png` says "Yjs" | Engine is Loro | `docs/assets/preview-light.png` ◐ |

**Change.**

1. **Known-limitations page**, public, one screen, linked from the app footer and the README. It
   carries: single node, no E2EE, plaintext backups, the offline scope decision, the browser matrix,
   the published limits, and RPO/RTO.
2. **Status page** (or a documented "we do not run one; here is the health endpoint" statement; an
   accurate statement is better than a dead status page).
3. **Diagnostics bundle** (§4.5) and a support contact that is not a personal email.
4. **Privacy policy, terms, DPA template**, and a **self-service delete** that removes a workspace
   and its attachments and reports what remains in backups.
5. **Docs truth pass** with a link checker and a code-fence test in CI, so drift fails a build rather
   than an audit.
6. **Upgrade guide** (N−1 → N) generated from the changelog, and an API reference if any HTTP surface
   is promised to third parties.

**Acceptance evidence.** The limitations page live and linked from the app; a diagnostics bundle
fixture; a delete flow test (workspace gone, attachments gone, share links dead, backup caveat
stated); a green docs link check in CI; the drift table above empty.

---
## 5. Free backup options

### 5.1 Folder backup first, Drive later

The lowest-cost backup we can offer without a vendor is a file the user already knows how to move:
**backup to a folder, plus bring-your-own-sync**.

Syncthing is not an API — it is a file-sync daemon. You do not "support Syncthing"; you write
snapshot files into a folder the user already syncs. The same code covers Syncthing, iCloud Drive,
Dropbox, OneDrive, a NAS, and a USB stick. **Zero server, zero OAuth, zero per-user cost, works
offline, and the bytes never leave the user's control.** ◐

### 5.2 The feature

| Piece | Detail | Status |
| --- | --- | --- |
| Directory picker | `showDirectoryPicker()` (File System Access API), Chromium-first | ○ |
| Snapshot format | The existing `.suite` file, which already embeds attachments as of format v2 | ✅ `packages/graph/src/workspaceFile.ts:8-10,47` |
| Naming | `Suite/<workspace-slug>-<device>-<timestamp>.suite` — per device **and** per timestamp | ○ |
| Manifest | `Suite/manifest.json`: workspace id hash, device label, timestamps, byte sizes, file format version | ○ |
| Restore | The launcher already imports `.suite` files | ✅ `apps/canvas/src/launcher/WorkspaceLauncher.tsx:273` |
| Retention | Rolling: keep the newest N per device, never delete a file the app did not create | ○ |

**Why per-device *and* per-timestamp filenames:** two devices writing the same folder must never
collide, and a sync conflict file (`… (conflicted copy).suite`) is then just another backup rather
than a corrupted one.

### 5.3 Two hard rules

1. **Never sync the live SQLite or IndexedDB store.** WAL files, locks, and sync-conflict copies will
   corrupt it. Only immutable `.suite` snapshots go into a synced folder. This rule is not a
   preference; it is the difference between a backup and a second failure mode.
2. **Do not assume a single writer.** Timestamped, per-device filenames make concurrent writers
   harmless. Never rely on "only one device writes here", because that assumption is invisible until
   it is false.

### 5.4 Where the API is missing

Safari and Firefox do not expose `showDirectoryPicker`. Fallbacks, in order:

1. **Download + reminder** — the existing export path, with a reminder tied to the last export.
2. **A Tauri wrapper** — if folder backup proves important enough, it gives cross-platform folder
   access and a keychain for future OAuth tokens, at the cost of a second distribution channel. ○
3. **OPFS / IndexedDB rolling snapshots** — a local ring of the newest N snapshots, so a bad edit is
   recoverable even with no external folder. This is useful regardless of folder backup. ○

### 5.5 Google Drive, later

The good news: **`drive.file` and `drive.appdata` are non-sensitive scopes**, so an app can avoid the
restricted-scope security assessment. `drive.file` sees only files the app creates or the user opens
with it — exactly right for a `Suite/` folder. `drive.appdata` hides backups in an app-private
folder. **Never request `drive` or `drive.readonly`**; those are restricted and trigger review. ◐

The real cost is the token lifecycle:

- **Automatic background backup needs offline access and refresh tokens**, which means server-side
  storage, encryption at rest, revocation handling, and a record to attach them to. *That record is
  effectively an account.*
- **Client-side Google Identity Services** gives short-lived access tokens only. Fine for a manual
  "Back up now" button; not enough for unattended backup.
- Once Better Auth exists, Drive becomes an account feature: the refresh token belongs to the user,
  revoking the account revokes the backup, and support has something to inspect.

**So:** folder + BYO sync for everyone, including anonymous users. Drive as a signed-in convenience
after accounts. Do not offer "free Drive backup" and pretend it is account-free; it is not.

### 5.6 Option matrix

| Option | Our cost | User cost | Build effort | Works offline | Needs account | Best for |
| --- | --- | --- | --- | --- | --- | --- |
| **Folder + BYO sync** (Syncthing/iCloud/Dropbox/NAS) | ~0 | ~0 | Low | Yes | No | Free tier, standalone edition |
| **Google Drive** (`drive.file`) | OAuth client + token store + PII obligation | Free (Google quota) | Medium | No (manual only) | Practically yes | Signed-in users, one-click backup |
| **WebDAV** (Nextcloud/ownCloud) | ~0 | Their server | Medium | No | Their credentials | Self-host, technical users |
| **S3-compatible** (R2/B2/MinIO) | ~0 | Storage cost | Medium | No | Their credentials | Power users, self-host |
| **Our own blob storage** | Storage + egress + liability + deletion duties | Free | Low code, high ops | No | Maybe | Only if capped and charged for |

"Build effort" is relative complexity (low/medium/high), not a schedule.

### 5.7 Suggested sequence

| Phase | Work | Why here |
| --- | --- | --- |
| **Now (Beta)** | "Back up to folder" + rolling local snapshots + restore-from-folder; document the Safari/Firefox fallback | Free-tier answer; costs nothing per user; reuses the `.suite` format that already carries attachments |
| **Paid (with accounts)** | Google Drive for signed-in users (`drive.file`), encrypted refresh tokens, per-device snapshot files, "Back up now" + automatic | Only sane once an account exists to own the token |
| **Later** | WebDAV/S3 targets for self-hosters, in-app scheduling | Power-user conveniences, not Beta blockers |

---

## 6. Beta operating limits

Beta publishes these numbers, enforces them where the code can, and names the failure mode at each
boundary. **Rows marked ✅ already exist; rows marked ○ are proposed Beta defaults.**

| Limit | Beta value | Basis | At the boundary |
| --- | --- | --- | --- |
| Document bytes per workspace | ○ 32 MiB (self-host: configurable, default unlimited) | 5,000 cards ≈ 12 MB ◐; 32 MiB leaves headroom without inviting a 1 GB board | Saves keep working; new share links refused (`409`) ✅ |
| Cards per workspace | ○ 10,000 (soft, warns before the ceiling) | 5,000-card benchmark is the measured comfort point | Warn + offer export; no hard delete |
| Attachment bytes per workspace | ○ 256 MiB hosted; per-file 16 MiB ✅ | 16 MiB cap and image MIME allowlist exist ✅ `attachments.ts:22-36` | Upload refused with the remaining budget named |
| Share links per workspace | 100 ✅ | existing interaction cap | New share refused (`409`) ✅ |
| Cards per selection share | 200 ✅ | existing cap | Selection share refused (`400`) ✅ |
| Open projection rooms (instance) | 128 ✅ (`SUITE_PROJECTION_ROOMS_MAX`), provisional until E2 | memory math below | New room waits/evicts; never silently drops a save |
| Concurrent peers per room | ○ 10 | load test target; presence and projection cost per peer | Join refused with a clear message |
| Concurrent rooms per instance | ○ 128 total (workspace + projection) | one process, one event loop | New join refused; existing rooms unaffected |
| Idle room retention | 24 h hosted, off self-host ✅ (`SUITE_ROOM_IDLE_HOURS`) | prevents forgotten tabs pinning memory | Sweep closes; reader rejoins on demand ✅ |
| Projection bytes per workspace | 32 MiB hosted ✅ | existing quota | New share refused (`507`) ✅ |
| Disk soft / hard watermark | 4 GiB / 5 GiB hosted ✅ | existing quota | Warn / refuse new workspace (`507`) ✅ |
| Share-link expiry default | 30 days hosted, never self-host ✅ | existing behaviour | Owner can still choose a date or never |
| Backup snapshot cadence | operator-defined; manifest timestamps published | no PITR | RPO equals the cadence + one save interval |
| Restore target | the drill's measured figure, published | drill transcript | Missing or corrupt snapshot refuses before touching the volume ✅ |

### The memory math

```
128 open projection rooms × ≈12 MB per 5,000-card workspace ≈ 1.5 GB RSS
        on a 1 vCPU / 2 GB box — before the Node heap, the WASM runtime, and Caddy.
```

This is the number that decides what Beta can promise. It is why the room ceiling is a *published
operating limit* rather than an implementation detail, why on-demand room opening matters (boot with
486 stored links fell from **3.62 GB RSS** to **119 MiB** ✅ `docs/operations.md` §"Capacity"), and
why "just add a replica" is not a Beta answer.

**Rules for this table.**

- A number in the table must appear in a committed artifact or a cited config default. If it does not,
  it is a hypothesis, not a limit.
- Every boundary names the user-visible behaviour. "Refused" without a message is an outage.
- The published page and the admin surface must agree; a drift test compares them.

---

## 7. Beta exit gates (B1–B10)

Beta ends when all ten gates have evidence artifacts — not when the list feels done. Each artifact is
a URL, a committed file, or a test that runs in CI.

| Gate | Claim | Evidence artifact | Workstream |
| --- | --- | --- | --- |
| **B1** | CI executes and gates `main` | Green `quality` + `e2e` run URL on `main`; branch-protection export naming both; a red-commit demo showing the gate blocks | P0-1, P0-8 |
| **B2** | Release identity exists | `LICENSE`, `SECURITY.md`, `CHANGELOG.md`, a tag matching `SUITE_VERSION`, a release page with upgrade notes | 4.9 |
| **B3** | Money is durable, or billing is closed | Test-mode E2E transcript (checkout → webhook → licence → entitlement → cancel) with idempotency and rotation rehearsal; **or** a public "not open" state in UI + docs | 4.4 |
| **B4** | Data durability, server and client | Container-recreate test for attachments, settings, and licences; backup/restore drill; two-tab compaction test; forced-error boundary test; `persist()` denial test; quota-exceeded test; documented offline scope with a test asserting the documented outcome | 4.1, 4.5 |
| **B5** | Upgrade path | Migration runner log test; `busy_timeout` contention test; N−1 document and database fixtures; unknown blob tag rejection | 4.2 |
| **B6** | Recovery is explainable and, when accounts exist, normal | "Workspace access" screen shipped; generation + scoring + KDF benchmark; device list/revoke; claim-existing-workspace test; authorization (`workspace_members`) test. **If accounts are not in Beta:** a written, tested operator-recovery procedure with its risk stated | 4.3 |
| **B7** | The supported browser set is tested | Firefox + WebKit smoke green in CI; one recorded iOS Safari pass; a written mobile in/out decision linked from the limits page | 4.6 |
| **B8** | Observability a stranger can use | Diagnostics bundle fixture (redacted); crash toggle default-off payload test; status page or an explicit statement; support contact in-app | 4.5, 4.9 |
| **B9** | Scale evidence and published limits | Load-test artifact naming hardware and recording event-loop lag/RSS/rebuild time; limits page whose every number appears in the artifact | 4.7 |
| **B10** | Security and docs truth | Threat model + data inventory + incident response + accepted risks merged; CORS deny-by-default test; non-root container proof; admin scope test; `pnpm audit` + SBOM; docs link check green and the drift table empty | 4.8, 4.9 |

**How to use the gates.** B1 gates everything; B2–B9 can run in parallel once B1 is green; B10 is last
because it must describe the system the other gates produced. A gate is open only when its artifact is
linked from the Beta declaration — a verbal "we did that" reopens the stage.

**Beta declaration (○).** A tagged commit plus a single page: the ten gate links, the published
limits, the known limitations, and the exact command to self-host the same build.

### 7.1 Gate review

- **Owner:** the maintainer/operator role. No separate review board is implied.
- **Review event:** every release candidate and every stage transition.
- **States:** `unopened`, `measuring`, `open`, `failed`, `deferred`.
- **Rules:** a gate is open only with a linked artifact; discussion does not close it. A gate that
  remains `unopened` or `measuring` across two consecutive release candidates is treated as `failed`
  for planning. Its dependent work is cut or moved to a later stage. A failed gate is not renamed to
  make the stage look complete.

---

## 8. Not in Beta

Each item is deferred with a destination. The right-hand column records where it goes next.

| Deferred | Why not Beta | Where |
| --- | --- | --- |
| **i18n** | All strings are hardcoded English; translation is a surface-wide change and a support obligation | [V2](./v2.md) Bet G |
| **End-to-end encryption** | No accounts, no device trust, no key directory. E2EE before identity creates unrecoverable-data support cases | [V2](./v2.md) Bet G |
| **Card-document split** | Benchmarks do not demand it; the split must stay a storage change behind `DocumentStore` | [V1](./v1.md) / [V2](./v2.md) Bet F |
| **Multi-replica** | Rooms, presence, projection, and rate limits are one-process truth; needs Redis + leases, not a config flag | [V1](./v1.md) topology ladder; [V2](./v2.md) Bet F |
| **Plugin API** | Would freeze the object model before it stabilizes | [V2](./v2.md) explicit cuts |
| **Marketplace** | Requires a plugin/starter ecosystem and a trust model that does not exist | [V2](./v2.md) |
| **Version history / time travel** | Undo exists; history is a storage and UX project with its own retention semantics | [V2](./v2.md) |
| **Comments / threads** | Needs identity for attribution — the thing Beta only begins to add | [V2](./v2.md) Bet D |
| **Importers** (Markdown, Notion, Heptabase) | Each is a parser, a mapping, and a fidelity promise | [V2](./v2.md) Bet D/E |
| **Mobile as a supported platform** | Beta only *decides*; support is a separate commitment | [V2](./v2.md) Bet G |
| **E2EE backups** | Operator-readable backups are the support model for Beta; encryption removes the recovery path | [V2](./v2.md) |

**The test for this list.** If an item is added to Beta, something else must leave, or a gate slips.
Beta's value is the narrowness of the claim.

---

## 9. Risk register

Risks are ranked by *what a stranger experiences*, not by implementation difficulty. Every risk has a
**leading indicator** — the metric that moves before the incident — and a threshold that triggers
action.

| # | Risk | Leading indicator | Trigger | Mitigation | Artifact |
| --- | --- | --- | --- | --- | --- |
| R1 | **Memory ceiling** — open rooms × document size exhausts the box | `rooms.projections`, RSS, `projections.opened` | RSS > 70% of the box, or opened rooms tracking stored links | On-demand rooms, idle sweep, published room ceiling, eviction | `/api/admin/status`, load test |
| R2 | **Save stalls** — synchronous full-state upsert blocks the event loop | p99 event-loop lag during saves; save duration per room | p99 lag above the published budget, or saves overlapping the next tick | Incremental Loro updates, worker-thread SQLite, compaction policy | Load test; lag metric |
| R3 | **Projection cost** — full rebuild per share per save | Rebuild time per share; dirty-room count; fan-out ratio | Rebuild > the published per-share budget on a target board | Version-vector skip, diff apply, per-share debounce | `packages/graph/bench/projection.bench.ts` |
| R4 | **Single-process truth** — rooms, presence, limits in one process | Restart count; join refusals; rate-limit false positives | Any plan that assumes two replicas; repeated restarts | Publish single-node; room leases and Redis only in V1/V2 | Limits page; topology ladder |
| R5 | **Document size** — one workspace grows until every save is slow | `documentBytes` per workspace, `overQuota` count | Any workspace near the published document ceiling | Soft warn, export prompt, share refusal, split trigger | `/api/admin/workspaces` |
| R6 | **Attachment bytes** — blobs in SQLite grow the disk and backups | Attachment bytes per workspace; snapshot size | Snapshot growth outpacing document growth | 16 MiB/file, per-workspace cap, object storage seam later | Backup manifest line |
| R7 | **Client storage** — eviction, quota, multi-tab loss | Save failures; `persist()` denials; tab count per workspace | Any silent save failure; any cross-tab loss report | `persist()`, quota UX, Web Locks/BroadcastChannel | Client tests; crash reports |
| R8 | **Upgrade drift** — old documents relabelled as current | Documents opened with an older `schemaVersion`; migration log lines | Any document whose stored version < build version | Migration runner, N−1 fixtures, blob tag | Boot logs; fixtures |
| R9 | **Docs drift** — published limits/claims disagree with code | Docs link check; limits page vs admin diff | Any mismatch in a gate artifact | Docs checks in CI, single source for limits | CI job |
| R10 | **Operator trust** — plaintext at rest, unscoped admin | Admin token usage; backup copies off-host | Any shared admin token; any unencrypted off-host copy | Scopes, MFA, audit, encrypted volumes, documented accepted risk | Threat model |

**Reading a trigger.** A trigger is not an incident; it is the point where the mitigation's priority
changes. R1 and R2 are the two that will actually end a Beta day; R7 is the one that produces the
worst support ticket ("it lost my work").

---

## 10. Relationship to the plan of record

### 10.1 ADR-0020 — main and Loro are the plan of record

✅ Accepted. Beta assumes it without restating it: cards are objects, boards are contexts, one type
per card, tags for cross-cutting grouping, and the stored `types` map stays a one-key map for merge
safety. Beta adds no new entity kind. The two gaps ADR-0020 lists — export/import and card-level
sharing — are both now covered by `.suite` files and projection shares, which the ADR should record
when it is next touched ◐.

### 10.2 `docs/design-inspirations.md` — budgets, one document, non-goals

✅ Beta inherits the performance budgets, the "keep production storage as one document for now"
decision, and the non-goal list wholesale. Where the design doc describes an eventual index/card
split, Beta treats it as a **future storage change behind `DocumentStore`**, not as a Beta
prerequisite; the split stays gated on the benchmark and load evidence in §4.7.

### 10.3 ADR-0019 — references, not typed links

✅ Accepted. Typed links are revisited only after views v2 lands, and only via a new ADR. Beta makes
no change to the reference model; the "not shared" title stubs in selection projections are the
existing answer to transitive visibility.

### 10.4 ADR-0021, ADR-0022, ADR-0023 — sharing

- **ADR-0021** (card-level sharing as a per-card room) is **superseded for S1 by
  [ADR-0022](../decisions/0022-share-projection-links.md)**; its
  card-document rationale remains future work ✅.
- **ADR-0022** (share links are capabilities over live projection rooms) is **accepted** ✅ and is
  the sharing model Beta ships: hashed tokens, `read`/`write` per room, no accounts, revocable,
  optional expiry.
- **ADR-0023** (selection projections) is **accepted** ✅; Beta's limits include its 200-card cap and
  its "unshared references show titles only" rule.

### 10.5 Conflict notes (explicit, not silently overridden)

| Conflict | Positions | Beta's resolution |
| --- | --- | --- |
| **One document vs index/card split** | Design doc describes a target split (§4.2); audit recommends one document for v1 | Beta keeps one document, publishes the size limit, and treats the split as an evidence-triggered change. The design doc is not contradicted; it is *scheduled by evidence* instead of by stage. |
| **Card-level sharing deferred vs projections shipped** | ADR-0021 deferred per-card rooms; ADR-0022 shipped board/card/selection projections | Beta follows ADR-0022. A "card share" is a projection of one card, not a per-card document. The card-document split remains future work; Beta does not claim it. |
| **Accounts vs capability-only links** | Security model says "link-based, not account-based"; the audit recommends optional accounts | Beta keeps links as the default and adds accounts as an **ownership layer**, never as a gate on anonymous use. `docs/security-model.md` must gain an "accounts (optional, hosted)" section so the two statements are not contradictory. |
| **Single node vs hosted scale** | `compose.yaml` says single replica by design; a paid product implies availability | Beta sells published limits and documented recovery, not availability. Multi-replica stays in V1/V2. |
| **"Free and open source" vs no license** | `docs/billing.md:12` asserts it; there is no `LICENSE` | Beta resolves in favour of reality: either add the license or change the sentence. This is P0-2, not a documentation nit. |
| **CORS allowlist vs `*` default** | Security model says allowlist; `config.ts:277` returns `["*"]` | Beta resolves in favour of the stricter code path (deny by default) and fixes the docs+tests together (§4.8). |

### 10.6 What Beta does *not* relitigate

One architecture across editions; no tier-specific document engine; plan/apply for programmatic
changes; one query engine; one annotation model; themes as data; local-first as the default. V2 may
extend these; Beta assumes them.

---

## 11. Open questions, change triggers, and the evidence ledger

### 11.1 Open questions

| # | Question | Leaning | What would settle it |
| --- | --- | --- | --- |
| Q1 | Does Beta take money, or ship with billing closed? | Closed unless the durable store lands with its E2E | A working test-mode E2E + rotation rehearsal (P0-3 Option B) |
| Q2 | Is mobile in or out? | Out, documented explicitly | The iOS Safari pass + a decision recorded on the limits page |
| Q3 | Service worker or "offline = open tab"? | Explicit boundary for Beta, service worker later | Session data on reload-while-offline (reversal trigger in §4.1e) |
| Q4 | Which license? | AGPL-3.0 for the server, or source-available if hosted resale is a concern | A business decision, recorded as an ADR |
| Q5 | Accounts for everyone or hosted-only? | Hosted-only, behind a flag; self-host stays capability-only | Parity test showing self-host is unchanged with the auth service absent |
| Q6 | What is the published document ceiling? | 32 MiB, 10,000 cards soft | The load test at the ceiling (§4.7) |
| Q7 | Does Beta ship the folder-backup feature, or only export? | Folder backup, because it is small and consistent with the local-first model | A `showDirectoryPicker` prototype + the fallback copy for Safari/Firefox |
| Q8 | How is the tree frozen for the Beta declaration? | Tagged commit, fixes only, same required checks | B1 + B2 evidence |
| Q9 | What does the operator promise for lost keys without accounts? | A written procedure with its race stated — no SLA | The B6 artifact, whichever branch it takes |
| Q10 | Is Postgres in Beta? | No — it arrives with Better Auth, control plane only | Auth service prototype showing JWT/JWKS + `workspace_members` |

### 11.2 Change triggers

This document changes when one of these becomes true. Each trigger names the section that must be
revised.

| Trigger | Revision |
| --- | --- |
| CI goes green on `main` with required checks | Close P0-1; B1 becomes an artifact link, not a plan |
| A durable billing store lands with a test-mode E2E | Rewrite P0-3 as "closed"; Q1 resolves |
| Accounts ship behind a flag | §4.3 becomes "shipped" for hosted; the security model gains the accounts section |
| A load test shows the memory ceiling is lower than assumed | §6 numbers and §7 B9 evidence change together |
| The benchmark shows the split is needed at the published ceiling | Escalate to [V1](./v1.md); Beta's one-document claim gets a dated retraction (in the ADR, not here) |
| A data-loss report traces to multi-tab or attachments | Freeze Beta, reopen B4/A1, and publish an incident note |
| A second replica becomes a requirement | Beta is over; that is a [V1](./v1.md) topology project |
| A stranger self-hosts successfully from the docs alone | The docs truth pass (4.9) is validated by evidence, not by review |

### 11.3 Evidence ledger

Every factual claim in this document, with how it was checked. A ✅ whose source is not listed here is
a claim to re-verify, not a fact.

| Claim | Source | Check |
| --- | --- | --- |
| No `LICENSE`, `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`; version `0.1.0` | repository root; `package.json` | `ls`, `cat` ✅ |
| 0 tags, 0 releases; 89 commits on `main`; clean tree | git | `git tag`, `gh release list`, `git status --porcelain` ✅ |
| 21 workflow runs, all `startup_failure`, 0 jobs | GitHub Actions | `gh run list --limit 25` ✅ |
| CI defines `quality`, `mutation`, `e2e`, `image` jobs | `.github/workflows/ci.yml:18,77,111,142` | read ✅ |
| Billing store is a module-level memory store | `services/billing/handler.ts:268`; `store.ts:48-50` | read ✅ |
| Billing docs mandate replacement; rotation has a window; no live E2E | `docs/billing.md:181,103-127,214` | read ✅ |
| "Free and open source" claim | `docs/billing.md:12` | read ✅ |
| Attachments DB defaults to CWD; not in compose/.env | `apps/collab-server/src/attachments.ts:79-80`; `compose.yaml:37-39`; `.env.example` | grep ✅ |
| Attachments absent from backup/restore; ops says "reserved" | `deploy/backup.sh`, `deploy/restore.sh`; `docs/operations.md:80` | read ✅ |
| `compact()` deletes all update keys for the workspace | `apps/canvas/src/collab/loroPersistence.ts:160-180` | read ✅ |
| No service worker, no `storage.persist()`, no error boundary | `apps/canvas/src`, `index.html`, `vite.config.ts` | grep ✅ |
| Schema version stamped on open, no migration | `packages/graph/src/loro/WorkspaceDocument.ts:1326-1327` | read ✅ |
| File parser rejects newer schema/version | `packages/graph/src/workspaceFile.ts:135-141` | read ✅ |
| `.suite` v2 embeds attachments | `packages/graph/src/workspaceFile.ts:8-10,47` | read ✅ |
| Export warns on missing images | `apps/canvas/src/components/WorkspaceActions.tsx:100-110` | read ✅ |
| Playwright Chromium-only; CI installs only Chromium | `e2e/playwright.config.ts:73`; `.github/workflows/ci.yml:62,129` | read ✅ |
| One 640 px breakpoint | `apps/canvas/src/styles/global.css:677,797` | grep ✅ |
| CORS `*` when unset | `apps/collab-server/src/config.ts:277` | read ✅ |
| No `USER` in runtime image | `Dockerfile` | read ✅ |
| Admin token unscoped, compared in constant time | `apps/collab-server/src/adminHttp.ts:235-241` | read ✅ |
| No `busy_timeout` / `user_version` | server source | grep ✅ |
| Rate limits in-process; JSON body 64 KiB | `docs/operations.md` §"Fixed limits"; `http.ts:156` | read ✅ |
| Room ceiling default 128; memory math 128 × 12 MB ≈ 1.5 GB | `docs/operations.md` §"Capacity"; `packages/graph/bench` | ◐ (benchmark numbers audit-reported) |
| Projection/load benchmarks | `docs/operations.md` §"Capacity" | read ✅ |
| Boot with 486 links: 3.62 GB → 119 MiB | `docs/operations.md` §"Capacity" | read ✅ |
| Restore drill performed, includes WAL check | `docs/operations.md` §"Drill performed" | read ✅ |
| Hosted share expiry 30 days; last-used coarse | `docs/operations.md` §"Links" | read ✅ |
| PBKDF2 600k, documented as weaker than Argon2id | `apps/canvas/src/session/ownerKey.ts:517-522,530` | read ✅ |
| ADR-0021 superseded for S1 by ADR-0022; 0022/0023 accepted | ADR headers | read ✅ |
| Docs drift (billing workspace membership, counts, Yjs, attachments, stale names) | `docs/testing.md:4,28-30,37`; `README.md:168,183`; `docs/security-model.md:72`; `AGENTS.md:83-84` | read ✅ |
| Audit snapshot: 49 modified, +2,922/−2,306, 19 untracked | audit §Verdict | ◐ (no longer true; tree is clean) |

### 11.4 What would make this document wrong

- CI going green and billing becoming durable would close the two largest P0s, turning §3 into a
  history section.
- A stranger successfully self-hosting from the docs without contact would strengthen the claim in
  §4.9.
- A measured memory ceiling materially below the assumption would change §6 and possibly the Beta
  scope itself.
- A data-loss report after Beta entry is a stop-the-line event: reopen B4 and A1, not a doc edit.

When any of these happen, edit this file in the same change as the evidence, and cite the artifact.
