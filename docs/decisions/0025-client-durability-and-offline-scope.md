# ADR-0025: Client durability and the offline boundary

- **Status:** Accepted
- **Date:** 2026-10-23
- **Gate:** A6
- **Supersedes:** none

## Context

The canvas keeps a Loro document in IndexedDB and, in a hosted deployment, syncs
it through a relay. Two failure modes were unaddressed before Alpha:

1. A browser may evict an origin's storage, and a full disk refuses writes. Both
   were silent: the document looked saved and was not.
2. A render error anywhere in the shell produced a blank page with no build, no
   route and no way to say what happened.

The alternative to a durable local copy — "the relay has it" — is not available
to a self-hoster running one container, to a standalone build, or to a tab whose
network has gone away.

## Decision

### Durable storage is requested on first use, and its state is visible

- `navigator.storage.persist()` is called after the **first meaningful
  interaction** — the first local change to the document (an edit, an import, a
  move) — never on load. Chrome only grants durable storage to an origin the
  person has actually used, and asking on load wastes the one prompt.
- The storage panel reports exactly one of:
  - `persisted` — the browser agreed not to evict this origin's data;
  - `best-effort` — the browser declined (`persist()` resolved `false`), or
    cannot offer durable storage at all, so the copy may be evicted;
  - `unsupported` — the Storage API is missing (an embedded browser, a
    partitioned context).
- On a refusal the panel states the consequence ("it may evict the local copy")
  and offers an export. It never blocks editing: the in-memory document is the
  source of truth and remains complete.

### A refused write is a typed state, never a silent save

- IndexedDB's `add`/`put` are wrapped once per page by
  `installIndexedDbQuotaGuard()` (`apps/canvas/src/storage/durability.ts`).
  `QuotaExceededError` (and the Safari/Firefox codes and names) raises a visible
  state on the storage panel and in the diagnostics bundle.
- A failed write does not touch the document. Persistence is a side channel;
  a quota failure leaves the open tab fully editable, and the panel tells the
  person to export before closing it.
- `navigator.storage.estimate()` is shown as usage against quota. Unknown values
  say "unknown" rather than a fabricated number.

### The document survives a broken render

- `CanvasErrorBoundary` (`apps/canvas/src/shell/ErrorBoundary.tsx`) wraps every
  page the entry point renders — the workspace, a share view, the protected
  notice and the local-only notice. Its fallback always renders: build version,
  route, a copyable diagnostic block, reload, and export of the current
  workspace. A white screen is a bug in the boundary, not an acceptable state.
- The diagnostic bundle (`apps/canvas/src/shell/diagnostics.ts`) is built from
  local state only — build, sanitised route, persist state, estimate, quota,
  connection status, last error. Copying it needs no network (`navigator.clipboard`
  with a selection-based fallback).
- The route in the bundle and in the fallback drops the URL fragment (which
  carries the owner key) and redacts a share token.

### Offline means the open tab, and the UI says so

- No service worker in Alpha. A service worker caches assets and changes the
  reload semantics; getting that wrong is worse than not having it, and the
  self-host story does not need it.
- The published scope, in the storage panel and in docs:
  **"Offline means the open tab keeps working. A reload while offline is not
  supported in Alpha."**
- Local persistence covers the failure this boundary actually has: a dropped
  connection or a relay outage does not lose work while the tab stays open.
  Full offline reload is Beta scope (`docs/roadmap/beta.md`).

## Consequences

- A person can see why their work might disappear and take a copy before it does.
- The page keeps working through quota exhaustion; the cost is that the panel
  has one more place that must be honest after every storage change.
- Every render error becomes a diagnosable artifact instead of a support rumour.
- No service worker means a cold start needs the network. Accepted for Alpha and
  recorded in the roadmap.
- `VITE_SUITE_VERSION` must be set by the release build for the fallback and the
  diagnostics bundle to name a release; an unset value reports `dev`.

## Alternatives considered

- **Ask for persistence on load.** Rejected: browsers treat it as a permission
  prompt without user intent and commonly deny it, which would make the panel
  permanently pessimistic.
- **Block editing when storage is refused.** Rejected: the document is in memory
  and correct; blocking would turn a storage limitation into data loss.
- **A service worker for offline reload.** Rejected for Alpha: stale-asset bugs
  are harder to recover from than a clear "reload needs the network" rule.
- **A modal dialog on quota exhaustion.** Rejected: it interrupts the one thing
  that still works — editing — and can be dismissed without reading it.
