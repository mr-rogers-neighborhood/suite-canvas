# Alpha — current state and Alpha exit criteria

- **Status:** living document. It records decisions and verified facts; it is not a contract.
- **Stage:** late Alpha, approaching Beta.
- **Provenance:** a read-only codebase audit and design discussion (2,544 lines), re-checked against
  the working tree on 2026-10-23. The tree was mid-flight during the audit and is now committed
  clean (89 commits on `main` at that time).
- **Re-baselined 2026-10-25** against `main` at 124 commits: file and test counts, the four reasons
  in §1.2, the scorecard, the store statement in §4.4 and the A1/A4 gate notes were corrected
  against the tree. §7.3 gate statuses were already current and are unchanged. The analysis
  sections keep their 2026-10-23 framing; where a claim was overtaken it is marked rather than
  rewritten. Facts can change; each claim carries a marker.
- **Scope:** what Alpha means, what is strong, what is broken or unsafe, and the gates that must
  close before Beta.
- **Companions:** [Beta](./beta.md) · [V1](./v1.md) · [V2](./v2.md) ·
  [ADR-0020](../decisions/0020-main-and-loro-plan-of-record.md) ·
  [architecture](../architecture.md) · [design intent](../design-inspirations.md)

## How to read this document

This is a stage contract with evidence. It answers three questions:

1. Where is the product? Late Alpha.
2. Why is it not Beta? Two live data-loss paths, no executed CI, no release identity, no durable
   billing, and no client durability work.
3. What must be true before Beta? Gates A1–A11 (stability, durability, release identity),
   plus the **core surface gates A12–A27** in §7.5.

It does not answer "when". Sequencing is by dependency and evidence. No dates, durations, or effort
estimates are used.

### Reading legend

| Marker | Meaning |
| --- | --- |
| ✅ | Verified in the tree on 2026-10-23, with a path and usually a line. |
| ◐ | Audit-reported or taken from a repo report; needs re-verification. |
| ○ | Decision or hypothesis. Not a fact about the code. |

### Terms

| Term | Meaning |
| --- | --- |
| **Gate** | A condition that must be true before the stage can close. |
| **Evidence artifact** | A file, test, report, or URL that proves a gate. |
| **Trigger** | An observable event or measurement that justifies starting or reversing work. |
| **Bet / candidate** | A proposed feature area. Not approved until an ADR or merged change says so. |
| **Plan of record** | The current binding decision set: ADR-0020 and the ADRs that supersede it. |
| **ADR** | Architecture Decision Record: one decision, its context, and its consequences. |
| **Marker** | ✅ verified; ◐ needs re-verification; ○ decision or hypothesis. |

### Scope boundaries

- Not a feature list. Feature scope is in [design-inspirations.md](../design-inspirations.md) §10
  and the ADRs.
- Not a release note. There are no releases yet; that is a finding.
- Not a substitute for running the suite. Test counts and green status are evidence, not claims.

### Change triggers

Closing A1 and A2 moves the verdict from "unsafe for strangers" to "safe for strangers with known
limits". Other change triggers are in §13.2.

---

## 1. Verdict and position

**Late Alpha, approaching Beta.** The core product is real; the missing pieces are evidence and
safety rails. ✅

The verdict rests on two comparisons: why this is past pre-alpha, and why it is not Beta.

### 1.1 Why it is clearly past pre-alpha

| Claim | Evidence | Marker |
| --- | --- | --- |
| It runs as a product, not a prototype | Three editions from one codebase — standalone, self-host relay, hosted paid — with build-time feature removal (`docs/architecture.md` §"Build profile: standalone and relay", `apps/canvas/src/session/mode.ts`) | ✅ |
| The hard correctness work is done | One `LoroDoc` per workspace behind a typed, Zod-validated facade (`packages/graph/src/loro/WorkspaceDocument.ts`, 3,558 lines) | ✅ |
| Merge correctness is *fuzzed*, not assumed | `packages/graph/src/loro/workspace.convergence.test.ts` converges two documents; property tests on merge, sections, search | ✅ |
| Sharing is a real projection system, not a flag | `apps/collab-server/src/projectionWorker.ts` (1,468 lines) rebuilds a redacted self-contained document per share room; ADR-0022, ADR-0023 accepted | ✅ |
| Publish has a plan/apply split | `packages/graph/src/publish/plan.ts` is pure and replayable; `apply.ts` reads only captured values | ✅ |
| Operational thinking exists | Boot-time config validation (`config.ts`, 522 lines), quotas that never drop a save (`limits.ts:9`), 429 + `Retry-After`, `/metrics`, health probe, admin status, backup with integrity checks | ✅ |
| The security basics are right | `timingSafeEqual`, 32-byte random capabilities, SHA-256 at rest, per-room capability scoping, 15-minute share sessions, revocation that closes live sockets | ◐ (mechanics read; end-to-end not re-tested here) |
| Architecture is enforced by tests | `packages/graph/src/purity.test.ts` parses the AST to keep the core DOM-free; `apps/canvas/src/session/mode.test.ts` forbids `fetch`/`WebSocket` outside relay modules; `apps/collab-server/src/patchGuard.test.ts` fails if a dependency patch vanishes | ✅ |
| Documentation is a design artifact | 48 ADRs with statuses and supersession chains, 1,000-line architecture doc, 952-line operations runbook | ✅ |

A pre-alpha would not have a purity test, a convergence fuzz test, or an ADR that says "this
decision was reversed, here is why". Those are the habits of a project that has already survived its
first rewrite.

### 1.2 Why it is not Beta yet

Beta means strangers can use it for real work with known limits. The 2026-10-23 audit found two live
data-loss paths; both are closed as of the 2026-10-25 re-baseline (§7.3). What keeps the product
out of Beta now is evidence and identity rather than data safety:

1. **No commit has ever been gated.** The CI workflow is plausible and complete, but every run in
   the repository is `startup_failure` with zero jobs — including the latest pushes to `main`. ◐
   **Re-verify**: `gh run list --workflow=ci.yml`. Whatever the cause, the claim "tests pass" rests
   on local runs, and a stranger has no reason to believe it. Gate A3 stays `blocked`; §7.1 records
   why no tree change can unblock it.
2. **There is no release tag.** `LICENSE`, `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md` and
   `CODE_OF_CONDUCT.md` exist, and `package.json` reads `0.2.0-alpha.1`. What is missing is a semver
   tag on a released commit, so "which build is this?" still has no artifact to roll back to. The
   repository's single tag (`ice-parity-2026-10-23`) marks a spike, not a release. Gate A4 is
   `measuring` for that one artifact.
3. **Billing is closed, and that is the promise being kept.** The durable store exists
   (`services/billing/store-dynamodb.ts`, behind `SUITE_BILLING_STORE=dynamodb`) and hosted checkout
   is closed in the UI and the docs. A5 is satisfied by the closed path; the failure mode it exists
   to prevent — a payment path that appears to work and loses entitlement on a cold start — is gone.
4. **Three promises still lack an artifact.** The upgrade path has fixtures and a test but no N−1
   policy statement (A7); the supported browser set is Chromium only (B7); and no second operator has
   restored the release from the docs alone (B11).

**Closed since the audit.** Attachments, settings and licences live on `/data`, are covered by
backup/restore, and boot refuses a split or `:memory:` layout (`SUITE_REQUIRE_DURABLE_STORES` — A1).
Multi-tab compaction can no longer delete a peer's unmerged rows, and leadership hands over when the
leader closes (ADR-0024 — A2). The client requests `navigator.storage.persist()`, shows the grant
state, handles quota, and renders a diagnostic instead of a white page, with an opt-in crash hook
(ADR-0025, ADR-0027 — A6). Both reported UX bugs are fixed with e2e coverage (A10).

### 1.3 The one-sentence position

> The product is real, the correctness culture is unusually good, and the data-loss paths the audit
> found are closed. What is missing is the evidence that it works (CI), the artifact that names the
> build (a release tag), and the promises that turn strangers' data into an obligation (upgrade
> path, browser set, operator restore).

---

## 2. What Alpha means here

Alpha is **not a quality label**. In this repository it is a **trust boundary**: whose data is at
risk when something goes wrong.

| Stage | Who can use it | Failure mode | What "done" means |
| --- | --- | --- | --- |
| Pre-alpha | The author, with throwaway data | "I lost my scratch document" | It runs end to end at all |
| **Alpha (here)** | **The team, on real internal work** | **"We fix it and tell the team"** | **The model is right; the edges are known** |
| Beta | Strangers, with published limits | "We owe them a fix and an apology" | Data is durable, limits are published, support exists |
| V1 | Paying strangers, for a year | "We owe them a refund, a restore, and an incident note" | Identity, billing, upgrades, support without SQLite |
| V2 | Evidence-gated expansion | — | Each bet has a measured trigger |

### 2.1 Team-usable

Alpha is satisfied when the people who built it can:

- open a workspace, build boards, place cards, write bodies, attach images, link references,
  search, publish a draft, share a projection, and export a `.suite` file; ✅ all of these exist
- trust the *model*: one document, field-granular writes, scoped undo, stable record identity; ✅
  (`docs/conventions.md`, `docs/architecture.md` §"Undo")
- recover from their own mistakes with a backup they can name. ◐ the backup exists
  (`deploy/backup.sh`) but is incomplete (§6.1), which is exactly the gap between "team-usable" and
  "stranger-safe".

### 2.2 Unsafe for strangers

Alpha is *not* satisfied — and Beta is not entered — while any of these are true. Each line is
marked as it stands on 2026-10-25; the §6 analysis is kept as history.

- A stranger's restore silently drops their images (§6.1). **Closed** — attachments are on `/data`
  and in backup/restore.
- A stranger with two tabs open can lose edits made in the other tab (§6.2). **Closed** — ADR-0024.
- A stranger cannot tell whether the build they run is the build we tested (§1.2 point 2). **Still
  true** — no release tag.
- A stranger who pays gets an entitlement that evaporates on a cold start (§1.2 point 3). **Closed**
  — billing is closed rather than volatile.
- A stranger's browser can silently evict the local document (§6.5, P1 row "client storage").
  **Mitigated** — `persist()` is requested and the grant state is visible.
- A stranger hits an unknown interaction and gets a blank page with no diagnostic (§6.5). **Closed**
  — `CanvasErrorBoundary` and the diagnostics bundle.

### 2.3 The Alpha contract

Alpha tolerance: data loss is possible and may go unnoticed. That is acceptable for the team, who
can say "that was mine, rebuild it". It is not acceptable for a stranger. Gates A1, A2, A6, and A7
exist to close this gap.

---

## 3. Stage scorecard

The table rates twelve dimensions separately. Each stage describes that dimension, not the product
as a whole. A product is as ready as the weakest dimension a stranger will touch.

| # | Dimension | Stage | Evidence | Marker |
| --- | --- | --- | --- | --- |
| 1 | **Core product loop** | Beta-ish | Workspaces, boards, cards, types/fields/tags, sections, connectors, mentions, references, library/trash, undo/redo, search, views, display styles, attachments, sharing (workspace/board/card/selection), publish drafts, `.suite` export/import, standalone edition | ✅ |
| 2 | **Data model & correctness** | Beta-ish | One `LoroDoc` per workspace; Zod-validated writes; typed `WorkspaceDocument`; property tests for merge/sections/search; scoped undo; presence in `EphemeralStore`, never persisted | ✅ |
| 3 | **Test intent** | Beta-ish | 150 Vitest files / 2,065 tests; 46 Playwright specs; 27 stories under the global `a11y: { test: "error" }` gate; 75 billing `node --test` declarations; mutation configs (`stryker.*.config.mjs`); coverage thresholds on `@suite/graph` | ✅ |
| 4 | **Test evidence** | **Alpha** | No verifiable green CI run. Local counts were re-derived on 2026-10-25 and `docs/testing.md` matches them (`pnpm test`: 150 files / 2,065 tests; full `pnpm e2e`: 219 passed, 3 skipped) | ✅ (counts) / ◐ (CI) |
| 5 | **Ops / deploy** | Beta-ish, single node | `compose.yaml` (Caddy → app), TLS + CSP, healthcheck, graceful shutdown, boot-time config validation, `/metrics`, structured redacted logs, admin panel, backup/restore scripts, quota + rate-limit system | ✅ |
| 6 | **Security model** | Alpha+ | Constant-time comparisons, 32-byte capabilities, SHA-256 at rest, scoped worker tokens, PBKDF2 600k, share-token scoping, live revocation. Missing: threat model, audit trail, expiry *by default*, admin scoping, E2EE | ◐ |
| 7 | **Billing** | **Closed by design** | Hosted checkout is closed in the UI and docs; the durable store exists (`services/billing/store-dynamodb.ts`, flag `SUITE_BILLING_STORE`); Stripe webhook E2E is not run because there is no live endpoint | ✅ |
| 8 | **Client resilience** | Beta-ish | `navigator.storage.persist()` with a visible grant state (`StoragePanel`), quota handling, `CanvasErrorBoundary`, opt-in crash reporting, diagnostics bundle; ADR-0025, ADR-0027 | ✅ |
| 9 | **Release management** | **Alpha** | `0.2.0-alpha.1`; `LICENSE`, `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `docs/release.md`; no release tag yet (the one tag marks a spike); 124 commits | ✅ |
| 10 | **Scale evidence** | **Alpha** | Single replica by design; SQLite; in-process rooms/presence/projection/rate limits; benchmarks exist (`packages/graph/bench/workspace.bench.ts`, `projection.bench.ts`) but are not gated | ✅ |
| 11 | **UX / onboarding** | Alpha | Polished visuals, real keyboard/ARIA work, but no accounts, no mobile layout beyond one `max-width: 640px` rule ◐, no i18n, and a recovery model with five terms for three artifacts ◐ | ◐ |
| 12 | **Docs** | Beta-ish, drifting | ~9,800 lines, 48 ADRs, real runbooks; counts, store counts and engine names were re-checked on 2026-10-25 (§9) | ✅ |

### 3.1 Reading the scorecard

No dimension is pre-alpha any more. Billing moved from pre-alpha to closed-by-design (the hosted
path is off, and says so); release management moved from pre-alpha to alpha (the identity files
exist, the tag does not); client resilience moved from alpha to beta-ish when `persist()`, quota
handling, the error boundary and crash reporting landed. What keeps the scorecard from Beta is
**Test evidence** — the one dimension with no exercised proof, because Actions cannot run. The
strongest property is not in the table: recording decisions and enforcing them with tests (§5).

---

## 4. Architecture as built

This section exists because the audit asked for the architecture to be stated explicitly rather than
inferred from 30k lines. It is a summary of [../architecture.md](../architecture.md), re-verified at
the level of module boundaries.

### 4.1 Layers

| Layer | What it owns | Where | Marker |
| --- | --- | --- | --- |
| **Canvas UI** | Rendering, gestures, selection, editors, presence display | `apps/canvas/src/canvas`, `components`, `editor`, `hooks` | ✅ |
| **UI state** | Ephemeral UI only: active board, selection, drawers, connection status | `apps/canvas/src/store/useUiStore.ts`, `useCanvasStore.ts` | ✅ |
| **Document facade** | Typed, validated access to the CRDT; *all* graph writes | `packages/graph/src/loro/WorkspaceDocument.ts` | ✅ |
| **Pure graph core** | Zod schemas, projections, publish planning, search, views, sections, file format | `packages/graph/src/*` | ✅ |
| **Sync client** | Loro provider, presence/cursors, IndexedDB persistence | `apps/canvas/src/collab` | ✅ |
| **Relay** | WebSocket rooms, auth, persistence, shares, workspaces, projections, attachments, admin, metrics | `apps/collab-server/src` | ✅ |
| **Billing** | Stripe webhook → Ed25519 licence → SES email | `services/billing` | ✅ |
| **Deploy** | Runtime image, Caddy TLS/static/proxy, backups | `Dockerfile`, `compose.yaml`, `deploy/` | ✅ |

The dependency direction is deliberate and mostly honoured: `@suite/graph` is pure and cannot import
React, `@xyflow`, `@tiptap` or browser globals (`purity.test.ts` forbids it in the AST). The one
violation is billing importing app source (§6.5).

### 4.2 Truth and data flow

```
React UI ──► Zustand (ephemeral UI only)
   │
   └──► WorkspaceDocument (Zod-validated) ──► LoroDoc   ← the truth
                                                │
                     ┌──────────────────────────┼──────────────────────────┐
                     ▼                          ▼                          ▼
            IndexedDB snapshot         LoroProvider ──WS──► Relay room    (nothing else)
            + update log                      │                       │
                                              ▼                       ▼
                                     presence / cursors       SQLite document store
                                     (EphemeralStore,                │
                                      never persisted)        ProjectionWorker
                                                                     │
                                                            share-<token> rooms
```

Four properties the diagram is meant to make obvious:

- **One `LoroDoc` per workspace.** Cards are objects, boards are views, placements/sections/edges/
  types/tags/references/titles/bodies all live in the same document. ✅
- **The relay is not authoritative.** It authenticates, persists and projects; the client owns the
  truth. That is a coherent, deliberate principle, not an accident (see ADR-0015 and
  `docs/architecture.md` §"Data flow"). ✅
- **Two data planes.** Document plane = WebSocket + Loro + SQLite. Control plane = HTTP: claim,
  rotate, delete, shares, publish/reload/status, attachments, admin, health, metrics. ✅
- **Projection is a derived read model.** A board/card/selection share is a redacted, self-contained
  copy in its own room, rebuilt from the saved workspace. The owner's workspace id never reaches a
  viewer. ✅ (ADR-0022 §3, ADR-0023 §5)

### 4.3 Trust boundaries

| Boundary | Credential | What it can do | Marker |
| --- | --- | --- | --- |
| Browser ↔ relay document room | Owner key **or** share token | Read/write exactly one room, plus its derived presence/cursor rooms | ✅ |
| Browser ↔ share API | Share token → short-lived session | Resolve one share; no minting or revoking | ✅ |
| Browser ↔ workspace API | Owner key | Claim, rotate, delete, manage links | ✅ |
| Projection worker ↔ relay | Scoped worker token | Write projection rooms only | ✅ |
| Publish worker ↔ relay | Source token | Write a workspace room only when an editor share exists | ✅ |
| Operator ↔ admin API/panel | `SUITE_ADMIN_TOKEN` | **Full data access, unscoped** | ✅ |
| Stripe ↔ billing Lambda | Webhook signature | Mint licences | ◐ |
| Billing ↔ relay | Ed25519 licence | Hosted quotas | ✅ |

The highest-risk row is the admin token: one bearer secret reads and deletes every workspace, with
no scoping, no MFA, and no audit trail (§10).

### 4.4 Deployment topology

```
        ┌────────────┐   TLS, CSP, static assets, /api, /ws
Internet│   Caddy    │──────────────┐
        └────────────┘              ▼
                          ┌──────────────────────────┐
                          │   single Node process    │
                          │  ┌────────────────────┐  │
                          │  │  relay + rooms     │  │
                          │  │  projection worker │  │  ← in-process
                          │  │  rate limits       │  │  ← in-process counters
                          │  └────────────────────┘  │
                          └────────────┬─────────────┘
                                       ▼
                        SQLite (one file per store, on /data)
                        documents · shares · workspaces · settings · licences · attachments
```

What is absent at this stage:

| Absent | Consequence | Marker |
| --- | --- | --- |
| Redis / Postgres | No shared room state, no cross-process locks | ✅ |
| Multi-replica mode | `compose.yaml` says single replica; rooms, presence, projections and rate limits are process-local | ✅ |
| A shared lock or lease | A second replica would double-write projection rooms | ✅ |
| A reverse-proxy default rate limit | Flood protection is operator homework | ◐ |
| A message queue | Saves and rebuilds happen on the event loop | ✅ |

**Canonical store statement.** Six stores exist in code (`documents`, `shares`, `workspaces`,
`settings`, `licences`, `attachments`). `compose.yaml` configures all six under `/data` and sets
`SUITE_REQUIRE_DURABLE_STORES=1`, so a `:memory:`, working-directory or split layout is a boot error
rather than a quiet loss. `deploy/backup.sh` and `deploy/restore.sh` cover all six, including
attachment bytes and their ids. ✅ This closes the durability finding that used to live in §6.1 and
is gate A1.

---

## 5. What is working

Ten properties that are better than the norm, each with a pointer. These are why the verdict is
"late Alpha" rather than "prototype".

1. **The pure core is enforced by the AST, not by intention.** `packages/graph/src/purity.test.ts`
   parses TypeScript sources and fails if `@suite/graph` imports React, `@xyflow`, `@tiptap`,
   `loro-adaptors`, or touches `document`/`window`/`localStorage`/`navigator`. That is why the graph
   suite runs in seconds and can be mutation-tested. Most codebases *say* a package should stay pure;
   this one cannot compile a violation. ✅
2. **Field-granular writes and identity-stable snapshots.** `docs/conventions.md` forbids whole-record
   writes, requires one commit per gesture, and keeps record identity stable so React can skip
   re-renders. `WorkspaceSnapshotStore` applies incremental changes and reuses unchanged collections.
   This is a conflict-resolution architecture, not "CRDT as a database". ✅
3. **Publish is pure planning plus replay.** `packages/graph/src/publish/plan.ts` is explicitly pure
   and replayable; `apply.ts` reads captured values only. The plan/apply split, the conflict model and
   the draft baseline are the most sophisticated part of the tree: "what will publishing do?" is
   testable without a server. ✅
4. **Capability scoping is a documented matrix, not an `if`.** Projection token → projection rooms
   only. Source token → a workspace room only when an editor share exists. Share token → exactly one
   room plus its presence rooms. Owner key → its workspace and derived rooms. Empty auth rejected.
   Revocation closes live sockets through the patched `loro-websocket`. ✅ (ADR-0022 §1–§3,
   `docs/architecture.md` §"Room authorization")
5. **Architecture is tested as architecture.** `apps/canvas/src/session/mode.test.ts` scans for direct
   `fetch`/`WebSocket` outside relay modules; `apps/collab-server/src/patchGuard.test.ts` fails if a
   dependency patch disappears; `packages/graph/src/mutationGaps.test.ts` pins behaviours found by
   surviving mutants; `packages/graph/src/loro/workspace.convergence.test.ts` fuzzes two documents to
   convergence. These fail the build, which is more than most architecture docs manage. ✅
6. **Exports are attachment-complete by design.** `.suite` backups carry attachment bytes; an image
   that cannot be found is listed by card title instead of silently dropped; import restores local
   bytes and marks them not-yet-uploaded. The team treats "backup" as a data-loss boundary — which
   makes the §6.1 server-side omission more painful, not less. ✅
7. **Operational semantics are thought through.** `apps/collab-server/src/limits.ts:9` states the rule
   that shapes every refusal: *a save is never dropped*; nothing on the save path consults a quota
   (`docs/operations.md:676`). With boot-time config validation, request ids, redacted capability
   paths in logs, graceful shutdown, backup integrity checks and named metric gauges, this is mature
   thinking for an Alpha. ✅
8. **Supply-chain discipline.** Dependency patches are exact-pinned and guarded by a test;
   `pnpm-workspace.yaml` explains why each patch exists and when to drop it; the Stripe integration is
   hand-rolled HMAC rather than an SDK; the AWS SDK is kept out of the repo install. Deliberate
   dependency minimalism is rare. ✅
9. **Strict TypeScript and behaviour-enforcing lint.** `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, no unused, no fallthrough
   (`tsconfig.base.json`). Biome raises `noFloatingPromises` to an error and bans `noConsole` outside
   the logger (`biome.jsonc`). No `any`, no `@ts-ignore`, no SQL string interpolation, no
   `dangerouslySetInnerHTML`, no `eval` in source. ✅
10. **Docs are design artifacts.** 48 ADRs with statuses and supersession chains (`0021 → 0022`), a mermaid data flow, performance budgets, explicit non-goals, and an
    open-questions table that admits what is undecided. This roadmap exists to extend that habit. ✅

**The through-line:** the project records its reasoning and encodes it as a test. That makes the
risk register below specific rather than vague.

### 5.1 Coding practices and organization

**In good shape.**
- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`) and Biome rules (`noFloatingPromises` as an error, `noConsole` outside the
  logger). Source contains no `any`, no `@ts-ignore`, no SQL string interpolation, no `eval`, and no
  `dangerouslySetInnerHTML` ✅.
- Conventional commits, commitlint, husky, and lint-staged are configured (`package.json`,
  `commitlint.config.mjs`). `@suite/graph` is kept DOM-free by an AST test, not by convention ✅.
- Package boundaries are clear: `apps/canvas`, `apps/collab-server`, `packages/graph`,
  `services/billing`, `e2e`. Turborepo caches build, typecheck, and test tasks (`turbo.json`).
- Dependency patches are exact-pinned and guarded by `patchGuard.test.ts`; the workspace file
  records why each patch exists ✅.

**Friction to watch.**
- **Billing imports app source** (`services/billing/issue.ts:6` → `apps/collab-server/src/licence.ts`).
  This is the one clear package-graph violation (P1-5).
- **Four files carry a large share of the domain:** `WorkspaceDocument.ts` (3,558 lines, 140
  methods), `CanvasBoard.tsx` (2,412), `adminHttp.ts` (1,516), `projectionWorker.ts` (1,468). They
  are internally organized and tested, but they are merge-conflict and review bottlenecks (P1-4).
- **Review capacity is the main organizational risk.** The tree has 124 commits on one branch, zero
  tags, zero releases, and no external issues or pull requests. `CONTRIBUTING.md`, `CODEOWNERS`, and
  a release process do not exist. That is workable for a solo project and insufficient for Beta.
- **Documentation is not enforced.** `AGENTS.md` still names `GraphDocument` and
  `useGraphSnapshot`, which do not exist (`AGENTS.md:83-84`). Stale agent instructions cause agents
  to invent APIs, so this is a correctness issue, not a style issue (D7).

---

## 6. Alpha bug and risk register

Format for each item: **symptom → where → impact → fix direction → acceptance evidence → status.**

Status vocabulary: `open` (believed present), `open/needs-repro` (reported, not yet reproduced by us),
`mitigated` (guard exists, but the class of bug remains), `closed` (fixed with evidence).

### 6.1 P0 — Live data loss: attachments are not durable in the deployment

> **Status: closed 2026-10-25 (gate A1).** All six stores are on `/data` in `compose.yaml`;
> `SUITE_REQUIRE_DURABLE_STORES=1` refuses a split, `:memory:` or relative layout at boot;
> `deploy/backup.sh` and `deploy/restore.sh` snapshot attachments with an id digest;
> `deploy/drills/attachments-record.md` records the container-recreate drill. The analysis below is
> kept as the record of the finding.

**Symptom.** Uploaded images survive until the container is recreated, then render as placeholders.
A restore from backup loses them permanently.

**Where.**

| Fact | Evidence | Marker |
| --- | --- | --- |
| Attachments DB path defaults to the process working directory | `apps/collab-server/src/attachments.ts:79-80` — `env.SUITE_ATTACHMENTS_DB?.trim() \|\| "suite.attachments.sqlite"` | ✅ |
| `compose.yaml` sets `SUITE_DB`, `SUITE_SHARES_DB`, `SUITE_WORKSPACES_DB` under `/data` but **not** `SUITE_ATTACHMENTS_DB` | `compose.yaml:37-41` | ✅ |
| No `SUITE_ATTACHMENTS_DB` in `.env.example` | grep returns nothing | ✅ |
| `deploy/backup.sh` snapshots five stores, not attachments | `deploy/backup.sh:70-77`, `:122-133` | ✅ |
| `deploy/restore.sh` accepts exactly `documents \| shares \| workspaces \| settings \| licences` | `deploy/restore.sh:116` | ✅ |
| Ops docs still say attachments are "reserved" | `docs/operations.md:80`, `:668` | ✅ |
| `limits.ts` says the same | `apps/collab-server/src/limits.ts:32-33` | ✅ |
| `README.md` and `docs/security-model.md:72` say "three SQLite files" | §9 | ✅ |

**Impact.** Silent image loss on any `docker compose up --force-recreate`, image update, or host
migration. Worse, it looks like a sync bug, not a storage bug: the document still holds the
attachment id, so the UI shows a broken image forever. A restore produces a *successful* integrity
check on five databases while the sixth is gone. This is the single highest-severity item in the
document because it is both destructive and invisible.

**Fix direction.**

1. Set `SUITE_ATTACHMENTS_DB: /data/attachments.sqlite` in `compose.yaml`, and document it in
   `.env.example` beside the other stores.
2. Add `attachments` to `deploy/backup.sh` (`.backup`, integrity check, byte count, checksum) and to
   the `restore.sh` store list and manifest validation.
3. Extend the manifest with an attachment **count** and a **checksum over ordered ids** so a restore
   can prove it restored the same set, not merely a readable file.
4. Treat a missing attachments DB at boot as a startup error when other stores are present
   (not a silent empty database).
5. Update `docs/operations.md`, `docs/security-model.md`, `README.md` and `limits.ts` in the same
   change — see gate A8.
6. Audit the other two `:memory:` stores while here (`compose.yaml:40-41`).

**Acceptance evidence (gate A1).**

- An integration test that starts the composed stack, uploads an image, recreates the container, and
  reads the image back byte-identical.
- A backup/restore drill that includes a workspace with ≥1 attachment and asserts the restored image
  bytes hash equal to the original.
- `manifest.txt` from the drill contains an attachment count and checksum.
- `docker compose config` shows `SUITE_ATTACHMENTS_DB` under `/data`.

**Status:** `closed` 2026-10-25 (gate A1).

### 6.2 P0 — Live data loss: multi-tab IndexedDB compaction deletes every workspace update row

> **Status: closed 2026-10-25 (gate A2).** Compaction now runs under leader election
> ([ADR-0024](../decisions/0024-multi-tab-persistence-and-leader-election.md)); a surviving tab takes
> leadership over when the leader closes (`loroPersistence.ts`, `destroy()` releases the lease), and
> the two-instance / leader-takeover suites cover it. The analysis below is kept as the record of the
> finding.

**Symptom.** With two tabs open on the same workspace, a compaction in one tab destroys the other
tab's unmerged offline edits.

**Where.** `apps/canvas/src/collab/loroPersistence.ts:160-180` — `compact()` writes *this tab's*
`doc.export({ mode: "snapshot" })`, then reads every key in the `workspaceId` index of the updates
object store and deletes them:

```ts
const keys = await request<IDBValidKey[]>(index.getAllKeys(IDBKeyRange.only(this.workspaceId)));
for (const key of keys) transaction.objectStore(UPDATES).delete(key);
```

Compaction is scheduled every `COMPACT_INTERVAL_MS = 2_000` (`loroPersistence.ts:8,140-145`) and also
runs on `flush()`. A second delete loop exists at `:72-73`, in the load/migration path. ✅

**The exact failure scenario.**

1. Tab A and Tab B are both open on workspace `W`. Each holds its own `LoroDoc`
   (`apps/canvas/src/store/useCanvasStore.ts:35-52` — module-level singletons, so a *new page load*
   means a *new doc*).
2. The network drops. Tab B edits three cards offline. Tab B's provider queues updates into its own
   `LoroDoc`; nothing reaches the relay.
3. Tab A is online-ish but has not received B's updates (B never sent them; there is no
   `BroadcastChannel` between tabs).
4. Tab A's 2-second timer fires → `compact()` → snapshot of A's doc (without B's edits) is written →
   **all** update rows for `W` are deleted, including the rows B appended. B's rows were the only
   durable copy of B's edits.
5. Tab B reloads (or the OS reclaims it). It loads the snapshot plus *no* updates. B's three cards are
   gone.

Online, the server may still hold B's edits, so the bug hides inside a normal session and surfaces
only in the offline/reload window — the window a local-first product exists to protect.

**Impact.** Silent loss of a peer's offline work. No error, no prompt, no recovery: the update log
was the recovery mechanism and it was deleted.

**Fix direction** (either, or both, but not neither):

- **Option A — one writer per workspace.** Elect a leader with the Web Locks API
  (`navigator.locks.request("suite-persist:<roomId>", { mode: "exclusive" }, …)`). Only the leader
  compacts; followers append and read. Add a `BroadcastChannel` to announce compaction and to
  forward updates between tabs so each tab's doc converges without a server round trip.
- **Option B — delete only what the snapshot covers.** Store each update row with the version vector
  it produces, and delete only rows whose vector is contained by the snapshot's vector. Correct, but
  requires teaching the persistence layer about Loro versions, and it does not give the tabs
  convergence.
- **Recommendation:** A, with B's version-vector filter as a defensive second check, because A also
  fixes the "two tabs diverge forever while offline" problem that B leaves in place.

**Acceptance evidence (gate A2).**

- A two-instance test on `fake-indexeddb`: construct two `LoroIndexeddbPersistence` objects over the
  same database and workspace; append different updates from each; compact from instance 1; reload
  instance 2; assert both edit sets are present and the documents converge.
- A test that compaction from a non-leader is a no-op (lock held by another "tab").
- A manual two-tab offline drill: edit in both tabs with the network off, close one, reload the other,
  compare against a third peer's copy.

**Status:** `closed` 2026-10-25 (gate A2).

### 6.3 Reported UX bug — marquee multi-select breaks the page

**Report.** "Multi-select via marquee breaks the page as soon as any item is selected/contacted."
✅ Reproduced in both shapes (peer drag during the box; cancel mid-gesture) and fixed. The root cause
was selection ownership: the window listener effect was keyed on a callback that changed whenever a
peer tick rebuilt the board, so its cleanup released `marqueeActive` mid-gesture and the next repaint
wrote the store's stale selection over React Flow's live one.

**Where.** `apps/canvas/src/canvas/CanvasBoard.tsx`:

| Lines | What lives there | Why it is a suspect |
| --- | --- | --- |
| `:355-365` | `paintedSelection` and `marqueeActive` refs with a long comment about the race | A guard already exists for exactly this symptom, which means the race was seen before and is still reachable |
| `:383-416` | `runSmoothing()` → `setNodes` on every animation frame while any peer target is moving | A peer pointer tick during a marquee re-runs `setNodes`; combined with diffing, this is the "repainting `selected` over a live marquee" path |
| `:424-425` | `repaintSelection = !marqueeActive.current && selectedKey !== paintedSelection.current` | The guard only covers `applyBoardNodes`; other `setNodes` callers bypass it |
| `:742-765` | `userSelectionRect` → `setSelectionBox` → presence publish, throttled by `DRAG_THROTTLE_MS` | Publishing the marquee box mutates presence state, which can re-render the board *during* the gesture |
| `:1751-1760` | `onSelectionStart` / `onSelectionEnd` set `marqueeActive`, and `onSelectionEnd` calls `applyBoardNodes()` | `onSelectionEnd` is the only place the guard is released; a cancelled gesture (Escape, pointer-up outside) may not fire it |
| `:1840-1845` | `onSelectionContextMenu` — "a marquee leaves React Flow's selection overlay over the cards" | The overlay intercepts pointer events; context menu paths assume node hit-testing |

**Impact.** A blank page or unbounded re-render during the most ordinary multi-select gesture. If it
throws, there is no error boundary (§6.5), so the user sees a blank page. The result ranges from
"feels unfinished" to "lost my work because the tab died".

**Reproduction checklist** (to be automated as an e2e spec):

1. Open a board with ≥3 cards. Marquee over **one** card. Release. Page alive? Selection painted?
2. Marquee over **two** cards, then over **many** (10+). Any difference?
3. Marquee across two **sections** (overlapping rectangles, per ADR-0017 geometry).
4. Marquee while a **peer** is dragging a card (forces `runSmoothing` frames during the gesture).
5. Marquee while a peer is *marqueeing* (forces `selectionBox` presence updates during the gesture).
6. Marquee starting on a card rather than the pane; marquee ending outside the viewport; Escape
   mid-marquee; context-click during the marquee.
7. After each: keyboard still works (`Tab`, arrow nudge, `Cmd-Z`), and the browser console has no
   error.

**Fix direction.**

- Make `marqueeActive` authoritative for **all** `selected` painting, not just `applyBoardNodes`;
  centralise node painting through one function that consults the ref.
- Release the guard on every termination path (`onSelectionEnd`, pointer cancel, Escape, unmount), not
  only the happy path.
- Stop publishing the presence selection box through the same store that feeds `setNodes`; publish it
  to the ephemeral store directly, or throttle it outside the React render path.
- Treat `selected` as **React Flow's** state during a gesture and reconcile exactly once at the end.
- Add an error boundary first (§6.5, A6) so the failure is diagnosable while the fix lands.

**Acceptance evidence (gate A10).**

- An e2e spec covering the checklist above: select 1, select 2, select many, across sections, with a
  peer present — no crash, no blank frame, no console error, keyboard still functional.
- A React Profiler or render-count assertion that a marquee does not re-render the board more than
  once per animation frame.
- A regression note in the changelog once releases exist.

**Status:** `closed` 2026-10-25 (gate A10). Both former `test.fixme` cases are real specs in
`e2e/tests/marquee.spec.ts`; listeners register once and call through a ref, and every termination
path clears the selection overlay. The specs re-fit and re-measure between gestures so they assert
selection ownership, not auto-pan or a moved viewport.

### 6.4 Reported UX bug — local interaction has no smoothing, remote drags do

**Report.** "Artificial smoothing for the client doing the interaction would be nice. Not as extreme
as what we project across the sync (which is great/bouncy), but smoother somehow. Sometimes feels a
bit frame-droppy." ◐

**Where.** `apps/canvas/src/canvas/CanvasBoard.tsx:54` (`const SMOOTHING = 0.22;`) and `:383-416`
(`runSmoothing`: exponential ease toward `peerTargets` on each animation frame, `0.5px` settle
threshold, `requestAnimationFrame` loop). Local drags commit through `onNodeDrag` (throttled by
`DRAG_THROTTLE_MS`), `onNodeDragStop` → `commitDrop`, and a CRDT write per gesture — **no easing on
the local path**. ✅

**Impact.** Two different physical feels for the same object. Remote motion is smooth and slightly
elastic; local motion is whatever React Flow and the CRDT round trip produce, which appears
frame-droppy under load. Users judge a canvas by their own drag first.

**Fix direction.**

- Add a **separate, subtler** local easing constant (e.g. `LOCAL_SMOOTHING ≈ 0.45-0.6`, settling
  faster than the remote `0.22`) applied to **local viewport/drag deltas only**.
- **Never write intermediate positions to the CRDT.** One commit per gesture, at drop (already the
  contract in `docs/conventions.md`). Smoothing must be a *rendering* transform, not a document
  mutation.
- Interpolate the **delta**, not the node's truth: keep the committed position as the source, render
  `committed + eased remainder`.
- Consider whether the frame-drop is really scheduling: check whether `setNodes` during drag competes
  with `runSmoothing`'s own `setNodes`, and whether the peer loop runs while no peer is moving.
- Guard against input lag: local easing must be **predictive**, ending at the pointer, not trailing
  it.

**Acceptance evidence (gate A10).**

- Instrumented run at 60 Hz and 120 Hz: p95 frame time during a local multi-node drag within budget,
  no dropped frames attributable to `setNodes` churn.
- Subjective acceptance: local drag feels at least as responsive as today (no added input lag) and no
  longer "steppy".
- A test asserting exactly one CRDT commit per gesture regardless of smoothing.
- A test asserting remote smoothing behaviour is unchanged (`0.22` settle path).

**Status:** `closed` 2026-10-25 (gate A10). Implemented in `apps/canvas/src/canvas/localEasing.ts`. It is a time-based
render-only ease (`tau` 12 ms) on the delta; pointer samples only set the target, one rAF paints,
drop snaps to the pointer and commits once. `prefers-reduced-motion` skips it; remote smoothing is
unchanged. Unit tests cover the one-commit contract and the reduced-motion path.

### 6.5 P1 — Important, not Alpha-blocking

| # | Item | Symptom | Where | Impact | Fix direction | Acceptance evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1-1 | **Synchronous full-state SQLite saves on the event loop** | Every room writes a whole-document BLOB, serially, on the main thread | `apps/collab-server/src/persistence.ts` (one `state` BLOB per room, `DatabaseSync`), `server.ts:212` (`saveInterval: 2000`) | At ~12 MB/5,000-card workspace, each save is megabytes of write amplification and blocks every WebSocket message for the duration; several active rooms serialize into visible latency spikes | Persist incremental Loro updates and compact periodically; move SQLite to a worker thread; add `busy_timeout`; measure **event-loop lag**, not save duration | Lag histogram during a save under load; save duration p95; no message interleaving failure | `open` |
| P1-2 | **Projection rebuild is full clear-and-rewrite per share, single peer, single worker** | Every save rebuilds every projection of that workspace | `apps/collab-server/src/projectionWorker.ts` (1,468 lines); `docs/architecture.md` §"Share projections" documents the LWW-one-peer design | A 2,000-card board with several shares pays the full cost per save; design cannot survive a second worker or multi-replica without a lease | Use publish diff machinery for incremental projection; skip when the source version vector is unchanged; record projection build time per share and cap it; add a per-room lease if a second worker is ever introduced | Per-share build-time metric; skip ratio; a test that an unchanged workspace rebuilds zero shares | `open` |
| P1-3 | **Module-load singletons make the app one-workspace-per-page-load** | `LoroDoc`, `WorkspaceDocument`, presence stores, persistence and provider are constructed at import; `SESSION` is read at import | `apps/canvas/src/store/useCanvasStore.ts:35-52` | No clean workspace switch without reload; tests must reset modules; accounts/multi-workspace tabs get harder the longer this stays | Introduce a `WorkspaceSession` factory/context created at boot, with doc/persistence/provider injected; remove the `import.meta.env.MODE` standalone workaround | A test that two sessions can exist in one process; a workspace switch without reload | `open` |
| P1-4 | **God objects** | One class/file owns a whole domain | `WorkspaceDocument.ts` 3,558 lines / **140 methods**; `CanvasBoard.tsx` 2,412; `adminHttp.ts` 1,516; `projectionWorker.ts` 1,468 | Review, onboarding and merge-conflict cost; every change touches a file everyone is editing | Split behind the existing facade by aggregate (cards, boards, types/tags, edges/sections, content); extract canvas gesture hooks; split admin routes and projection phases. Existing tests are the safety net | Line/method counts down; no behaviour change in the suite; import graph shows no cycles | `open` |
| P1-5 | **Billing imports app source** | `services/billing/issue.ts:6` imports `../../apps/collab-server/src/licence.ts` | Same | Breaks the package graph; the Lambda bundle reaches into an app; two test runners (Vitest in workspace, `node --test` in billing) | Create `packages/licence` (format, sign/verify, types) used by relay, canvas and billing; keep enforcement wrappers in the server | Billing builds without an `apps/` import; one runner; no parser drift test failures | `open` |
| P1-6 | **Ad-hoc migrations, no `busy_timeout`** | Each store does its own `PRAGMA table_info` + `ALTER TABLE`; no `user_version`, no ordered list | `shares.ts`, `settings.ts`, and peers | Upgrade correctness distributed across six files; an admin command or live `sqlite3` can hit `SQLITE_BUSY` immediately | One small migration runner (shared helper), versioned and logged at boot; `busy_timeout = 5000` on every connection; N−1 fixture tests | N−1 database files open and migrate; a concurrent `sqlite3` read does not error | `open` |
| P1-7 | **CORS default is `*`; docs say allowlist** | Empty `SUITE_ALLOWED_ORIGINS` yields `["*"]` | `apps/collab-server/src/config.ts:277` | Broader than documented and unnecessary with bearer tokens and no cookies | Default to **no** CORS headers (same-origin); require explicit `*` to opt in; update `.env.example` and security model | Config test asserting no `Access-Control-Allow-Origin` by default; docs match | `open` |
| P1-8 | **Quality gates cover the easy half** | Mutation is scoped to `licence`, `limits`, `config` on the server and `publish/*`, `projection`, `search`, `views`, `sections` on the graph | `stryker.server.config.mjs:37-41`, `stryker.graph.config.mjs:38-46` | The modules where a mistake has high impact — `auth`, `shares`, `persistence`, `WorkspaceDocument` — are not mutated; server coverage is measured, not gated | Gate server coverage on auth/shares/persistence; add changed-file incremental mutation to PRs and keep full runs scheduled; add `WorkspaceDocument` once the publish split settles | Mutation score published per module; PR job that fails on a new surviving mutant in changed files | `open` |
| P1-9 | **No API contract or versioning** | Client hand-writes `fetch`; server hand-parses bodies; errors are human strings; routes unversioned | `apps/collab-server/src/http.ts`, `adminHttp.ts`; client call sites | Every client change re-derives the shape; no stable error codes for UI copy or i18n; no deprecation path | `packages/contracts` with Zod request/response schemas; derive client types; `/api/v1`; `{ error: { code, message, requestId } }` | Contract tests on both sides; a client type error when the server shape changes | `open` |

**Additional P1, verified here:** `SUITE_SETTINGS_DB` and `SUITE_LICENCE_DB` default to `:memory:`
in `compose.yaml:40-41`, so hosted licence claims do not survive a container recreate. ✅ This is
part of A1, not a separate work item.

### 6.6 P2 — Post-Beta

| # | Item | Symptom | Where | Impact | Fix direction | Status |
| --- | --- | --- | --- | --- | --- | --- |
| P2-1 | **Owner key in `localStorage`** | `suite.ownerKey.<workspaceId>` is readable by any same-origin script | `apps/canvas/src/session/ownerKey.ts:93-116` | The highest-value secret in the app; one XSS is total workspace compromise. Mitigated (not solved) by a strong CSP, no `dangerouslySetInnerHTML`, validated image/link schemes | Accounts move paid users to HttpOnly session cookies; for anonymous users, a non-extractable WebCrypto wrapper in IndexedDB; document the tradeoff explicitly in the security model | `open` |
| P2-2 | **No backpressure or message-size cap on document updates** | `MAX_BODY_BYTES = 64 KiB` is the **control plane only** | `apps/collab-server/src/http.ts:156` (control plane); doc updates are WebSocket frames with a 10 s fragment timeout and no total cap | A scripted client or a huge paste forces a large `applyUpdates` and then a full-state save — the P1-1 failure mode, amplified | Cap per-message and per-room update bytes; rate-limit updates; log and deny oversized ones | `open` |
| P2-3 | **Worker tokens generated per start** | `resolveWorkerTokens` mints random tokens when unset | `config.ts` | Fine in-process; a separate projection worker would be invalidated by every restart | Document the deployment contract, or persist/rotate tokens explicitly | `open` |

### 6.7 What this register is *not* saying

- It is not saying the model is wrong. Nothing here requires a rewrite; every item is a bounded
  change behind an existing seam.
- It is not exhaustive. It is the set of items with a *named* failure mode.
- It is not a work order. §8 groups the work; §11 assigns each deferral to a later stage.

---

## 7. Alpha exit gates

Beta entry is defined by these gates. Each gate names its **evidence artifact**: the thing an
outsider could inspect. A gate without an artifact is not closed. The Beta and V1 gate mapping is in
[beta.md §1.3](./beta.md#gate-crosswalk).

A11 (Portals) is pinned as an alpha gate for the next planning phase. It is not claimed open; its
scope, data model, and acceptance are sketched in §7.4. It is split into **A11a** (real portals in
a derived scene) and **A11b** (fractal layout presets); that split is now history, with A11a
deferred and A11b carrying on.

> **Amendment (2026-10-25).** A11a is `deferred` with the removed scene surface, and A11b continues
> as the fractal layout command on the React Flow board.

| Gate | Statement | Required evidence | Depends on |
| --- | --- | --- | --- |
| **A1** | Attachments, settings, and licence state are durable | Container-recreate test for all three; backup/restore drill with an attachment; manifest count + checksum; `SUITE_ATTACHMENTS_DB`, `SUITE_SETTINGS_DB`, and `SUITE_LICENCE_DB` all point at `/data` in `compose.yaml` and `.env.example`; **boot refuses a mixed layout** (attachments on CWD while other stores are `/data`, or `:memory:` settings/licences in a composed deployment); ops/security/limits docs corrected | — |
| **A2** | Multi-tab persistence cannot delete a peer's work | Two-instance `fake-indexeddb` test (compact in A, reload B, both survive); leader-election test; two-tab offline drill record | — |
| **A3** | CI actually gates `main` | A green `quality` + `e2e` run on `main`, visible in Actions; branch protection with required checks; a deliberately failing commit demonstrated to be blocked | — |
| **A4** | The product has an identity | `LICENSE`; `SECURITY.md`; `CHANGELOG.md`; semver tag on the released commit; version reported by `/health` or admin status; images pinned by digest | A3 |
| **A5** | Billing is either durable or explicitly closed | Either a durable store with conditional writes and a Stripe test-mode webhook E2E, **or** hosted checkout disabled and every surface saying "billing is not open" | A3 |
| **A6** | The client can fail without losing the page | `navigator.storage.persist()` requested on first edit **and** from a gesture ("Keep a copy on this device"); a save pill that is a status ("Saved on this device") with the durability caveat in the panel; quota handling; an error boundary that renders a diagnostic instead of white; a crash hook (opt-in); `e2e/tests/save-state.spec.ts` | — |
| **A7** | An old document opens in a new build | N−1 fixture test for the workspace format; `schemaVersion` policy in code (currently stamped at `WorkspaceDocument.ts:1326-1327` with no migration step); N−1 database fixture per store | A3 |
| **A8** | The docs tell the truth | §9 ledger emptied; `pnpm docs:check` (links + code fences) in CI; `AGENTS.md` names real types | — |
| **A9** | The limits are published | A single limits page: workspace bytes, card count, attachment bytes/workspace, shares/workspace, selection cards, open rooms, peers/room, restore targets. Values sourced from `limits.ts` and `compose.yaml`, not prose | A1 |
| **A10** | Both reported UX bugs are closed | Marquee e2e checklist (1, 2, many, across sections, with a peer); local-vs-remote smoothing acceptance at 60/120 Hz; one CRDT commit per gesture | A6 |
| **A11a** | Real portals in a derived scene | Portal data model retained (ADR-0029); a portal renders a live, scaled target board at readable zoom and its miniature only as the far-LOD impostor; entering moves the camera and the root board stays active; nested portals expand lazily with cycle/depth guards; scene outline and camera checkpoints replace the overlay transition; a share expands only in-scope targets; e2e covers zoom-through without a board switch, depth ≥ 2, a cycle, back to the exact camera, and one CRDT commit per gesture | A10 |
| **A11b** | Fractal layout presets | One-shot recursive layout commands with per-depth overrides, a preview, one undoable batch and deterministic output; no live reflow; unit/e2e coverage of recipes, cycles and pinned cards | A11a |

### 7.1 Gate notes

**A1 — why a container-recreate test and not a unit test.** The bug is a deployment fact: the code
is correct and the compose file is not. Only a test that runs the composed stack can fail when the
volume mapping regresses.

**A1 also covers the `:memory:` stores.** Settings and licence claims default to `:memory:` when a
deployment does not configure them, so operator limit overrides and hosted entitlements did not
survive a restart. That is now refused: `compose.yaml` sets all six store paths under `/data` and
`SUITE_REQUIRE_DURABLE_STORES=1`, and `config.ts` fails the boot with a named error for an unset,
`:memory:`, relative or split layout.

**A1 hardening (implemented).** Rather than documenting the trap, the server refuses the ambiguous
deployment at boot — the same guard covers the "attachments somewhere else" case. Closing
attachments alone would have left a paid customer's entitlement as volatile as the attachment
bytes; A1 covers all six stores.

**A2 — why two instances in one process.** `fake-indexeddb` gives a shared database across two
`LoroIndexeddbPersistence` objects, which is exactly the browser's situation. A single-instance test
would pass today.

**A3 — why a deliberately failing commit.** A green run proves the workflow can run; a blocked
commit proves the check is *required*. Branch protection is the difference between "we have CI" and
"CI gates us".

**A3 status: `blocked` — account entitlement, not a code defect (re-verified 2026-10-23).** Actions is
enabled (`enabled: true`, `allowed_actions: all`), the workflows pass `actionlint` v1.7.12, and the
remote files match the local files. Every run, including `workflow_dispatch` and a one-line smoke
workflow on a throwaway branch, ends in `startup_failure` with 0 jobs and 0 check runs. The same
signature appears in a second private repository on this account (169 runs, none successful), and no
run in either repository has ever produced a job, so this is not a regression in the YAML. Branch
protection and rulesets return `403: Upgrade to GitHub Pro or make this repository public`.

The cause is an account-level entitlement for hosted runners on private repositories — most likely
exhausted included minutes or a zero spending limit. Nothing in this tree can change it.

**What stands in for A3.** `pnpm verify` plus `pnpm e2e`, recorded with commands and output in
[`docs/release.md`](../../docs/release.md) so the claim is reproducible by hand instead of taken on
trust. That is weaker than a required check — a stranger cannot see it run — and A3 stays `blocked`
rather than `open` until Actions executes and the repository can require checks.

**What unlocks it, cheapest first.** Make the repository public (free, unmetered, and enables branch
protection on the free plan); add a payment method or raise the spending limit (keeps it private);
or attach a self-hosted runner on the operator's machine (no metered minutes, unverified against an
admission block). The workflow files stay in place and correct so any of these needs no code change.

**A4 — why a tag and not a version field.** `package.json` now reads `0.2.0-alpha.1` and the identity
files exist (`LICENSE`, `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
`docs/release.md`), but no semver tag points at a released commit: the repository's only tag
(`ice-parity-2026-10-23`) marks a spike. The tag is the artifact that answers "which build is this?"
and gives a rollback target, so A4 stays open until one exists.

**A5 — why "or".** Beta is about strangers doing real work; taking money is a V1 promise. Either
billing works, or the product says clearly it does not. The failure mode to avoid is a payment path
that *appears* to work and loses entitlement state on a cold start.

**A6 — why an error boundary is Alpha-critical.** Without one, every UI bug is indistinguishable
from a crash, and §6.3 cannot be diagnosed in the field. A6 also covers the §2.2 item "a stranger's
browser can silently evict the local document": `persist()` and quota handling are the mitigation.

**A7 — why N−1 and not a migration framework.** `WorkspaceDocument.ts:1326-1327` stamps the current
schema version on open without a migration. That is a no-op today by construction. Beta users will
hold old documents, so the no-op must be *tested*, not asserted.

**A9 — why before Beta and not after.** A published limit tells strangers what the single-node
system can handle. It converts "it got slow" into "you exceeded the documented workspace size".

**A10 — why both bugs.** Multi-select and drag are the first interactions a new user exercises.
A page-breaking marquee or visibly uneven local drag is more damaging than a missing feature.

### 7.2 Gate review

Each gate has an owner role, an evidence artifact, and a status. For a project of this size the
owner is the maintainer/operator; no separate review board is implied.

- **States:** `unopened` (no artifact), `measuring` (work in progress), `open` (artifact linked),
  `failed` (measured and not met), `deferred` (explicitly out of Alpha, with a reason).
- **Review event:** review the gate table at every release candidate and at each stage transition.
  A gate is not closed by discussion; it is closed by a linked artifact.
- **Expiry:** a gate that remains `unopened` or `measuring` at two consecutive release candidates is
  treated as `failed` for planning purposes. Its dependent work is cut or moved to a later stage,
  not kept open indefinitely.

### 7.3 Gate status at integration

| Gate | Status | Evidence |
| --- | --- | --- |
| A1 | `open` | Six stores on `/data`, backup/restore with attachments, and a recreate drill. `SUITE_REQUIRE_DURABLE_STORES=1` (set in `compose.yaml`) makes boot refuse an unset, `:memory:`, relative, or split store layout and names every offending variable. Evidence: `compose.yaml`; `deploy/backup.sh`; `deploy/restore.sh`; `deploy/drills/attachments-record.md`; `apps/collab-server/src/config.ts` + `config.test.ts` (store-durability suite); `attachmentDurability.test.ts` |
| A2 | `open` | `apps/canvas/src/collab/loroPersistence.ts`; `loroPersistence.test.ts` (two-instance and leader-takeover); ADR-0024 |
| A3 | `blocked` | Account entitlement, not code: every run is `startup_failure` with zero jobs, in this repo and a second private one, with no successful run ever. The local gate (`pnpm verify` + `pnpm e2e`) is published in `docs/release.md`. Unlock by public repo, billing, or a self-hosted runner. See §7.1. |
| A4 | `measuring` | Identity files exist; the release tag does not. `LICENSE` (MIT), `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `docs/release.md`, `package.json` at `0.2.0-alpha.1`; ADR-0026 |
| A5 | `open` | `services/billing/handler.ts` (closed by default, `503` before signature), `docs/billing.md`, `.env.example` |
| A6 | `open` | `apps/canvas/src/shell/ErrorBoundary.tsx`, `storage/durability.ts`, `components/StoragePanel.tsx`, `crash/*`, `compose.crash.yaml`; ADR-0025, ADR-0027 |
| A7 | `open` | `apps/collab-server/src/persistence.ts` (`loro-snapshot-v1`), `fixtures/n-1/`, `storeUpgrade.test.ts` |
| A8 | `open` | `scripts/docs-check.mjs`; corrected `README.md`, `AGENTS.md`, `docs/testing.md`, `docs/billing.md`, `docs/deploy-aws.md` |
| A9 | `open` | `scripts/generate-limits.mjs`; generated `docs/limits.md`; `--check` in CI |
| A10 | `open` | Marquee selection ownership fixed; both former `fixme` cases are real specs (peer drag during the box, cancel mid-gesture); local drag easing is render-only and one commit per drop. Evidence: `apps/canvas/src/canvas/CanvasBoard.tsx`; `apps/canvas/src/canvas/localEasing.ts` + tests; `e2e/tests/marquee.spec.ts` |
| A11a | `deferred` | The live, scaled portal instance was the scene surface's job, and that surface is removed: a portal is a doorway again (card + `board` field + miniature + camera transition), and the data model (ADR-0029) is unchanged. Nothing to close here. |
| A11b | `closed` | The fractal planner is **cut**: it lived in `packages/scene`, which came from the abandoned second engine and was imported by nothing but its own unwired command (`apps/canvas/src/canvas/layoutCommand.ts`). What survives is graph-owned: `packages/graph/src/layoutPlan.ts` + `applyLayoutPlan` still commit a whole plan as one undoable batch. Arrange on a selection is **A17**. |

### 7.4 A11 — Portals and card focus (pinned)

**Amendment (2026-10-25).** The live-scene rendering target is withdrawn, so **A11a is withdrawn**
and the scene surface is removed. The
data-model decisions below stand and ship; the "Scene rendering (A11a target)" paragraphs are kept
as the record of a direction that was not taken.

**Name.** "Portals" is the working name. It is better than "nested canvases" because the user-facing
object is a doorway, not a container. Alternatives if it ever needs renaming: *Vistas*, *Doorways*,
*Looking Glass*.

**Amendment (2026-10-23).** The data model below was accepted in ADR-0029 and stands. The rendering
and acceptance were, for a time, superseded: the static miniature plus camera transition that swaps
`activeBoardId`, and the one-level nesting limit, were no longer the target. That direction is now
withdrawn; A11 is **A11a** (deferred) and **A11b** (fractal layout presets).

**Definition.** A portal is a card on a board that represents another board. In the target it is a
**live, scaled instance** of its target inside one continuous scene: the root board stays active,
and entering a portal moves the camera rather than replacing the board. Far away, the card shows a
miniature impostor; close enough, the target's cards, sections, edges and nested portals are part
of the same plane.

**Data model (accepted, ADR-0029).**
- A built-in `portal` card type with a `board` field kind. A board reference participates in views,
  publish redaction, and backlinks like any other reference value. `packages/graph` exports
  `PORTAL_TYPE_ID`, `PORTAL_BOARD_FIELD_ID`, and `createPortalCard`.
- A portal is a *card*, not a new object class. Cards already have multiple placements, so the same
  target board can be reached from several boards.
- A portal **references** its target board; it never owns or deletes it. A deleted target leaves the
  portal readable as *Unavailable board*. `deleteType("portal")` and removal of the board field are
  refused.

**Scene rendering (A11a target).**
- `@suite/graph` is the only document truth. A pure projection derives the scene from the graph
  snapshot and the camera; it is never written back. The scene is painted through a `SceneSurface`
  adapter, with the real `NodeCard`/Tiptap as the DOM layer at readable zoom.
- A portal card owns a child `BoardInstance` fitted into its frame. Below the expansion gate the
  portal draws its **impostor** — the existing `BoardMiniature` — and instantiates nothing. Above
  the gate the target's cards, sections and edges are instantiated at the projected scale and become
  interactive.
- LOD bands are discrete (`full` ≥ 0.75, `compact` 0.35–0.75, `icon` 0.12–0.35, `hidden` < 0.12).
  Downgrade is immediate; upgrade waits for the higher threshold plus a dwell time. DOM editors
  mount only at `full`, within a budget.
- Expansion is lazy and bounded: only visible subtrees instantiate children, a repeated board path
  (`A → B → A`) stops at a stub with a focus action, and a hard depth cap (default 6) protects
  pathological graphs. Cycles stay legal in the document.
- The same card can appear in several instances; every instance resolves to one canonical card and
  placement, so selection, drags and edits agree everywhere, and each gesture is still one CRDT
  commit.
- Cross-board presence keeps the existing `AWARENESS_FIELDS.board` transport. Peer positions and
  drags map into every visible instance of that board, and a portal card still shows target-board
  presence.

**Navigation (A11a target).**
- The root board remains `activeBoardId`; board tabs keep their meaning and clear the focus path.
- Entering a portal pushes a camera checkpoint and the instance path onto `focusPath`, then animates
  the camera to the child instance's bounds. There is no overlay, no board swap and no white flash.
- Escape or back pops the focus path and restores the exact camera checkpoint. Keyboard focus and
  search auto-expand ancestors and move the camera to the target.
- The **scene outline** — workspace → root board → portal instances → target boards → nested
  portals — is the non-spatial navigation and accessibility surface. It lists the focus path, LOD and
  expanded state, and peer presence, and it is a projection of the same scene, not a second model.
- Card focus keeps the inspector's **Edit** action and the zoom gesture, now as a camera move onto
  the card's readable surface with the previous checkpoint restored on exit. The card stays the same
  object; there is no second editor model.

**Resolved decisions.**
- A portal references the target; it never creates or deletes it (ADR-0029).
- Cycles are a navigation and rendering problem: A→B→A is legal, the focus path returns to the exact
  previous camera, and the scene stops expanding at the repeated board path.
- Nesting is recursive and lazy, bounded by the depth cap — not one level.
- In a share, a portal expands only when its target board is inside the projection; otherwise it
  reads as *Unavailable board*. Drawing content travels with the projection
  ([ADR-0022](../decisions/0022-share-projection-links.md),
  [ADR-0031](../decisions/0031-whiteboard-cards-and-loro-binding.md)). Whether a portal to a filed
  or closed board expands is an open question (Beta §4.12).
- The landed first slice (portal card, miniature, camera transition, back stack, card focus) is kept
  as precedent, not as acceptance: the miniature becomes the impostor and the transition is
  retired.
- Tab grouping and cross-board edges are follow-ons, not part of A11a.

**Status (2026-10-25):** A11a `deferred` — the live portal was the scene surface's job, and that
surface is removed. A11b carries on as **A17** (Arrange on a selection): the fractal planner and the
graph `LayoutPlan` batch ship, the whole-board *Arrange fractally* entry was removed, and what remains
is the selection gesture. The acceptance list below stays as the record of what A11a would have
required.

**Acceptance for A11a.**
- A portal can be created from the right-click menu and the Add card/type menu (retained).
- Above the expansion gate the portal renders the target board live; below it, the miniature
  impostor. No board swap, no overlay, no white flash on entry.
- Zooming through a portal moves the camera and keeps the root board active; two levels of nested
  portals render live at readable zoom.
- A cycle stops with a visible stub and a working focus action; the depth cap holds.
- Back/Escape restores the exact camera checkpoint; board tabs still switch the root board.
- The scene outline lists root and portal instances, follows the focus path, and supports keyboard
  navigation.
- DOM editors exist only at `full`; one CRDT commit per gesture.
- A portal target outside a share's scope reads as *Unavailable board*; drawing content is present
  when in scope.
- A peer on the target board appears on the portal card, the tab and every live instance.
- `prefers-reduced-motion` skips camera flights and LOD transitions.
- E2E: zoom-through without a board switch, depth ≥ 2, cycle, back to the exact camera, share scope,
  card focus, and presence in a portal instance.

**Acceptance for A11b.**
- Layout is a command: preview a plan, apply in one field-granular batch and one undo step. No live
  reflow and no per-frame writes.
- Recipes cover grid, columns, rows, radial, spiral, phyllotaxis, rings and treemap, recursively
  through portals, with per-depth overrides (scale, gap, rotate, pattern) and deterministic output.
- Pinned/excluded cards keep their positions; sections expand to contain members; cycles stop at the
  repeated board path; an invalid plan writes nothing and says why.
- Unit tests cover recipes and guards; an e2e covers preview → apply → undo on a nested fixture.

**Non-goals for A11a/A11b:** tab grouping, cross-board edges, mobile, live reflow, and portal-aware
workspace merge-back.

### 7.5 Alpha core surface gates (A12–A35)

> **Added 2026-10-25.** The author's core-feature notes are now the plan of record: every surface
> named there is a gate below, and [ADR-0041](../decisions/0041-alpha-core-is-a-closed-feature-set.md)
> is the list itself. Anything not on this page is **post-Alpha**, regardless of what an older roadmap
> says. Statuses move `planned → in flight → shipped` only.

| Gate | Statement | Required evidence | Depends on |
| --- | --- | --- | --- |
| **A12** | **Connections are uniform and complete** | Every node kind (note, portal, sketch) and every section renders the same connector layer with add/remove/move; dots revealed on selection, hover, thread mode and mid-drag, and *hidden dots never break link drawing* (handles stay mounted); links resolve card ↔ section ↔ board; a link keeps the connector it was dropped on, links paint beneath the cards so a line never takes a press meant for one, and several dots may join the same two things. **Shipped:** `NodeConnectors.tsx`, `useNodeConnectorWiring.ts`, `linkGeometry.ts`, `SectionLayer.tsx`, `CanvasBoard.tsx`; `ADR-0039`, `ADR-0048`; A link is also selected, moved, deleted and multi-selected (`Shift`+click and the marquee, which picks up a canvas-drawn section link from its span) like any other entity, and its own inspector mirrors the menu's controls. `packages/graph/src/loro/connectionMatrix.test.ts`, `e2e/tests/connection-matrix.spec.ts`, `e2e/tests/link-behaviour.spec.ts`, `e2e/tests/link-selection.spec.ts`, `e2e/tests/link-inspector.spec.ts`; `ADR-0050`. **Expanded 2026-10-25:** a third drawing mode, **web**, links every click from one fixed origin instead of threading between clicks (`ADR-0061`) — one control, three states, `Ctrl` as the gesture modifier, the armed origin kept visible. **Shipped:** the control walks connect → thread → web → connect and the connector menu walks the same cycle (`nextLinkMode` in `linkGesture.ts`); `Ctrl`/`Cmd` engages web for one press without writing the stored mode; the armed end is marked per dot on cards and sections (`data-armed`), and the reveal rule is now named `chaining` so thread and web share it. The same connector pair may carry a second link in the opposite direction, drawn with a deterministic per-edge offset, and a selected link can be isolated — see **A31**. Evidence: `apps/canvas/src/canvas/linkThread.ts` + `linkThread.test.ts` (a thread and a web draw different graphs from the same three clicks), `LinkModeControl.tsx` + tests, `e2e/tests/web-mode.spec.ts`. | — |
| **A13** | **A board closes without a decision** | Closing a tab writes nothing and never prompts; the library gains a **Boards** section listing every board; `Place` makes a portal without moving the board in the list; `Unplace Cards` removes this board's placements only; delete asks once, in the library, and offers unplace-or-trash; `Locate` pans to the card or its portal. Evidence: `LibraryDrawer.tsx`, `BoardTabs.tsx`, `deleteBoard` scoped to the board's own cards (already fixed in `WorkspaceDocument.ts`). **Expanded 2026-10-25:** the library gains **bulk editing** over any tab (select rows and trash, unplace, place, tag or import together) and has to stay usable past a screenful — a filter that survives, a stable sort, rows that do not re-render per keystroke; a row offers `Place` when the card has no placement and `Locate` only when it is on this board — a locate that cannot succeed is not offered. **Sections and order fixed 2026-10-25** (`ADR-0011` amendment): Inbox → Cards → Sketches → Boards → Types → Trash, with Trash absent where the session may not manage trash; the type facet row appears on Inbox and Cards only, and Sketch/Portal never appear in it, because a behaviour is not a facet. Attachments and annotations do not become sections — an attachment belongs to a card, and an annotation *is* one. | A12 |
| **A14** | **Portals and sections are inspectable** | A portal inspector shows its board, colour, cover image, links in/out, **Open board** as the primary action and Locate; a section inspector shows title, colour, links and Locate; selecting either routes to the container panel, never to a card focus surface. **Shipped:** `ContainerPanel.tsx`, `useContainerPanelModel.ts`, `CardInspectorHost.tsx`, `setBoardColor`, `setBoardCover`, `BoardCoverPicker.tsx` (a cover is chosen from the workspace's own image attachments and a portal paints it in place of the live miniature, falling back when the bytes are absent); `containerPanel.test.ts`, `e2e/tests/container-panel.spec.ts`, `e2e/tests/cover.spec.ts`; `ADR-0040`. A portal's panel also lists the target board's cards grouped by section, each row navigating. **Expanded 2026-10-25:** `Locate` sits beside Open and Edit whenever the entity is on this board and reads `Place` when it is not; the Title row is first in every entity's panel and is editable in place; a board, sketch or portal row can reach its library entry. | A12 |
| **A15** | **Sketches, not whiteboards** | Every user-facing string says Sketch (type id unchanged); a click selects, a double-click opens, Enter opens; framed and seamless display modes stored per card; the sketch editor batches strokes into one commit; a "someone is editing this sketch" presence indicator. **Shipped, and a sketch is inspectable**: a click opens the one inspector like a note. Evidence: `WhiteboardCardFace.tsx`, `cards/whiteboard.ts`, `ADR-0031`, `e2e/tests/sketches.spec.ts`. | A12 |
| **A16** | **A portal preview shows its links** | The miniature draws the target board's card-to-card links (plus section and boundary links once they resolve) with the same geometry the board uses; a link whose endpoint is not on the target board is simply absent. **Shipped:** `MiniatureLink` + `linkAnchors` reuse in `portalMiniature.ts`, `BoardMiniature.tsx`; two model tests; `connectors.spec.ts` "a portal's miniature draws the links on the board it opens". | A12 |
| **A17** | **Arrange is one gesture over a selection** | The context menu offers **Arrange** only with a multi-selection; commits one undoable batch, never reflows the rest of the board, and never changes section membership (sections grow to fit). **Shipped as align & distribute** — there is no fractal tree (the planner was cut with `packages/scene`) and the larger idea is **Patterns** (`ADR-0049`, design only): `arrangeCommand.ts` + tests, `arrange.spec.ts`, `applyLayoutPlan`; `ADR-0017`. | A12 |
| **A18** | **Board templates** *(core)* | Duplicating a board copies its sections, cards, placements and internal links in one undoable batch; a template gallery applies a template as a **new** board; the source board is never modified. **Shipped:** `duplicateBoard` + `setBoardTemplate`/`Board.template` on `WorkspaceDocument`, the gallery surface, three starter boards, `e2e/tests/board-templates.spec.ts`; `ADR-0040`. **Named 2026-10-25:** in the interface a board template is a **board blueprint**, and "blueprint" is the family name for both board and type blueprints (`ADR-0059` amendment); code keeps `template`. **Shipped 2026-10-26:** the gallery heading, its row detail and actions and a marked board's row badge all say blueprint. | A13, A14 |
| **A19** | **Metadata is fields** | A card's type may declare metadata-capable fields; a fetch action fills *selected* fields on *this* card only, storing the values as ordinary field values; there are no built-in media card types. **Started:** attachments are cards' own bytes and now supply a board's cover (`useBoardCover.ts`); the field-filling fetch is deferred until there is a network surface to ask, so no partial model ships. **Expanded 2026-10-25:** the same fetch fills a `rating` field (a number with a scale, optional half steps and an icon set), so a media card can show a score the user also sets by hand. Evidence: `ADR-0042`, `ADR-0057`, field definitions. | A14 |
| **A20** | **Views are three kinds** | A saved view carries `kind: lens \| database \| render` over one `ViewQuery`; a database renders rows/columns with editable cells that use the inspector's own editors; a render draws 2D charts (3D only after the 2D contract holds); `libraryFilters.ts` is folded into `runViewQuery` first. Evidence: `views.ts`, `ADR-0043`. | A14 |
| **A21** | **One target primitive, with chat** | Presence, Follow, Goto and the handbook all address `Target`; a chat bubble posts persisted messages (capped) and can carry a target; Follow subscribes to a peer's target; Goto navigates through the existing camera/board machinery; a target the receiver cannot see fails quietly. **Partial: the primitive only.** `Target`/`targetKey`/`sameTarget` live in `packages/graph/src/target.ts`, `navigateTo`/`planNavigation` in `apps/canvas/src/canvas/navigateTarget.ts`, and presence `focus` is mapped through `targetOfFocus()`; Follow, Goto and chat are not built. Evidence: `ADR-0044`, one inspector (`ADR-0050`). | A14 |
| **A22** | **The handbook** | Articles are cards on a designated board with subject fields; the panel lists articles that match what is on screen and shows a count badge; hovering an article draws a line to and outlines its subject, choosing the instance nearest the viewport centre; an "explain this" picker turns the next click into a target; a user can document their own entity the same way. **Expanded 2026-10-25:** articles and cards list their **backlinks**, and the outline-and-point gesture is generalised to any mention or backlink (hover peeks read-only, opening scrolls it into view, a dead reference reads as removed) — see **A32** for tours, which reuse the same spotlight. Evidence: `ADR-0045`, `ADR-0055`, handbook card type, the seed. | A21 |
| **A23** | **Source annotations** | A PDF page or video timecode can carry annotations that project as cards, appear in the library, and drop onto the canvas; an annotation can be detached into an ordinary card and keeps working when the source is removed. Evidence: annotation records, projection, the reader surface. | A19 |
| **A24** | **Navigation and tabs** | A home board setting with a home control; the pre-tabs nav affordance is removed and navigation moves beside the search bar; board tabs can be grouped and pinned, with pinned tabs collapsing to an icon and closing only from the menu; the library reflects grouping and pinning; the outline expands a section to show its contents and navigates into a portal on double-click; clicking an outline card navigates to it. **Expanded 2026-10-25:** the outline gains a z-order lens, so what sits above what is answerable in one place for cards, sections and links; there is no separate layer-mode surface.

**Also 2026-10-25 — Sketches get their own library section, and may be promoted.** The library also gains a **Types** tab (own types plus suggested blueprints), per `ADR-0059`'s amendment. A sketch is a card
(ADR-0031), so it appears in Cards today only by its type; it deserves a **Sketches** tab the way Boards
has one, because "my drawings" is a question users ask as often as "my boards". The tab replaces the
`Sketch` entry in the type facet row rather than joining it, and the same goes for `Portal` — the facet
row is a card-list filter, and these two are behaviours (see `ADR-0011`'s amendment, which also fixes the
tab order and declines sections for attachments and annotations). The same note asks
whether a sketch can be **promoted like a board or a portal** — opened full-surface in a **tab**. That is
the portal mechanism minus the target board: a sketch is already its own surface in focus
(`openCardFocus`), so promotion is "a sketch tab" over the same card id, not a new object. Promotion stays
additive and the card remains the thing that exists.

**Also 2026-10-25 — home and new tab are two settings, not one.** Closing the last open board opens the **home board** rather than leaving the app empty. A **new tab** opens a chooser (pick a board, or create one) instead of guessing a board, and the workspace may name a **new-tab board** so that tab has a default. Home and new tab stay distinct because they answer different questions: home is *where I land*, new tab is *where I start something*. Both are one optional board id on the workspace — no new record class, and the same ids a portal already resolves — so a user who wants a portal on their new-tab board can have one. No empty state, no second notion of "the board you are on". **Shipped 2026-10-26:** both ids live in workspace meta (`workspaceHomeBoardId`, `newTabBoardId`, cleared when their board is deleted), the home control sits at the head of the tab strip, closing the last tab lands on home, and `+` asks — opening a board that has no tab, or making one — unless the workspace named a new-tab board. Tab grouping and pinning are still open.

Evidence: `BoardTabs.tsx`, `BoardOutline.tsx`, `LibraryDrawer.tsx`, `ADR-0052`. | A13 |
| **A25** | **Theming and icons** | Roles are tokens; the current palette becomes the default theme; the shell reads only those tokens (no shell-owned colours); rules are named records applied globally or per type/kind with derived borders/tints and a contrast floor; icons come from a local preset set with an optional cached Iconify key; boards, sections, types, cards and free canvas icons can carry one. **Narrowed 2026-10-25:** the *paint vocabulary* moved to **A29** (one `SurfaceStyle` record over every surface, `ADR-0051`), which runs first. What remains here is the **rule layer** over that record — named rules, themes, derived values and the contrast floor — plus icons, including an `icon` field kind and in-line icons in the editor body. Evidence: `global.css` token refactor, `ADR-0046`, `ADR-0051`. | A24 |
| **A26** | **Collaborative drag previews** | Dragging a row out of the library shows a local ghost at the pointer and publishes an ephemeral preview so peers see where it will land; the drop is one undoable placement; a viewer's ghost renders but the drop is refused. **Shipped:** `libraryDrag` on `presence.ts` (rides the gesture beat), `PeerLibraryDragLayer.tsx`, `LibraryDrawer.tsx` `canPlace`; `peerProjection.test.ts`; **Expanded 2026-10-25:** the same ghost serves the dock: a new card is dragged out to drop, or a click arms the cursor so the card follows the pointer until released — it no longer lands at a fixed spot chosen for the user. Evidence: `e2e/tests/library-ghost.spec.ts`, `e2e/tests/place-held.spec.ts`. | A13 |
| **A27** | **Schema editing is collaborative** | The type editor and the property inspector publish what the local user is editing, and peers see it (who is in which field, which type is being edited), on the same target primitive; no schema write changes shape because of it. Evidence: `TypeSettingsDialog.tsx`, `CardInspectorHost.tsx`, `ADR-0044`. | A21 |
| **A28** | **Views and embeds render in place** | A view card paints its saved view (table or chart) read-only on the canvas and references the view by id; an `embed` field value `{kind, id}` renders through one registry on the canvas node, the card body, the inspector and a database cell; body embeds render a capped head with a count and open the full view on demand; a recursive embed stops with a stub; a share resolves embeds only within its projection scope. Evidence: `ADR-0047`, `fieldKinds`, the embed registry. | A20 |
| **A29** | **The paint system** *(core, first)* | One `SurfaceStyle` record over the four edges of every surface: role tokens with the current palette as the default theme, per-side solid/dashed/dotted/none with a direction that derives from geometry, silhouettes, seamless backgrounds, an opacity floor that hover restores, per-surface text scale, and a wider camera range with content breakpoints. One Style tab in the inspector, shared by cards, sections, portals and links. **Shipped 2026-10-25:** one `SurfaceStyle` record, the painter and one editor, reachable from every surface that can be opened on its own — a card (CardPanel), a section and a portal (ContainerPanel's Details · Contents · Style tabs, the portal painting its card rather than the board it opens), and a link (the drawer's line editor: one stroke, so one paint, width and flow instead of four sides — `sides.top` is where a link's stroke lives, and `linkStroke` paints it in both link layers). **Remaining:** the board's own surface has a painter but no entry point yet (it needs a board-level menu to open it), and fields and shell regions still take their paint from the rule layer. **Shipped 2026-10-26:** a **workspace palette** — the `theme` record, per mode, authored in the Styles list and mirrored read-only in Appearance; a share renders it in the visitor's own mode (`ADR-0071` Q2/Q3, `apps/canvas/src/theme/workspaceTheme.ts`, `e2e/tests/workspace-theme.spec.ts`). Evidence: `ADR-0051`, `ADR-0046`, `packages/graph/src/style.ts` + tests, `apps/canvas/src/canvas/surfacePaint.test.ts`, `e2e/tests/style.spec.ts`. | A14, A24 |
| **A30** | **Supertags** | A card carries several types; the primary owns presentation and the others only contribute fields, grouped by type in the inspector; required stays advisory and per type; no code branches on a combination of types. Boards and sections gain an optional tag list, and a lens can filter by tag. **In flight:** boards and sections store an optional tag set (mergeable, so two clients adding different tags both keep theirs) and a legacy record with no tag map reads as none. Evidence: `ADR-0053`, `ADR-0016` amendment, `packages/graph/src/loro/boardSectionTags.test.ts`. | A29 |
| **A31** | **Link routes** | A link carries an optional polyline of bends that every path style renders, and a layer choice (`below` by default, `above` as the exception, raising paint and hit stroke together). Reverse duplicate links are allowed between the same two connectors and are drawn with a deterministic per-edge offset. Path styles gain an opt-in `avoid` mode that routes around cards and sections within a bounded search, falls back to `bezier` when the budget runs out, and is overridden by any bends the user drew. The link inspector edits bends, layer and path style, and can isolate one link. **In flight:** the pure route geometry (`edgeRoute.ts` — bends in every mode, a bounded `avoid` search, `bezier` fallback) and the layer for links that paint above the cards are in place. Evidence: `ADR-0052`, `apps/canvas/src/canvas/edgeRoute.ts` + 23 tests, `e2e/tests/link-route.spec.ts`. | A29 |
| **A32** | **Tutorials and tours** | A tutorial is a card whose body holds step blocks (`targets`, `viewport`, `caption`, `advance`), where `targets` holds at least one `Target` and the first is primary; a player overlay flies the camera, spotlights the targets, dims the rest, offers a scrubber, and survives a target that no longer resolves by falling back to the stored viewport with a tombstone. **Expanded 2026-10-25:** a tour is one document on three surfaces — the tutorial card's inspector (**Details · Steps · Style**) turns the existing picker into step authoring and presents from the same panel, with a caption editable while presenting; the overlay is the reader's view with no inspector open (read-only in a share); the handbook panel only starts a tour whose steps include the article's subject. Completion is per reader, stored on the tutorial. Product tours are tutorials on the handbook board anchored to `data-testid`, with a CI test that fails when a shipped tour names a missing anchor. Diataxis ships as four tags plus a Docs board template. **Planned.** The three surfaces are decided by `ADR-0058` — the tutorial's own panel drives it (Details · Steps · Style), the overlay is the reader's view, and the handbook only starts a matching tour. Evidence: `ADR-0054`, `ADR-0055`, `ADR-0058`, `e2e/tests/tour.spec.ts`, `scripts/tour-anchors.mjs`. | A29, A22 |
| **A33** | **The type and settings editors** | The plural sits inline with the singular; every entity's Title row comes first and is editable in place; the type editor's rows are a grid the user can author in, with runtime-owned fields marked read-only and linked to Card Settings; Card Settings owns entity defaults (sketch display mode, new-card size/shape/text scale, portal defaults); the inspector reaches the library entry for a board, sketch or portal. Evidence: `ADR-0056`, `CardSettingsDialog.tsx`, `TypeSettingsDialog.tsx`, `e2e/tests/type-editor.spec.ts`. | A30 |
| **A34** | **Fields compose** | `rating` (a number with a scale, optional half steps and an icon set, fed by media metadata), `group` (an object keyed by sub-field id) and `list` (a `LoroMovableList` of scalars, groups or card references) with one level of nesting; concurrent appends keep both entries and concurrent edits to different sub-values both survive; one registry entry per kind renders on the canvas, in the body, in the inspector and in a database cell. **In flight:** the kind registry landed (`apps/canvas/src/field/fieldKindRegistry.tsx`), consulted by the inspector before its built-in switch, so a composite kind ships without editing the panel. Evidence: `ADR-0057`, `packages/graph/src/loro/compositeFields.test.ts`, `fieldKindRegistry.tsx` + tests. | A29 |
| **A35** | **Shape and rollup** | A card's chrome is its header and nothing else — no per-side strips, no widget areas (ADR-0060 note 2026-10-26); a card or a section can be `collapsed` as document state, painting its header and a derived summary while a section keeps its cards' placements and membership; a custom shape is a closed route (one connector, bends as the outline) rendered as paint on an underlay so a silhouette never clips content. Evidence: `ADR-0060`, `ADR-0051` §5, `ADR-0052` §2, `e2e/tests/rollup.spec.ts`. | A29, A31 |
| **A36** | **Placement is a mode too** | One mode slot reads as a link tool on connectors and as a placement tool during a run: `place · thread · web · pattern`, cycling in that order, with `place` the single-card reading, `thread` a chain, `web` spokes from a fixed origin and `pattern` a mindmap tree. A run is gesture state — a queue, what it placed, an origin and an anchor — never document data, so it needs no schema and cannot half-sync to a collaborator. Positions come from a pure planner (`placeRun.ts`, joining `arrangeCommand.ts`), placement plus its link land in one `batch()` so one undo removes both, and a run always ends (Escape, Stop, empty queue, board switch). Section wrapping is opt-in per run and sized to fit. **Shipped:** the mode slot is `CanvasMode` (`place · thread · web · pattern`) with one control cycling them; `canvas/placeRun.ts` plans each shape (grid from the run origin, chain right, ring at the golden angle with a floor that forbids an overlapping spoke, alternating branches) and `planSetOffsets` places a step's set as one unit; `canvas/placementRun.ts` holds the run as a stack (a sub-run suspends its parent and resumes it); `canvas/usePlacementEngine.ts` commits a step's placements, its one link and its wrapping section in one `batch()` — one undo per card, and *Place all now* as the single-step variant. A run ends on Escape, Stop, an empty queue, or a board switch. Evidence: `ADR-0063`, `ADR-0061` amendment, `apps/canvas/src/canvas/placeRun.ts` + 20 tests, `placementRun.ts` + 25 tests, `e2e/tests/place-run.spec.ts`. | A13, A26, A31 |
| **A37** | **A run has sources** | Every place a set of cards can come from hands the run an ordered list of ids and nothing else: a **library selection** (row selection with ⌘/Ctrl-add and Shift-range, the same selection bulk trash and unplace use), a **saved view's** sorted result via *Place results…*, the **dock's** type picks, and the **one-at-a-time loop** that reopens the library on the same tab and filters after each placement. Order is the order the user can see — a run that threaded a different order than the list would read as a bug. Behaviours (portal, sketch, tutorial) are ordinary cards here: placeable, unplace-able, and present in Cards and the Inbox. **Shipped:** library row selection behind a visible *Select* toggle (⌘/Ctrl-add, Shift-range over the visible order) with a bar whose verbs are the modes — Place / Thread / Web / Pattern cards, Trash, One at a time; a saved view's *Place* resolves its result on the click and hands it over as a queue; a dock pick during a live run creates an unplaced card and queues it (the picker loop, the one run that outlives its queue); a row's Place verb reads *Place next* while a run is live and enqueues instead of starting a second run. Behaviours need no special case: `isBehaviourType` keeps them out of the facet row and nothing keeps them out of Cards or the Inbox. Evidence: `ADR-0063`, `ADR-0011` amendment, `ADR-0040` amendment, `components/librarySelection.ts` + 10 tests, `e2e/tests/place-picker.spec.ts`, `e2e/tests/views-place.spec.ts`. | A36, A13, A20 |
| **A38** | **Two axes, and a cursor that says so** | The canvas has two slots: `purpose` (explore · run · record, with `present` as a tour's own state that the widget can leave but never enter) and `gesture` (place · thread · web · pattern), each with its own control and each exclusive within itself — the two controls are segments of one pill, the purpose at its bottom. The **cursor was the status holder**; it is now **peers-only** (ADR-0064 amendment): the reader's own bubble is withdrawn because it repeated the pill under the pointer, presence publishing is unchanged, and a peer who is off this view gets an edge tick that brings them into view. A peer's bubble keeps the corner pointer, the presence initial, a status ring for the purpose and one slot (the gesture glyph); run progress lives in the placement bar and unread chat has no home until the chat lane exists. Colour is **hue for meaning, contrast for state**, resolved from the `--value-*` palette so a theme flips contrast and never meaning; every state carries a glyph and a label. `purpose: run` opens the library in selection mode; leaving a purpose ends what it started. **Planned.** Evidence: `ADR-0064`, `ADR-0046` amendment, `ADR-0049`/`ADR-0063`/`ADR-0058` amendments, `apps/canvas/src/cursor/StatusCursor.tsx`, `e2e/tests/purpose-control.spec.ts`, `e2e/tests/status-cursor.spec.ts`. | A36 |
| **A39** | **Presence covers every surface, and says what people are doing** | `FocusState` is a `Target` (ADR-0044), so a property row, a type-editor row and a card body are all addressable: every property panel publishes its own focus and draws the peer tag, the type editor does the same for workspace editors, and the presence payload gains `purpose`, `gesture` and an ephemeral `bubble`. **Chat is ephemeral first**: a bubble carries text, a timestamp and an optional anchor `Target`, is capped and aged out, and is **broadcast only explicitly** (command bar, shortcut, context action) — silence is the default. What presence must never carry is recorded: keystrokes, clipboard, chat text on the canvas channel. **Planned.** Evidence: `ADR-0044` amendment, `ADR-0064`, `apps/canvas/src/collab/presence.ts`, `e2e/tests/presence-coverage.spec.ts`, `e2e/tests/chat-bubble.spec.ts`, and the coverage table in `architecture.md`. | A38, A21 |
| **A41** | **One modifier map, and a fourth purpose that explains a selection** | Both mode families take the same modifier map — resting, shift, ctrl, alt — so `place · thread · web · pattern` and `explore · run · record · explain` are reachable without cycling; `alt` finally gives `pattern` a key (shipped: `apps/canvas/src/canvas/modifierPreview.ts`, `e2e/tests/modifier-map.spec.ts`). A modifier **previews and never commits**: the stored value changes only on a click, because these keys are also undo, multi-select and browser shortcuts, and a click *during* one is refused so the key is the only thing that ends it. A key that points at the value already stored hands back the resting value, which is the only mapping where the stored value plus three keys name the whole family exactly once from every state. **Shipped.** `explain` is now a member of the cycle rather than only an `alt` target, and it gathers: the selection becomes a read-only context panel (entities, types, fields, the links between them) that writes nothing. The fourth purpose is **`explain`**, the inverse of [ADR-0045](../decisions/0045-handbook-articles-are-cards.md)'s picker: a selection becomes a scoped, temporary context answered from the handbook, writes nothing on its own, and becomes persistent only when saved **as a view** — so the selection vocabulary (one datum vs an aggregate) must match the one views use. Evidence: `ADR-0066` (+ three amendments), `apps/canvas/src/canvas/modifierPreview.ts`, `apps/canvas/src/canvas/explainContext.ts`, `apps/canvas/src/components/ExplainPanel.tsx`, `e2e/tests/modifier-map.spec.ts`, `e2e/tests/modifier-matrix.spec.ts` (both themes, glyph **and** painted colour per cell), `e2e/tests/palette-contrast.spec.ts` (4.5:1 floor). | A38 |
| **A42** | **Identity needs no explanation** | The account is the identity and the owner key is plumbing. Signing in **claims** what this device already has (one `UPDATE` of `organization_id`, so no id, URL or share link changes); import, local editing and export work with **no account**, while sync, collaboration, shares, publishing and billing need one. The **passphrase path is deleted** — it silently rotated the owner key and invalidated the rest — and recovery words are retired to a single advanced *Owner file*. Storage conditions become a **ladder**: nothing when signed in and persisted; a quiet "Saved on this device" without an account; one dismissible inline banner when storage is not durable; a blocking dialog only while storage is failing. Second factors are offered to every account and nudged by sign-in method — strongest for an email-only account, absent for Google, neutral for passkeys — and **required only for operators**, who can impersonate and spend. Registration is open with an **operator admission** step (`admittedAt` plus one server-side gate on organization creation, claim and sync — never on local work), and the front door is normalized (`better-auth-harmony`) behind invisible Turnstile (`captcha` + client half), with `@dymo-api/better-auth` as the documented fallback. Invitations are the organization plugin's; shareable capped revocable keys are `better-enrollment`'s, and `invite_keys`/`redeem_invite_key()` are deleted behind a pinned version, a wrapped redemption route and one role reader. **Planned.** Evidence: `ADR-0067`, `ADR-0065` amendment, `apps/canvas/src/session/ownerKit.ts`, `apps/canvas/src/components/StoragePanel.tsx`, `apps/canvas/src/components/WorkspaceProtected.tsx`, `e2e/tests/claim-workspace.spec.ts`, `e2e/tests/admission.spec.ts`. | A40 |
| **A43** | **A system workspace authors what workspaces start with** | Everything a workspace is born with — handbook articles, **blueprints**, object types with fields, card templates, defaults — is authored on the same canvas in a workspace flagged as the template source, one per organization, **seeded by copy** from a deployment template at organization creation (no runtime inheritance). Publishing is versioned and applying is **additive**: it adds what is missing and changes nothing a person has touched, following the rule `ensureDefaultTypes()` already follows. Seeded entities carry `origin: system` and the `systemVersion` that delivered them, a "what would change" diff precedes applying, and a reseed can be ignored. A system entity is a **template, not a live link** — no portal into the system workspace. The admin panel is **one** surface: the content canvas beside people/organizations from the `admin` plugin, an admissions queue, and auth audit events, with the five debug panels simplified. **Planned.** Evidence: `ADR-0068`, `docs/architecture.md`, `packages/graph/src/loro/WorkspaceDocument.ts` (`ensureDefaultTypes`), `apps/canvas/src/admin/`, `e2e/tests/system-workspace.spec.ts`. | A42 |
| **A44** | **Billing runs on the Stripe plugin and the licence stays our proof** | `@better-auth/stripe` owns subscription state with `customerType: "organization"` and `referenceId` = the organization id, so a second purchase updates a customer instead of minting a second one; one active subscription per reference is enforced by the plugin. Plan `limits` are the single definition of `workspaces`, `documentBytes` and `attachmentBytes`; `authorizeReference` is `capabilitiesForRole`, so only an owner or admin may spend. The **Ed25519 licence survives** unchanged: one webhook (the plugin's) feeds one issuer, which signs a provider-agnostic `SubscriptionState`, so Paystack stays a swap rather than a rewrite (deferred, not excluded). Our webhook, its event store and `STRIPE_PRICE_TIERS` are deleted. Test mode stays the default and real money stays gated on the durable store — which is now **Postgres**, so DynamoDB goes entirely (`store-dynamodb.ts` and `SUITE_BILLING_STORE` deleted with our webhook) and one control plane holds accounts, organizations, subscriptions, licence records and workspace rows. **Planned.** Evidence: `ADR-0069`, `docs/billing.md`, `services/billing/`, `apps/collab-server/src/licence.ts`, `e2e/tests/billing.spec.ts`. | A42, A40 |
| **A45** | **One Postgres control plane, never document bytes** | Accounts, organizations, memberships, invitations, subscriptions, licence records and workspace rows live in one Postgres database; a `.loro` snapshot, an attachment's bytes or a rendered projection never do, because every backup would then be a copy of every customer's content and the control plane would become the hot path for editing. `pg` and checked-in SQL, no ORM; migrations run deliberately, never at boot; every durable store is one `INSERT … ON CONFLICT` rather than a read the other container cannot see; pools are small, module-scoped and closed by whoever opened them. The relay keeps its own SQLite claim store so it stays deployable without a database at all, and an unreachable control plane refuses loudly instead of falling back to memory. Backups are the durability story, not an environment variable. **Shipped in part.** Evidence: `ADR-0070`, `services/auth/src/postgres.ts`, `services/auth/src/postgresRepositories.ts`, `services/auth/sql/0001…0003`, `services/billing/store-postgres.ts`. | A40 |
| **A40** | **Identity: an organization owns a workspace, invites are rows, billing is open** | Better Auth on a Postgres control plane (passkeys, magic link, Google) using its **organization plugin as the tenant**: one organization owns **many** workspaces (`workspaces.id` = the document id, `organization_id` a column), so claiming a workspace is one `UPDATE` that changes **no id and no share link**; `owner/admin/member` map to the capability matrix by one `capabilitiesForRole` and apply org-wide, and finer access is deferred — our sync model can enforce **per workspace, never per board or card**, which is what a future team would be: a set of workspace grants. Invitations are the plugin's email-bound ones; **`invite_keys`** stay as shareable rows (role, expiry, max uses, revoked-at) redeemed atomically into `member`, for a tester you cannot email. Seats are checked **server-side** against the licence at connection time, so a lapsed licence loses sync and never local data. Billing attaches to the **organization** (`client_reference_id`), with the licence's `workspaces` field as the ceiling on how many workspaces one organization may hold; a Checkout route (reading `STRIPE_SECRET_KEY`) and a Portal link open billing in **test mode** by default, the existing webhook still the only mint, and real money still gated on the durable store. Beta takes the **account** branch of B6 and the operator-recovery path becomes an availability runbook. **Planned.** Evidence: `ADR-0065` (+ Organizations amendment), `docs/billing.md`, `docs/security-model.md`, `services/auth/`, `services/billing/handler.ts` + tests, `e2e/tests/claim-workspace.spec.ts`. | A38 |

**Non-goals for §7.5:** real-time co-editing of Excalidraw scenes, a CMS-style routing/slug model, a
media *library* surface, mobile, and any second canvas or rendering engine.

---

## 8. Work packages

Work packages are **ordered groups with exit evidence**, not a schedule. Packages may overlap; the
dependencies are what matter. Every package ends with "not in scope" so scope creep has a fence.

### Package A — Stabilize data

**Goal:** no known path loses bytes.

| Includes | Gate |
| --- | --- |
| `SUITE_ATTACHMENTS_DB` → `/data`; backup/restore/ops/security docs; manifest count + checksum; container-recreate test | A1 |
| Web Locks leader + `BroadcastChannel` for IndexedDB compaction; version-vector delete filter; two-instance test | A2 |
| Audit `:memory:` defaulting for `SUITE_SETTINGS_DB` / `SUITE_LICENCE_DB` | A1 |
| `busy_timeout`; migration runner skeleton (P1-6) | A7 (partial) |

**Exit evidence:** the A1 and A2 artifacts, plus a written statement of which stores are
authoritative and which are disposable.

**Not in scope:** incremental persistence, worker-thread SQLite, projection incrementality (P1-1,
P1-2 → [beta.md](./beta.md)).

### Package B — Make truth recoverable

**Goal:** an operator can restore, and a stranger can be told what to do.

| Includes | Gate |
| --- | --- |
| CI execution fixed; required checks; branch protection | A3 |
| `LICENSE`, `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`; semver tag; version surfaced in `/health` | A4 |
| Billing: durable store **or** an explicit "not open" state across UI, docs, and endpoint | A5 |
| N−1 workspace fixture test; N−1 per-store database fixtures | A7 |
| Backup automation + a recorded restore drill (RPO/RTO stated, not estimated) | A9 (partial) |

**Exit evidence:** a green required check on `main`, a tag with release notes, a restore drill record,
and an N−1 test that fails when the policy is broken.

**Not in scope:** accounts, Stripe Customer Portal, dunning, tax (→ [v1.md](./v1.md)).

### Package C — Harden the client

**Goal:** the page survives bugs and the browser.

| Includes | Gate |
| --- | --- |
| `navigator.storage.persist()` with visible grant state; quota/eviction UX; eviction simulation | A6 |
| React error boundary around the canvas shell; opt-in crash hook | A6, A10 |
| Marquee fix + e2e checklist | A10 |
| Local interaction smoothing (render-only; one commit per gesture) | A10 |
| Service worker **or** an explicitly scoped "offline means open tab" statement | A6 (partial; full offline reload → [beta.md](./beta.md)) |

**Exit evidence:** a forced render error shows a diagnostic panel; an eviction simulation does not
lose the document; the marquee and smoothing specs pass with a peer connected.

**Not in scope:** cross-browser matrix, mobile layout, i18n (→ [beta.md](./beta.md)).

### Package D — Tell the truth in docs and UI

**Goal:** nothing in the repository or the interface overstates what exists.

| Includes | Gate |
| --- | --- |
| §9 ledger emptied, in one pass, with the code change that caused each drift | A8 |
| `AGENTS.md` corrected to `WorkspaceDocument` / `useWorkspaceSnapshot` | A8 |
| `docs/roadmap/limits.md` (or equivalent) generated/sourced from `limits.ts` | A9 |
| Preview assets regenerated (no "Yjs" label) | A8 |
| Share UI states what a link grants, including "anyone with the link can edit" | — |
| Billing surfaces say "not open" if A5 chose that path | A5 |

**Exit evidence:** `pnpm docs:check` green; a repository-wide grep for the retired terms returns
nothing outside ADRs (which are historical and must not be rewritten).

**Not in scope:** rewriting ADR history. ADRs record what was believed; drift lives in the docs that
claim to describe *today*.

### Package E — Paint the board, then build on it

**Goal:** every surface is painted from one record before the surfaces that depend on it are built.

| Includes | Gate |
| --- | --- |
| `SurfaceStyle` + `EdgeStyle` in `@suite/graph`, optional on card, section, board, edge and field definition | A29 |
| Role-token refactor of `global.css`; the current palette becomes the default theme; the shell reads only tokens | A29 |
| One painter: silhouettes, per-side edges with dash animation and geometry-derived direction, seamless background, opacity floor with hover restore, per-surface text scale | A29 |
| One Style tab in the inspector, shared by cards, sections, portals and links | A29 |
| Wider camera range with content breakpoints; unclamped while presenting | A29 |
| Named rules, themes, derived values and the contrast floor; icons, the `icon` field kind and in-line icons | A25 |
| `bends` + `layer` on the edge; one route rendered by every path style; reverse pairs; isolate | A31 |
| Multi-type picker, field union, board/section tags | A30 |
| `rating`, `group`, `list` with one level of nesting and four-place parity | A34 |
| A tutorial card, step blocks, the player overlay, Diátaxis tags, product tours with an anchor-rot test | A32 |
| Type editor rows, Title-first panels, inline title edit, Card Settings, library access from the panel | A33 |
| A mode family shared by link drawing and placement, with a pure run planner | A36 |
| Library row selection; a run's four sources; behaviours listed as cards | A37 |
| A purpose axis and a gesture axis, two controls, and a status cursor for peers (the reader's own withdrawn) on the `--value-*` palette | A38 |
| `FocusState` as a `Target`, peer tags in every panel row and the type editor, ephemeral chat bubbles | A39 |
| Better Auth control plane, claim-workspace, invite keys, server-side seats, Checkout + Portal in test mode | A40 |
| One modifier map over both mode families; `alt` for `pattern`; `explain` in the cycle, gathering a selection into a read-only context (saving it as a view is ADR-0043) | A41 |
| Account-first identity, claim on sign-in, storage ladder, admission queue, plugin invitations | A42 |
| System workspace: published, versioned, additive content for every workspace an organization holds | A43 |
| Billing on the Stripe plugin, plan limits as the one entitlement definition, licence token kept | A44 |
| One Postgres control plane: schema in `sql/`, `pg` repositories, one-write claims, no document bytes | A45 |

**Exit evidence:** the paint gate's schema and e2e tests, the bend matrix, the composite-field merge tests,
a tour that plays and survives a deleted target, and `scripts/tour-anchors.mjs` failing on a removed anchor.

**Not in scope:** A* obstacle-avoiding pathfinding, dynamic mirrored edges, a separate layer-mode surface,
shape objects that hold cards, type inheritance, a click-recorder for tours, saved layout presets
(a run ships with four built-in shapes — see `ADR-0063`), persisted chat records, E2EE, and
self-serve team billing beyond one seat allowance.

### 8.1 Package dependency graph

`A → A1, A2` · `B → A3` · `A3 → A4, A5, A7` · `C → A6 → A10` · `D → A8, A9` (A9 needs A1 for the
attachment row; A8 needs A3 for the check to run) · `E → A29 → A25, A31, A34 → A30 → A33`, with A32
needing A29 and A22, A36 → A37 needing A13 and A26, and
`A38 → A39` needing A21, with A40 independent of the canvas gates (it is a server stream).

A3 (CI) has the widest effect: it keeps every other gate's evidence current. A8 (docs) is the
smallest: it requires reading the cited files and correcting them.

---

## 9. Documentation drift ledger

Docs are one of this project's main trust signals, so stale docs are a *product* problem, not a
housekeeping one. Each row was re-read on 2026-10-23, and the ledger was extended on 2026-10-25 with
the drift that audit missed (D12–D17).

| # | Doc claim | Reality | Where | Marker |
| --- | --- | --- | --- | --- |
| D1 | "`services/billing` is outside the pnpm workspace" | It is a workspace member via `services/*` | `docs/testing.md:4` | ✅ |
| D2 | "104 test files — 1,278 Vitest tests" | 142 test files today; declaration counts not re-counted here | `docs/testing.md:28` | ✅ (files) / ◐ (declarations) |
| D3 | "21 Playwright specs containing 132 tests" | Counts not re-derived; single `chromium` project confirmed | `docs/testing.md:30`, `:37` | ◐ |
| D4 | "the three SQLite files" (×2) | Six stores exist in code; compose configures five, attachments defaults to CWD, settings/licences default to `:memory:` | `README.md:168`, `README.md:183` | ✅ |
| D5 | "The three SQLite files … are not encrypted" | Same six-store correction as D4 | `docs/security-model.md:72` | ✅ |
| D6 | "Attachments reserved; nothing stores them yet" | Attachments are implemented, uploaded, served and exported | `docs/operations.md:80`, `:668`, `apps/collab-server/src/limits.ts:32-33` | ✅ |
| D7 | `GraphDocument` / `useGraphSnapshot` | `WorkspaceDocument`; `useWorkspaceSnapshot` (`apps/canvas/src/store/workspaceStore.ts`) | `AGENTS.md:83-84` | ✅ |
| D8 | `preview-light.png` shows "Yjs" | The engine is Loro (ADR-0015) | `docs/assets/preview-light.png` | ◐ (asset not re-opened) |
| D9 | "`settings.sqlite` is not part of a snapshot" | `backup.sh` includes it | `deploy/restore.sh:276` vs `deploy/backup.sh:76` | ✅ |
| D10 | ADR-0020 lists export/import and card sharing as gaps | `.suite` export/import and projection shares now exist | `docs/decisions/0020-…md` (context) | ✅ (as history, not drift to fix) |
| D11 | Ops doc describes a "three database" backup | Six stores exist and compose configures all six; backup covers all six | `docs/operations.md`, `deploy/backup.sh` | ✅ |

| D12 | "No `LICENSE`, no `SECURITY.md`, no `CHANGELOG.md`, no `CONTRIBUTING.md`, no tags … 89 commits" | All five identity files exist at `0.2.0-alpha.1`; 124 commits; one tag, and it marks a spike rather than a release | `docs/roadmap/alpha.md` §1.2, §3 row 9 | ✅ (fixed 2026-10-25) |
| D13 | "142 test files; ~1,392 unit declarations; ~160 Playwright declarations; 61 billing tests; 24 stories" | 150 Vitest files / 2,065 tests; 46 Playwright specs; 75 billing tests; 27 stories | `docs/roadmap/alpha.md` §3, `docs/testing.md`, `README.md` | ✅ (fixed 2026-10-25) |
| D14 | "`compose.yaml` configures five … attachments defaults to CWD; settings and licences default to `:memory:`" | All six stores are under `/data` with `SUITE_REQUIRE_DURABLE_STORES=1`, and boot refuses a split layout | `docs/roadmap/alpha.md` §4.4, §7.1 A1 | ✅ (fixed 2026-10-25) |
| D15 | "23 ADRs"; "840-line architecture doc"; "884-line operations runbook"; "`WorkspaceDocument`, 2,850 lines" | 48 ADRs; 1,010 lines; 952 lines; 3,558 lines | `docs/roadmap/alpha.md` §1.1, §3 row 12 | ✅ (fixed 2026-10-25) |
| D16 | A derived "scene" was described as the product of record; `?canvas=ice` named a surface | The scene was a read-only preview with no editing path and it is removed; `?canvas=ice` is gone from the parser, and the scene surface and its modules are deleted (2026-10-25) | `docs/architecture.md` §Rendering, `AGENTS.md` | ✅ (fixed 2026-10-25) |
| D17 | "64 `node --test` tests" in billing | 75 | `README.md:70` | ✅ (fixed 2026-10-25) |

### 9.1 Closure status

| # | Status | Evidence |
| --- | --- | --- |
| D1 | fixed | `docs/testing.md` no longer claims billing is outside the workspace |
| D2, D3 | fixed | `docs/testing.md` counts re-derived at integration |
| D4, D5, D11 | fixed | README, security model, operations, and AWS runbook now state six stores |
| D6 | fixed | operations and `limits.ts` describe attachments as shipped |
| D7 | fixed | `AGENTS.md` names `WorkspaceDocument` / `useWorkspaceSnapshot` |
| D8 | fixed | the stale `preview-light.png` was removed; README uses `preview-dark.png` |
| D9 | fixed | backup and restore both cover settings |
| D10 | history | ADR-0020 remains a dated decision; no rewrite |
| D12–D17 | fixed 2026-10-25 | Identity, counts, store layout, doc sizes, the surface claim and the billing count were corrected against the tree; the surface decision lives in `docs/architecture.md` §Rendering |

**Mechanical guard (A8).** `node scripts/docs-check.mjs` checks relative links and anchors, fenced
blocks, retired terms, and version consistency. The CI `quality` job runs it. The limits page has
its own `--check`.

**Why D7 was the worst of these.** `AGENTS.md` is the entry point for AI agents. Stale names there
cause agents to invent APIs — which is exactly how a codebase acquires plausible-looking phantom
methods. It was also the smallest change to make.

**Why D10 is not on the fix list.** ADRs are dated decisions. ADR-0020 correctly said export/import
was a gap *on 2026-10-22*. The fix is a new ADR or an amendment line, not a rewrite of history.

**Proposed mechanical guard (gate A8):** `pnpm docs:check` that (a) resolves every relative link,
(b) validates every fenced block's language tag, (c) greps for retired terms (`GraphDocument`,
`useGraphSnapshot`, "three SQLite files", "Yjs") outside `docs/decisions/` and
`docs/design-inspirations.md`, and (d) regenerates the test counts from `vitest list` and
`playwright test --list`.

---

## 10. Security posture today

### 10.1 What is strong

| Property | Evidence | Marker |
| --- | --- | --- |
| Capability model stated plainly: "whoever holds the link has the capability, and the server cannot tell two holders apart" | `docs/security-model.md` | ✅ |
| Constant-time comparison for secrets | `auth.ts` (`timingSafeEqual`) | ◐ |
| 32-byte random capabilities; SHA-256 at rest | `auth.ts`, `shares.ts` | ◐ |
| Share sessions are scoped, short-lived, hashed, deleted with the share | `shares.ts`, `docs/security-model.md:65-67` | ✅ |
| Revocation closes live sockets, not just new joins | patched `loro-websocket` + `patchGuard.test.ts` | ✅ |
| Separate projection/source worker tokens, scoped by room | `config.ts`, `docs/architecture.md` §"Room authorization" | ✅ |
| Passphrase derivation is defensible and candid | PBKDF2 600k, workspace-id salt, comment acknowledging Argon2id is stronger | ◐ |
| Attachment content policy is explicit | MIME allowlist of 5 image types, SVG and HTML refused **by name**, 16 MiB per-upload cap (`attachments.ts:22-36`) | ✅ |
| Admin token in `sessionStorage`, not a URL and not `localStorage` | `apps/canvas/src/admin/api.ts` | ◐ |
| Explicit "not in this model" section | `docs/security-model.md` | ✅ |

### 10.2 What is missing

| Gap | Why it matters | Where it should land |
| --- | --- | --- |
| **No threat model** | The doc is a policy description: assets, adversaries, attack paths and mitigations are not enumerated. It cannot answer "what if the laptop is stolen?" | Beta (§[beta.md](./beta.md) security workstream) |
| **No data inventory** | Which store holds what, sensitivity, retention, backup coverage. *This gap is why §6.1 exists.* | Beta; would have caught A1 |
| **No audit trail** | No attribution: the relay cannot say who created or edited a card. Presence is ephemeral. | V1 with accounts |
| **Share links do not expire by default** | Expiry exists (7/30/never) but the default is never; no last-used-by-person, no access list | Beta (expiry default) / V1 (access list) |
| **Admin token is unscoped** | One bearer secret reads every workspace and deletes any. No MFA, no IP allowlist, no separate hostname, no audit | Beta (scoping, MFA) |
| **Recovery semantics are confusing** | Five terms for three artifacts; "recovery words" and "passphrase" sound layered but are alternative keys; the passphrase silently rotates the owner key and invalidates old links and `.suitekey` files | Beta |
| **Owner key in `localStorage`** (§6.6 P2-1) | XSS-readable; CSP is mitigation, not fix | Beta (accounts) / V1 |
| **CORS defaults to `*`** (§6.5 P1-7) | Broader than documented | Alpha (small change) |
| **Docker runs as root** | No `USER` in `Dockerfile`; runtime image keeps dev dependencies because the server runs via `tsx` | Beta |
| **No dependency scanning / SBOM / image signing** | Patched dependencies are a supply-chain surface with no automated watch | Beta |
| **No retention or self-service delete** | Operator commands exist; a paid user has no delete path and there is no GDPR/CCPA process | V1 |
| **No incident response** | What to do for a leaked link, a compromised owner key, a stolen backup | Beta (runbook) / V1 (comms) |
| **No E2EE** | Documented as absent; the hosted operator can read everything | V2 (intentional deferral) |

### 10.3 The three security sentences that matter

1. **Anyone with an editor link is indistinguishable from the owner of that link.** That is the
   capability model working as designed, and it is also why attribution cannot be retrofitted without
   accounts.
2. **The admin token is the real root credential, and it is unscoped.** Today it is an operator
   convenience; the moment there is a second operator it is a governance problem.
3. **The owner key is the only secret that protects a workspace, and it lives where XSS can read
   it.** Every anonymous-user compromise reduces to this sentence.

---

## 11. Deferrals

Nothing is dropped silently. Every P1/P2 item either closes in Alpha or is routed, with the reason.

| Item | Routed to | Reason | Marker |
| --- | --- | --- | --- |
| Attachments durability (§6.1) | **Alpha** (A1) | Live data loss | ○ |
| Multi-tab compaction (§6.2) | **Alpha** (A2) | Live data loss | ○ |
| Marquee (§6.3), local smoothing (§6.4) | **Alpha** (A10) | First-minute product feel | ○ |
| CI execution + branch protection | **Alpha** (A3) | Evidence for everything else | ○ |
| Release identity | **Alpha** (A4) | A stranger needs to know what they run | ○ |
| Billing durable or explicitly closed | **Alpha** (A5) | Paid surfaces must not imply billing works when it does not | ○ |
| Client durability minimum | **Alpha** (A6) | Blank page = unfixable bug | ○ |
| N−1 upgrade test | **Alpha** (A7) | Beta users hold old documents | ○ |
| Docs truth pass, published limits | **Alpha** (A8, A9) | Smallest trust fixes | ○ |
| Incremental/worker-thread persistence (P1-1) | [Beta](./beta.md) | Needs load evidence to size correctly | ○ |
| Projection incrementality (P1-2) | [Beta](./beta.md) | Cost is real but bounded by share count | ○ |
| `WorkspaceSession` refactor (P1-3) | [Beta](./beta.md) | Prerequisite for accounts/multi-workspace | ○ |
| God-object splits (P1-4) | [Beta](./beta.md) | Gradual, test-guarded, not gating | ○ |
| `packages/licence` (P1-5) | [Beta](./beta.md) | Small, but not a trust boundary | ○ |
| Migration runner + `busy_timeout` (P1-6) | **Alpha** (A7 partial) → [Beta](./beta.md) | Rollout of the runner | ○ |
| CORS default deny (P1-7) | **Alpha** | One-line default + doc fix | ○ |
| Quality-gate widening (P1-8) | [Beta](./beta.md) | Needs stable modules to mutate | ○ |
| API contracts + `/api/v1` (P1-9) | [V1](./v1.md) | Pays off across many client changes; not a Beta blocker | ○ |
| Owner key in localStorage (P2-1) | [Beta](./beta.md) accounts → [V1](./v1.md) | Needs accounts to fix properly | ○ |
| Update size/rate caps (P2-2) | [Beta](./beta.md) | Amplifies P1-1; land with it | ○ |
| Worker token persistence (P2-3) | [Beta](./beta.md) | Only matters if the worker splits | ○ |
| Service worker / offline reload | [Beta](./beta.md) | Alpha scopes offline to "open tab" | ○ |
| Firefox/WebKit, mobile, i18n | [Beta](./beta.md) | Platform matrix decision | ○ |
| Accounts, devices, claim flow | [Beta](./beta.md) → [V1](./v1.md) | Identity is the central V1 dependency | ○ |
| Threat model, data inventory, incident response | [Beta](./beta.md) | Security is a Beta claim | ○ |
| E2EE, multi-replica, card-document split, comments, version history, importers | [V2](./v2.md) | Evidence-gated; see conflict notes in §12 | ○ |

---

## 12. Relationship to the plan of record

This document is subordinate to the repository's decisions. Where it disagrees, it says so here
rather than quietly overriding.

### 12.1 ADR-0020 — main and Loro are the plan of record

`docs/decisions/0020-main-and-loro-plan-of-record.md` decides: `main` and Loro are the plan of
record; the Yjs memo is history; cards are objects and boards are contexts; one type per card; finish
surfaces before widening the model; card-level sharing is deferred, not faked.

**This document assumes all of that without restating it.** Consequences for Alpha:

- The vocabulary is `card`, `board`, `type`, `section`, `reference` — never `note` or `link`.
- "Finish, then own the data" is exactly the Alpha posture: the model is finished enough that the
  remaining work is durability and truth, not shape.
- ADR-0020's §4 order (editor/block rendering → formatter → property blocks → field robustness →
  library polish → onboarding/share → exact backup → portable export) is *implementation order*, not
  a gate list. Gates (§7) override it where a data-loss fix is at stake.

✅ No conflict.

### 12.2 `docs/design-inspirations.md`

The design doc states the product thesis: §4.2 target data model, §7 collaboration model, §8
performance strategy, §10 feature list, §11 open questions.

**Conflict 1 — eventual index/card split vs the V1 one-document decision.**

- Design doc (§4.2, §7 "Card-level sharing") treats an **index document plus one card document per
  card** as the target shape, and calls card-level sharing a "core requirement".
- The agreed direction for **V1 is one Loro document per workspace**, with the split
  *benchmark-triggered* (`packages/graph/bench/workspace.bench.ts` is the signal), not speculative.
- **Resolution:** these are not contradictory, they are sequenced. The design doc describes the
  *target*; V1 chooses *when* to pay for it. ADR-0021 §5 already says "keep today's storage one
  document" and names the benchmark as the trigger. Recorded for V1 in [v1.md](./v1.md); the
  trigger is restated in [v2.md](./v2.md).
- **Reversal trigger:** the benchmark or real usage crossing a published workspace-size limit, or a
  card-level ACL requirement that a projection cannot satisfy.

**Conflict 2 — card-level sharing deferred vs projection shares already shipped.**

- Design doc §7 says card-level sharing is a core requirement and needs a card *document*.
- ADR-0021 defers card-level sharing as a per-card room.
- ADR-0022 then ships **projection rooms**: a card share copies one card into a synthetic
  `share-board`, in its own room, with its own token. ADR-0023 adds selection shares.
- **Resolution:** projection shares satisfy the *user-visible* need ("share this card without
  sharing the workspace") without the per-card document. What remains deferred is the *convergent
  two-way* card document with an independent ACL and per-card undo scope. ✅ For Alpha this is
  already reconciled in the tree; recorded so [beta.md](./beta.md) does not re-open it.

**Conflict 3 — board sharing was an "open question" in the design doc.**

- `docs/design-inspirations.md` §7 lists board sharing as an open question with two candidate
  shapes ("read-only access to a filtered index" or "a server-rendered board snapshot").
- ADR-0022 chose a **third** shape: a live projection room. ADR-0023 extended it to selections.
- **Resolution:** the design doc's open question is answered by ADR-0022; the design doc should gain
  a pointer, which is a docs-truth item (§9), not a roadmap change.

**Not a conflict, worth naming:** §8's performance budgets are the *reason* the one-document decision
is defensible. Alpha does not test against them; Beta must (P1-1, P1-2).

### 12.3 ADR-0019 — references, not typed links

`docs/decisions/0019-references-not-typed-links.md` decides that edges are untyped and meaning comes
from mentions, references, properties, tags and sections. The typed-relation design is revisited
only if views v2 lands.

**Consequence for Alpha:** nothing in this document may assume relation types exist. The risk
register's "P1-4 split by aggregate — edges/sections" refers to *edge placements*, not relations.
○ Recorded so the Beta/V1 documents do not plan against a model that was rejected.

### 12.4 ADR-0021 / 0022 / 0023 — sharing

| ADR | Status | What it decides | Standing in Alpha |
| --- | --- | --- | --- |
| 0021 | **superseded for S1** by 0022; the card-document split rationale remains future work | Do not implement card-level sharing; record the per-card room seam; keep one document | The seam is intact and the one-document decision stands |
| 0022 | **accepted** | Share links are capability tokens over live projection rooms; S1 = workspace edit + board/card viewer; S3 adds editors | Shipped. Alpha's job is to make its storage durable, not to extend it |
| 0023 | **accepted** | Selection shares are viewer-only board projections over fixed card ids | Shipped. Adds `SUITE_MAX_SELECTION_CARDS` to the published limits (A9) |

✅ Both 0022 and 0023 are verified as `accepted` in the tree.

### 12.5 Out of scope for this document

**Accounts** belong to [Beta](./beta.md) and [V1](./v1.md); Alpha only records that anonymous
capability links stay the default and that accounts are an *optional* ownership layer, never a
replacement for capability sharing. **Postgres** arrives with Better Auth for the **control plane
only**, not the document plane. **Topology** is single-node with published limits; multi-replica is a
[V2](./v2.md) question gated on load evidence.

---

## 13. Open questions, change triggers, and evidence ledger

### 13.1 Open questions

| # | Question | Why it is open | Who decides | Marker |
| --- | --- | --- | --- | --- |
| Q1 | Is the Actions `startup_failure` an account/repo setting, an org policy, or a billing state? | Answered as far as evidence allows: it reproduces in two private repos with no successful run ever, which points at account entitlement rather than a policy or YAML. The billing page itself needs the `user` token scope to read, so the exact number is unconfirmed | Operator | ◐ |
| Q2 | Does Alpha require a service worker, or is "offline means the tab stays open" an acceptable Alpha/Beta scope? | Both are defensible; the second is smaller in scope and must then be written down and shown in the UI | Product | ○ |
| Q3 | Is `navigator.storage.persist()` enough, or is a visible "your browser may evict this" state required? | Persistence is requested, not guaranteed; silent eviction is a data-loss path | Product | ○ |
| Q4 | Does A5 close by building a durable billing store or by turning hosted checkout off? | Both make the billing state accurate; they differ significantly in cost | Operator | ○ |
| Q5 | Does the attachments fix belong in compose only, or should the server refuse to boot with an in-CWD database when other stores are on `/data`? | The second prevents recurrence; the first is smaller | Engineering | ○ |
| Q6 | Should the marquee fix land before or with the error boundary? | The boundary makes the bug diagnosable; the fix stops it happening | Engineering | ○ |
| Q7 | Is `SMOOTHING = 0.22` right for remote peers once local easing exists? | Two constants must be tuned together or the two feels invert | Design | ○ |
| Q8 | Do we publish limits as a docs page, an `/limits` endpoint, or both? | Source of truth matters more than channel; A9 requires *one* | Engineering | ○ |

### 13.2 Change triggers

| Trigger | What changes |
| --- | --- |
| A load test shows the single-node ceiling is below the intended cohort | Capacity work moves from Beta into Alpha; A9 gains a hard number and V1's topology decision is revisited |
| Benchmark shows a workspace at the published limit is unusable | The index/card split moves from [V2](./v2.md) to [V1](./v1.md); ADR-0021's trigger fires |
| Actions execution cannot be fixed at the account level | A3 needs an alternative gate (self-hosted runner or a local pre-push verification that is *recorded*), and Beta must say what it does not prove |
| A second operator or a second replica appears | Admin scoping moves from Beta to Alpha; projection leases become a Beta item |
| A real user loses data | The register gains a P0 with a dated reproduction; every gate downstream is re-opened |
| Billing is turned off | A5 closes immediately; [v1.md](./v1.md) inherits the whole billing workstream |
| Accounts land earlier than planned | §10 (owner key in localStorage) and §11 (recovery semantics) collapse into one workstream |
| Cross-browser usage exceeds Chromium-only testing | The platform matrix moves from Beta to Alpha |

### 13.3 Evidence ledger

What was verified in this pass, and what was not.

| Verified by reading the tree on 2026-10-25 (✅) | Reported but not re-verified (◐) |
| --- | --- |
| Six stores under `/data` in `compose.yaml` with `SUITE_REQUIRE_DURABLE_STORES=1`; `config.ts` boot refusal + `config.test.ts` store-durability suite | GitHub Actions run history (every run `startup_failure`, 0 jobs; account-level, see §7.1 A3) |
| `deploy/backup.sh` snapshots all six stores, attachments with an id digest; `deploy/restore.sh` verifies them; `deploy/drills/attachments-record.md` | `timingSafeEqual` / 32-byte capability details in `auth.ts` |
| `attachments.ts` MIME allowlist and 16 MiB cap | PBKDF2 iteration count and salt derivation |
| `loroPersistence.ts` leader election and release-on-destroy; ADR-0024; two-instance and leader-takeover tests | Mobile layout claim (one `max-width: 640px` rule) |
| `useCanvasStore.ts` module-level singletons; `CanvasBoard.tsx` 2,412 lines; `projectionWorker.ts` 1,468 lines | Projection rebuild cost figures |
| `WorkspaceDocument.ts` 3,558 lines; schema stamp at open with no migration step | Timing claims about save stalls |
| `Dockerfile` has no `USER` (runtime stage) | `preview-dark.png` content |
| `e2e/playwright.config.ts` chromium-only; 30 specs | "No `any`/`@ts-ignore` in source" sweeps |
| Identity files present (`LICENSE`, `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`); `package.json` `0.2.0-alpha.1`; one tag (`ice-parity-2026-10-23`); 124 commits | Billing webhook against a live Stripe endpoint |
| `navigator.storage.persist()` + `StoragePanel` + `CanvasErrorBoundary` + `crash/*`; no service worker | Storybook story count and a11y gating beyond the 29 files listed |
| `pnpm test`: 150 files / 2,065 tests; full `pnpm e2e`: 219 passed / 3 skipped; billing `node --test`: 75 declarations | |
| `stryker.server.config.mjs` mutation scope | |
| ADR-0021 superseded for S1; 0022/0023 accepted; ADR-0019 accepted; the scene surface is removed | |
| `purity.test.ts`, `mode.test.ts`, `patchGuard.test.ts`, `mutationGaps.test.ts`, `workspace.convergence.test.ts` all exist | |

The 2026-10-23 rows that were overtaken — attachments in the working directory, five configured
stores, 2,850-line `WorkspaceDocument`, 1,914-line `CanvasBoard`, missing licence files, no
`persist()`, 142 test files — are recorded as drift (D12–D17, §9) rather than left as facts.

### 13.4 Maintenance

1. Re-read the ledger (§13.3) before quoting anything from it. The tree moves. Dates in ADR
   titles and contexts are historical record dates, not schedule dates.
2. When a gate closes, move its row out of §7 into a closed-gate list at the bottom, with the
   artifact link. Do not delete the row.
3. When a P0 closes, keep the symptom paragraph. The *shape* of a data-loss bug is reusable
   knowledge; the fix is not.
4. When this document and an ADR disagree, the ADR wins and §12 records the disagreement.

---

*Next: [Beta](./beta.md) — what makes a stranger able to use this for real work, with known limits.*
