import type { Pool } from "pg";

/**
 * What an account is told the next time it looks.
 *
 * Consent given once is not the same as being told each time: an account may have allowed
 * support access months ago and still deserve to know that somebody opened it on Tuesday.
 * The audit table answers "what happened"; this answers "was the person told", and the two
 * are deliberately separate rows — one is a record for the deployment, the other is a
 * sentence for the reader.
 *
 * Only the account can read its own notices, and reading one marks it read. Nothing here
 * names the operator: an account needs to know support looked, not which colleague did.
 */
export interface Notice {
  id: number;
  kind: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export interface NoticeStore {
  /** Writes one notice for an account. */
  write: (input: { userId: string; kind: string; body: string }, now?: number) => Promise<Notice>;
  /** Newest first, for the account's own surface. */
  listFor: (userId: string, limit?: number) => Promise<Notice[]>;
  /** Marks one read, but only if it belongs to this account. */
  markRead: (userId: string, id: number, now?: number) => Promise<boolean>;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS account_notices (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    read_at BIGINT
  )
`;

const CREATE_INDEX = `
  CREATE INDEX IF NOT EXISTS account_notices_for_user
  ON account_notices (user_id, created_at DESC, id DESC)
`;

const INSERT = `
  INSERT INTO account_notices (user_id, kind, body, created_at)
  VALUES ($1, $2, $3, $4)
  RETURNING id, kind, body, created_at, read_at
`;

const SELECT_FOR_USER = `
  SELECT id, kind, body, created_at, read_at
  FROM account_notices
  WHERE user_id = $1
  ORDER BY created_at DESC, id DESC
  LIMIT $2
`;

const MARK_READ = `
  UPDATE account_notices
  SET read_at = COALESCE(read_at, $3)
  WHERE id = $1 AND user_id = $2
  RETURNING id
`;

interface NoticeRow {
  id: string | number;
  kind: string;
  body: string;
  created_at: string | number;
  read_at: string | number | null;
}

function toNotice(row: NoticeRow): Notice {
  return {
    id: Number(row.id),
    kind: row.kind,
    body: row.body,
    createdAt: Number(row.created_at),
    readAt: row.read_at === null ? null : Number(row.read_at),
  };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function createNoticeStore(pool: Pick<Pool, "query">): NoticeStore {
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
    write: async ({ userId, kind, body }, now = Date.now()) => {
      await ensure();
      const result = await pool.query(INSERT, [userId, kind, body, now]);
      const row = (result.rows as NoticeRow[])[0];
      if (row === undefined) throw new Error("the notice was not written");
      return toNotice(row);
    },
    listFor: async (userId, limit = DEFAULT_LIMIT) => {
      await ensure();
      const capped = Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
      const result = await pool.query(SELECT_FOR_USER, [userId, capped]);
      return (result.rows as NoticeRow[]).map(toNotice);
    },
    markRead: async (userId, id, now = Date.now()) => {
      await ensure();
      const result = await pool.query(MARK_READ, [id, userId, now]);
      return result.rows.length > 0;
    },
  };
}

/**
 * The sentence an impersonation leaves.
 *
 * No operator identity: an account needs to know support looked, not which colleague did.
 * No link either — the way to switch support access off is in the app the reader is already
 * in, and a link out of it would be the wrong direction.
 */
export function supportViewNotice(when: number): string {
  const at = new Date(when).toLocaleString();
  return [
    `Someone on the team that runs this deployment opened your account on ${at}, to answer a support question.`,
    "That is only possible while support access is switched on, and you can switch it off at any time from Support access.",
  ].join(" ");
}

/** A memory store, so a module test asserts the sentence without a database. */
export function memoryNoticeStore(): NoticeStore & { notices: (Notice & { userId: string })[] } {
  const notices: (Notice & { userId: string })[] = [];
  let nextId = 1;
  return {
    notices,
    write: async ({ userId, kind, body }, now = Date.now()) => {
      const notice = { id: nextId++, kind, body, createdAt: now, readAt: null, userId };
      notices.push(notice);
      return notice;
    },
    listFor: async (userId) =>
      notices
        .filter((entry) => entry.userId === userId)
        .sort((left, right) => right.createdAt - left.createdAt || right.id - left.id),
    markRead: async (userId, id, now = Date.now()) => {
      const notice = notices.find((entry) => entry.id === id && entry.userId === userId);
      if (notice === undefined) return false;
      notice.readAt ??= now;
      return true;
    },
  };
}
