import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable } from "./postgres.js";

/**
 * The migration runner for the control-plane schema.
 *
 * `sql/0001` through `sql/0005` were applied by hand, and a hand-applied schema is
 * the kind of thing that is correct on the machine where it was typed and wrong
 * everywhere else. This module makes the same files ordered, checksummed and
 * idempotent: a deployment starts, the SQL in `sql/` is applied exactly once, and a
 * file that changes after it was applied refuses the boot instead of drifting.
 *
 * Two properties are worth stating because they are the whole design:
 *
 *  - **Forward only.** There is no `down`. A control-plane migration that can be
 *    reversed is a migration whose reversal nobody ran; roll forward with a new file.
 *  - **Transactional per file.** Each file runs inside `BEGIN`/`COMMIT` on one
 *    connection, and its `schema_migrations` row is written in the same transaction.
 *    A failure half-way leaves neither the schema change nor the record.
 *
 * The runner is pure SQL emission plus one connection; it takes a `Queryable` (the
 * same seam the repositories use), so the tests drive it with a recording fake and
 * `pnpm test` never needs a database.
 */

/** `services/auth/sql`, resolved from this file so it works wherever the package is run from. */
export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../../sql/", import.meta.url));

/** One row per applied file: what ran, what it hashed to, and when. */
const CREATE_TABLE_SQL = [
  "CREATE TABLE IF NOT EXISTS schema_migrations (",
  "  filename text PRIMARY KEY,",
  "  checksum text NOT NULL,",
  "  applied_at timestamptz NOT NULL DEFAULT now()",
  ")",
].join("\n");

const SELECT_APPLIED_SQL = "SELECT filename, checksum FROM schema_migrations ORDER BY filename";
const INSERT_APPLIED_SQL = "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)";

/** Postgres' "relation does not exist": the table is created by the first `migrate`. */
const MISSING_TABLE = "42P01";

export interface MigrationFile {
  /** The file name as recorded in `schema_migrations`, e.g. `0001_control_plane.sql`. */
  name: string;
  sql: string;
  /** SHA-256 of the file's bytes, hex. */
  checksum: string;
}

export interface AppliedMigration {
  filename: string;
  checksum: string;
}

export interface MigrationStatus {
  /** Applied and unchanged, in file order. */
  applied: string[];
  /** On disk, not yet recorded, in file order. */
  pending: string[];
  /** Recorded, but the file's bytes no longer hash to what was applied. */
  drifted: string[];
}

/** A single connection. `release` returns it to the pool; a bare client has none. */
export interface MigrationConnection extends Queryable {
  release?: () => void;
}

/** A pool, or anything that can answer a query. `connect` is preferred when present. */
export interface MigrationTarget extends Queryable {
  connect?: () => Promise<MigrationConnection>;
}

export interface MigrateOptions {
  /** Overrides `MIGRATIONS_DIRECTORY`; tests point this at a fixture directory. */
  directory?: string;
  /** One line per applied migration. Defaults to `console.log`. */
  log?: (line: string) => void;
}

export interface MigrateReport {
  /** Filenames this run applied, in order. */
  applied: string[];
  /** Filenames already recorded, skipped. */
  skipped: string[];
}

/** A file changed after it was applied. Loud, because the database no longer matches the repo. */
export class MigrationChecksumError extends Error {
  readonly filename: string;

  constructor(filename: string) {
    super(
      `migration ${filename} was modified after it was applied: the checksum in schema_migrations does not match the file. Add a new migration instead of editing an applied one`,
    );
    this.name = "MigrationChecksumError";
    this.filename = filename;
  }
}

/** SHA-256 of the file's text, hex. Any edit — even whitespace — changes it. */
export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/** Every `.sql` file in `directory`, in lexical order, which is the order they apply. */
export function migrationFiles(directory: string = MIGRATIONS_DIRECTORY): MigrationFile[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(directory, name), "utf8");
      return { name, sql, checksum: checksumOf(sql) };
    });
}

/**
 * What would happen, given the files on disk and the rows already recorded. Pure:
 * no I/O, which is what lets the interesting cases be tested without Postgres.
 */
export function planMigrations(
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationStatus {
  const recorded = new Map(applied.map((row) => [row.filename, row.checksum]));
  const status: MigrationStatus = { applied: [], pending: [], drifted: [] };
  for (const file of files) {
    const checksum = recorded.get(file.name);
    if (checksum === undefined) {
      status.pending.push(file.name);
    } else if (checksum === file.checksum) {
      status.applied.push(file.name);
    } else {
      status.drifted.push(file.name);
    }
  }
  return status;
}

const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

/**
 * Boot-time migration is on unless an operator says otherwise:
 * `SUITE_AUTH_MIGRATE=0` (or `false`/`no`/`off`) skips it.
 *
 * This reads `process.env` directly rather than going through `http/env.ts`
 * because `migrate` is called before the HTTP environment exists — a deployment
 * that fails here never gets as far as building a handler.
 */
export function migrationsEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  const raw = source.SUITE_AUTH_MIGRATE?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return !DISABLED_VALUES.has(raw);
}

function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === MISSING_TABLE
  );
}

function appliedRow(row: unknown): AppliedMigration | null {
  if (typeof row !== "object" || row === null) return null;
  const { filename, checksum } = row as { filename?: unknown; checksum?: unknown };
  if (typeof filename !== "string" || typeof checksum !== "string") return null;
  return { filename, checksum };
}

async function readApplied(target: MigrationTarget): Promise<AppliedMigration[]> {
  try {
    const { rows } = await target.query(SELECT_APPLIED_SQL);
    return rows.flatMap((row) => {
      const parsed = appliedRow(row);
      return parsed === null ? [] : [parsed];
    });
  } catch (error) {
    // Before the first migration there is no table, which is a status of "nothing
    // applied" rather than a failure.
    if (isMissingTable(error)) return [];
    throw error;
  }
}

/**
 * Runs `work` inside a transaction: on one pooled connection when the target can
 * hand one out, otherwise on the target itself (a single connection or an adapter).
 */
async function inTransaction<T>(
  target: MigrationTarget,
  work: (client: Queryable) => Promise<T>,
): Promise<T> {
  const client = target.connect === undefined ? target : await target.connect();
  const owned = client !== target;
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original failure is the one worth reporting; a rollback that also
      // fails leaves the connection to be discarded by the pool.
    }
    throw error;
  } finally {
    if (owned) (client as MigrationConnection).release?.();
  }
}

async function applyFile(target: MigrationTarget, file: MigrationFile): Promise<void> {
  await inTransaction(target, async (client) => {
    await client.query(file.sql);
    await client.query(INSERT_APPLIED_SQL, [file.name, file.checksum]);
  });
}

/**
 * Applies every unapplied file, in order, each in its own transaction.
 *
 * Idempotent: a second call finds every file recorded and applies nothing. A file
 * that changed after it was applied throws `MigrationChecksumError` before anything
 * is applied, so one drifted file cannot half-migrate a database.
 */
export async function migrate(
  target: MigrationTarget,
  options: MigrateOptions = {},
): Promise<MigrateReport> {
  const log = options.log ?? ((line: string) => console.log(line));
  const files = migrationFiles(options.directory);

  await target.query(CREATE_TABLE_SQL);
  const status = planMigrations(files, await readApplied(target));

  const drifted = status.drifted[0];
  if (drifted !== undefined) {
    throw new MigrationChecksumError(drifted);
  }

  const byName = new Map(files.map((file) => [file.name, file]));
  for (const name of status.pending) {
    const file = byName.get(name);
    if (file === undefined) continue;
    await applyFile(target, file);
    log(`auth migration applied: ${file.name}`);
  }

  if (status.pending.length === 0) log("auth migrations: schema is up to date");
  return { applied: status.pending, skipped: status.applied };
}

/** What is applied, what is pending and what no longer matches. Does not write. */
export async function status(
  target: MigrationTarget,
  directory: string = MIGRATIONS_DIRECTORY,
): Promise<MigrationStatus> {
  return planMigrations(migrationFiles(directory), await readApplied(target));
}

/**
 * The boot call: honours `SUITE_AUTH_MIGRATE` and otherwise runs `migrate`.
 * Returns `null` when migration is switched off, so a caller can say so.
 */
export async function migrateAtBoot(
  target: MigrationTarget,
  options: MigrateOptions & { source?: Record<string, string | undefined> } = {},
): Promise<MigrateReport | null> {
  const log = options.log ?? ((line: string) => console.log(line));
  if (!migrationsEnabled(options.source)) {
    log("auth migrations: skipped (SUITE_AUTH_MIGRATE is off)");
    return null;
  }
  return migrate(target, options);
}
