import { AuthError } from "../http/errors.js";
import type { AccountStore, WorkspaceDataStore } from "./store.js";
import type {
  AccountExport,
  AccountShare,
  AccountWorkspace,
  ExportedOrganization,
  ExportedWorkspace,
} from "./types.js";

/**
 * The account export: one file, the account's own rows, and a pointer for every
 * document.
 *
 * Three decisions are written into the shape rather than the page:
 *
 * - **Documents are referenced, not copied.** A workspace already exports as a
 *   `.suite` file, so the account export names the workspace and its export path. A
 *   copy here would be a second, unversioned snapshot per document, taken without the
 *   document store this service cannot reach.
 * - **Nothing of anyone else's.** Organizations carry the account's own membership
 *   row and the workspaces, never another member's id, role or address. A headcount is
 *   read internally for the erase and is not part of the file.
 * - **Share metadata without a credential.** A share row contributes its id, scope and
 *   timestamps. The token and its hash stay behind, because the export is a file that
 *   leaves the deployment.
 */

const FORMAT = "suite-account";
const VERSION = 1;

const DOCUMENT_NOTE =
  "Document bytes are not copied into this file. Export each workspace as a .suite file from the app, or through GET /api/admin/workspaces/<workspaceId>/export with an operator token.";

const SHARES_NOTE =
  "Share metadata is listed per workspace. Link tokens and their hashes are not exported, because a token is a working credential.";

const OTHER_PEOPLE_NOTE =
  "This file contains the account's own rows only: its profile, its memberships, and the workspaces of organizations it belongs to. Other members' rows and their addresses are not included.";

const CREDENTIALS_NOTE =
  "Session tokens, passkeys, second-factor secrets and password hashes are credentials rather than account data, and are not exported. The profile records whether second-factor sign-in is on.";

export interface AccountExportDeps {
  accounts: AccountStore;
  /**
   * The relay's share store. Null when the deployment did not wire one, in which case
   * each workspace says so instead of reporting an empty list as a fact.
   */
  workspaceData: WorkspaceDataStore | null;
  now?: () => number;
}

/** A share row as the export carries it, from a relay record of any extra shape. */
function shareOf(row: AccountShare): AccountShare {
  return {
    shareId: row.shareId,
    scope: row.scope,
    role: row.role,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

function documentReference(workspaceId: string): ExportedWorkspace["document"] {
  return {
    format: "suite",
    exportedHere: false,
    exportPath: `/api/admin/workspaces/${encodeURIComponent(workspaceId)}/export`,
    note: DOCUMENT_NOTE,
  };
}

/** Share rows for one workspace, or the reason they could not be read. */
async function sharesFor(
  workspaceId: string,
  workspaceData: WorkspaceDataStore | null,
): Promise<{ shares: readonly AccountShare[]; sharesUnavailableReason?: string }> {
  if (workspaceData === null) {
    return {
      shares: [],
      sharesUnavailableReason:
        "the deployment has no relay store wired, so this workspace's share rows were not read",
    };
  }
  try {
    return { shares: (await workspaceData.shares(workspaceId)).map(shareOf) };
  } catch (error) {
    return {
      shares: [],
      sharesUnavailableReason: `the relay refused the share read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function workspaceOf(
  workspace: AccountWorkspace,
  shares: readonly AccountShare[],
  sharesUnavailableReason?: string,
): ExportedWorkspace {
  return {
    workspaceId: workspace.workspaceId,
    name: workspace.name,
    createdAt: workspace.createdAt,
    archivedAt: workspace.archivedAt,
    document: documentReference(workspace.workspaceId),
    shares,
    ...(sharesUnavailableReason === undefined ? {} : { sharesUnavailableReason }),
  };
}

/**
 * Builds the file. The read is the whole operation: nothing here writes, and a
 * failure answers with a named refusal instead of an empty export that would look
 * like "this account owns nothing".
 */
export async function accountExport(
  input: { userId: string },
  deps: AccountExportDeps,
): Promise<AccountExport> {
  const snapshot = await deps.accounts.read(input.userId);
  if (snapshot === null) {
    throw new AuthError("unauthorized", "the account no longer exists");
  }

  const organizations: ExportedOrganization[] = [];
  for (const organization of snapshot.organizations) {
    const workspaces = snapshot.workspaces.filter(
      (workspace) => workspace.organizationId === organization.organizationId,
    );
    const exported: ExportedWorkspace[] = [];
    for (const workspace of workspaces) {
      const read = await sharesFor(workspace.workspaceId, deps.workspaceData);
      exported.push(workspaceOf(workspace, read.shares, read.sharesUnavailableReason));
    }
    organizations.push({
      organizationId: organization.organizationId,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      membership: { role: organization.role, joinedAt: organization.joinedAt },
      workspaces: exported,
    });
  }

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: (deps.now ?? Date.now)(),
    account: snapshot.profile,
    organizations,
    notes: {
      documents: DOCUMENT_NOTE,
      shares: SHARES_NOTE,
      otherPeople: OTHER_PEOPLE_NOTE,
      credentials: CREDENTIALS_NOTE,
    },
  };
}

/** The file name a browser saves: stable enough to sort, and tied to the account. */
export function accountExportFileName(userId: string, exportedAt: number): string {
  const day = new Date(exportedAt).toISOString().slice(0, 10);
  // The id goes into a header, so anything that is not a safe file-name character is
  // dropped: a quote or a newline in it would otherwise split the `content-disposition`
  // header the route sets.
  const safe = userId.replace(/[^A-Za-z0-9._-]/gu, "_");
  return `suite-account-${safe}-${day}.json`;
}
