import type { OrganizationRole, RoleOverrideLookup } from "@suite/auth";
import type { Pool } from "pg";

/**
 * The row behind a worn role.
 *
 * One row per operator, naming the organization it applies in, because a role only means
 * anything inside one. Setting it again replaces it; clearing deletes it, and the real role
 * comes back the moment nothing is there.
 *
 * The row is *not* a membership. Nothing here writes `member`, so no seat is counted twice,
 * no invitation is consumed, and dropping the row restores exactly what an operator had.
 */
export interface RoleOverride {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
  setAt: number;
}

export interface RoleOverrideStore {
  get: (userId: string) => Promise<RoleOverride | null>;
  set: (input: Omit<RoleOverride, "setAt">, now?: number) => Promise<RoleOverride>;
  clear: (userId: string) => Promise<boolean>;
  /** The port `@suite/auth` wraps around the memberships reader. */
  lookup: RoleOverrideLookup;
}

const ROLES: readonly OrganizationRole[] = ["owner", "admin", "member"];

export function isWearableRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && ROLES.includes(value as OrganizationRole);
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS operator_role_overrides (
    user_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    role TEXT NOT NULL,
    set_at BIGINT NOT NULL
  )
`;

const SELECT_ONE = `
  SELECT user_id, organization_id, role, set_at
  FROM operator_role_overrides
  WHERE user_id = $1
`;

const UPSERT = `
  INSERT INTO operator_role_overrides (user_id, organization_id, role, set_at)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (user_id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id, role = EXCLUDED.role, set_at = EXCLUDED.set_at
`;

const DELETE_ONE = `DELETE FROM operator_role_overrides WHERE user_id = $1`;

interface OverrideRow {
  user_id: string;
  organization_id: string;
  role: string;
  set_at: string | number;
}

function toOverride(row: OverrideRow): RoleOverride | null {
  // A row whose role is not one of the three is treated as absent: a costume is not a
  // place to fail open.
  if (!isWearableRole(row.role)) return null;
  return {
    userId: row.user_id,
    organizationId: row.organization_id,
    role: row.role,
    setAt: Number(row.set_at),
  };
}

export function createRoleOverrideStore(pool: Pick<Pool, "query">): RoleOverrideStore {
  let ready: Promise<void> | null = null;
  const ensure = (): Promise<void> => {
    ready ??= pool.query(CREATE_TABLE).then(
      () => undefined,
      (error: unknown) => {
        ready = null;
        throw error;
      },
    );
    return ready;
  };

  const store: RoleOverrideStore = {
    get: async (userId) => {
      await ensure();
      const result = await pool.query(SELECT_ONE, [userId]);
      const row = (result.rows as OverrideRow[])[0];
      return row === undefined ? null : toOverride(row);
    },
    set: async (input, now = Date.now()) => {
      await ensure();
      await pool.query(UPSERT, [input.userId, input.organizationId, input.role, now]);
      return { ...input, setAt: now };
    },
    clear: async (userId) => {
      await ensure();
      await pool.query(DELETE_ONE, [userId]);
      return true;
    },
    lookup: async ({ userId, organizationId, role }) => {
      // Nobody to wear anything as: a stranger stays a stranger, and the store is not
      // consulted about a membership that does not exist.
      if (role === null) return null;
      const override = await store.get(userId);
      if (override === null) return null;
      return override.organizationId === organizationId ? override.role : null;
    },
  };
  return store;
}

/** What a reader sees: the role, the organization it applies in, and when it started. */
export function overrideBody(override: RoleOverride | null) {
  return override === null
    ? { role: null, organizationId: null, setAt: null }
    : { role: override.role, organizationId: override.organizationId, setAt: override.setAt };
}
