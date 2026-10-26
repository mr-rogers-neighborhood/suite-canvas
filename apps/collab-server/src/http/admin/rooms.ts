import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProjectionRoomStats } from "../../projection/index.js";
import { HttpError } from "../errors.js";
import { sendJson } from "../respond.js";
import type { AdminRequestDeps, AdminRoomRow } from "./deps.js";
import { audit, closedSessions, readBody } from "./deps.js";

/**
 * Room inventory for the sync server and the projection worker, plus the two
 * operator seams that close a room or sweep the idle ones.
 */

export function roomRows(deps: AdminRequestDeps): AdminRoomRow[] {
  return (deps.rooms?.() ?? []).map((room) => {
    const row: AdminRoomRow = { roomId: room.roomId, clients: room.clients };
    if (room.authKinds) {
      const kinds = room.authKinds;
      row.authKinds = {
        account: kinds.account,
        share: kinds.share,
        internal: kinds.internal,
        anonymous: kinds.anonymous,
      };
    }
    return row;
  });
}

/**
 * Socket rooms (when the sync server can enumerate them) next to the rooms the
 * projection worker holds. The two lists answer different questions, so they
 * are kept apart and labelled instead of being merged.
 */
export function roomsBody(deps: AdminRequestDeps) {
  const projectionRooms = (deps.projectionRooms?.() ?? []).map((room) => ({
    roomId: room.roomId,
    shareId: room.shareId,
    workspaceId: room.workspaceId,
    role: room.role,
    hasBaseline: room.hasBaseline,
    dirty: room.dirty,
  }));
  return {
    rooms: roomRows(deps),
    projectionRooms,
    note: "projectionRooms are the rooms the projection worker holds for active links; they are not every socket room.",
  };
}

/**
 * Room accounting as `status` reports it, or nothing at all when the caller has
 * no projection worker. `documentBytes` is the worker's estimate of what the
 * open projection documents hold; `limit` is `SUITE_PROJECTION_ROOMS_MAX`.
 */
export function projectionStatsOf(deps: AdminRequestDeps): { projections?: ProjectionRoomStats } {
  const stats = deps.projectionStats?.();
  if (!stats) return {};
  return {
    projections: {
      open: stats.open,
      limit: stats.limit,
      opened: stats.opened,
      evicted: stats.evicted,
      refused: stats.refused,
      documentBytes: stats.documentBytes,
    },
  };
}

export async function sweepProjectionRooms(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
  url: URL,
): Promise<void> {
  if (!deps.sweepRooms) {
    throw HttpError.notImplemented("This server cannot sweep projection rooms.");
  }
  const dryRun = await dryRunFlag(request, url);
  const report = await deps.sweepRooms({ dryRun });
  audit(deps, {
    path: url.pathname,
    target: "projection-rooms",
    action: "sweep-rooms",
    outcome: dryRun ? "dry-run" : "swept",
    details: {
      idleHours: report.idleHours,
      checked: report.checked,
      unknown: report.unknown,
      closed: dryRun ? 0 : report.rooms.length,
      candidates: report.rooms.length,
    },
  });
  sendJson(response, 200, {
    ok: true,
    dryRun,
    idleHours: report.idleHours,
    checked: report.checked,
    unknown: report.unknown,
    closed: report.rooms,
  });
}

/** A `dryRun` flag from the query string or the JSON body; the body wins. */
export async function dryRunFlag(request: IncomingMessage, url: URL): Promise<boolean> {
  const query = url.searchParams.get("dryRun")?.trim().toLowerCase() ?? "";
  let dryRun = query === "1" || query === "true" || query === "yes";
  const fromBody = (await readBody(request))?.dryRun;
  if (fromBody !== undefined) {
    if (typeof fromBody !== "boolean") {
      throw HttpError.badRequest("dryRun must be true or false.");
    }
    dryRun = fromBody;
  }
  return dryRun;
}

/** Closes every session in a room; the counting seam the patched server exposes. */
export function disconnectRoomSessions(
  response: ServerResponse,
  deps: AdminRequestDeps,
  roomId: string,
  url: URL,
): void {
  if (!deps.disconnectRoom) {
    throw HttpError.notImplemented("This server cannot close room sessions.");
  }
  const closed = closedSessions(deps, roomId);
  audit(deps, {
    path: url.pathname,
    target: roomId,
    action: "disconnect-room",
    outcome: "closed",
    details: { closed },
  });
  sendJson(response, 200, { ok: true, roomId, closed });
}

/* ---------------------------------- fixtures ---------------------------------- */
