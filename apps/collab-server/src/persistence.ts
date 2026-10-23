import { DatabaseSync } from "node:sqlite";
import { createLogger } from "./logging.js";

/**
 * How often the store refreshes SQLite's query planner. An hour matches
 * SQLite's own guidance for `PRAGMA optimize`, which is cheap on this schema.
 */
export const OPTIMIZE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Format tag every stored snapshot blob starts with, followed by a newline and
 * the Loro bytes. Documents written before the tag existed have no prefix and
 * are read as v1 — that is a format decision, not a migration: the bytes are
 * passed through unchanged and nothing is rewritten on read.
 *
 * Changing the tag is an explicit, reviewable commit plus a fixture in
 * `src/fixtures/n-1/`. `decodeSnapshot` refuses a tag it does not know instead
 * of guessing: a newer server may store shapes this build would silently drop.
 */
export const SNAPSHOT_FORMAT_TAG = "loro-snapshot-v1";

/** Prefix shared by every tag, so an unknown version is recognised as one. */
const SNAPSHOT_TAG_MAGIC = "loro-snapshot-";

/** A tag line is short; anything longer is a legacy blob that happens to start with it. */
const MAX_TAG_LENGTH = 64;

const TAG_PREFIX = new TextEncoder().encode(`${SNAPSHOT_FORMAT_TAG}\n`);
const MAGIC_PREFIX = new TextEncoder().encode(SNAPSHOT_TAG_MAGIC);

/**
 * The schema version this build writes into `PRAGMA user_version`. A store from
 * a *newer* build refuses to open; an older or unstamped store opens as-is.
 * Bumping this number is an explicit change that ships with a migration and an
 * N−1 fixture — never an implicit side effect of `CREATE TABLE IF NOT EXISTS`.
 */
export const DOCUMENT_STORE_SCHEMA = 1;

/** A blob or database written by a newer build than this one. */
export class UnsupportedStoreVersionError extends Error {
  readonly reason = "unsupported-store-version";

  constructor(
    readonly found: number | string,
    readonly supported: number | string,
  ) {
    super(
      `This store was written by a newer Suite build (${String(found)}; this build reads ${String(supported)}). Refusing to open it: a newer format may carry data this build would drop. Upgrade the server, or restore from a backup taken on this build.`,
    );
    this.name = "UnsupportedStoreVersionError";
  }
}

/** Reads the tag off a stored blob, or null when it is a legacy untagged blob. */
function snapshotTag(stored: Uint8Array): string | null {
  const limit = Math.min(stored.byteLength, MAX_TAG_LENGTH);
  for (let index = 0; index < limit; index += 1) {
    if (stored[index] === 0x0a) {
      const head = stored.subarray(0, index);
      for (let offset = 0; offset < MAGIC_PREFIX.byteLength; offset += 1) {
        if (head[offset] !== MAGIC_PREFIX[offset]) return null;
      }
      return new TextDecoder().decode(head);
    }
  }
  return null;
}

/** Prefixes a Loro snapshot with the format tag. */
export function encodeSnapshot(bytes: Uint8Array): Uint8Array {
  const tagged = new Uint8Array(TAG_PREFIX.byteLength + bytes.byteLength);
  tagged.set(TAG_PREFIX, 0);
  tagged.set(bytes, TAG_PREFIX.byteLength);
  return tagged;
}

/**
 * Strips the format tag, or returns an untagged legacy blob unchanged. Throws
 * `UnsupportedStoreVersionError` for a tag this build does not know.
 */
export function decodeSnapshot(stored: Uint8Array): Uint8Array {
  const tag = snapshotTag(stored);
  if (tag === null) return new Uint8Array(stored);
  if (tag !== SNAPSHOT_FORMAT_TAG) throw new UnsupportedStoreVersionError(tag, SNAPSHOT_FORMAT_TAG);
  return stored.slice(TAG_PREFIX.byteLength);
}

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
    db.exec("PRAGMA busy_timeout = 5000");
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
  // A second connection (an admin command, a backup script) waits for the
  // writer instead of failing with SQLITE_BUSY.
  db.exec("PRAGMA busy_timeout = 5000");
  // One writer at a time with readers: WAL lets the HTTP side read while a room
  // save is in flight, and survives a crash without losing committed saves.
  const journal = db.prepare("PRAGMA journal_mode = WAL").get() as PragmaRow | undefined;
  const storeVersion = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)
      ?.user_version ?? 0,
  );
  if (storeVersion > DOCUMENT_STORE_SCHEMA) {
    db.close();
    throw new UnsupportedStoreVersionError(storeVersion, DOCUMENT_STORE_SCHEMA);
  }
  db.exec(
    `CREATE TABLE IF NOT EXISTS documents (
       name TEXT PRIMARY KEY,
       state BLOB NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
  );
  // Stamping the version records what this build just opened. It rewrites no
  // row and backfills no column: an older database is read exactly as it is.
  if (storeVersion < DOCUMENT_STORE_SCHEMA) {
    db.exec(`PRAGMA user_version = ${DOCUMENT_STORE_SCHEMA}`);
  }
  // Collected statistics are refreshed on open and hourly; see `maintenance`.
  db.exec("PRAGMA optimize");

  const select = db.prepare("SELECT state FROM documents WHERE name = ?");
  const upsert = db.prepare(
    `INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  );
  const remove = db.prepare("DELETE FROM documents WHERE name = ?");
  // `bytes` is the document, not the container: the format tag is subtracted so
  // a per-workspace budget does not move when the tag is introduced. `hex()`
  // keeps the comparison a text-to-text one; a BLOB never equals a TEXT pattern.
  const tagHex = Buffer.from(TAG_PREFIX).toString("hex").toUpperCase();
  const listAll = db.prepare(
    `SELECT name,
            length(state) - CASE WHEN substr(hex(state), 1, ?) = ? THEN ? ELSE 0 END AS bytes,
            updated_at
       FROM documents`,
  );
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
      return row?.state ? decodeSnapshot(new Uint8Array(row.state)) : null;
    },
    save: (name, state) => {
      upsert.run(name, encodeSnapshot(state), Date.now());
    },
    delete: (name) => {
      remove.run(name);
    },
    list: () =>
      (
        listAll.all(
          String(tagHex.length),
          tagHex,
          String(TAG_PREFIX.byteLength),
        ) as unknown as DocumentRow[]
      ).map((row) => ({
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
