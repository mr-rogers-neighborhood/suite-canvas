import type { ServerResponse } from "node:http";
import { HttpError } from "../errors.js";
import { sendJson } from "../respond.js";
import { notifyRemoved } from "../shareHooks.js";
import type { AdminRequestDeps } from "./deps.js";
import { audit, notifyChanged, publicShare, workspaceExists } from "./deps.js";

/**
 * Link inventory and the revoke paths, which run the same host hooks a revoke
 * through the share API runs.
 */

export function listWorkspaceShares(
  response: ServerResponse,
  deps: AdminRequestDeps,
  url: URL,
): void {
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) throw HttpError.badRequest("A workspaceId query parameter is required.");
  sendJson(response, 200, {
    workspaceId,
    shares: deps.shares.list(workspaceId).map(publicShare),
  });
}

/* ---------------------------------- mutations --------------------------------- */

/** Body cap for mutation calls; every body here is a small object. */
export function revokeOneShare(
  response: ServerResponse,
  deps: AdminRequestDeps,
  shareId: string,
  url: URL,
): void {
  const existing = deps.shares.get(shareId);
  if (!existing) throw HttpError.notFound("Share not found.");
  const share = deps.shares.revoke(shareId);
  if (!share) throw HttpError.notFound("Share not found.");

  const revoked = existing.revokedAt === null ? 1 : 0;
  if (revoked === 1) {
    notifyRemoved(deps, share);
    notifyChanged(deps, share.workspaceId);
  }

  audit(deps, {
    path: url.pathname,
    target: share.id,
    action: "revoke-share",
    outcome: revoked === 1 ? "revoked" : "already-revoked",
    details: { workspaceId: share.workspaceId, revoked },
  });
  sendJson(response, 200, {
    ok: true,
    workspaceId: share.workspaceId,
    revoked,
    share: publicShare(share),
  });
}

/** Revokes every active link of a workspace, for incident response. */
export function revokeWorkspaceShares(
  response: ServerResponse,
  deps: AdminRequestDeps,
  url: URL,
): void {
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  if (workspaceId.length === 0) {
    throw HttpError.badRequest("A workspaceId query parameter is required.");
  }
  if (!workspaceExists(deps, workspaceId)) throw HttpError.notFound("Workspace not found.");

  const revoked = deps.shares.revokeAll(workspaceId);
  for (const share of revoked) notifyRemoved(deps, share);
  notifyChanged(deps, workspaceId);

  audit(deps, {
    path: url.pathname,
    target: workspaceId,
    action: "revoke-workspace-shares",
    outcome: "revoked",
    details: { revoked: revoked.length },
  });
  sendJson(response, 200, {
    ok: true,
    workspaceId,
    revoked: revoked.length,
    shares: revoked.map(publicShare),
  });
}

/**
 * Forgets the owner hash so the next open claims the workspace with whatever
 * key that browser presents. The work itself is `admin reset-owner`'s, so the
 * CLI and this endpoint can never drift apart.
 */
