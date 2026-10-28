import type { Pool } from "pg";

/**
 * What an operator did, kept where it outlives the process.
 *
 * The control plane could already *log* an impersonation, and a log line is not a record: it
 * rotates, it is not queryable, and it says nothing to the person on the other end. This
 * table is the answer to "who opened my account, and when", asked months later by somebody
 * who was not in the room.
 *
 * Two rules decide what earns a row:
 *
 * - **A decision writes.** A refusal that got as far as an authorisation answer is the most
 *   interesting row in the table, because it names an actor and a target and says no. A 401
 *   from no session does not: it names nobody, so it is not an act.
 * - **The details are data, not prose.** `details` is `jsonb` so the panel can render one
 *   fact beside another, and so a later question ("every licence write in October") is a
 *   query rather than a grep.
 *
 * The table is created on first use, like `operator_support_grants` and `suite_settings`, so
 * an older database boots.
 */
export interface AuditEntry {
  actor: string;
  /** What was acted on: an account id, a workspace id, a settings key. */
  target: string;
  /** A stable verb, not a sentence: `impersonate`, `settings.write`, `licence.write`. */
  action: string;
  /** `ok`, `refused`, or the failure word the handler chose. */
  outcome: string;
  details?: Record<string, unknown>;
}

export interface AuditRecord extends AuditEntry {
  id: number;
  at: number;
  details: Record<string, unknown>;
}

export interface AuditQuery {
  limit?: number;
  /** Keyset paging: return rows strictly older than this watermark. */
  before?: { at: number; id: number };
  actor?: string;
  action?: string;
}

export interface AuditStore {
  record: (entry: AuditEntry, now?: number) => Promise<void>;
  recent: (query?: AuditQuery) => Promise<AuditRecord[]>;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS operator_audit (
    id BIGSERIAL PRIMARY KEY,
    at BIGINT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    outcome TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb
  )
`;

/** The read is newest-first, and the composite index is what keeps paging cheap. */
const CREATE_INDEX = `
  CREATE INDEX IF NOT EXISTS operator_audit_recent
  ON operator_audit (at DESC, id DESC)
`;

const INSERT = `
  INSERT INTO operator_audit (at, actor, action, target, outcome, details)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb)
`;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface AuditRow {
  id: string | number;
  at: string | number;
  actor: string;
  action: string;
  target: string;
  outcome: string;
  details: Record<string, unknown> | null;
}

function toRecord(row: AuditRow): AuditRecord {
  return {
    id: Number(row.id),
    at: Number(row.at),
    actor: row.actor,
    action: row.action,
    target: row.target,
    outcome: row.outcome,
    details: row.details ?? {},
  };
}

export function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(value), MAX_LIMIT);
}

export function createAuditStore(pool: Pick<Pool, "query">): AuditStore {
  /** Created once per store, not once per row: a write is not the place to migrate. */
  let ready: Promise<void> | null = null;
  const ensure = (): Promise<void> => {
    ready ??= (async () => {
      await pool.query(CREATE_TABLE);
      await pool.query(CREATE_INDEX);
    })().catch((error: unknown) => {
      ready = null;
      throw error;
    });
    return ready;
  };

  return {
    record: async (entry, now = Date.now()) => {
      await ensure();
      await pool.query(INSERT, [
        now,
        entry.actor,
        entry.action,
        entry.target,
        entry.outcome,
        JSON.stringify(entry.details ?? {}),
      ]);
    },

    recent: async (query = {}) => {
      await ensure();
      const values: unknown[] = [];
      const where: string[] = [];
      if (query.actor !== undefined && query.actor.length > 0) {
        values.push(query.actor);
        where.push(`actor = $${values.length}`);
      }
      if (query.action !== undefined && query.action.length > 0) {
        values.push(query.action);
        where.push(`action = $${values.length}`);
      }
      if (query.before !== undefined) {
        values.push(query.before.at, query.before.id);
        // Strictly older on the tuple: two rows can share a millisecond, and a page that
        // repeats or skips one is worse than a page that is one row short.
        where.push(`(at, id) < ($${values.length - 1}, $${values.length})`);
      }
      values.push(clampLimit(query.limit));
      const text = `
        SELECT id, at, actor, action, target, outcome, details
        FROM operator_audit
        ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
        ORDER BY at DESC, id DESC
        LIMIT $${values.length}
      `;
      const result = await pool.query(text, values);
      return (result.rows as AuditRow[]).map(toRecord);
    },
  };
}

/**
 * A store that keeps its rows in memory, for tests.
 *
 * Every module takes an `audit` option, so a test asserts the rows an act wrote without a
 * database: `entries` is the whole trail, newest last.
 */
export function memoryAuditStore(): AuditStore & { entries: AuditRecord[] } {
  const entries: AuditRecord[] = [];
  let nextId = 1;
  return {
    entries,
    record: async (entry, now = Date.now()) => {
      entries.push({ ...entry, id: nextId++, at: now, details: entry.details ?? {} });
    },
    recent: async (query = {}) => {
      const matching = entries
        .filter((entry) => query.actor === undefined || entry.actor === query.actor)
        .filter((entry) => query.action === undefined || entry.action === query.action)
        .filter(
          (entry) =>
            query.before === undefined ||
            entry.at < query.before.at ||
            (entry.at === query.before.at && entry.id < query.before.id),
        )
        .sort((left, right) => right.at - left.at || right.id - left.id);
      return matching.slice(0, clampLimit(query.limit));
    },
  };
}

/**
 * Writes one row, and never turns a bookkeeping failure into a failed request.
 *
 * A missing audit row is a problem to fix; a settings write that 500s because the audit
 * table could not be written is a worse one, and it would teach an operator to retry an act
 * that already happened.
 */
export async function auditSafely(
  store: AuditStore | null,
  entry: AuditEntry,
  onError: (error: unknown) => void,
): Promise<void> {
  if (store === null) return;
  try {
    await store.record(entry);
  } catch (error) {
    onError(error);
  }
}
