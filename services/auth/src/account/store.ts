import type {
  AccountShare,
  AccountSnapshot,
  ErasureCounts,
  ErasurePlan,
  WorkspaceDataErasure,
} from "./types.js";

/**
 * The two stores an account erase spans, as ports.
 *
 * They are separate because they are separate processes and separate databases
 * (ADR-0065 §9). `AccountStore` is this service's own Postgres: users, sessions,
 * organizations, members, workspaces and the licence bookkeeping. `WorkspaceDataStore`
 * is everything the relay keeps per workspace: the Loro snapshot, the share rows and
 * the attachment bytes. The control plane holds no credential that reaches either of
 * the relay's two, so the second port is injected by the deployment that can.
 */
export interface AccountStore {
  /** The account's own rows, or null when the user row is already gone. */
  read: (userId: string) => Promise<AccountSnapshot | null>;
  /**
   * Removes the plan in **one transaction** and reports what it removed.
   *
   * One transaction is the whole promise: a caller that sees an error has not lost
   * half an account, and a retry starts from the same plan. The implementation
   * re-checks the plan inside the transaction, because the plan came from a read
   * that another request could have raced.
   */
  erase: (plan: ErasurePlan) => Promise<ErasureCounts>;
}

/**
 * The relay's stores for one workspace.
 *
 * `shares` is a read for the export. `erase` is the destructive call, and it is
 * expected to be idempotent: deleting a workspace's data twice removes nothing the
 * second time and reports zeroes, which is what makes a failed erase safe to retry.
 */
export interface WorkspaceDataStore {
  shares: (workspaceId: string) => Promise<readonly AccountShare[]>;
  erase: (workspaceId: string) => Promise<WorkspaceDataErasure>;
}

/**
 * The operator command that finishes a workspace whose relay stores were not wired.
 *
 * Named once and returned in the report, so the sentence a user reads and the command
 * an operator runs cannot drift apart.
 */
export function relayDeleteCommand(workspaceId: string): string {
  return `DELETE /api/workspaces/${workspaceId} with the owning account's session, or pnpm --filter @suite/collab-server admin delete ${workspaceId} --force`;
}
