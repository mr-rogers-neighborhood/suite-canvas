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
  /**
   * Replaces the owner hash when `currentOwnerKey` still owns the workspace.
   * The update is a single conditional statement, so a concurrent rotation
   * cannot leave a stale key in place.
   */
  rotate: (workspaceId: string, currentOwnerKey: string, newOwnerKey: string) => boolean;
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

/** Validates a rotation payload; the current key arrives in the header. */
export function validateRotateInput(newOwnerKey: unknown): string | null {
  if (!isText(newOwnerKey, MAX_KEY_LENGTH)) return "A new owner key is required.";
  return null;
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
  const update = db.prepare(
    `UPDATE workspaces SET owner_hash = ?, claimed_at = ?
     WHERE workspace_id = ? AND owner_hash = ?`,
  );

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

    rotate: (workspaceId, currentOwnerKey, newOwnerKey) => {
      assertClaimInput(workspaceId, currentOwnerKey);
      const problem = validateRotateInput(newOwnerKey);
      if (problem) throw new Error(problem);

      const id = workspaceId.trim();
      const stored = storedHash(id);
      if (stored === null || !sameHash(stored, hashOwnerKey(currentOwnerKey))) return false;
      // The hash in the WHERE clause is the compare-and-swap: only the key that
      // was just verified can replace itself.
      const result = update.run(hashOwnerKey(newOwnerKey), Date.now(), id, stored);
      return Number(result.changes) === 1;
    },

    has: (workspaceId) => {
      if (!isText(workspaceId, MAX_ID_LENGTH)) return false;
      return storedHash(workspaceId.trim()) !== null;
    },

    close: () => db.close(),
  };
}
