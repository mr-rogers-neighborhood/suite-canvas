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

## Resolved — the pill is a status, and the risk is the panel's sentence

The author's note, verbatim: *"'Saved Temporarily' is still a bit confusing and instils uncertainty…
it is not clear whether the changes are permanent or if they might be lost… Most people are not "Local
only" users and will expect their changes to be saved permanently unless explicitly stated otherwise."*

**What is actually happening, in plain terms.** The work *is* saved — written to this browser's own
storage on every edit, and reload-safe. What the browser has not promised is that it will keep that data
forever: without durable storage, a browser may clear a site's data when the device runs low on space (or
after long inactivity, in some browsers). Safari is the strictest; Chrome grants durability to installed
apps and to sites the reader has engaged with; a plain tab in a fresh profile usually declines until the
site is bookmarked or installed. So it is **not** "your browser is being weird" — it is the standard
best-effort behaviour of origin storage, and it is exactly what an account (or an install) fixes.

**Why the label misfires.** "Saved temporarily" states a *limitation* where the reader expects a
*status*. It leaves them unable to answer "am I safe?" and invites the worst reading — that the next
reload may be empty. Two separate things are being collapsed into one phrase: *where* the work is saved
(here, in this browser) and *how firmly* the browser promises to keep it. The second is a footnote for
most readers and a real risk for a few.

**Options considered.**

1. **Say where, not how firm.** Pill: "Saved on this device" always; the durability caveat becomes a
   detail in the panel, not a pill. The claim stays true in every case, and the difference between
   durable and best-effort is explained once, on demand.
2. **Ask for durability at a moment of intent.** The ladder already tries on first edit; retry when the
   reader presses the action button ("Keep a copy on this device"), because a user gesture is what
   browsers weigh. Granting turns the caveat into a fact rather than a warning.
3. **Make the account the answer, once.** Keep the caveat visible only for a reader who is *not* signed
   in and *not* installed, and phrase the action, not the risk: "Sign in to keep this workspace
   anywhere." That is what the banner already does; the pill is the part that hedges.
4. **Do not mention it at all** for signed-in readers — already true: `signedIn` renders "Saved", and
   that is the state every hosted reader is in. The hedge is exclusive to anonymous, local-only use.

**Decision (author, 2026-10-25): options 1 and 2 — say where, *and* retry on a real gesture.**

**What that means in the code.** `storageLadder()` returns `"Saved on this device"` for every
non-failing anonymous state — durable or not — because the pill answers *where*, and the browser's
answer does not change that. `"Saved temporarily"` is gone. The banner's one sentence names the act
rather than the risk: "Sign in to keep this workspace anywhere." The risk moved into the panel's
`detail` row, in the reader's words, with an export beside it. The one case where the pill may still
alarm is a *failed write*, where the risk is present tense and hiding it would be a lie.

`requestPersistence()` is now offered from a genuine click — "Keep a copy on this device" — for
`unknown` **and** `denied`. The automatic attempt on first edit stays (it costs nothing), but browsers
weigh user intent, so the button is where durability is actually won; when it is granted the caveat
disappears on its own because the state changed rather than because the copy did.

Signed-in readers are untouched: "Saved", no caveat. That is the state every hosted reader is in, which
is why the hedge was only ever visible to the anonymous, local-only case the author described.

## Amendment — the risk is named once on the way out

The resolved decision above puts the risk in the panel's sentence, which only a reader who opens the
panel will read. A reader whose workspace sits on the `banner` rung — anonymous, with no promise that
this browser will keep the copy — is one click from leaving the only copy behind: back to the
launcher, or out of the tab. Neither moment had anything to catch it.

**What it does.** While `storageLadder()` reports `banner`, a return to the launcher is intercepted by
a small in-app dialog (`apps/canvas/src/components/LeavingDialog.tsx`). It carries one sentence in
plain words — "This workspace is saved only in this browser, and the browser may clear it when the
device needs the space." — the two actions that make the work safe, and "Leave anyway". The actions
are the ones that already exist rather than new ones: "Sign in" opens the account dialog the header
uses, and "Export a copy" writes the same backup as File → Export backup… . Leaving proceeds when the
reader chooses it. The condition (`shouldWarnBeforeLeaving`) lives in
`apps/canvas/src/session/leavingGuard.ts` and is read from the ladder's rung, not from a second rule
in a component; the dialog and the native prompt are its two mechanisms.

**Why a second, native mechanism.** An in-app dialog cannot see a tab close, and that is the other
half of the same loss. The same rung therefore also registers a `beforeunload` listener
(`apps/canvas/src/session/useBeforeUnload.ts`). The browser owns that wording, so the listener only
asks the question; it is registered while the rung is `banner` and removed when the rung changes, when
the reader has begun the navigation they chose, and it is never registered for a signed-in reader or
for `blocking`, whose risk is already present tense in the chrome and the panel and would gain no way
to be fixed from a close prompt.

**Why once per session.** A reader who has been told and has chosen to stay does not need the same
sentence on every return to the launcher, and a guard that repeats itself becomes a guard people
dismiss unread. The dismissal lives in memory only — not `localStorage`, where it would outlive the
session and could hide the warning after the reload it describes — and it is tied to the document's
version: once the work changes, the old warning no longer describes what could be lost, so the next
leave asks again. Choosing "Leave anyway" is itself a dismissal, and the session ends when the page
does.

**What it deliberately does not do.** It does not run for a share session: the projection in this
browser is not the only copy of the work, and a share has neither an export nor an account to offer.
It does not block leaving, and it introduces no storage state of its own — the pill, the panel and
this dialog all read the one `storageLadder()` answer.

## Amendment — the native prompt is a gate, not a message

The author's note: *"the native confirm dialogue when closing the tab/window… should be more informative,
and upon clicking Cancel should then bring up the system prompt again or provide additional guidance."*

**What the browser allows, plainly.** A `beforeunload` handler cannot choose the wording — Chromium shows
"Changes you made may not be saved", Safari and Firefox their own variants — and it cannot show anything
custom. It also gives **no signal** for which button was pressed: there is no "cancelled" event, and no way
to tell a cancelled close from a tab that was simply left open. So "re-prompt after Cancel" cannot be
implemented as described on any engine, and faking it with a timer would either nag a reader who never
tried to leave or fire while they are working.

What that leaves, and what the shipped guard does:

1. **The native prompt is the last resort, not the explanation.** It exists to force a decision. Its job is
   to be *rare* — registered only on the `banner` rung, and disarmed the moment the reader chooses a leave.
2. **The informative sentence lives where we own the words**: the in-app leaving dialog and the storage
   panel. That is where sign-in, an export and "leave anyway" are offered, and where the reader can read
   the risk at their own pace.
3. **Guidance after a cancelled close is the panel's job.** A reader who cancelled is still in the app with
   the storage pill in front of them saying "Saved on this device"; opening it explains the state, offers
   the durability gesture and the export. Making that surface the obvious next step is a *discoverability*
   problem, and it is cheaper to solve there than to fight the browser.
4. **If the platform ever gives us a signal** (a `visibilitychange` heuristic is the closest thing, and it
   is wrong often enough to be worse than silence), the dialog can be raised again on return. Until then we
   do not pretend to detect it.

Recorded so this is not re-attempted as a bug: it is a platform boundary, not an unfinished feature.

## Amendment — the warning is for a reader who is the only copy

The author's note: *"When two users are live/synced, should the local-first warning display? Probably only
if there is a conflict or not at all, because if you're signed in and working collaboratively, constant
warnings would be disruptive?"*

The ladder learned one input: `synced` — **another device is in the room right now**. Not "my socket is
open": a reader alone in a workspace is still the only copy, and the relay room for an anonymous
workspace is not the account's copy. Presence is the fact that changes the answer, which is exactly the
fact the author described.

1. **`banner` gives way to `quiet` while someone else is present.** The line becomes "Saved here and
   synced", the sentence names why ("Another device in this room has a copy, so this one can clear its
   own safely"), and no sign-in or export is offered. A collaborating reader has somewhere else to go.
2. **`blocking` does not move.** A write failing is present tense and local: another copy does not make
   the reader's next edit land. The quota banner and its export stay.
3. **`persisted` does not move either.** Where the work is does not change because a room is live; the
   durable anonymous reader keeps "Saved on this device" and no banner.
4. **The leaving guard follows the ladder, as it must.** With the rung at `quiet`, nobody is prompted on
   the way out — that is the point of the change, and it is asserted in `leavingGuard.test.ts` rather
   than left to the dialog.
5. **The claim is about a copy, not about permission.** Sync does not make a share safer, and a share
   already excludes itself from the leaving prompt.

The status line itself moved out of the chrome in the same pass; see the ADR-0064 amendment on one status
surface.
