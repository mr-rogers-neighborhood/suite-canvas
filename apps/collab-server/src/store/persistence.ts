import { DatabaseSync } from "node:sqlite";
import { LoroDoc } from "loro-crdt";
import { createLogger } from "../logging.js";
import {
  createDocumentWriteQueue,
  type DocumentWriteQueue,
  type DocumentWriteStats,
} from "./persistenceWriter.js";

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
 *
 * Schema 1: initial `documents` table.
 * Schema 2: adds `document_updates` WAL table and index for append-only delta updates.
 */
export const DOCUMENT_STORE_SCHEMA = 2;

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
  /**
   * Latest stored state for a document, or null when it was never saved.
   *
   * Reads are synchronous and always see the writes this process accepted: a
   * save that has not reached the disk yet is answered from the pending
   * overlay, so `save` then `load` never returns the previous bytes.
   *
   * If pending delta updates exist in `document_updates`, they are merged with
   * the latest checkpoint snapshot via `doc.importBatch()`.
   */
  load: (name: string) => Uint8Array | null;
  /**
   * Accepts a write. The row is made durable by the writer thread, in the order
   * the server accepted the writes; it is deliberately not synchronous, so the
   * event loop does not wait for a full-snapshot upsert.
   *
   * Saving a snapshot also truncates any pending delta updates for this document.
   */
  save: (name: string, state: Uint8Array) => void;
  /**
   * Appends an incremental delta update to the SQLite WAL table `document_updates`.
   */
  appendUpdate: (name: string, update: Uint8Array) => void;
  /** Removes a document and any pending updates. Ordered with the saves. */
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
  /**
   * Stored bytes of one document, without reading the blob — the number a room
   * ceiling compares against. `null` when the key was never saved.
   */
  measure: (name: string) => number | null;
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
  /** Queue depth, mode and bytes of the write path, for the metrics endpoint. */
  writeStats: () => DocumentWriteStats;
  /**
   * Blocks until every accepted write is on disk. The server does not call this
   * on the request path — `close` does — but a test or an operator tool may.
   */
  flush: () => void;
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
 * The connection contract every store in the relay shares.
 *
 * - `busy_timeout` is a property of a *connection*, so each module that opens
 *   one sets it: a second connection (an admin command, a backup script) then
 *   waits for the writer instead of failing with `SQLITE_BUSY`.
 * - `journal_mode = WAL` is a property of the *file*, so the first opener holds
 *   it for every later connection; setting it here means no store depends on a
 *   boot-time pass in `server.ts` having run first.
 * - `user_version` is the store's own schema claim. A file stamped by a newer
 *   build is refused, and an older or unstamped one is stamped with the version
 *   this build just opened, exactly as the document store always did.
 *
 * Throws `UnsupportedStoreVersionError` (after closing the connection, since the
 * caller cannot use it) when the file is too new.
 */
export function configureConnection(db: DatabaseSync, schemaVersion: number): string {
  db.exec("PRAGMA busy_timeout = 5000");
  const journal = db.prepare("PRAGMA journal_mode = WAL").get() as PragmaRow | undefined;
  const found = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)
      ?.user_version ?? 0,
  );
  if (found > schemaVersion) {
    db.close();
    throw new UnsupportedStoreVersionError(found, schemaVersion);
  }
  if (found < schemaVersion) db.exec(`PRAGMA user_version = ${schemaVersion}`);
  return String(journal?.journal_mode ?? "unknown");
}

/**
 * SQLite-backed document store. The server no longer depends on a client being
 * connected to keep a workspace alive: state is flushed to disk as it changes and
 * replayed when a document is next loaded.
 *
 * Two connections exist, and only one of them writes. The connection below is
 * the *read* side (`load`, `list`, `size`, `PRAGMA optimize`); the writes go to
 * `persistenceWriter.ts`, which owns them on a worker thread so a full-snapshot
 * upsert never blocks the event loop. `configureConnection` still runs on this
 * connection first, which is what refuses a store written by a newer build — a
 * refusal has to happen before a writer thread is started.
 */
export interface DocumentStoreOptions {
  /** Called after a batch of writes is durable, with the number of rows it held. */
  onWritten?: (rows: number) => void;
}

export function createDocumentStore(
  path: string,
  options: DocumentStoreOptions = {},
): DocumentStore & DocumentInventory & DocumentMaintenance {
  const db = new DatabaseSync(path);
  // WAL, the busy timeout and the schema stamp in one place; see
  // `configureConnection`. A store from a newer build is refused there.
  const journal = configureConnection(db, DOCUMENT_STORE_SCHEMA);
  const schema = `CREATE TABLE IF NOT EXISTS documents (
       name TEXT PRIMARY KEY,
       state BLOB NOT NULL,
       updated_at INTEGER NOT NULL
     );
     CREATE TABLE IF NOT EXISTS document_updates (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL,
       update_data BLOB NOT NULL,
       created_at INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS idx_document_updates_name ON document_updates (name);
  `;
  db.exec(schema);
  // Collected statistics are refreshed on open and hourly; see `maintenance`.
  db.exec("PRAGMA optimize");

  const select = db.prepare("SELECT state FROM documents WHERE name = ?");
  const selectUpdates = db.prepare(
    "SELECT update_data FROM document_updates WHERE name = ? ORDER BY id ASC",
  );
  const exists = db.prepare(
    "SELECT 1 AS found FROM documents WHERE name = ? UNION SELECT 1 AS found FROM document_updates WHERE name = ? LIMIT 1",
  );
  const upsertSql = `INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`;
  const removeSql = "DELETE FROM documents WHERE name = ?";
  const appendUpdateSql =
    "INSERT INTO document_updates (name, update_data, created_at) VALUES (?, ?, ?)";
  const truncateUpdatesSql = "DELETE FROM document_updates WHERE name = ?";

  const upsert = db.prepare(upsertSql);
  const remove = db.prepare(removeSql);
  const appendUpdateStmt = db.prepare(appendUpdateSql);
  const truncateUpdatesStmt = db.prepare(truncateUpdatesSql);
  // `bytes` is the document, not the container: the format tag is subtracted so
  // a per-workspace budget does not move when the tag is introduced. `hex()`
  // keeps the comparison a text-to-text one; a BLOB never equals a TEXT pattern.
  const tagHex = Buffer.from(TAG_PREFIX).toString("hex").toUpperCase();
  const listAll = db.prepare(
    `SELECT name, bytes, updated_at FROM (
       SELECT d.name AS name,
              (length(d.state) - CASE WHEN substr(hex(d.state), 1, ?) = ? THEN ? ELSE 0 END) +
              coalesce((SELECT sum(length(u.update_data)) FROM document_updates u WHERE u.name = d.name), 0) AS bytes,
              max(d.updated_at, coalesce((SELECT max(u.created_at) FROM document_updates u WHERE u.name = d.name), 0)) AS updated_at
         FROM documents d
       UNION
       SELECT u.name AS name,
              sum(length(u.update_data)) AS bytes,
              max(u.created_at) AS updated_at
         FROM document_updates u
        WHERE u.name NOT IN (SELECT name FROM documents)
        GROUP BY u.name
     )`,
  );
  const countAll = db.prepare(
    `SELECT count(DISTINCT name) AS count FROM (
       SELECT name FROM documents
       UNION
       SELECT name FROM document_updates
     )`,
  );
  // `length(state)` is answered from the row header, so the size of a document
  // can be checked without materializing it — which is the point of a ceiling.
  const measureOne = db.prepare(
    `SELECT (SELECT length(state) - CASE WHEN substr(hex(state), 1, ?) = ? THEN ? ELSE 0 END FROM documents WHERE name = ?) AS base_bytes,
            (SELECT coalesce(sum(length(update_data)), 0) FROM document_updates WHERE name = ?) AS update_bytes`,
  );
  const pageCount = db.prepare("PRAGMA page_count");
  const pageSize = db.prepare("PRAGMA page_size");

  const journalMode = (): string => journal;
  const size = (): number => {
    const pages = pageCount.get() as PragmaRow | undefined;
    const bytesPerPage = pageSize.get() as PragmaRow | undefined;
    return Number(pages?.page_count ?? 0) * Number(bytesPerPage?.page_size ?? 0);
  };
  const optimize = (): void => {
    db.exec("PRAGMA optimize");
  };

  let maintenance: NodeJS.Timeout | null = null;

  // The write half. `path === ":memory:"` stays inline: an in-memory database is
  // private to the connection that opened it, so a second thread would be a
  // different database, not a shared one.
  const writer: DocumentWriteQueue = createDocumentWriteQueue({
    path,
    statements: {
      save: upsertSql,
      remove: removeSql,
      appendUpdate: appendUpdateSql,
      truncateUpdates: truncateUpdatesSql,
    },
    setup: ["PRAGMA busy_timeout = 5000", "PRAGMA journal_mode = WAL", schema],
    inline: {
      save: (name, state, updatedAt) => {
        upsert.run(name, state, updatedAt);
        truncateUpdatesStmt.run(name);
      },
      remove: (name) => {
        remove.run(name);
        truncateUpdatesStmt.run(name);
      },
      appendUpdate: (name, updateData, createdAt) => {
        appendUpdateStmt.run(name, updateData, createdAt);
      },
    },
    warn: (text, fields) => logger.warn(text, { path, ...fields }),
    ...(options.onWritten === undefined ? {} : { onWritten: options.onWritten }),
  });

  const storedDocuments = (): StoredDocument[] => {
    const rows = (
      listAll.all(
        String(tagHex.length),
        tagHex,
        String(TAG_PREFIX.byteLength),
      ) as unknown as DocumentRow[]
    ).map((row) => ({
      name: row.name,
      bytes: Number(row.bytes),
      updatedAt: Number(row.updated_at),
    }));
    // Accepted writes are part of the inventory: a quota computed a moment after
    // a save must count it, or a share would be minted against a stale size.
    const pending = writer.pendingAll();
    if (pending.size === 0) return rows;
    const merged = new Map(rows.map((row) => [row.name, row]));
    for (const [name, write] of pending) {
      if (write.state === null) {
        merged.delete(name);
        continue;
      }
      if (write.state !== undefined) {
        merged.set(name, {
          name,
          bytes: write.state.byteLength - TAG_PREFIX.byteLength,
          updatedAt: write.updatedAt,
        });
      }
    }
    return [...merged.values()];
  };

  /** Stored documents, adjusted for the writes the writer has not placed yet. */
  const documentCount = (): number => {
    let count = Number((countAll.get() as { count?: number } | undefined)?.count ?? 0);
    for (const [name, write] of writer.pendingAll()) {
      const present = exists.get(name, name) !== undefined;
      if (write.state === null) {
        if (present) count -= 1;
      } else if (!present && write.state !== undefined) {
        count += 1;
      }
    }
    return Math.max(0, count);
  };

  return {
    load: (name) => {
      if (writer.hasPendingUpdates(name)) {
        writer.flush();
      }
      const accepted = writer.pending(name);
      if (accepted !== undefined && accepted.state !== undefined) {
        return accepted.state === null ? null : decodeSnapshot(accepted.state);
      }
      const baseRow = select.get(name) as { state?: Uint8Array } | undefined;
      const updateRows = selectUpdates.all(name) as unknown as { update_data: Uint8Array }[];

      if (updateRows.length === 0) {
        return baseRow?.state ? decodeSnapshot(new Uint8Array(baseRow.state)) : null;
      }

      // Replay WAL delta updates on top of the base snapshot checkpoint
      const doc = new LoroDoc();
      try {
        if (baseRow?.state) {
          const baseBytes = decodeSnapshot(new Uint8Array(baseRow.state));
          if (baseBytes.byteLength > 0) {
            doc.import(baseBytes);
          }
        }
        const payloads = updateRows.map((r) => new Uint8Array(r.update_data));
        try {
          doc.importBatch(payloads);
        } catch {
          for (const payload of payloads) {
            doc.import(payload);
          }
        }
        return doc.export({ mode: "snapshot" });
      } finally {
        if (typeof (doc as unknown as { free?: () => void }).free === "function") {
          (doc as unknown as { free: () => void }).free();
        }
      }
    },
    save: (name, state) => {
      writer.append({ kind: "save", name, state: encodeSnapshot(state), updatedAt: Date.now() });
    },
    appendUpdate: (name, update) => {
      writer.append({
        kind: "update",
        name,
        updateData: update,
        updatedAt: Date.now(),
      });
    },
    delete: (name) => {
      writer.append({ kind: "delete", name, state: null, updatedAt: Date.now() });
    },
    list: storedDocuments,
    measure: (name) => {
      const accepted = writer.pending(name);
      if (accepted !== undefined && accepted.state !== undefined) {
        return accepted.state === null ? null : accepted.state.byteLength - TAG_PREFIX.byteLength;
      }
      const row = measureOne.get(
        String(tagHex.length),
        tagHex,
        String(TAG_PREFIX.byteLength),
        name,
        name,
      ) as { base_bytes?: number | null; update_bytes?: number } | undefined;
      if (
        row?.base_bytes == null &&
        (row?.update_bytes == null || Number(row.update_bytes) === 0)
      ) {
        return null;
      }
      return Number(row.base_bytes ?? 0) + Number(row.update_bytes ?? 0);
    },
    size,
    inventory: () => ({
      path,
      bytes: size(),
      documents: documentCount(),
      journalMode: journalMode(),
    }),
    journalMode,
    optimize,
    writeStats: () => writer.stats(),
    flush: () => {
      writer.flush();
    },
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
      // Writes first: closing the read connection under an outstanding write
      // would leave the last snapshot in memory. `close` blocks until the
      // writer has either committed or reported that it could not.
      writer.close();
      db.close();
    },
  };
}
