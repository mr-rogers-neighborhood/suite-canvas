import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "../logging.js";
import { type AdminPaths, adminPaths, deleteWorkspace } from "../ops/admin.js";
import type { LicenceClaimStore } from "../store/licenceClaims.js";
import type { WorkspaceAccess } from "./access.js";
import type { AccessDecision } from "./auth.js";
import { HttpError, toProblem } from "./errors.js";
import { clientAddress, rotateLimiter } from "./rateLimit.js";
import { bearerToken, readJsonBody } from "./request.js";
import { applyCors, methodNotAllowed, sendEmpty, sendJson, sendProblem } from "./respond.js";

/**
 * The workspace routes that survive the owner key (ADR-0076).
 *
 * There is exactly one route: the workspace delete. Claim, rotate and status
 * are gone with the key they were built around — a workspace's organization is
 * recorded by the first verified session that opens it (`access.ts`), a
 * credential is never rotated by this process (the control plane's session TTL
 * bounds it), and the client reads its quota from the same session it syncs
 * with.
 *
 * The delete takes two credentials, because it has two callers. An account
 * presents its session and deletes what it owns. The control plane, executing
 * an account erasure, has no session to present and no browser to ask, so it
 * presents `SUITE_RELAY_PURGE_TOKEN`: one operation, the purge of the workspace
 * named in the path, and nothing on `/api/admin/*`. A dedicated token rather
 * than an operator session, because the identity process should not hold the
 * relay's root key: a bug in the account service would otherwise reach every
 * workspace's limits, rooms and links.
 */
const logger = createLogger().child({ component: "workspaces" });

export const WORKSPACE_API_PATH = "/api/workspaces";

/**
 * Where the service credential is read. Both the relay and the control plane
 * read this name, so one secret is configured once on each side.
 */
export const PURGE_TOKEN_ENV = "SUITE_RELAY_PURGE_TOKEN";

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

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
  /**
   * The credential a peer service presents instead of an account session.
   *
   * Defaults to `SUITE_RELAY_PURGE_TOKEN`, read here rather than passed in from
   * `sync/server.ts`, for the same reason `storage` defaults to `adminPaths()`:
   * the route's service half is configuration, and a deployment that sets the
   * variable does not also have to change the server's wiring. Unset means no
   * service call is accepted, so a relay that never asked for one cannot be
   * purged by a token nobody configured.
   */
  purgeToken?: string;
  /**
   * The attachment bytes the workspace owns. A workspace export carries its
   * images, so an erasure that left the bytes behind would be a delete in name
   * only: `gc` with no referenced ids removes every row of that workspace.
   */
  attachments?: { gc: (workspaceId: string, referencedIds: Iterable<string>) => number } | null;
}

export interface WorkspaceRequestDeps extends WorkspaceRequestHooks {
  /** The session credential and the organization the workspace belongs to. */
  access: WorkspaceAccess;
  /**
   * The socket's own credential decision for a workspace, reason included.
   *
   * Omitted, the access route answers 404: a deployment that never wired the
   * decision has nothing to explain, and inventing an answer would be worse than
   * saying nothing.
   */
  decide?: (workspaceId: string, token: string) => Promise<AccessDecision>;
  /**
   * Whether the relay holds anything for this workspace, for a readable 404.
   * Omitted, the delete is attempted and reports the zero rows it removed.
   */
  exists?: (workspaceId: string) => boolean;
  /** Drops the workspace's recorded organization, so a re-claim starts clean. */
  forgetWorkspace?: (workspaceId: string) => void;
}

/**
 * `GET /api/workspaces/:id/access` — may this credential sync here, and if not,
 * why not.
 *
 * The socket answers a refusal with "authentication failed" and nothing else,
 * which is how a plan that does not cover a workspace and a session that expired
 * came to read as the same sentence. This route runs the same decision and
 * returns the reason, so the client can say something true and actionable.
 *
 * A missing credential is `no-credential` rather than a 401: the caller asked a
 * question about a workspace, not for access to one, and the answer is the point.
 */
async function explain(
  request: IncomingMessage,
  response: ServerResponse,
  deps: WorkspaceRequestDeps,
  workspaceId: string,
): Promise<void> {
  const decide = deps.decide;
  if (decide === undefined) throw HttpError.notFound("Not found.");
  if (workspaceId.trim().length === 0)
    throw HttpError.badRequest("The workspace identifier is empty.");
  const decision = await decide(workspaceId.trim(), bearerToken(request) ?? "");
  // Always 200: the caller asked what the answer is, and a refusal is an answer
  // with a reason in it, not an HTTP failure.
  sendJson(
    response,
    200,
    decision.ok
      ? { ok: true, permission: decision.permission }
      : { ok: false, reason: decision.reason },
  );
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
 * Deletes a workspace on the account's own authority — or on the control plane's.
 *
 * ## Two callers, one implementation
 *
 * An account deletes on the session JWT in the `Authorization` header, checked
 * against the organization the relay recorded for this workspace. The body
 * repeats the workspace id, so a stray request cannot wipe a workspace it did
 * not name.
 *
 * The control plane deletes on the purge token, while running an account
 * erasure: it holds the account's rows, not its session, so there is no JWT to
 * present. The shape is the same, so the body still repeats the id and the
 * counts are the same counts. Two differences, and both are about convergence:
 * the purge is not charged to the per-address delete budget (one account can
 * own more workspaces than that budget allows per minute, and stopping halfway
 * would leave a half-erased account), and a purge of a workspace the relay no
 * longer holds answers zero rows instead of 404 (a retry after a partial
 * failure has to succeed, not report "not found" at the caller that already
 * deleted the row it learned the id from).
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
  const id = workspaceId.trim();
  // The control plane presents a token, not a session. Checked before the rate
  // budget, because which credential arrived decides whether that budget applies.
  const serviceToken = (deps.purgeToken ?? process.env[PURGE_TOKEN_ENV] ?? "").trim();
  const presented = bearerToken(request);
  const service = presented !== null && sameSecret(presented, serviceToken);

  // Deletion spends the rate budget that rotation used to: both were rare,
  // destructive operations, and a flood of either must not reach the database.
  // An account erasure is not that flood: it is one process deleting the
  // workspaces of one account, and its budget is the control plane's own.
  if (!service) {
    const removal = rotateLimiter.take(clientAddress(request));
    if (!removal.ok) {
      throw HttpError.rateLimited(
        removal.retryAfter,
        "Too many workspace deletions. Wait a moment and try again.",
      );
    }
  }

  // Authorization first: an unknown workspace and someone else's workspace must
  // look the same from outside, and only an entitled account learns the
  // difference (its organization is recorded, so the 404 below is its own data).
  const principal = service ? null : await deps.access.forWorkspace(request, id);
  // A purge answers zero rows for a workspace already gone: the caller deleted
  // its own row for that workspace, so "not found" here would be the one answer
  // that cannot converge on a retry.
  if (!service && deps.exists !== undefined && !deps.exists(id)) {
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
  // No card survives the delete, so every attachment row of the workspace is
  // unreferenced by construction.
  const attachmentRows = deps.attachments?.gc(id, []) ?? 0;
  deps.forgetWorkspace?.(id);

  // The host still runs its own hook below; this line is the only record that the
  // delete came from a service rather than from the account it belonged to.
  if (service) {
    logger.info("workspace purged by a service", {
      workspaceId: id,
      documents: result.documents + result.projected,
      shares: result.shares + result.baselines,
      attachments: attachmentRows,
    });
  }

  sendJson(response, 200, {
    workspaceId: id,
    deleted: true,
    // A service call names no account: it has no principal to report.
    organizationId: principal?.organizationId ?? null,
    ...result,
    licenceRows,
    // Rows, not bytes: on the disk store a row *is* its bytes, and an object
    // store's `gc` counts the objects it deleted.
    attachments: attachmentRows,
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
    // `GET /api/workspaces/:id/access` explains a refused connection;
    // `DELETE /api/workspaces/:id` is the account's own delete. Every other
    // method and shape is a 404: the routes that used to live here are gone.
    if (parts.length === 2 && parts[1] === "access") {
      if (method !== "GET") {
        methodNotAllowed(response, "GET, OPTIONS");
        return true;
      }
      await explain(request, response, deps, decodeSegment(parts[0] ?? ""));
      return true;
    }
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
