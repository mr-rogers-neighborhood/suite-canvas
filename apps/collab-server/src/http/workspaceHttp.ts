import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "../logging.js";
import { type AdminPaths, adminPaths, deleteWorkspace } from "../ops/admin.js";
import type { LicenceClaimStore } from "../store/licenceClaims.js";
import type { WorkspaceAccess } from "./access.js";
import { HttpError, toProblem } from "./errors.js";
import { clientAddress, rotateLimiter } from "./rateLimit.js";
import { readJsonBody } from "./request.js";
import { applyCors, methodNotAllowed, sendEmpty, sendJson, sendProblem } from "./respond.js";

/**
 * The workspace routes that survive the owner key (ADR-0076).
 *
 * There is exactly one: the account-authorized delete. Claim, rotate and status
 * are gone with the key they were built around — a workspace's organization is
 * recorded by the first verified session that opens it (`access.ts`), a
 * credential is never rotated by this process (the control plane's session TTL
 * bounds it), and the client reads its quota from the same session it syncs
 * with.
 */
const logger = createLogger().child({ component: "workspaces" });

export const WORKSPACE_API_PATH = "/api/workspaces";

export interface WorkspaceRequestHooks {
  /**
   * Called after an account delete committed, so a host can close the
   * workspace's live sessions and drop its share projections. The data is
   * already gone.
   */
  onDeleted?: (workspaceId: string) => void;
  /**
   * Where an account delete finds the relay's SQLite files. Defaults to the same
   * `SUITE_DB`/`SUITE_SHARES_DB`/`SUITE_WORKSPACES_DB` the server booted from.
   */
  storage?: AdminPaths;
  /** The entitlement record a delete drops, or null on a self-host. */
  licences?: Pick<LicenceClaimStore, "remove"> | null;
}

export interface WorkspaceRequestDeps extends WorkspaceRequestHooks {
  /** The session credential and the organization the workspace belongs to. */
  access: WorkspaceAccess;
  /**
   * Whether the relay holds anything for this workspace, for a readable 404.
   * Omitted, the delete is attempted and reports the zero rows it removed.
   */
  exists?: (workspaceId: string) => boolean;
  /** Drops the workspace's recorded organization, so a re-claim starts clean. */
  forgetWorkspace?: (workspaceId: string) => void;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw HttpError.badRequest("The workspace identifier is malformed.");
  }
}

function deleteConfirmMessage(workspaceId: string): string {
  return `Deleting a workspace requires {"confirm":"${workspaceId}"} in the request body.`;
}

/**
 * Deletes a workspace on the account's own authority: the session JWT in the
 * `Authorization` header, checked against the organization the relay recorded
 * for this workspace. The body repeats the workspace id, so a stray request
 * cannot wipe a workspace it did not name.
 *
 * The data is removed by the operator CLI's `delete` (`admin.ts`), so both entry
 * points share one implementation: documents and projected share rooms, share
 * rows and their baselines, the recorded organization — and, on a hosted relay,
 * the licence record beside it. The delete is immediate and has no tombstone;
 * see `docs/reference/security-model.md` for what that means for other devices.
 */
async function remove(
  request: IncomingMessage,
  response: ServerResponse,
  deps: WorkspaceRequestDeps,
  workspaceId: string,
): Promise<void> {
  // Deletion spends the rate budget that rotation used to: both were rare,
  // destructive operations, and a flood of either must not reach the database.
  const removal = rotateLimiter.take(clientAddress(request));
  if (!removal.ok) {
    throw HttpError.rateLimited(
      removal.retryAfter,
      "Too many workspace deletions. Wait a moment and try again.",
    );
  }

  const id = workspaceId.trim();
  // Authorization first: an unknown workspace and someone else's workspace must
  // look the same from outside, and only an entitled account learns the
  // difference (its organization is recorded, so the 404 below is its own data).
  const principal = await deps.access.forWorkspace(request, id);
  if (deps.exists !== undefined && !deps.exists(id)) {
    throw HttpError.notFound("Workspace not found.");
  }

  const body = await readJsonBody(request);
  const confirm =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).confirm
      : undefined;
  if (typeof confirm !== "string" || confirm.trim() !== id) {
    throw HttpError.badRequest(deleteConfirmMessage(id));
  }

  const result = deleteWorkspace(deps.storage ?? adminPaths(), id);
  // The licence row only exists on a hosted relay, and only that deployment
  // opens the store; a self-host delete must not create one.
  const licenceRows = deps.licences?.remove(id) ?? 0;
  deps.forgetWorkspace?.(id);

  sendJson(response, 200, {
    workspaceId: id,
    deleted: true,
    organizationId: principal.organizationId,
    ...result,
    licenceRows,
  });
  try {
    deps.onDeleted?.(id);
  } catch (error) {
    logger.error("delete hook failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handles the workspace delete. Returns false when the request is not one of its
 * routes so the caller can keep serving its own routes.
 */
export async function handleWorkspaceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: WorkspaceRequestDeps,
): Promise<boolean> {
  applyCors(request, response);
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== WORKSPACE_API_PATH && !url.pathname.startsWith(`${WORKSPACE_API_PATH}/`)) {
    return false;
  }

  const method = request.method ?? "GET";
  if (method === "OPTIONS") {
    // Every response carries the share API's CORS headers.
    sendEmpty(response, 204);
    return true;
  }

  try {
    const segment = url.pathname.slice(WORKSPACE_API_PATH.length).replace(/^\//, "");
    const parts = segment.split("/");
    // `DELETE /api/workspaces/:id` is the account's own delete. Every other
    // method and shape is a 404: the routes that used to live here are gone.
    if (parts.length !== 1 || (parts[0]?.length ?? 0) === 0) {
      throw HttpError.notFound("Not found.");
    }
    if (method !== "DELETE") {
      methodNotAllowed(response, "DELETE, OPTIONS");
      return true;
    }
    await remove(request, response, deps, decodeSegment(parts[0] ?? ""));
  } catch (error) {
    if (response.headersSent) return true;
    const problem = toProblem(error);
    if (problem) {
      sendProblem(response, problem);
      return true;
    }
    logger.error("request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(response, 500, { error: "The workspace request failed." });
  }

  return true;
}
