/**
 * Deleting a workspace, in both profiles.
 *
 * A relay workspace is deleted by its owner key: the same credential the claim
 * and rotation paths use, never an operator token. A standalone workspace has
 * no relay, so only the local half exists.
 *
 * There are no accounts, so the relay cannot tell other devices that a
 * workspace is gone. `purgeWorkspaceLocally` clears everything *this* browser
 * holds; another device keeps its offline copy until it opens the workspace
 * again, and then finds the relay empty. That limit is stated in the dialog and
 * in `docs/security-model.md`.
 */

import { deleteWorkspaceDocument } from "../collab/loroPersistence";
import { collabHttpBase } from "./endpoints";
import { clearLicence } from "./licence";
import { forgetOwnerKey, WORKSPACE_API_PATH } from "./ownerKey";
import { clearSavedRecoveryKey } from "./ownerKit";
import { forgetWorkspace } from "./workspaceTransfer";

/** Which halves of a workspace exist: a relay copy, a local copy, or both. */
export type WorkspaceDeleteProfile = "relay" | "standalone";

export interface DeleteWorkspaceInput {
  workspaceId: string;
  profile: WorkspaceDeleteProfile;
  /** The owner key from the session; required for the relay half. */
  ownerKey?: string | null;
  /**
   * Runs after the relay delete committed and before the local purge. The open
   * editor uses it to stop writing the document that is about to be deleted.
   */
  beforePurge?: () => void;
}

/**
 * Clears everything this browser holds for a workspace: the IndexedDB
 * document, the owner key (and its claim record), the recovery-saved flag, the
 * recents entry and the licence token.
 *
 * It is idempotent and never throws: a store that was never there, storage that
 * refuses writes and a browser without IndexedDB are all fine.
 */
export async function purgeWorkspaceLocally(workspaceId: string): Promise<void> {
  const id = workspaceId.trim();
  if (id.length === 0) return;
  forgetOwnerKey(id);
  clearSavedRecoveryKey(id);
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
    return "The server did not receive the owner key, so nothing was deleted. This browser still has its copy.";
  }
  if (status === 403) {
    return "This browser's owner key does not match this workspace, so nothing was deleted. This browser still has its copy.";
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
 * Deletes the relay's copy. The owner key travels in the `Authorization`
 * header, never in the URL, and the body repeats the workspace id so a stray
 * request cannot delete a workspace it did not name.
 */
export async function deleteWorkspaceOnRelay(workspaceId: string, ownerKey: string): Promise<void> {
  const id = workspaceId.trim();
  const url = `${collabHttpBase()}${WORKSPACE_API_PATH}/${encodeURIComponent(id)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerKey}`,
      },
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
    const ownerKey = input.ownerKey?.trim() ?? "";
    if (ownerKey.length === 0) {
      throw new Error(
        "This browser has no owner key for the workspace, so it was not deleted. Open the owner link first.",
      );
    }
    await deleteWorkspaceOnRelay(id, ownerKey);
  }
  input.beforePurge?.();
  await purgeWorkspaceLocally(id);
}
