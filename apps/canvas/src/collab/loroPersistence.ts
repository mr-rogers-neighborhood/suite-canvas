import type { LoroDoc } from "loro-crdt";

const DB_NAME = "suite-loro";
const DB_VERSION = 1;
const SNAPSHOTS = "snapshots";
const UPDATES = "updates";
const COMPACT_AFTER_UPDATES = 64;
const COMPACT_INTERVAL_MS = 2_000;

interface SnapshotRecord {
  id: string;
  bytes: Uint8Array;
  updatedAt: number;
}

interface UpdateRecord {
  id?: number;
  workspaceId: string;
  bytes: Uint8Array;
  createdAt: number;
}

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

/**
 * Offline persistence for one Loro document. The snapshot is the fast load path;
 * updates are appended immediately so a crash between compactions loses nothing.
 */
export class LoroIndexeddbPersistence {
  private db: IDBDatabase | null = null;
  private readonly pending: Uint8Array[] = [];
  private compactTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;

  constructor(
    private readonly workspaceId: string,
    private readonly doc: LoroDoc,
  ) {}

  async open(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
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

  /** Loads the snapshot and every update appended since it was written. */
  async load(): Promise<void> {
    if (!this.db) await this.open();
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

    if (updates.length > 0) await this.compact();
    this.subscribe();
  }

  private subscribe(): void {
    this.unsubscribe = this.doc.subscribeLocalUpdates((update) => {
      if (this.destroyed) return;
      this.pending.push(update);
      void this.append(update);
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

  private async append(update: Uint8Array): Promise<void> {
    const db = this.db;
    if (!db || this.destroyed) return;
    const transaction = db.transaction(UPDATES, "readwrite");
    transaction.objectStore(UPDATES).add({
      workspaceId: this.workspaceId,
      bytes: update,
      createdAt: Date.now(),
    } satisfies UpdateRecord);
    await transactionDone(transaction);
  }

  async compact(): Promise<void> {
    const db = this.db;
    if (!db || this.destroyed) return;
    if (this.compactTimer !== null) {
      clearTimeout(this.compactTimer);
      this.compactTimer = null;
    }
    this.pending.length = 0;

    const snapshot: SnapshotRecord = {
      id: this.workspaceId,
      bytes: this.doc.export({ mode: "snapshot" }),
      updatedAt: Date.now(),
    };
    const transaction = db.transaction([SNAPSHOTS, UPDATES], "readwrite");
    transaction.objectStore(SNAPSHOTS).put(snapshot);
    const index = transaction.objectStore(UPDATES).index("workspaceId");
    const keys = await request<IDBValidKey[]>(index.getAllKeys(IDBKeyRange.only(this.workspaceId)));
    for (const key of keys) transaction.objectStore(UPDATES).delete(key);
    await transactionDone(transaction);
  }

  async flush(): Promise<void> {
    await this.compact();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.compactTimer !== null) clearTimeout(this.compactTimer);
    this.unsubscribe?.();
  }
}
