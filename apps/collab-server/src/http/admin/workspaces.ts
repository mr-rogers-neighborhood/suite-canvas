import type { IncomingMessage, ServerResponse } from "node:http";
import { WorkspaceDocument } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { deleteWorkspace, resetOwner } from "../../ops/admin.js";
import { loadLoroDocument } from "../../projection/index.js";
import type { DocumentInventory } from "../../store/persistence.js";
import { HttpError } from "../errors.js";
import { sendJson } from "../respond.js";
import { notifyRemoved } from "../shareHooks.js";
import type { AdminRequestDeps, AdminWorkspaceRow, StoredWorkspace } from "./deps.js";
import {
  audit,
  closedSessions,
  DEFAULT_ADMIN_PAGE,
  MAX_ADMIN_PAGE,
  mutationPaths,
  notifyChanged,
  pageNumber,
  publicShare,
  readBody,
  workspaceExists,
  workspaceIdOf,
} from "./deps.js";
import { countersOf, effectiveLimits, schemaVersionOf, versionsOf } from "./status.js";

/**
 * Workspace inventory and the destructive workspace mutations.
 */

export function storedWorkspaces(documents: AdminRequestDeps["documents"]): StoredWorkspace[] {
  const byId = new Map<string, StoredWorkspace>();
  let entries: ReturnType<DocumentInventory["list"]> = [];
  try {
    entries = documents.list?.() ?? [];
  } catch {
    return [];
  }
  for (const entry of entries) {
    const id = workspaceIdOf(entry.name);
    if (!id) continue;
    const current = byId.get(id);
    if (!current || entry.updatedAt > current.lastSavedAt) {
      byId.set(id, { id, lastSavedAt: Number(entry.updatedAt) });
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.lastSavedAt - a.lastSavedAt || a.id.localeCompare(b.id),
  );
}

export function loadWorkspace(documents: AdminRequestDeps["documents"], id: string) {
  const state = loadLoroDocument(documents, id);
  if (!state) return null;
  const doc = new LoroDoc();
  try {
    doc.import(state);
  } catch {
    return { bytes: state.byteLength, workspace: null, doc: null };
  }
  return { bytes: state.byteLength, workspace: new WorkspaceDocument(doc), doc };
}

export function claimedOf(deps: AdminRequestDeps, id: string): boolean {
  try {
    return deps.workspaces.has(id);
  } catch {
    return false;
  }
}

export function sharesOf(deps: AdminRequestDeps, id: string): number {
  try {
    return deps.shares.countActive(id);
  } catch {
    return 0;
  }
}

export function workspaceRow(deps: AdminRequestDeps, stored: StoredWorkspace): AdminWorkspaceRow {
  const loaded = loadWorkspace(deps.documents, stored.id);
  const documentBytes = loaded?.bytes ?? 0;
  const budget =
    deps.quotas?.documentBudget(stored.id) ??
    effectiveLimits(deps).limits.documentBytesPerWorkspace;
  return {
    id: stored.id,
    claimed: claimedOf(deps, stored.id),
    documentBytes,
    overQuota: documentBytes > budget,
    ...countersOf(loaded?.workspace ?? null),
    shares: sharesOf(deps, stored.id),
    lastSavedAt: stored.lastSavedAt,
  };
}

/** Effective limits: the server's resolver when wired, else defaults plus env. */
export function listWorkspaces(response: ServerResponse, deps: AdminRequestDeps, url: URL): void {
  const limit = pageNumber(url.searchParams.get("limit"), DEFAULT_ADMIN_PAGE, MAX_ADMIN_PAGE);
  const offset = pageNumber(url.searchParams.get("offset"), 0);
  const stored = storedWorkspaces(deps.documents);
  const page = stored.slice(offset, offset + limit);
  sendJson(response, 200, {
    workspaces: page.map((entry) => workspaceRow(deps, entry)),
    total: stored.length,
    diskBytes: deps.diskBytes?.() ?? deps.documents.size?.() ?? 0,
  });
}

export function workspaceDetail(
  response: ServerResponse,
  deps: AdminRequestDeps,
  workspaceId: string,
): void {
  const stored = storedWorkspaces(deps.documents).find((entry) => entry.id === workspaceId);
  if (!stored) {
    if (!claimedOf(deps, workspaceId)) throw HttpError.notFound("Not found.");
    sendJson(response, 200, {
      id: workspaceId,
      claimed: true,
      documentBytes: 0,
      overQuota: false,
      cards: 0,
      boards: 0,
      sections: 0,
      types: 0,
      tags: 0,
      shares: sharesOf(deps, workspaceId),
      lastSavedAt: null,
      shareList: deps.shares.list(workspaceId).map(publicShare),
      versions: {},
      schemaVersion: null,
    });
    return;
  }

  const loaded = loadWorkspace(deps.documents, workspaceId);
  sendJson(response, 200, {
    ...workspaceRow(deps, stored),
    shareList: deps.shares.list(workspaceId).map(publicShare),
    versions: versionsOf(loaded?.doc ?? null),
    schemaVersion: schemaVersionOf(loaded?.doc ?? null),
  });
}

export async function resetWorkspaceOwner(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
  workspaceId: string,
  url: URL,
): Promise<void> {
  const body = await readBody(request);
  const raw = body?.revokeShares;
  if (raw !== undefined && typeof raw !== "boolean") {
    throw HttpError.badRequest("revokeShares must be true or false.");
  }
  const revokeShares = raw === true;

  if (!workspaceExists(deps, workspaceId)) throw HttpError.notFound("Workspace not found.");
  // Captured before the CLI code rewrites the rows, so the hooks still know
  // which live projection rooms belong to the shares that just went away.
  const activeShares = revokeShares ? deps.shares.list(workspaceId) : [];

  const messages: string[] = [];
  const result = resetOwner(mutationPaths(deps), workspaceId, {
    revokeShares,
    log: (line) => messages.push(line),
  });

  if (revokeShares) {
    for (const share of activeShares) notifyRemoved(deps, share);
    notifyChanged(deps, workspaceId);
  }

  audit(deps, {
    path: url.pathname,
    target: workspaceId,
    action: "reset-owner",
    outcome: "owner-key-removed",
    details: { revokeShares, ...result },
  });
  sendJson(response, 200, {
    ok: true,
    workspaceId,
    revokeShares,
    ...result,
    messages,
  });
}

/**
 * Deletes everything the relay stores for a workspace by running the CLI's
 * `delete`, then the same hooks a revoke would have run. The body must repeat
 * the workspace id, so a stray request cannot wipe a workspace.
 */
export async function deleteWorkspaceData(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
  workspaceId: string,
  url: URL,
): Promise<void> {
  const body = await readBody(request);
  const confirm = body?.confirm;
  if (typeof confirm !== "string" || confirm.trim() !== workspaceId) {
    audit(deps, {
      path: url.pathname,
      target: workspaceId,
      action: "delete-workspace",
      outcome: "rejected",
      details: { reason: "confirmation-mismatch" },
    });
    throw HttpError.badRequest(
      `Deleting a workspace requires {"confirm":"${workspaceId}"} in the request body.`,
    );
  }
  if (!workspaceExists(deps, workspaceId)) throw HttpError.notFound("Workspace not found.");

  const activeShares = deps.shares.list(workspaceId);
  const messages: string[] = [];
  const result = deleteWorkspace(mutationPaths(deps), workspaceId, {
    log: (line) => messages.push(line),
  });

  for (const share of activeShares) notifyRemoved(deps, share);
  notifyChanged(deps, workspaceId);
  let closed = 0;
  try {
    closed = closedSessions(deps, workspaceId);
  } catch {
    // The delete is committed either way; the sockets die with their credentials.
  }

  audit(deps, {
    path: url.pathname,
    target: workspaceId,
    action: "delete-workspace",
    outcome: "deleted",
    details: { ...result, closedSessions: closed },
  });
  sendJson(response, 200, {
    ok: true,
    workspaceId,
    ...result,
    closedSessions: closed,
    messages,
  });
}

/**
 * `POST /api/admin/rooms/sweep` revokes the links of projection rooms nobody
 * touched for the idle window (`SUITE_ROOM_IDLE_HOURS`). `?dryRun=1` — or
 * `{"dryRun":true}` in the body — reports the candidates without closing them.
 * What was closed comes back as `closed`; each room's documents and draft
 * baseline go with it, through the same revoke path an operator revoke takes.
 */
