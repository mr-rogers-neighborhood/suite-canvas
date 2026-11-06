# ADR-0024: One compactor per workspace, and a version vector as the delete proof

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0020](./0020-main-and-loro-plan-of-record.md), [ADR-0022](./0022-share-projection-links.md), `apps/canvas/src/collab/loroPersistence.ts`

## Context

Offline persistence in the canvas writes two things to IndexedDB: a snapshot per workspace, and an
append-only log of the local updates since that snapshot. The snapshot is the fast load path; the
log is what makes a crash between compactions harmless.

`compact()` wrote this tab's snapshot and then deleted **every** row in the workspace's update
index. With one tab that is correct. With two tabs open on the same workspace it is silent data
loss: the tab that compacts first deletes the other tab's rows, and those rows were the only durable
copy of the other tab's offline edits. Nothing in the UI reports it — the next load is simply
missing work — and it surfaces exactly where a local-first product has to be strongest: an offline
window, a reload, or a machine that reclaims a background tab.

Two facts decide the design:

1. A tab's `LoroDoc` is a subset of the workspace history. It cannot know what another tab holds.
2. IndexedDB gives no cross-tab atomicity beyond a single read-write transaction over the stores it
   names, and a browser tab can disappear at any instant, including between a snapshot write and a
   delete.

## Decision

1. **One compactor per workspace, elected with Web Locks.** A tab calls
   `navigator.locks.request("suite-compact:<workspace>", { mode: "exclusive", ifAvailable: true })`
   when it opens the workspace and holds the lock for the tab's lifetime. The holder compacts; every
   other tab is a follower, appends its own log, and never writes a snapshot. `compact()` from a
   follower returns without writing anything — a tested no-op, not a quiet best effort.
2. **A follower takes over, throttled.** A granted lock dies with its tab, so a follower re-requests it
   on its next compaction (at most once every `LEADERSHIP_RETRY_MS`, five seconds) with the same
   non-blocking `ifAvailable: true`. Losing the race caches `follower` again; winning it turns that
   tab into the compactor immediately, without a reload. Concurrent compactions share one in-flight
   request, and a tab only ever holds one lock, so the earlier grant is never orphaned.
3. **Deletion is filtered by a version vector, not by key enumeration.** Each snapshot records the
   oplog version it was exported at, and each update row records the oplog version it produced.
   `deleteCovered` deletes a row only when the *stored* snapshot's version covers that row's version.
   The stored snapshot is read **inside the same read-write transaction** as the delete, so no other
   tab can swap in a smaller snapshot between the check and the delete.
4. **The snapshot version is broadcast.** `BroadcastChannel("suite-persist:<workspace>")` carries two
   messages: local updates, so tabs converge without a relay round trip, and the snapshot's version
   vector. A follower uses the announced version, re-checked against the store, to prune its own
   covered rows.
5. **A snapshot never replaces one it cannot supersede.** Before writing, the compactor compares its
   own version with the stored snapshot's. If the stored one holds something this tab has not seen,
   the compaction is skipped. Writing would strand those rows: covered by the old snapshot, absent
   from the new one, and deleted by a tab that thought it was caught up.
6. **No Web Locks is a fallback, not a downgrade.** Without `navigator.locks` every tab compacts,
   and each tab deletes only rows it appended itself (`tabId` on the row). Per-tab logs plus the
   version-vector check are both needed: the vector says a row is *in* the snapshot, the tab id says
   this tab is the one entitled to remove it. Durability is never switched off; the log simply grows
   a little more than it would with an elected writer.
7. **`TAB_ID` stays an identity, not a lock.** `tabId.ts` still keys presence and labels diagnostic
   rows. A tab id is not mutual exclusion: it cannot be revoked when a tab dies, and two tabs can
   collide.

## The invariant

> **No tab deletes an update it cannot prove a stored snapshot contains.**

Every deletion path — the leader's compaction, a follower's prune after a broadcast, and the
no-locks fallback — goes through one function that enforces it. A row without a version, or a
snapshot without one, proves nothing and keeps the row. Legacy rows are stamped with the version the
document reached when they were imported, which is an upper bound: it can only make a later delete
more conservative, never less.

## Rejected alternatives

- **Enumerate the index and delete everything (the previous behaviour).** Correct with one tab,
  destructive with two. This is the bug.
- **Delete only rows whose version is covered, with no leader.** Necessary but not sufficient. With
  two writers, tab A can write snapshot A, tab B can overwrite it with snapshot B, and rows that
  only A's snapshot covered are then uncovered and gone. The leader, or the "never replace with
  less" guard, is what makes the vector check meaningful.
- **Delete only this tab's rows, with no version check.** Keeps the invariant by accident for other
  tabs, but a tab can still delete its own row that no snapshot contains — the fast path, and the
  data loss, is exactly this.
- **A per-compaction lock (`ifAvailable` at compaction time only).** Two tabs still interleave: one
  writes a snapshot, releases, the other writes and deletes against its own smaller document. The
  lock has to cover who *writes*, not just who is writing at this instant.
- **A SharedWorker or a service worker as the single writer.** More moving parts than the invariant
  needs, and the Alpha does not ship a service worker at all (see ADR-0025).
- **Incremental persistence / a CRDT-aware store.** Explicitly out of scope for Alpha; the
  append-only log plus compaction is enough once deletion is safe.

## Consequences

- **Two tabs converge faster than the relay.** An offline tab's edits reach a sibling tab over the
  channel, so a leader's next snapshot already covers both tabs' work.
- **A follower compacts only after it wins the lock.** A workspace whose leader sits idle compacts
  less often than the update count suggests; the log absorbs it and the load path replays it. When
  the leader closes, the next surviving tab to compact inherits the role, so takeover is bounded by
  the retry throttle plus one compaction interval rather than by a reload.
- **The fallback keeps more rows than the leader path.** That is the cost of not having a lock; the
  bytes are recovered by the next compaction that can prove coverage.
- **A future storage backend inherits the invariant.** Any implementation that deletes log entries
  must take a version vector with each snapshot and refuse to delete what it cannot cover.
- **Tested by construction.** `apps/canvas/src/collab/loroPersistence.test.ts` runs two instances
  over one `fake-indexeddb`: a leader compacts while a follower holds unmerged text, the follower
  reloads, and its text survives. Further cases cover the follower no-op, deletion of covered rows,
  a row with no version surviving, the no-locks fallback, a tab that refuses to replace a
  snapshot it has not caught up with, and the takeover case: the leader is destroyed, a surviving
  follower compacts on its next attempt, and rows it cannot cover survive. Removing the version-vector check fails these tests.
