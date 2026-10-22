import { DatabaseSync } from "node:sqlite";

export interface DocumentStore {
  /** Latest stored state for a document, or null when it was never saved. */
  load: (name: string) => Uint8Array | null;
  save: (name: string, state: Uint8Array) => void;
  /** Removes a document, used when a share is revoked. */
  delete: (name: string) => void;
  close: () => void;
}

/**
 * SQLite-backed document store. The server no longer depends on a client being
 * connected to keep a workspace alive: state is flushed to disk as it changes and
 * replayed when a document is next loaded.
 */
export function createDocumentStore(path: string): DocumentStore {
  const db = new DatabaseSync(path);
  db.exec(
    `CREATE TABLE IF NOT EXISTS documents (
       name TEXT PRIMARY KEY,
       state BLOB NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
  );

  const select = db.prepare("SELECT state FROM documents WHERE name = ?");
  const upsert = db.prepare(
    `INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  );
  const remove = db.prepare("DELETE FROM documents WHERE name = ?");

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
    close: () => db.close(),
  };
}
