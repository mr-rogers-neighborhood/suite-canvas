/**
 * Which of this browser's workspaces the account already holds.
 *
 * The launcher knows what is on this device and nothing else. Signing in does not
 * move a document anywhere, so the honest answer to "is this synced?" comes from
 * the account service, not from a local guess — a workspace saved here and a
 * workspace already in the account are different states, and the row says which.
 *
 * Failure is not an error the reader has to act on: an offline launcher simply
 * says it does not know yet.
 */

import { credentialAuthorization } from "../auth/credential";
import { collabHttpBase } from "./endpoints";
import { isStandalone } from "./mode";

/** One workspace the account can open, as the service reports it. */
export interface AccountWorkspace {
  id: string;
  organizationId: string | null;
  name: string;
  createdAt: number;
  archivedAt: number | null;
}

export interface AccountWorkspaces {
  workspaces: readonly AccountWorkspace[];
  organizations: readonly { id: string; name: string; role: string }[];
}

export const ACCOUNT_WORKSPACES_PATH = "/api/account/workspaces";

/**
 * The account's workspaces, or `null` when there is no session or no answer.
 *
 * `null` and an empty list are different: no answer means the launcher keeps
 * saying "on this device", while an empty list means the account holds nothing yet
 * and the offline work is the only copy — which is exactly when offering to bring
 * it along is worth doing.
 */
export async function readAccountWorkspaces(
  options: {
    base?: string;
    authorization?: () => Promise<Record<string, string>>;
    fetch?: typeof globalThis.fetch;
  } = {},
): Promise<AccountWorkspaces | null> {
  // A standalone build has no account service to ask, and a build that shipped the
  // request anyway would log a 404 on every launcher visit.
  if (options.fetch === undefined && isStandalone()) return null;
  const call = options.fetch ?? globalThis.fetch;
  const authorization = options.authorization ?? credentialAuthorization;
  const headers = await authorization();
  if (Object.keys(headers).length === 0) return null;
  try {
    const response = await call(`${options.base ?? collabHttpBase()}${ACCOUNT_WORKSPACES_PATH}`, {
      method: "GET",
      headers: { ...headers, accept: "application/json" },
      credentials: "include",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const { workspaces, organizations } = body as Partial<AccountWorkspaces>;
    if (!Array.isArray(workspaces)) return null;
    return {
      workspaces: workspaces.filter(
        (workspace): workspace is AccountWorkspace =>
          typeof workspace === "object" && workspace !== null && typeof workspace.id === "string",
      ),
      organizations: Array.isArray(organizations) ? organizations : [],
    };
  } catch {
    return null;
  }
}

/** What a launcher row can honestly say about a workspace. */
export type WorkspaceSyncState = "synced" | "local" | "unknown";

export function syncStateOf(
  workspaceId: string,
  account: AccountWorkspaces | null,
): WorkspaceSyncState {
  if (account === null) return "unknown";
  return account.workspaces.some((workspace) => workspace.id === workspaceId) ? "synced" : "local";
}

/** The one word a row shows. Short because it sits beside a name, not under one. */
export function syncLabelOf(state: WorkspaceSyncState): string | null {
  if (state === "synced") return "Synced";
  if (state === "local") return "On this device";
  return null;
}
