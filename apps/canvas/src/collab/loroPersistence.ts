import { type LoroDoc, VersionVector } from "loro-crdt";
import { TAB_ID } from "./tabId";

const DB_NAME = "suite-loro";
const DB_VERSION = 1;
const SNAPSHOTS = "snapshots";
const UPDATES = "updates";
const COMPACT_AFTER_UPDATES = 64;
const COMPACT_INTERVAL_MS = 2_000;

/**
 * One compactor per workspace, per origin. A tab that holds this lock writes
 * snapshots; a tab that does not appends its own update log and lets the leader
 * cover it. Holding the lock for the tab's lifetime is deliberate: a lock
 * acquired per compaction would let two tabs interleave a snapshot write with
 * the other's delete, which is the bug this replaces.
 */
export const COMPACT_LOCK_PREFIX = "suite-compact:";

/** Channel a workspace's tabs use to forward updates and announce snapshots. */
export const PERSIST_CHANNEL_PREFIX = "suite-persist:";

/**
 * Shortest interval between takeover attempts. A follower re-requests the lock
 * when it next compacts, so the tab that inherits a closed leader's workspace
 * starts compacting without a reload; the throttle keeps a tab that loses the
 * race from asking on every keystroke-driven compaction.
 */
export const LEADERSHIP_RETRY_MS = 5_000;

interface SnapshotRecord {
  id: string;
  bytes: Uint8Array;
  updatedAt: number;
  /**
   * Oplog version the snapshot was exported at. A snapshot without one was
   * written before A2 and proves nothing about which updates it contains, so
   * nothing may be deleted against it.
   */
  version?: Uint8Array;
}

interface UpdateRecord {
  id?: number;
  workspaceId: string;
  bytes: Uint8Array;
  createdAt: number;
  /** The tab that appended this row; the no-locks fallback deletes only its own. */
  tabId?: string;
  /** Oplog version after this update. Absent on rows written before A2. */
  version?: Uint8Array;
}

/** What a compaction attempt did, for tests and diagnostics. */
export type CompactionOutcome = "compacted" | "follower" | "skipped";

/**
 * True when every peer/counter in `part` is also in `container`, i.e. the
 * document at `container` already has everything `part` describes. This is the
 * only proof that lets an update row be deleted.
 */
export function versionCovers(container: VersionVector, part: VersionVector): boolean {
  for (const [peer, counter] of part.toJSON()) {
    if ((container.get(peer) ?? 0) < counter) return false;
  }
  return true;
}

type Leadership = "leader" | "follower" | "fallback";

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) {
        db.createObjectStore(SNAPSHOTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(UPDATES)) {
        const updates = db.createObjectStore(UPDATES, {
          keyPath: "id",
          autoIncrement: true,
        });
        updates.createIndex("workspaceId", "workspaceId");
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("could not open IndexedDB"));
  });
}

/**
 * Removes every cached byte for one workspace. Used by “Forget this browser”:
 * the relay copy is untouched, so the workspace can be reopened later.
 */
export async function deleteWorkspaceDocument(workspaceId: string): Promise<void> {
  if (typeof indexedDB === "undefined" || workspaceId.trim().length === 0) return;
  const db = await openDatabase();
  try {
    const transaction = db.transaction([SNAPSHOTS, UPDATES], "readwrite");
    transaction.objectStore(SNAPSHOTS).delete(workspaceId);
    const index = transaction.objectStore(UPDATES).index("workspaceId");
    const keys = await request<IDBValidKey[]>(index.getAllKeys(IDBKeyRange.only(workspaceId)));
    for (const key of keys) transaction.objectStore(UPDATES).delete(key);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

type ChannelMessage =
  | { type: "update"; bytes: Uint8Array }
  | { type: "snapshot"; version: Uint8Array };

/**
 * Offline persistence for one Loro document.
 *
 * The snapshot is the fast load path; updates are appended immediately so a
 * crash between compactions loses nothing. The invariant that makes two tabs
 * safe — no tab deletes an update it cannot prove a stored snapshot contains —
 * is enforced in `deleteCovered`, not by scheduling.
 */
export class LoroIndexeddbPersistence {
  private db: IDBDatabase | null = null;
  private readonly pending: Uint8Array[] = [];
  private compactTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;
  /** Last resolved role, or null before the first attempt. */
  private leadership: Leadership | null = null;
  /** The attempt in flight, so concurrent compactions share one request. */
  private leadershipAttempt: Promise<Leadership> | null = null;
  private lastLeadershipAttempt = 0;
  private releaseLeadership: (() => void) | null = null;
  private channel: BroadcastChannel | null = null;
  /** Snapshot versions announced by peers, newest last. */
  private readonly peerSnapshots: Uint8Array[] = [];

  constructor(
    private readonly workspaceId: string,
    private readonly doc: LoroDoc,
    private readonly options: { tabId?: string; leadershipRetryMs?: number } = {},
  ) {}

  /** This tab's id, for the per-tab log. `tabId.ts` stays the source. */
  private get tabId(): string {
    return this.options.tabId ?? TAB_ID;
  }

  private get leadershipRetryMs(): number {
    return this.options.leadershipRetryMs ?? LEADERSHIP_RETRY_MS;
  }

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await openDatabase();
    this.connectChannel();
    // Ask once on open so the workspace has a leader before the first edit.
    void this.ensureLeadership();
  }

  /** Loads the snapshot and every update appended since it was written. */
  async load(): Promise<void> {
    await this.open();
    const db = this.db;
    if (!db) return;

    const snapshot = await request<SnapshotRecord | undefined>(
      db.transaction(SNAPSHOTS).objectStore(SNAPSHOTS).get(this.workspaceId),
    );
    if (snapshot?.bytes) this.doc.import(snapshot.bytes);

    const updates = await request<UpdateRecord[]>(
      db
        .transaction(UPDATES)
        .objectStore(UPDATES)
        .index("workspaceId")
        .getAll(IDBKeyRange.only(this.workspaceId)),
    );
    for (const update of updates) {
      try {
        this.doc.import(update.bytes);
      } catch (error) {
        console.warn("[loro] skipping corrupt offline update", error);
      }
    }

    // Rows written before A2 carry no version. Stamp the ones just imported:
    // the document now provably contains them, and that version is an upper
    // bound, so it only ever makes a later delete more conservative.
    await this.stampLegacyRows(updates);
    if (updates.length > 0) await this.compact();
    this.subscribe();
  }

  private async stampLegacyRows(updates: readonly UpdateRecord[]): Promise<void> {
    const db = this.db;
    if (!db) return;
    const legacy = updates.filter(
      (update) => update.id !== undefined && update.version === undefined,
    );
    if (legacy.length === 0) return;
    const version = this.doc.oplogVersion().encode();
    const transaction = db.transaction(UPDATES, "readwrite");
    const store = transaction.objectStore(UPDATES);
    for (const update of legacy) {
      if (update.id === undefined) continue;
      store.put({ ...update, version, tabId: update.tabId ?? this.tabId } satisfies UpdateRecord);
    }
    await transactionDone(transaction);
  }

  private subscribe(): void {
    this.unsubscribe = this.doc.subscribeLocalUpdates((update) => {
      if (this.destroyed) return;
      this.pending.push(update);
      const version = this.doc.oplogVersion().encode();
      void this.append(update, version);
      // A peer tab applies this without waiting for the relay, so a document
      // covers more of the log than the relay has seen and a leader's snapshot
      // covers both tabs' work.
      this.post({ type: "update", bytes: update });
      if (this.pending.length >= COMPACT_AFTER_UPDATES) {
        void this.compact();
        return;
      }
      if (this.compactTimer === null) {
        this.compactTimer = setTimeout(() => {
          this.compactTimer = null;
          void this.compact();
        }, COMPACT_INTERVAL_MS);
      }
    });
  }

  private async append(update: Uint8Array, version: Uint8Array): Promise<void> {
    const db = this.db;
    if (!db || this.destroyed) return;
    const transaction = db.transaction(UPDATES, "readwrite");
    transaction.objectStore(UPDATES).add({
      workspaceId: this.workspaceId,
      bytes: update,
      createdAt: Date.now(),
      tabId: this.tabId,
      version,
    } satisfies UpdateRecord);
    await transactionDone(transaction);
  }

  /**
   * Writes this tab's snapshot and deletes only the update rows that snapshot
   * provably contains.
   *
   * A follower does not compact at all: two tabs writing snapshots is how a tab
   * with a smaller document overwrites one with more, and the rows covered by
   * the overwritten snapshot then look deletable. One writer per workspace, or
   * per-tab logs when Web Locks is unavailable.
   */
  async compact(): Promise<CompactionOutcome> {
    if (this.destroyed) return "skipped";
    await this.open();
    const db = this.db;
    if (!db) return "skipped";
    if (this.compactTimer !== null) {
      clearTimeout(this.compactTimer);
      this.compactTimer = null;
    }

    // A follower retries here, throttled: `ifAvailable` never blocks, so this
    // costs one promise when the leader is still alive and turns this tab into
    // the compactor when it is not. Without the retry, a leader tab closing
    // leaves the survivors appending forever with nothing writing snapshots.
    const leadership = await this.ensureLeadership();
    if (leadership === "follower") return "follower";

    const mine = this.doc.oplogVersion();
    const snapshot: SnapshotRecord = {
      id: this.workspaceId,
      bytes: this.doc.export({ mode: "snapshot" }),
      updatedAt: Date.now(),
      version: mine.encode(),
    };
    const transaction = db.transaction([SNAPSHOTS, UPDATES], "readwrite");
    // Never replace a snapshot with one that contains less. Without Web Locks
    // two tabs may both compact; if this tab has not seen everything the stored
    // snapshot holds, writing would strand those rows: they are covered by the
    // old snapshot and gone from the new one. Skip instead — the update log is
    // the recovery mechanism, and it is never deleted by guesswork.
    const stored = await request<SnapshotRecord | undefined>(
      transaction.objectStore(SNAPSHOTS).get(this.workspaceId),
    );
    if (stored?.version && !versionCovers(mine, VersionVector.decode(stored.version))) {
      transaction.abort();
      return "skipped";
    }
    transaction.objectStore(SNAPSHOTS).put(snapshot);
    await this.deleteCovered(transaction, leadership === "fallback");
    await transactionDone(transaction);
    this.pending.length = 0;
    this.post({ type: "snapshot", version: snapshot.version ?? new Uint8Array() });
    return "compacted";
  }

  /**
   * Deletes the update rows the *stored* snapshot contains. Reading the
   * snapshot inside the same transaction is the proof: IndexedDB serialises
   * read-write transactions over these stores, so no other tab can swap in a
   * smaller snapshot between the check and the delete.
   *
   * `ownOnly` is the fallback when Web Locks is missing: with no elected
   * writer, a tab deletes only rows it appended itself. Another tab's rows are
   * replayed on load (Loro import is idempotent), which costs space but can
   * never cost an edit.
   */
  private async deleteCovered(transaction: IDBTransaction, ownOnly: boolean): Promise<number> {
    const stored = await request<SnapshotRecord | undefined>(
      transaction.objectStore(SNAPSHOTS).get(this.workspaceId),
    );
    if (!stored?.version) return 0;
    const snapshotVersion = VersionVector.decode(stored.version);
    const rows = await request<UpdateRecord[]>(
      transaction
        .objectStore(UPDATES)
        .index("workspaceId")
        .getAll(IDBKeyRange.only(this.workspaceId)),
    );
    let removed = 0;
    for (const row of rows) {
      if (row.id === undefined) continue;
      // No version: this build cannot prove the snapshot contains the row.
      if (!row.version) continue;
      if (ownOnly && row.tabId !== this.tabId) continue;
      if (!versionCovers(snapshotVersion, VersionVector.decode(row.version))) continue;
      transaction.objectStore(UPDATES).delete(row.id);
      removed += 1;
    }
    return removed;
  }

  /** A follower's own rows, once a leader's snapshot provably contains them. */
  private async pruneOwnCovered(): Promise<void> {
    const db = this.db;
    if (!db || this.destroyed) return;
    const transaction = db.transaction([SNAPSHOTS, UPDATES], "readwrite");
    await this.deleteCovered(transaction, true);
    await transactionDone(transaction);
  }

  /**
   * The role this tab may act on, re-asking with `ifAvailable` when it is still
   * a follower and the throttle allows it.
   *
   * - A leader or the no-locks fallback is stable: never asks again.
   * - One attempt runs at a time; concurrent compactions await the same promise.
   * - A lost attempt is cached as `follower` with a timestamp, so the next
   *   compaction inside the throttle window returns immediately.
   */
  private async ensureLeadership(): Promise<Leadership> {
    if (this.destroyed) return this.leadership ?? "follower";
    if (this.leadership === "leader" || this.leadership === "fallback") return this.leadership;
    if (this.leadershipAttempt) return this.leadershipAttempt;

    const now = Date.now();
    if (
      this.leadership === "follower" &&
      now - this.lastLeadershipAttempt < this.leadershipRetryMs
    ) {
      return "follower";
    }
    this.lastLeadershipAttempt = now;

    const attempt = this.requestLeadership().then(
      (role) => {
        this.leadership = role;
        this.leadershipAttempt = null;
        return role;
      },
      () => {
        // A failed request is not a reason to stop persisting: the fallback
        // still compacts, deleting only rows this tab appended.
        this.leadership = "fallback";
        this.leadershipAttempt = null;
        return "fallback" as const;
      },
    );
    this.leadershipAttempt = attempt;
    return attempt;
  }

  private async requestLeadership(): Promise<Leadership> {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks?.request) {
      console.warn(
        "[loro] Web Locks is unavailable; every tab compacts and deletes only its own covered updates",
      );
      return "fallback";
    }
    // Only one lock is ever held: a retry happens only while this tab is a
    // follower, so `releaseLeadership` from an earlier grant cannot be
    // overwritten by a second grant.
    this.releaseLeadership = null;
    try {
      return await new Promise<Leadership>((resolve) => {
        void locks
          .request(
            `${COMPACT_LOCK_PREFIX}${this.workspaceId}`,
            { mode: "exclusive", ifAvailable: true },
            (lock) => {
              if (lock === null) {
                resolve("follower");
                return Promise.resolve();
              }
              resolve("leader");
              return new Promise<void>((release) => {
                this.releaseLeadership = release;
              });
            },
          )
          .catch(() => resolve("fallback"));
      });
    } catch {
      return "fallback";
    }
  }

  private connectChannel(): void {
    if (typeof BroadcastChannel !== "function") return;
    try {
      this.channel = new BroadcastChannel(`${PERSIST_CHANNEL_PREFIX}${this.workspaceId}`);
    } catch {
      this.channel = null;
      return;
    }
    this.channel.onmessage = (event: MessageEvent) => {
      const data = event.data as ChannelMessage | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "update") {
        try {
          this.doc.import(data.bytes);
        } catch (error) {
          console.warn("[loro] skipping a peer update", error);
        }
        return;
      }
      if (data.type === "snapshot") {
        this.peerSnapshots.push(data.version);
        if (this.peerSnapshots.length > 8) this.peerSnapshots.shift();
        void this.pruneOwnCovered();
      }
    };
  }

  private post(message: ChannelMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A channel that closed under us is not a durability problem: the row was
      // already appended, and the next compaction covers it.
    }
  }

  async flush(): Promise<void> {
    await this.compact();
  }

  destroy(): void {
    this.destroyed = true;
    // Releasing hands the workspace to a surviving tab's next compaction.
    this.leadership = null;
    if (this.compactTimer !== null) clearTimeout(this.compactTimer);
    this.compactTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    const release = this.releaseLeadership;
    this.releaseLeadership = null;
    release?.();
    this.channel?.close();
    this.channel = null;
    this.db?.close();
    this.db = null;
  }
}
