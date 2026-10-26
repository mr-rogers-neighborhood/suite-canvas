import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pick } from "remeda";
import type { QuotaService, ResolvedLimits } from "../../config/limits.js";
import type { Logger } from "../../logging.js";
import { createLogger } from "../../logging.js";
import type { AdminPaths } from "../../ops/admin.js";
import { adminPaths } from "../../ops/admin.js";
import type { MetricsCollector } from "../../ops/metrics.js";
import type {
  ProjectionRoomInfo,
  ProjectionRoomStats,
  RoomSweepReport,
} from "../../projection/index.js";
import type { AttachmentStore } from "../../store/attachments.js";
import type { DocumentInventory, DocumentStore } from "../../store/persistence.js";
import type { SettingsStore } from "../../store/settings.js";
import type { Share, ShareStore } from "../../store/shares.js";
import { SHARE_ROOM_PREFIX } from "../../store/shares.js";
import type { WorkspaceRegistry } from "../../store/workspaces.js";
import { HttpError } from "../errors.js";
import { methodNotAllowed } from "../respond.js";
import { claimedOf, storedWorkspaces } from "./workspaces.js";

/**
 * What the admin routes are handed, plus the small helpers every resource
 * shares: request bodies, path segments, audit lines and the mapping from a
 * stored workspace to a row.
 */
export const auditLogger = createLogger().child({ component: "admin" });

/** Body cap for mutation calls; every body here is a small object. */
const MAX_ADMIN_BODY_BYTES = 64 * 1024;

export const MAX_ADMIN_PAGE = 200;

export const DEFAULT_ADMIN_PAGE = 50;
/** Mirrors `MAX_ACTIVE_SHARES` in http.ts, which owns the creation cap. */
export interface AdminDatabasePaths {
  documents?: string;
  shares?: string;
  workspaces?: string;
}

/** Auth kinds of a room's sessions; counts only, never a credential. */
export interface AdminAuthKinds {
  owner: number;
  share: number;
  internal: number;
  anonymous: number;
}

export interface AdminRoomRow {
  roomId: string;
  clients: number;
  authKinds?: AdminAuthKinds;
}

export interface AdminRequestDeps {
  /** Document store; the inventory accessors are optional for test doubles. */
  documents: DocumentStore & Partial<DocumentInventory>;
  /**
   * Share store. `create` is only needed by the fixture endpoint; the wiring in
   * server.ts passes the whole store, so the optional member is always present
   * in production and an older test double still typechecks.
   */
  shares: Pick<ShareStore, "list" | "countActive" | "get" | "revoke" | "revokeAll"> &
    Partial<Pick<ShareStore, "create">>;
  /**
   * Owner registry. `claimOrVerify` lets a fixture mint a workspace plus a key
   * that can actually open it; without it the fixture endpoint answers 501.
   */
  workspaces: Pick<WorkspaceRegistry, "has"> & Partial<Pick<WorkspaceRegistry, "claimOrVerify">>;
  /** Database files, reported by `status` when known. */
  paths?: AdminDatabasePaths;
  /** Process start, epoch milliseconds; defaults to this module's load time. */
  startedAt?: number;
  /**
   * Rooms the sync server can report. Omitted when it exposes no room API, in
   * which case the socket half of `/api/admin/rooms` is an empty list instead
   * of guesses.
   */
  rooms?: () => readonly AdminRoomRow[] | undefined;
  /**
   * Rooms the projection worker holds. It is the only component that knows a
   * share room's workspace, role and draft state, so the inventory is read
   * from it rather than reconstructed from the stores.
   */
  projectionRooms?: () => readonly ProjectionRoomInfo[] | undefined;
  /**
   * The worker's room accounting: open rooms, the ceiling, opens since boot and
   * the bytes those documents hold. Optional so a caller without a projection
   * worker keeps the smaller status body rather than a block of zeros.
   */
  projectionStats?: () => ProjectionRoomStats | undefined;
  /**
   * The server's own revocation hook: closes the revoked share's viewers and
   * drops its projected document. Wiring it here makes an admin revoke behave
   * exactly like one made through the share API.
   */
  onShareRemoved?: (share: Share) => void;
  /** Rebuilds a workspace's projections after its shares changed. */
  onSharesChanged?: (workspaceId: string) => void;
  /**
   * Closes every session in a room and returns how many were closed. Provided
   * by the patched `SimpleServer.disconnectRoomWhere(roomId, () => true)`.
   */
  disconnectRoom?: (roomId: string) => number;
  /** Structured log destination; the audit line never carries a credential. */
  logger?: Logger;
  /** Effective limits; resolved fresh per call so an override applies at once. */
  limits?: () => ResolvedLimits;
  /** Runtime override store; without it `PUT /api/admin/limits` answers 501. */
  settings?: SettingsStore;
  /** Per-workspace budgets, including a hosted licence's cap. */
  quotas?: QuotaService;
  /** Current document-store bytes, shared with the quota service's cache. */
  diskBytes?: () => number;
  /** Collector rendered by `GET /metrics`; defaults to the process-wide one. */
  metrics?: MetricsCollector;
  /**
   * Resident set size reader for `status`; defaults to
   * `process.memoryUsage().rss` through the metrics module, so the JSON and the
   * scrape cannot disagree.
   */
  rssBytes?: () => number | null;
  /**
   * Revokes the links of projection rooms nobody has used for the idle window.
   * Without the worker that owns them there is nothing to sweep, so the route
   * answers 501 instead of pretending to have looked.
   */
  sweepRooms?: (options: { dryRun: boolean }) => Promise<RoomSweepReport> | RoomSweepReport;
  /**
   * Attachment bytes, so a bug-report export is as complete as the app's own
   * backup. Without it the export still succeeds but every image node is left
   * without its bytes, and the operator gets a workspace they cannot reproduce
   * with — the reason `createWorkspaceFile` takes the map at all.
   */
  attachments?: Pick<AttachmentStore, "get">;
}

export interface AdminDatabaseRow {
  path?: string;
  bytes: number;
  ok: boolean;
}

export interface AdminWorkspaceRow {
  id: string;
  claimed: boolean;
  documentBytes: number;
  /** True when the document exceeds its budget; saves are still accepted. */
  overQuota: boolean;
  cards: number;
  boards: number;
  sections: number;
  types: number;
  tags: number;
  shares: number;
  lastSavedAt: number | null;
}

export interface WorkspaceCounters {
  cards: number;
  boards: number;
  sections: number;
  types: number;
  tags: number;
}

export interface StoredWorkspace {
  id: string;
  lastSavedAt: number;
}

export const processStartedAt = Date.now() - Math.round(process.uptime() * 1000);

export function envLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** The configured operator token, or "" when the admin API is switched off. */
export function adminToken(): string {
  return process.env.SUITE_ADMIN_TOKEN?.trim() ?? "";
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw HttpError.badRequest("The workspace identifier is malformed.");
  }
}

export function pageNumber(raw: string | null, fallback: number, max?: number): number {
  if (raw === null || raw.trim().length === 0) return fallback;
  if (!/^\d+$/.test(raw.trim())) throw HttpError.badRequest("limit and offset must be integers.");
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value))
    throw HttpError.badRequest("limit and offset must be integers.");
  return max === undefined ? value : Math.min(value, max);
}

/**
 * The room id a stored document key belongs to, or null when the key is not a
 * workspace room. Share projections live under `share-` rooms and are excluded.
 */
export async function readBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > MAX_ADMIN_BODY_BYTES) {
      throw HttpError.payloadTooLarge("The request body is too large.");
    }
    chunks.push(buffer);
  }
  if (size === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw HttpError.badRequest("The request body must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw HttpError.badRequest("The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * One line per mutation: the admin path, what it targeted and how it ended.
 * The bearer token is not a parameter here, so it cannot reach the line.
 */
export function audit(
  deps: AdminRequestDeps,
  entry: {
    path: string;
    target: string;
    action: string;
    outcome: string;
    details?: Record<string, unknown>;
  },
): void {
  const logger = deps.logger ?? auditLogger;
  try {
    logger.info("admin.mutation", {
      path: entry.path,
      target: entry.target,
      action: entry.action,
      outcome: entry.outcome,
      ...entry.details,
    });
  } catch {
    // An audit line must never fail the request it describes.
  }
}

export function requireMethod(
  response: ServerResponse,
  method: string,
  ...allowed: readonly string[]
): void {
  if (allowed.includes(method)) return;
  methodNotAllowed(response, [...allowed, "OPTIONS"].join(", "));
}

/**
 * The database files a CLI-backed mutation must edit. `deps.paths` is what the
 * running server configured; the environment only fills gaps in test doubles.
 */
export function mutationPaths(deps: AdminRequestDeps): AdminPaths {
  const fallback = adminPaths();
  return {
    documents: deps.paths?.documents ?? fallback.documents,
    shares: deps.paths?.shares ?? fallback.shares,
    workspaces: deps.paths?.workspaces ?? fallback.workspaces,
  };
}

/** A workspace is known when it is claimed, stored, or has an active link. */
export function workspaceExists(deps: AdminRequestDeps, workspaceId: string): boolean {
  if (claimedOf(deps, workspaceId)) return true;
  try {
    if (deps.shares.list(workspaceId).length > 0) return true;
  } catch {
    // An unreadable share table only removes evidence, never invents it.
  }
  return storedWorkspaces(deps.documents).some((entry) => entry.id === workspaceId);
}

/**
 * Runs the server's own revocation hook, which disconnects the viewers and
 * deletes the projection. A failed hook must not turn a committed revoke into
 * an error response.
 */
export function notifyRemoved(deps: AdminRequestDeps, share: Share): void {
  try {
    deps.onShareRemoved?.(share);
  } catch {
    // The row is already revoked; the next projection pass reconciles the rest.
  }
}

export function notifyChanged(deps: AdminRequestDeps, workspaceId: string): void {
  try {
    deps.onSharesChanged?.(workspaceId);
  } catch {
    // Same as above: a rebuild hint must not fail the mutation.
  }
}

export function closedSessions(deps: AdminRequestDeps, roomId: string): number {
  const closed = deps.disconnectRoom?.(roomId) ?? 0;
  return Number.isFinite(closed) ? Math.max(0, Math.floor(closed)) : 0;
}

/** Revokes one link through the store, then runs the share API's revoke hooks. */
export function publicShare(share: Share) {
  return pick(share, [
    "id",
    "scope",
    "role",
    "boardId",
    "cardId",
    "cardIds",
    "cardCount",
    "createdAt",
    "expiresAt",
    "revokedAt",
  ]);
}

export function workspaceIdOf(name: string): string | null {
  const separator = name.indexOf(":");
  if (separator <= 0) return null;
  const roomId = name.slice(separator + 1);
  if (roomId.length === 0 || roomId.startsWith(SHARE_ROOM_PREFIX)) return null;
  return roomId;
}

/** An empty body reads as null; anything but a JSON object is a 400. */
