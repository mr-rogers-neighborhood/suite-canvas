import { DatabaseSync } from "node:sqlite";
import { createLogger } from "./logging.js";

/**
 * How often the store refreshes SQLite's query planner. An hour matches
 * SQLite's own guidance for `PRAGMA optimize`, which is cheap on this schema.
 */
export const OPTIMIZE_INTERVAL_MS = 60 * 60 * 1000;

const logger = createLogger().child({ component: "sqlite" });

export interface DocumentStore {
  /** Latest stored state for a document, or null when it was never saved. */
  load: (name: string) => Uint8Array | null;
  save: (name: string, state: Uint8Array) => void;
  /** Removes a document, used when a share is revoked. */
  delete: (name: string) => void;
  close: () => void;
}

/** One stored document key, for the operator inventory. */
export interface StoredDocument {
  /** Key the state is saved under, e.g. `%LOR:<roomId>`. */
  name: string;
  /** Snapshot length in bytes. */
  bytes: number;
  /** Epoch milliseconds of the last save. */
  updatedAt: number;
}

/**
 * Read-only inventory over the document store. It is separate from
 * `DocumentStore` so in-memory test doubles keep implementing the save path.
 */
export interface DocumentInventory {
  /** Every stored document key with its size and last save time. */
  list: () => StoredDocument[];
  /** Bytes the SQLite database occupies (page count × page size). */
  size: () => number;
  /** Read-only facts about the open database, for startup logs and operators. */
  inventory: () => DocumentStoreFacts;
}

export interface DocumentStoreFacts {
  path: string;
  bytes: number;
  documents: number;
  /** `wal` unless the filesystem refused it. */
  journalMode: string;
}

/**
 * Upkeep the server calls on its own. Kept out of `DocumentStore` so in-memory
 * doubles keep implementing only the save path.
 */
export interface DocumentMaintenance {
  /** Runs `PRAGMA optimize`; safe while the server is serving. */
  optimize: () => void;
  /**
   * Runs `optimize` every `intervalMs` (an hour by default). The timer is
   * unref'd, so it never keeps the process alive; `close` also stops it.
   */
  startMaintenance: (intervalMs?: number) => NodeJS.Timeout;
  /** The journal mode this connection ended up in. */
  journalMode: () => string;
}

interface DocumentRow {
  name: string;
  bytes: number;
  updated_at: number;
}

interface PragmaRow {
  page_count?: number;
  page_size?: number;
  journal_mode?: string;
}

/**
 * Opens `path` once, switches it to WAL and refreshes the query planner, then
 * closes. `journal_mode` lives in the file header, so every later connection
 * — including the ones the share and workspace stores open themselves —
 * inherits it. Returns the mode the file actually ended up in.
 */
export function configureSqlite(path: string): string {
  const db = new DatabaseSync(path);
  try {
    const row = db.prepare("PRAGMA journal_mode = WAL").get() as PragmaRow | undefined;
    db.exec("PRAGMA optimize");
    return row?.journal_mode ?? "unknown";
  } finally {
    db.close();
  }
}

/**
 * SQLite-backed document store. The server no longer depends on a client being
 * connected to keep a workspace alive: state is flushed to disk as it changes and
 * replayed when a document is next loaded.
 */
export function createDocumentStore(
  path: string,
): DocumentStore & DocumentInventory & DocumentMaintenance {
  const db = new DatabaseSync(path);
  // One writer at a time with readers: WAL lets the HTTP side read while a room
  // save is in flight, and survives a crash without losing committed saves.
  const journal = db.prepare("PRAGMA journal_mode = WAL").get() as PragmaRow | undefined;
  db.exec(
    `CREATE TABLE IF NOT EXISTS documents (
       name TEXT PRIMARY KEY,
       state BLOB NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
  );
  // Collected statistics are refreshed on open and hourly; see `maintenance`.
  db.exec("PRAGMA optimize");

  const select = db.prepare("SELECT state FROM documents WHERE name = ?");
  const upsert = db.prepare(
    `INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  );
  const remove = db.prepare("DELETE FROM documents WHERE name = ?");
  const listAll = db.prepare("SELECT name, length(state) AS bytes, updated_at FROM documents");
  const countAll = db.prepare("SELECT COUNT(*) AS count FROM documents");
  const pageCount = db.prepare("PRAGMA page_count");
  const pageSize = db.prepare("PRAGMA page_size");

  const journalMode = (): string => String(journal?.journal_mode ?? "unknown");
  const size = (): number => {
    const pages = pageCount.get() as PragmaRow | undefined;
    const bytesPerPage = pageSize.get() as PragmaRow | undefined;
    return Number(pages?.page_count ?? 0) * Number(bytesPerPage?.page_size ?? 0);
  };
  const optimize = (): void => {
    db.exec("PRAGMA optimize");
  };

  let maintenance: NodeJS.Timeout | null = null;

  return {
    load: (name) => {
      const row = select.get(name) as { state?: Uint8Array } | undefined;
      return row?.state ? new Uint8Array(row.state) : null;
    },
    save: (name, state) => {
      upsert.run(name, state, Date.now());
    },
    delete: (name) => {
      remove.run(name);
    },
    list: () =>
      (listAll.all() as unknown as DocumentRow[]).map((row) => ({
        name: row.name,
        bytes: Number(row.bytes),
        updatedAt: Number(row.updated_at),
      })),
    size,
    inventory: () => ({
      path,
      bytes: size(),
      documents: Number((countAll.get() as { count?: number } | undefined)?.count ?? 0),
      journalMode: journalMode(),
    }),
    journalMode,
    optimize,
    startMaintenance: (intervalMs = OPTIMIZE_INTERVAL_MS) => {
      maintenance ??= setInterval(() => {
        try {
          optimize();
        } catch (error) {
          // A failed optimize is not fatal; the store keeps working.
          logger.warn("PRAGMA optimize failed", {
            path,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, intervalMs);
      maintenance.unref();
      return maintenance;
    },
    close: () => {
      if (maintenance) {
        clearInterval(maintenance);
        maintenance = null;
      }
      db.close();
    },
  };
}
