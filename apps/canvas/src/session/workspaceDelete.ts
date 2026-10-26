/**
 * Deleting a workspace, in both profiles.
 *
 * A relay workspace is deleted with the account's session credential
 * (`auth/credential.ts`), never an operator token: the relay resolves the
 * workspace's organization from the document id and checks the caller's role. A
 * standalone workspace has no relay, so only the local half exists.
 *
 * `purgeWorkspaceLocally` clears everything *this* browser holds; another device
 * keeps its offline copy until it opens the workspace again, and then finds the
 * relay empty. That limit is stated in the dialog and in
 * `docs/reference/security-model.md`.
 */

import { credentialAuthorization, forgetCredential } from "../auth/credential";
import { deleteWorkspaceDocument } from "../collab/loroPersistence";
import { collabHttpBase } from "./endpoints";
import { clearLicence } from "./licence";
import { forgetWorkspace } from "./workspaceTransfer";

/** The workspace routes the relay serves beside the share API. */
export const WORKSPACE_API_PATH = "/api/workspaces";

/** Which halves of a workspace exist: a relay copy, a local copy, or both. */
export type WorkspaceDeleteProfile = "relay" | "standalone";

export interface DeleteWorkspaceInput {
  workspaceId: string;
  profile: WorkspaceDeleteProfile;
  /**
   * `Authorization` for the relay half. Defaults to this page's session
   * credential; a test supplies its own so it needs no account.
   */
  authorization?: () => Promise<Record<string, string>>;
  /**
   * Runs after the relay delete committed and before the local purge. The open
   * editor uses it to stop writing the document that is about to be deleted.
   */
  beforePurge?: () => void;
}

/**
 * Clears everything this browser holds for a workspace: the IndexedDB
 * document, the local cached session credential, the recents entry and the
 * licence token.
 *
 * It is idempotent and never throws: a store that was never there, storage that
 * refuses writes and a browser without IndexedDB are all fine.
 */
export async function purgeWorkspaceLocally(workspaceId: string): Promise<void> {
  const id = workspaceId.trim();
  if (id.length === 0) return;
  // The token is minted per page from the session cookie, so forgetting it costs
  // one round trip and guarantees a deleted workspace is not reopened with it.
  forgetCredential();
  forgetWorkspace(id);
  clearLicence(id);
  try {
    await deleteWorkspaceDocument(id);
  } catch {
    // A browser without IndexedDB has no cached document to remove; the
    // localStorage half above is what makes the workspace unopenable here.
  }
}

function serverMessage(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>).error;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * One readable line for a refused delete. Every message says the same thing:
 * nothing was deleted, so the caller must not purge locally either.
 */
export function deleteWorkspaceError(status: number, body: unknown): string {
  if (status === 401) {
    return "The server did not receive a session, so nothing was deleted. This browser still has its copy.";
  }
  if (status === 403) {
    return "This account may not delete this workspace, so nothing was deleted. This browser still has its copy.";
  }
  if (status === 404) {
    return "The server has no copy of this workspace, so nothing was deleted there. This browser still has its copy.";
  }
  if (status === 429) {
    return "Too many delete attempts. Wait a minute and try again; nothing was deleted.";
  }
  const message = serverMessage(body);
  if (message.length > 0) return message;
  return `The workspace was not deleted (${status}). This browser still has its copy.`;
}

/**
 * Deletes the relay's copy. The session credential travels in the
 * `Authorization` header, never in the URL, and the body repeats the workspace id
 * so a stray request cannot delete a workspace it did not name.
 */
export async function deleteWorkspaceOnRelay(
  workspaceId: string,
  authorization: () => Promise<Record<string, string>> = credentialAuthorization,
): Promise<void> {
  const id = workspaceId.trim();
  const url = `${collabHttpBase()}${WORKSPACE_API_PATH}/${encodeURIComponent(id)}`;
  // Resolved before the request, so "no session" reads as its own sentence
  // rather than as a network failure.
  const headers = await authorization();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ confirm: id }),
    });
  } catch {
    throw new Error(
      "Could not reach the workspace server, so nothing was deleted. This browser still has its copy.",
    );
  }
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  throw new Error(deleteWorkspaceError(response.status, body));
}

/**
 * The whole delete for one profile. The local purge runs only once the relay
 * half has succeeded, so a failed request can never look like a success.
 */
export async function deleteWorkspaceEverywhere(input: DeleteWorkspaceInput): Promise<void> {
  const id = input.workspaceId.trim();
  if (id.length === 0) throw new Error("A workspace id is required.");
  if (input.profile === "relay") {
    await deleteWorkspaceOnRelay(id, input.authorization);
  }
  input.beforePurge?.();
  await purgeWorkspaceLocally(id);
}
