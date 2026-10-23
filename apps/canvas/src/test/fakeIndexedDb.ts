/**
 * A tiny in-memory IndexedDB for unit tests.
 *
 * Only the surface `attachmentNode.ts` uses is implemented: `open` with an
 * upgrade callback, `createObjectStore`, one-store transactions, and
 * `put`/`get`/`delete`. Data lives in this module's map, so a second `open`
 * (the equivalent of a reload) sees the first connection's writes. The real
 * browser suites exercise the real IndexedDB.
 */
type StoredRecord = Record<string, unknown> & { id: string };

interface RequestLike {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
}

function request(work: () => unknown): RequestLike {
  const created: RequestLike = { result: undefined, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    try {
      created.result = work();
      created.onsuccess?.();
    } catch (error) {
      created.error = error;
      created.onerror?.();
    }
  });
  return created;
}

class MemoryStore {
  readonly records = new Map<string, StoredRecord>();

  constructor(readonly keyPath: string) {}
}

class MemoryTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readonly error = null;

  constructor(private readonly store: MemoryStore) {
    // Each operation runs in a microtask; completion lands after them.
    setTimeout(() => this.oncomplete?.(), 0);
  }

  objectStore(_name: string) {
    const store = this.store;
    return {
      put: (record: StoredRecord) =>
        request(() => {
          store.records.set(String(record.id), record);
        }),
      get: (id: string) => request(() => store.records.get(id)),
      delete: (id: string) =>
        request(() => {
          store.records.delete(id);
        }),
    };
  }
}

class MemoryDatabase {
  readonly stores = new Map<string, MemoryStore>();

  constructor(
    readonly name: string,
    public version: number,
  ) {}

  get objectStoreNames() {
    return { contains: (name: string) => this.stores.has(name) };
  }

  createObjectStore(name: string, options: { keyPath?: string } = {}) {
    this.stores.set(name, new MemoryStore(options.keyPath ?? "id"));
    return {};
  }

  transaction(name: string) {
    const store = this.stores.get(name);
    if (!store) throw new Error(`no store named ${name}`);
    return new MemoryTransaction(store);
  }

  close() {}
}

export interface FakeIndexedDb {
  /** Writes a record straight into a store, as an older app version would have. */
  seed(databaseName: string, storeName: string, record: StoredRecord): void;
  /** Drops every database, as a fresh browser profile would. */
  reset(): void;
  /** Puts the previous global back (usually `undefined` in jsdom). */
  restore(): void;
}

export function installFakeIndexedDb(): FakeIndexedDb {
  const databases = new Map<string, MemoryDatabase>();
  const original = Reflect.get(globalThis, "indexedDB");

  const fake = {
    open(name: string, version = 1) {
      const opened: RequestLike = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      // All callbacks are assigned synchronously by the caller, then the open
      // completes on the next task, like a real connection.
      setTimeout(() => {
        let database = databases.get(name);
        const created = database === undefined;
        if (database === undefined) {
          database = new MemoryDatabase(name, version);
          databases.set(name, database);
        }
        opened.result = database;
        if (created) opened.onupgradeneeded?.();
        opened.onsuccess?.();
      }, 0);
      return opened;
    },
  };

  Reflect.set(globalThis, "indexedDB", fake);

  return {
    seed(databaseName, storeName, record) {
      let database = databases.get(databaseName);
      if (database === undefined) {
        database = new MemoryDatabase(databaseName, 1);
        databases.set(databaseName, database);
      }
      if (!database.stores.has(storeName)) database.createObjectStore(storeName, { keyPath: "id" });
      database.stores.get(storeName)?.records.set(String(record.id), record);
    },
    reset() {
      databases.clear();
    },
    restore() {
      if (original === undefined) {
        Reflect.deleteProperty(globalThis, "indexedDB");
      } else {
        Reflect.set(globalThis, "indexedDB", original);
      }
    },
  };
}
