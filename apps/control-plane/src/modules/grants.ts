import type { Pool } from "pg";

/**
 * Support access: an account's permission for an operator to see what it sees.
 *
 * Impersonation is the most invasive thing this product can do, so it is not a switch an
 * operator throws. The account grants it, from its own session, and can take it back; the
 * operator can revoke it too, because a grant nobody remembers is worse than one that
 * lapses. An impersonation needs a live grant at the moment it starts — the grant is the
 * consent, the audit row is the record, and the banner is the account being told.
 *
 * The table is created on first use, like the settings table, so an older database boots.
 */
export interface SupportGrant {
  userId: string;
  grantedAt: number;
  revokedAt: number | null;
}

export interface GrantStore {
  get: (userId: string) => Promise<SupportGrant | null>;
  /** True only while a grant exists and has not been revoked. */
  active: (userId: string) => Promise<boolean>;
  grant: (userId: string, now?: number) => Promise<void>;
  revoke: (userId: string, now?: number) => Promise<void>;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS operator_support_grants (
    user_id TEXT PRIMARY KEY,
    granted_at BIGINT NOT NULL,
    revoked_at BIGINT
  )
`;

const SELECT_ONE = `
  SELECT user_id, granted_at, revoked_at
  FROM operator_support_grants
  WHERE user_id = $1
`;

const UPSERT_GRANT = `
  INSERT INTO operator_support_grants (user_id, granted_at, revoked_at)
  VALUES ($1, $2, NULL)
  ON CONFLICT (user_id) DO UPDATE SET granted_at = EXCLUDED.granted_at, revoked_at = NULL
`;

const REVOKE = `
  UPDATE operator_support_grants
  SET revoked_at = $2
  WHERE user_id = $1 AND revoked_at IS NULL
`;

interface GrantRow {
  user_id: string;
  granted_at: string | number;
  revoked_at: string | number | null;
}

function toGrant(row: GrantRow): SupportGrant {
  return {
    userId: row.user_id,
    grantedAt: Number(row.granted_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
  };
}

export function createGrantStore(pool: Pick<Pool, "query">): GrantStore {
  const ensure = async (): Promise<void> => {
    await pool.query(CREATE_TABLE);
  };
  return {
    get: async (userId) => {
      await ensure();
      const result = await pool.query(SELECT_ONE, [userId]);
      const row = (result.rows as GrantRow[])[0];
      return row ? toGrant(row) : null;
    },
    active: async (userId) => {
      const grant = await createGrantStore(pool).get(userId);
      return grant !== null && grant.revokedAt === null;
    },
    grant: async (userId, now = Date.now()) => {
      await ensure();
      await pool.query(UPSERT_GRANT, [userId, now]);
    },
    revoke: async (userId, now = Date.now()) => {
      await ensure();
      await pool.query(REVOKE, [userId, now]);
    },
  };
}
