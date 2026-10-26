import { DatabaseSync } from "node:sqlite";
import { type LicenceClaims, type LicenceQuota, licenceQuota } from "@suite/licence";
import { configureConnection } from "./persistence.js";

/**
 * The entitlement the relay last saw for a workspace's organization.
 *
 * The rows are written from a *verified* session JWT (ADR-0074), not from a
 * claim request: `tier` and `limits` in the token are minted from the
 * organization's subscription (ADR-0075), so recording them next to the
 * workspace is what lets the quota service and the attachment cap answer for a
 * save that carries no token at all. The store is bookkeeping for the relay and
 * its operator — it is never the authority on whether a session is valid.
 *
 * The claim record, not the token format: the Ed25519 verifier this file used to
 * hold moved to `@suite/licence` (ADR-0075), and the two are separate concerns.
 */

/** Schema version stamped into `PRAGMA user_version`; bump only with a migration. */
export const LICENCE_STORE_SCHEMA = 1;

/** Licence data recorded next to a workspace on the hosted relay. */
export interface LicenceClaimRecord {
  workspaceId: string;
  licenceId: string;
  tier: string;
  quota: LicenceQuota;
  email: string | null;
  /** Epoch milliseconds at which the licence stops verifying. */
  expiresAt: number;
  /** Epoch milliseconds of the most recent write that recorded this licence. */
  claimedAt: number;
}

export interface LicenceClaimStore {
  /** Stores the licence behind a workspace, replacing any earlier one. */
  record: (workspaceId: string, claims: LicenceClaims, now: number) => LicenceClaimRecord;
  get: (workspaceId: string) => LicenceClaimRecord | null;
  /**
   * Drops a workspace's licence record, for a workspace delete. Returns the
   * number of rows removed, so the caller can report it.
   */
  remove: (workspaceId: string) => number;
  close: () => void;
}

interface LicenceRow {
  workspace_id: string;
  licence_id: string;
  tier: string;
  quota_json: string | null;
  email: string | null;
  expires_at: number | null;
  claimed_at: number;
}

/**
 * Adds the columns of stores created before they existed, the same way the
 * share store migrates its older rows.
 */
function migrateLicenceColumns(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(workspace_licences)").all() as { name?: string }[];
  if (!columns.some((column) => column.name === "quota_json")) {
    db.exec("ALTER TABLE workspace_licences ADD COLUMN quota_json TEXT");
  }
  if (!columns.some((column) => column.name === "email")) {
    db.exec("ALTER TABLE workspace_licences ADD COLUMN email TEXT");
  }
  if (!columns.some((column) => column.name === "expires_at")) {
    db.exec("ALTER TABLE workspace_licences ADD COLUMN expires_at INTEGER");
  }
}

export function createLicenceClaimStore(path: string): LicenceClaimStore {
  const db = new DatabaseSync(path);
  configureConnection(db, LICENCE_STORE_SCHEMA);
  db.exec(
    `CREATE TABLE IF NOT EXISTS workspace_licences (
       workspace_id TEXT PRIMARY KEY,
       licence_id TEXT NOT NULL,
       tier TEXT NOT NULL,
       claimed_at INTEGER NOT NULL
     );`,
  );
  migrateLicenceColumns(db);

  const upsert = db.prepare(
    `INSERT INTO workspace_licences
       (workspace_id, licence_id, tier, quota_json, email, expires_at, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       licence_id = excluded.licence_id,
       tier = excluded.tier,
       quota_json = excluded.quota_json,
       email = excluded.email,
       expires_at = excluded.expires_at,
       claimed_at = excluded.claimed_at`,
  );
  const select = db.prepare("SELECT * FROM workspace_licences WHERE workspace_id = ?");
  const removeByWorkspace = db.prepare("DELETE FROM workspace_licences WHERE workspace_id = ?");

  return {
    record: (workspaceId, claims, now) => {
      const id = workspaceId.trim();
      const quota = licenceQuota(claims);
      upsert.run(
        id,
        claims.id,
        claims.tier,
        JSON.stringify(quota),
        claims.email ?? null,
        claims.expiresAt,
        now,
      );
      return {
        workspaceId: id,
        licenceId: claims.id,
        tier: claims.tier,
        quota,
        email: claims.email ?? null,
        expiresAt: claims.expiresAt,
        claimedAt: now,
      };
    },

    get: (workspaceId) => {
      const row = select.get(workspaceId.trim()) as LicenceRow | undefined;
      if (!row) return null;
      return {
        workspaceId: row.workspace_id,
        licenceId: row.licence_id,
        tier: row.tier,
        quota: row.quota_json
          ? (JSON.parse(row.quota_json) as LicenceQuota)
          : { workspaces: 1, documentBytes: 0, attachmentBytes: 0 },
        email: row.email,
        expiresAt: row.expires_at ?? 0,
        claimedAt: row.claimed_at,
      };
    },

    remove: (workspaceId) => Number(removeByWorkspace.run(workspaceId.trim()).changes),

    close: () => db.close(),
  };
}

let defaultLicenceClaims: LicenceClaimStore | null = null;

/**
 * The process-wide store the relay records into. Server wiring opens it once so
 * the quota service reads the same rows a join wrote.
 */
export function defaultLicenceClaimStore(): LicenceClaimStore {
  defaultLicenceClaims ??= createLicenceClaimStore(
    process.env.SUITE_LICENCE_DB?.trim() || ":memory:",
  );
  return defaultLicenceClaims;
}
