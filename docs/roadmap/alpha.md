# Alpha — current state and Alpha exit criteria

- **Status:** living document. It records decisions and verified facts; it is not a contract.
- **Stage:** late Alpha, approaching Beta.
- **Provenance:** a read-only codebase audit and design discussion (2,544 lines), re-checked against
  the working tree on 2026-10-23. The tree was mid-flight during the audit and is now committed
  clean (89 commits on `main`). Facts can change; each claim carries a marker.
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
3. What must be true before Beta? Gates A1–A10, plus A11 (Portals) once its
   planning phase lands.

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
| The hard correctness work is done | One `LoroDoc` per workspace behind a typed, Zod-validated facade (`packages/graph/src/loro/WorkspaceDocument.ts`, 2,850 lines, 165 methods) | ✅ |
| Merge correctness is *fuzzed*, not assumed | `packages/graph/src/loro/workspace.convergence.test.ts` converges two documents; property tests on merge, sections, search | ✅ |
| Sharing is a real projection system, not a flag | `apps/collab-server/src/projectionWorker.ts` (1,468 lines) rebuilds a redacted self-contained document per share room; ADR-0022, ADR-0023 accepted | ✅ |
| Publish has a plan/apply split | `packages/graph/src/publish/plan.ts` is pure and replayable; `apply.ts` reads only captured values | ✅ |
| Operational thinking exists | Boot-time config validation (`config.ts`, 522 lines), quotas that never drop a save (`limits.ts:9`), 429 + `Retry-After`, `/metrics`, health probe, admin status, backup with integrity checks | ✅ |
| The security basics are right | `timingSafeEqual`, 32-byte random capabilities, SHA-256 at rest, per-room capability scoping, 15-minute share sessions, revocation that closes live sockets | ◐ (mechanics read; end-to-end not re-tested here) |
| Architecture is enforced by tests | `packages/graph/src/purity.test.ts` parses the AST to keep the core DOM-free; `apps/canvas/src/session/mode.test.ts` forbids `fetch`/`WebSocket` outside relay modules; `apps/collab-server/src/patchGuard.test.ts` fails if a dependency patch vanishes | ✅ |
| Documentation is a design artifact | 23 ADRs with statuses and supersession chains, 840-line architecture doc, 884-line operations runbook | ✅ |

A pre-alpha would not have a purity test, a convergence fuzz test, or an ADR that says "this
decision was reversed, here is why". Those are the habits of a project that has already survived its
first rewrite.

### 1.2 Why it is not Beta yet

Beta means strangers can use it for real work with known limits. Today a stranger can lose data
without any diagnostic or notice. Four independent reasons, in descending severity:

1. **Two live data-loss paths exist.** Attachments live outside the data volume and outside backup
   (§6.1). Multi-tab IndexedDB compaction deletes another tab's unmerged updates (§6.2). These are
   not "scale" problems; they are "the backup is incomplete and the cache is destructive" problems.
2. **No commit has ever been gated.** The CI workflow is plausible and complete, but the audit
   reports that every run in the repository was `startup_failure` with zero jobs; the audit counted
   19 and a re-check on 2026-10-23 counted 21, attributed to a synthetic
   `BuildFailed` workflow. ◐ **Re-verify**: `gh run list --workflow=ci.yml`. Whatever the cause, the
   claim "tests pass" currently rests on local runs, and a stranger has no reason to believe it.
3. **There is no release identity.** No `LICENSE`, no `SECURITY.md`, no `CHANGELOG.md`, no
   `CONTRIBUTING.md`, no tags. ✅ (`ls` on the repo root; `git tag` empty; 89 commits, all on `main`.)
   `README.md` calls the product open source; without a licence that claim is not legally true. A
   version number of `0.1.0` with no tag means "which build are you running?" has no answer.
4. **Billing cannot take money, by its own admission.** `services/billing/handler.ts:268` constructs
   a module-level `memoryStore()`, and the comment above it says the store must be replaced before
   the endpoint takes real money. ✅ The hosted edition therefore has an entitlement path whose state
   dies with the Lambda container.

Secondary but real: the client has no durability work (no service worker, no
`navigator.storage.persist()`, no error boundary — ✅ grep across `apps/canvas/src` returns nothing),
there is no N−1 document upgrade test, and two reported UX bugs (§6.3, §6.4) make the primary
interaction feel unreliable.

### 1.3 The one-sentence position

> The product is real and the correctness culture is unusually good; what is missing is the
> evidence that it works (CI), the promise that it will keep working (release identity, upgrade
> path), and the guarantee that it will not eat data (attachments, multi-tab, client storage).

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

Alpha is *not* satisfied — and Beta is not entered — while any of these are true:

- A stranger's restore silently drops their images (§6.1). ✅
- A stranger with two tabs open can lose edits made in the other tab (§6.2). ✅
- A stranger cannot tell whether the build they run is the build we tested (§1.2 point 3). ✅
- A stranger who pays gets an entitlement that evaporates on a cold start (§1.2 point 4). ✅
- A stranger's browser can silently evict the local document (§6.5, P1 row "client storage"). ✅
- A stranger hits an unknown interaction and gets a blank page with no diagnostic (§6.5). ✅

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
| 3 | **Test intent** | Beta-ish | 142 test files; ~1,392 unit declarations ◐; ~160 Playwright declarations ◐; 61 billing tests ◐; 24 stories with `a11y: { test: "error" }` ◐; mutation configs (`stryker.*.config.mjs`); coverage thresholds on `@suite/graph` | ✅/◐ |
| 4 | **Test evidence** | **Alpha** | No verifiable green CI run. Counts in `docs/testing.md:28,30` are stale (104 files / 1,278 / 132 vs 142 files today) | ✅ (staleness) / ◐ (CI) |
| 5 | **Ops / deploy** | Beta-ish, single node | `compose.yaml` (Caddy → app), TLS + CSP, healthcheck, graceful shutdown, boot-time config validation, `/metrics`, structured redacted logs, admin panel, backup/restore scripts, quota + rate-limit system | ✅ |
| 6 | **Security model** | Alpha+ | Constant-time comparisons, 32-byte capabilities, SHA-256 at rest, scoped worker tokens, PBKDF2 600k, share-token scoping, live revocation. Missing: threat model, audit trail, expiry *by default*, admin scoping, E2EE | ◐ |
| 7 | **Billing** | **Pre-alpha** | Module-level in-memory store (`services/billing/handler.ts:268`); no live Stripe webhook E2E; key rotation has a customer-visible window | ✅ |
| 8 | **Client resilience** | **Alpha** | No service worker, no `navigator.storage.persist()`, no quota/eviction handling, no React error boundary, no crash reporting | ✅ |
| 9 | **Release management** | **Pre-alpha** | `0.1.0`, zero tags, zero releases, no `CHANGELOG`/`LICENSE`/`SECURITY.md`/`CONTRIBUTING.md`, 89 commits on one branch | ✅ |
| 10 | **Scale evidence** | **Alpha** | Single replica by design; SQLite; in-process rooms/presence/projection/rate limits; benchmarks exist (`packages/graph/bench/workspace.bench.ts`, `projection.bench.ts`) but are not gated | ✅ |
| 11 | **UX / onboarding** | Alpha | Polished visuals, real keyboard/ARIA work, but no accounts, no mobile layout beyond one `max-width: 640px` rule ◐, no i18n, and a recovery model with five terms for three artifacts ◐ | ◐ |
| 12 | **Docs** | Beta-ish, drifting | ~3,700 lines, 23 ADRs, real runbooks; counts, store counts, engine names and class names are stale (§9) | ✅ |

### 3.1 Reading the scorecard

Only two dimensions are pre-alpha: billing and release management. Both concern the promise around
the product rather than the product itself. The dimensions with no exercised evidence are test
evidence and client resilience; both are small changes relative to their impact. The strongest
property is not in the table: recording decisions and enforcing them with tests (§5).

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
`settings`, `licences`, `attachments`). `compose.yaml` configures five. Attachments defaults to the
process working directory; settings and licences default to `:memory:` (`compose.yaml:40-41`). All
three are lost when the container is recreated. ✅ This durability finding belongs with §6.1 and is
covered by gate A1.

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
10. **Docs are design artifacts.** 23 ADRs with statuses and supersession chains (`0001 → 0015`,
    `0021 → 0022`), a mermaid data flow, performance budgets, explicit non-goals, and an
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
- **Four files carry a large share of the domain:** `WorkspaceDocument.ts` (2,850 lines, 165
  methods), `CanvasBoard.tsx` (1,914), `adminHttp.ts` (1,516), `projectionWorker.ts` (1,468). They
  are internally organized and tested, but they are merge-conflict and review bottlenecks (P1-4).
- **Review capacity is the main organizational risk.** The tree has 89 commits on one branch, zero
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

**Status:** `open`.

### 6.2 P0 — Live data loss: multi-tab IndexedDB compaction deletes every workspace update row

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

**Status:** `open`.

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

**Status:** `open` — fixed. Both former `test.fixme` cases are real specs in
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

**Status:** `open` — implemented in `apps/canvas/src/canvas/localEasing.ts`. It is a time-based
render-only ease (`tau` 12 ms) on the delta; pointer samples only set the target, one rAF paints,
drop snaps to the pointer and commits once. `prefers-reduced-motion` skips it; remote smoothing is
unchanged. Unit tests cover the one-commit contract and the reduced-motion path.

### 6.5 P1 — Important, not Alpha-blocking

| # | Item | Symptom | Where | Impact | Fix direction | Acceptance evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1-1 | **Synchronous full-state SQLite saves on the event loop** | Every room writes a whole-document BLOB, serially, on the main thread | `apps/collab-server/src/persistence.ts` (one `state` BLOB per room, `DatabaseSync`), `server.ts:212` (`saveInterval: 2000`) | At ~12 MB/5,000-card workspace, each save is megabytes of write amplification and blocks every WebSocket message for the duration; several active rooms serialize into visible latency spikes | Persist incremental Loro updates and compact periodically; move SQLite to a worker thread; add `busy_timeout`; measure **event-loop lag**, not save duration | Lag histogram during a save under load; save duration p95; no message interleaving failure | `open` |
| P1-2 | **Projection rebuild is full clear-and-rewrite per share, single peer, single worker** | Every save rebuilds every projection of that workspace | `apps/collab-server/src/projectionWorker.ts` (1,468 lines); `docs/architecture.md` §"Share projections" documents the LWW-one-peer design | A 2,000-card board with several shares pays the full cost per save; design cannot survive a second worker or multi-replica without a lease | Use publish diff machinery for incremental projection; skip when the source version vector is unchanged; record projection build time per share and cap it; add a per-room lease if a second worker is ever introduced | Per-share build-time metric; skip ratio; a test that an unchanged workspace rebuilds zero shares | `open` |
| P1-3 | **Module-load singletons make the app one-workspace-per-page-load** | `LoroDoc`, `WorkspaceDocument`, presence stores, persistence and provider are constructed at import; `SESSION` is read at import | `apps/canvas/src/store/useCanvasStore.ts:35-52` | No clean workspace switch without reload; tests must reset modules; accounts/multi-workspace tabs get harder the longer this stays | Introduce a `WorkspaceSession` factory/context created at boot, with doc/persistence/provider injected; remove the `import.meta.env.MODE` standalone workaround | A test that two sessions can exist in one process; a workspace switch without reload | `open` |
| P1-4 | **God objects** | One class/file owns a whole domain | `WorkspaceDocument.ts` 2,850 lines / **165 methods**; `CanvasBoard.tsx` 1,914; `adminHttp.ts` 1,516; `projectionWorker.ts` 1,468 | Review, onboarding and merge-conflict cost; every change touches a file everyone is editing | Split behind the existing facade by aggregate (cards, boards, types/tags, edges/sections, content); extract canvas gesture hooks; split admin routes and projection phases. Existing tests are the safety net | Line/method counts down; no behaviour change in the suite; import graph shows no cycles | `open` |
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
scope, data model, and acceptance are sketched in §7.4.

| Gate | Statement | Required evidence | Depends on |
| --- | --- | --- | --- |
| **A1** | Attachments, settings, and licence state are durable | Container-recreate test for all three; backup/restore drill with an attachment; manifest count + checksum; `SUITE_ATTACHMENTS_DB`, `SUITE_SETTINGS_DB`, and `SUITE_LICENCE_DB` all point at `/data` in `compose.yaml` and `.env.example`; **boot refuses a mixed layout** (attachments on CWD while other stores are `/data`, or `:memory:` settings/licences in a composed deployment); ops/security/limits docs corrected | — |
| **A2** | Multi-tab persistence cannot delete a peer's work | Two-instance `fake-indexeddb` test (compact in A, reload B, both survive); leader-election test; two-tab offline drill record | — |
| **A3** | CI actually gates `main` | A green `quality` + `e2e` run on `main`, visible in Actions; branch protection with required checks; a deliberately failing commit demonstrated to be blocked | — |
| **A4** | The product has an identity | `LICENSE`; `SECURITY.md`; `CHANGELOG.md`; semver tag on the released commit; version reported by `/health` or admin status; images pinned by digest | A3 |
| **A5** | Billing is either durable or explicitly closed | Either a durable store with conditional writes and a Stripe test-mode webhook E2E, **or** hosted checkout disabled and every surface saying "billing is not open" | A3 |
| **A6** | The client can fail without losing the page | `navigator.storage.persist()` requested with a visible grant state; quota/eviction handling; an error boundary that renders a diagnostic instead of white; a crash hook (opt-in) | — |
| **A7** | An old document opens in a new build | N−1 fixture test for the workspace format; `schemaVersion` policy in code (currently stamped at `WorkspaceDocument.ts:1326-1327` with no migration step); N−1 database fixture per store | A3 |
| **A8** | The docs tell the truth | §9 ledger emptied; `pnpm docs:check` (links + code fences) in CI; `AGENTS.md` names real types | — |
| **A9** | The limits are published | A single limits page: workspace bytes, card count, attachment bytes/workspace, shares/workspace, selection cards, open rooms, peers/room, restore targets. Values sourced from `limits.ts` and `compose.yaml`, not prose | A1 |
| **A10** | Both reported UX bugs are closed | Marquee e2e checklist (1, 2, many, across sections, with a peer); local-vs-remote smoothing acceptance at 60/120 Hz; one CRDT commit per gesture | A6 |
| **A11** | Portals vertical slice | Portal card type, mini-map outline, enter/exit camera transition, cross-board presence, and card focus mode; e2e covers enter/exit, presence, and one commit per gesture | A10 |

### 7.1 Gate notes

**A1 — why a container-recreate test and not a unit test.** The bug is a deployment fact: the code
is correct and the compose file is not. Only a test that runs the composed stack can fail when the
volume mapping regresses.

**A1 also covers the `:memory:` stores.** `compose.yaml:40-41` defaults `SUITE_SETTINGS_DB` and
`SUITE_LICENCE_DB` to `:memory:`, so operator limit overrides and hosted licence claims do not
survive a restart. A1 closes only when all three stores (attachments, settings, licences) point at
`/data` and survive a container recreate. Closing attachments alone leaves a paid customer's
entitlement as volatile as the attachment bytes.

**A1 hardening for the next planning phase.** Refuse the ambiguous deployment at boot instead of
documenting the trap: if the document/shares/workspaces stores are under `/data` and attachments is
not, or settings/licences are `:memory:` in a composed deployment, the server should fail with a
named error. This is cheaper than a runbook warning and is not yet implemented; A1 is not fully
closed until it is.

**A2 — why two instances in one process.** `fake-indexeddb` gives a shared database across two
`LoroIndexeddbPersistence` objects, which is exactly the browser's situation. A single-instance test
would pass today.

**A3 — why a deliberately failing commit.** A green run proves the workflow can run; a blocked
commit proves the check is *required*. Branch protection is the difference between "we have CI" and
"CI gates us".

**A3 status: blocked externally (2026-10-23).** Actions is enabled, the workflow passes
`actionlint` v1.7.12, and the remote file matches the local file. Every run, including
`workflow_dispatch` and a one-line smoke workflow on a throwaway branch, ends in
`startup_failure` with 0 jobs and 0 check runs. Branch protection and rulesets return
`403: Upgrade to GitHub Pro or make this repository public`. A3 is therefore `failed` until Actions
executes and the repository can require checks. The local gate is `pnpm verify` plus `pnpm e2e`; it
does not close A3.

**A4 — why a tag and not a version field.** `package.json` says `0.1.0` and `git tag` is empty ✅, so
"which build are you running?" has no answer and no artifact to roll back to. The tag is the artifact.

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
| A3 | `failed` | See the A3 note in §7.1. Actions returns `startup_failure` with zero jobs; branch protection is unavailable on the private free repo. |
| A4 | `open` | `LICENSE` (MIT), `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `docs/release.md`, `package.json` at `0.2.0-alpha.1`; ADR-0026 |
| A5 | `open` | `services/billing/handler.ts` (closed by default, `503` before signature), `docs/billing.md`, `.env.example` |
| A6 | `open` | `apps/canvas/src/shell/ErrorBoundary.tsx`, `storage/durability.ts`, `components/StoragePanel.tsx`, `crash/*`, `compose.crash.yaml`; ADR-0025, ADR-0027 |
| A7 | `open` | `apps/collab-server/src/persistence.ts` (`loro-snapshot-v1`), `fixtures/n-1/`, `storeUpgrade.test.ts` |
| A8 | `open` | `scripts/docs-check.mjs`; corrected `README.md`, `AGENTS.md`, `docs/testing.md`, `docs/billing.md`, `docs/deploy-aws.md` |
| A9 | `open` | `scripts/generate-limits.mjs`; generated `docs/limits.md`; `--check` in CI |
| A10 | `open` | Marquee selection ownership fixed; both former `fixme` cases are real specs (peer drag during the box, cancel mid-gesture); local drag easing is render-only and one commit per drop. Evidence: `apps/canvas/src/canvas/CanvasBoard.tsx`; `apps/canvas/src/canvas/localEasing.ts` + tests; `e2e/tests/marquee.spec.ts` |
| A11 | `measuring` | Data model merged: `board` field kind, seeded `portal` type, `createPortalCard`, ADR-0029. Canvas slice (portal card, miniature, transition, presence, card focus) is in progress; acceptance checklist in §7.4. |

### 7.4 A11 — Portals and card focus (pinned)

**Name.** "Portals" is the working name. It is better than "nested canvases" because the user-facing
object is a doorway, not a container. Alternatives if it ever needs renaming: *Vistas*, *Doorways*,
*Looking Glass*.

**Definition.** A portal is a card on a board that represents another board. It renders a high-level
outline of that board, and activating it replaces the active board with the target board through a
camera transition. The transition is a camera trick: the target outline is drawn into the portal's
screen rectangle, animated to fill the viewport, then the board switches underneath the overlay. The
result should feel like zooming into a nested canvas, not navigating to a different page.

The same trick applies to a single card. The inspector's **Edit** action and a double-click/zoom
gesture open a full-canvas card editor; Escape or zoom-out returns to the previous board and
viewport.

**Data model (accepted, ADR-0029).**
- A built-in `portal` card type with a `board` field kind. A board reference participates in views,
  publish redaction, and backlinks like any other reference value. `packages/graph` exports
  `PORTAL_TYPE_ID`, `PORTAL_BOARD_FIELD_ID`, and `createPortalCard`.
- A portal is a *card*, not a new object class. Cards already have multiple placements, so the same
  target board can be reached from several boards.
- A portal **references** its target board; it never owns or deletes it. A deleted target leaves the
  portal readable as *Unavailable board*. `deleteType("portal")` and removal of the board field are
  refused.

**Rendering.**
- `PortalNode` draws a static miniature of the target board: section bands, card rectangles, and
  presence dots. Do not mount a second React Flow instance per portal; that would multiply the
  editor and gesture cost.
- The miniature is derived from the same snapshot and increments with the target board's version
  vector. It is not stored.
- Cross-board presence uses the existing `AWARENESS_FIELDS.board` value; no new transport. Render
  peer avatars on the portal card and a dot/badge on the board tab.

**Transition.**
1. Measure the portal node's screen rectangle.
2. Render the target board's outline into an overlay at that rectangle.
3. Animate the overlay to the full canvas viewport and fade the old board.
4. Switch `activeBoardId`, set the target viewport so the target's content maps to the screen, and
   remove the overlay.
5. Keep a back stack: Escape, breadcrumb, or the reverse zoom returns to the exact previous
   board/viewport.

**Card focus.** Reuse the same overlay. The inspector Edit action sets a `focusTarget` that expands
the card to the canvas, focuses the title/body editor, and restores the previous viewport on exit.
The card remains the same object; no second editor model.

**Resolved decisions.**
- A portal references the target; it never creates or deletes it (ADR-0029).
- Cycles are a navigation problem: A→B→A is legal, and the back stack returns to the exact previous
  board and viewport.
- In a share, a portal is an ordinary card with an inert board value. Portal-aware publish/export is
  a non-goal for this slice.
- The first slice is one level of nesting plus a back stack, not arbitrary depth.
- Tab grouping and cross-board edges are follow-ons, not part of the first slice.

**Acceptance for the first slice.**
- A portal can be created from the right-click menu and the Add card/type menu.
- Double-click or zooming past a threshold enters the target board with no full-page reload and no
  white flash.
- Escape or zoom-out returns to the exact previous board and viewport.
- A peer on the target board appears on the portal card and the board tab.
- The inspector Edit action opens the card in the canvas; Escape restores the previous viewport.
- One CRDT commit per gesture; no per-frame document writes.
- Keyboard activation and `prefers-reduced-motion` paths work.
- E2E: enter/exit, back stack, presence on portal/tab, card focus, and a portal cycle.

**Non-goals for the first slice:** tab grouping, cross-board edges, portal-aware publish/export,
mobile, and more than one level of nesting.

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

### 8.1 Package dependency graph

`A → A1, A2` · `B → A3` · `A3 → A4, A5, A7` · `C → A6 → A10` · `D → A8, A9` (A9 needs A1 for the
attachment row; A8 needs A3 for the check to run).

A3 (CI) has the widest effect: it keeps every other gate's evidence current. A8 (docs) is the
smallest: it requires reading the cited files and correcting them.

---

## 9. Documentation drift ledger

Docs are one of this project's main trust signals, so stale docs are a *product* problem, not a
housekeeping one. Each row was re-read on 2026-10-23.

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
| D11 | Ops doc describes a "three database" backup | Six stores exist; compose configures five; backup covers five; attachments covered by none | `docs/operations.md`, `deploy/backup.sh:70-77` | ✅ |

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
| Q1 | Is the Actions `startup_failure` an account/repo setting, an org policy, or a billing state? | The audit could not distinguish cause from symptom; it affects A3 directly | Operator | ◐ |
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

| Verified by reading the tree (✅) | Reported but not re-verified (◐) |
| --- | --- |
| `attachments.ts:79-80` default path; `:22-36` MIME allowlist and 16 MiB cap | GitHub Actions run history (`startup_failure`, 21 runs re-checked on 2026-10-23, 0 jobs) |
| `compose.yaml:37-41` store env vars, no `SUITE_ATTACHMENTS_DB`; `:40-41` `:memory:` defaults | Unit/e2e declaration counts (~1,392 / ~160) |
| `deploy/backup.sh:70-77`, `deploy/restore.sh:116`, `restore.sh:276` | Storybook story count and a11y gating |
| `loroPersistence.ts:8, 72-73, 140-145, 160-180` | `timingSafeEqual` / 32-byte capability details in `auth.ts` |
| `Dockerfile` has no `USER` (runtime stage `:31-57`) | PBKDF2 iteration count and salt derivation |
| `config.ts:277` → `["*"]`; `server.ts:212` `saveInterval: 2000`; `http.ts:156` 64 KiB | Mobile layout claim (one `max-width: 640px` rule) |
| `e2e/playwright.config.ts:73` chromium-only | `preview-light.png` still saying "Yjs" |
| `services/billing/handler.ts:268` `memoryStore()`; `issue.ts:6` app import | Passphrase UX detail in `RecoveryKeyDialog.tsx` / `WorkspaceProtected.tsx` |
| `useCanvasStore.ts:35-52` module-level singletons | "No `any`/`@ts-ignore` in source" sweeps |
| `WorkspaceDocument.ts` 2,850 lines, 165 methods, `:1326-1327` schema stamp | Projection rebuild cost figures |
| `CanvasBoard.tsx` 1,914 / `adminHttp.ts` 1,516 / `projectionWorker.ts` 1,468 | Timing claims about save stalls |
| `stryker.server.config.mjs:37-41` mutation scope | |
| No `LICENSE` / `SECURITY.md` / `CHANGELOG.md` / `CONTRIBUTING.md`; `git tag` empty; 89 commits; clean tree | |
| No service worker / `storage.persist` / error boundary in `apps/canvas/src` | |
| `testing.md:4,28,30,37`; `README.md:168,183`; `security-model.md:72`; `AGENTS.md:83-84`; `limits.ts:32-33`; `operations.md:80,668` | |
| ADR-0021 superseded for S1; 0022/0023 accepted; ADR-0019 accepted | |
| `purity.test.ts`, `mode.test.ts`, `patchGuard.test.ts`, `mutationGaps.test.ts`, `workspace.convergence.test.ts` all exist | |
| Test file count: 142 | |

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
