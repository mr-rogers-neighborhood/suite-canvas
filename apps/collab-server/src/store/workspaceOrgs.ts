import { DatabaseSync } from "node:sqlite";
import { configureConnection } from "./persistence.js";

/**
 * Which organization owns each workspace, as the relay last saw it.
 *
 * The control plane's `workspaces` row is the authority (ADR-0065, ADR-0076);
 * this store is the relay's local copy, because the relay holds no Postgres
 * credential and makes no control-plane call on a connect (ADR-0073). A
 * verified session JWT names an organization and the room names a workspace, so
 * something here has to answer "are those the same tenant?" without a network
 * hop — that question is the whole reason the file exists.
 *
 * The file, its environment variable (`SUITE_WORKSPACES_DB`) and the default
 * `suite.workspaces.sqlite` keep their names: `deploy/backup.sh` and
 * `docs/reference/environment.md` name them, and renaming a store that a backup
 * script discovers by filename is a deployment change, not a refactor. What the
 * store *holds* is renamed here — a `workspace_orgs` table of organizations, not
 * a `workspaces` table of owner hashes. The old table is left untouched and is
 * never read: ADR-0076 ships no migration for issued keys.
 */

/** Schema version stamped into `PRAGMA user_version`; bump only with a migration. */
export const WORKSPACE_ORG_SCHEMA = 1;

/** Longest workspace id the relay accepts; the control plane caps ids the same. */
const MAX_ID_LENGTH = 512;

export interface WorkspaceOrgRecord {
  workspaceId: string;
  organizationId: string;
  /** Epoch milliseconds the row was written. */
  openedAt: number;
}

/** What a claim attempt found. `conflict` means another organization got there first. */
export type ClaimOutcome = "claimed" | "owned" | "conflict";

export interface WorkspaceOrgStore {
  /**
   * The organization behind a workspace, or null when no verified session has
   * opened it yet. Null is not "anonymous": it means "this relay has not been
   * told", and an account join for such a workspace is what records it.
   */
  get: (workspaceId: string) => WorkspaceOrgRecord | null;
  /**
   * Records the organization a verified session belongs to. The first claim
   * wins, so a second organization is told `conflict` and the row is untouched;
   * the same organization is told `owned` and nothing is rewritten.
   */
  claim: (workspaceId: string, organizationId: string, now?: number) => ClaimOutcome;
  /** True when the workspace has a recorded organization. */
  has: (workspaceId: string) => boolean;
  /**
   * How many workspaces this relay has recorded for one organization.
   *
   * A lower bound on what the organization holds: a workspace claimed in the control plane
   * but never opened here is not counted. The join gate reads it as "at least this many",
   * which is the only direction that cannot refuse somebody who is inside their plan.
   */
  countForOrganization: (organizationId: string) => number;
  /** Drops a workspace's row, for a workspace delete. Returns rows removed. */
  remove: (workspaceId: string) => number;
  close: () => void;
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

/** Validates a claim pair; returns a human-readable problem, or null when valid. */
export function validateWorkspaceOrg(workspaceId: unknown, organizationId: unknown): string | null {
  if (!isText(workspaceId, MAX_ID_LENGTH)) return "A workspace id is required.";
  if (!isText(organizationId, MAX_ID_LENGTH)) return "An organization id is required.";
  return null;
}

function assertPair(workspaceId: string, organizationId: string): void {
  const problem = validateWorkspaceOrg(workspaceId, organizationId);
  if (problem) throw new Error(problem);
}

interface WorkspaceOrgRow {
  workspace_id: string;
  organization_id: string;
  opened_at: number;
}

export function createWorkspaceOrgStore(path: string): WorkspaceOrgStore {
  const db = new DatabaseSync(path);
  configureConnection(db, WORKSPACE_ORG_SCHEMA);
  db.exec(
    `CREATE TABLE IF NOT EXISTS workspace_orgs (
       workspace_id TEXT PRIMARY KEY,
       organization_id TEXT NOT NULL,
       opened_at INTEGER NOT NULL
     );`,
  );

  const insert = db.prepare(
    `INSERT OR IGNORE INTO workspace_orgs (workspace_id, organization_id, opened_at)
     VALUES (?, ?, ?)`,
  );
  const select = db.prepare(
    "SELECT workspace_id, organization_id, opened_at FROM workspace_orgs WHERE workspace_id = ?",
  );
  const removeRow = db.prepare("DELETE FROM workspace_orgs WHERE workspace_id = ?");
  const countByOrg = db.prepare(
    "SELECT count(*) AS n FROM workspace_orgs WHERE organization_id = ?",
  );

  const rowOf = (workspaceId: string): WorkspaceOrgRow | null =>
    (select.get(workspaceId) as WorkspaceOrgRow | undefined) ?? null;

  return {
    get: (workspaceId) => {
      if (!isText(workspaceId, MAX_ID_LENGTH)) return null;
      const row = rowOf(workspaceId.trim());
      return row === null
        ? null
        : {
            workspaceId: row.workspace_id,
            organizationId: row.organization_id,
            openedAt: Number(row.opened_at),
          };
    },

    claim: (workspaceId, organizationId, now = Date.now()) => {
      assertPair(workspaceId, organizationId);
      const id = workspaceId.trim();
      const org = organizationId.trim();
      // `INSERT OR IGNORE` makes the first claim win even with concurrent joins,
      // and its row count is what tells "I inserted it" from "it was already there".
      const inserted = Number(insert.run(id, org, now).changes) === 1;
      if (inserted) return "claimed";
      const stored = rowOf(id);
      if (stored === null) throw new Error("The workspace organization could not be stored.");
      return stored.organization_id === org ? "owned" : "conflict";
    },

    has: (workspaceId) => {
      if (!isText(workspaceId, MAX_ID_LENGTH)) return false;
      return rowOf(workspaceId.trim()) !== null;
    },

    countForOrganization: (organizationId) => {
      if (!isText(organizationId, MAX_ID_LENGTH)) return 0;
      const row = countByOrg.get(organizationId.trim()) as { n: number } | undefined;
      return row === undefined ? 0 : Number(row.n);
    },

    remove: (workspaceId) => {
      if (!isText(workspaceId, MAX_ID_LENGTH)) return 0;
      return Number(removeRow.run(workspaceId.trim()).changes);
    },

    close: () => db.close(),
  };
}
