import { createHash, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/** Only the key hash is stored, so a leaked database never yields a usable key. */
export function hashOwnerKey(ownerKey: string): string {
  return createHash("sha256").update(ownerKey, "utf8").digest("hex");
}

export type ClaimResult = "owner" | "mismatch";

export interface WorkspaceRegistry {
  /**
   * Claims a workspace on first use and verifies later owners. The first key
   * wins; a different key is a mismatch and leaves the row untouched.
   */
  claimOrVerify: (workspaceId: string, ownerKey: string) => ClaimResult;
  /** True when this key owns the workspace; false when unknown or different. */
  verify: (workspaceId: string, ownerKey: string) => boolean;
  /** True when the workspace has an owner key registered. */
  has: (workspaceId: string) => boolean;
  close: () => void;
}

const MAX_ID_LENGTH = 512;
const MAX_KEY_LENGTH = 512;

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

/** Validates a claim payload; returns a human-readable problem, or null when valid. */
export function validateClaimInput(workspaceId: unknown, ownerKey: unknown): string | null {
  if (!isText(workspaceId, MAX_ID_LENGTH)) return "A workspace id is required.";
  if (!isText(ownerKey, MAX_KEY_LENGTH)) return "An owner key is required.";
  return null;
}

function assertClaimInput(workspaceId: string, ownerKey: string): void {
  const problem = validateClaimInput(workspaceId, ownerKey);
  if (problem) throw new Error(problem);
}

/** Compares two hex digests without leaking where they differ. */
function sameHash(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(actual, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

interface WorkspaceRow {
  owner_hash: string;
}

export function createWorkspaceRegistry(path: string): WorkspaceRegistry {
  const db = new DatabaseSync(path);
  db.exec(
    `CREATE TABLE IF NOT EXISTS workspaces (
       workspace_id TEXT PRIMARY KEY,
       owner_hash TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       claimed_at INTEGER NOT NULL
     );`,
  );

  const insert = db.prepare(
    `INSERT OR IGNORE INTO workspaces (workspace_id, owner_hash, created_at, claimed_at)
     VALUES (?, ?, ?, ?)`,
  );
  const select = db.prepare("SELECT owner_hash FROM workspaces WHERE workspace_id = ?");

  const storedHash = (workspaceId: string): string | null => {
    const row = select.get(workspaceId) as WorkspaceRow | undefined;
    return row ? row.owner_hash : null;
  };

  return {
    claimOrVerify: (workspaceId, ownerKey) => {
      assertClaimInput(workspaceId, ownerKey);
      const id = workspaceId.trim();
      const hash = hashOwnerKey(ownerKey);
      // `INSERT OR IGNORE` makes the first claim win even with concurrent writers.
      const now = Date.now();
      insert.run(id, hash, now, now);
      const stored = storedHash(id);
      if (stored === null) throw new Error("The workspace claim could not be stored.");
      return sameHash(stored, hash) ? "owner" : "mismatch";
    },

    verify: (workspaceId, ownerKey) => {
      assertClaimInput(workspaceId, ownerKey);
      const stored = storedHash(workspaceId.trim());
      return stored !== null && sameHash(stored, hashOwnerKey(ownerKey));
    },

    has: (workspaceId) => {
      if (!isText(workspaceId, MAX_ID_LENGTH)) return false;
      return storedHash(workspaceId.trim()) !== null;
    },

    close: () => db.close(),
  };
}
