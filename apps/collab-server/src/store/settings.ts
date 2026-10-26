import { DatabaseSync } from "node:sqlite";
import type { KeyValueStore } from "../config/limits.js";

/** Where the settings file lives; unset keeps the store in memory. */
export const SETTINGS_DB_ENV = "SUITE_SETTINGS_DB";

export interface SettingRow {
  key: string;
  value: string;
  updatedAt: number;
}

/**
 * Tiny SQLite key/value store. It exists so runtime overrides survive a restart
 * when `SUITE_SETTINGS_DB` names a file, and so tests get an isolated in-memory
 * pair without touching the disk. Values are opaque text; the limits code owns
 * the encoding of its own key.
 */
export interface SettingsStore extends KeyValueStore {
  get: (key: string) => string | null;
  /** Writes one value; null deletes the row. */
  set: (key: string, value: string | null) => void;
  /** Every row, for an operator dump. */
  all: () => SettingRow[];
  /** When the key was last written, or null when it is absent. */
  updatedAt: (key: string) => number | null;
  close: () => void;
}

/** The configured path, or `:memory:` when no file was named. */
export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[SETTINGS_DB_ENV]?.trim();
  return configured && configured.length > 0 ? configured : ":memory:";
}

/**
 * Adds the columns of stores created before they existed, the same
 * `PRAGMA table_info` pass the share and licence stores use. The table itself
 * is created first, so a fresh file migrates into the current shape.
 */
function migrateSettingsColumns(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(settings)").all() as { name?: string }[];
  if (!columns.some((column) => column.name === "updated_at")) {
    db.exec("ALTER TABLE settings ADD COLUMN updated_at INTEGER");
  }
}

export function createSettingsStore(path: string = settingsPath()): SettingsStore {
  const db = new DatabaseSync(path);
  db.exec(
    `CREATE TABLE IF NOT EXISTS settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );`,
  );
  migrateSettingsColumns(db);

  const select = db.prepare("SELECT key, value, updated_at FROM settings WHERE key = ?");
  const selectAll = db.prepare("SELECT key, value, updated_at FROM settings ORDER BY key ASC");
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const remove = db.prepare("DELETE FROM settings WHERE key = ?");

  return {
    get: (key) => {
      const row = select.get(key) as { value?: string } | undefined;
      return row?.value ?? null;
    },
    set: (key, value) => {
      if (typeof key !== "string" || key.trim().length === 0) {
        throw new Error("A settings key is required.");
      }
      if (value === null) {
        remove.run(key);
        return;
      }
      upsert.run(key, value, Date.now());
    },
    all: () =>
      (selectAll.all() as { key?: string; value?: string; updated_at?: number }[]).map((row) => ({
        key: String(row.key ?? ""),
        value: String(row.value ?? ""),
        updatedAt: Number(row.updated_at ?? 0),
      })),
    updatedAt: (key) => {
      const row = select.get(key) as { updated_at?: number | null } | undefined;
      return row?.updated_at ?? null;
    },
    close: () => db.close(),
  };
}
