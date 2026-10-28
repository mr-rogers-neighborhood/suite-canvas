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
import type { LicenceClaimStore } from "../../store/licenceClaims.js";
import type { DocumentInventory, DocumentStore } from "../../store/persistence.js";
import type { SettingsStore } from "../../store/settings.js";
import type { Share, ShareStore } from "../../store/shares.js";
import { SHARE_ROOM_PREFIX } from "../../store/shares.js";
import type { WorkspaceOrgStore } from "../../store/workspaceOrgs.js";
import { HttpError } from "../errors.js";
import { methodNotAllowed } from "../respond.js";
import type { SessionVerifier } from "../sessionToken.js";
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
  account: number;
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
   * Which organization the relay recorded for each workspace. Read-only here: an
   * operator may inspect and delete, and ownership itself is the control plane's
   * row (ADR-0065), never an admin mutation.
   */
  orgs: Pick<WorkspaceOrgStore, "has">;
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
  /**
   * Verifies the operator's session JWT. Required by the router, which will not serve
   * one of these routes without it: an operator is an account the control plane signed
   * for, and this is the only thing that can say so.
   */
  sessions: SessionVerifier;
  /** Structured log destination; the audit line never carries a credential. */
  logger?: Logger;
  /** Effective limits; resolved fresh per call so an override applies at once. */
  limits?: () => ResolvedLimits;
  /** Runtime override store; without it `PUT /api/admin/limits` answers 501. */
  settings?: SettingsStore;
  /** Per-workspace budgets, including a hosted licence's cap. */
  quotas?: QuotaService;
  /**
   * The workspace licence rows the quota service reads.
   *
   * Writable here so the gate can be driven from the admin panel: a past-due licence is an
   * expired row, and a cancelled one is no row at all, so testing a plan state needs no
   * payment provider.
   */
  licences?: Pick<LicenceClaimStore, "get" | "record" | "remove"> | null;
  /** Current document-store bytes, shared with the quota service's cache. */
  diskBytes?: () => number;
  /** Collector rendered by `GET /metrics`; defaults to the process-wide one. */
  metrics?: MetricsCollector;
  /**
   * The credential that made this request, as a label. The router sets it on a
   * per-request copy of these deps; nothing else may, so an audit line cannot
   * name an actor that did not present a session.
   */
  actor?: string;
  /**
   * The single audit row this request will write. The router creates it for a
   * mutating call, handlers fill it in through `audit()`, and the router writes
   * it once the answer is known — so one mutation is one row, whatever happens
   * inside.
   */
  audit?: AdminAuditRow;
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

/** The one row a mutating admin request writes: who, what, where, and how it ended. */
export interface AdminAuditRow {
  /** The credential's label, never the credential. */
  actor: string;
  /** The verb, e.g. `delete-workspace`. */
  action: string;
  /** The id the verb applied to. */
  target: string;
  /** `ok`, `refused` or `failed`, plus any handler-specific word. */
  result: string;
  /** Free-form detail a handler added; never a credential or a document body. */
  details: Record<string, unknown>;
}

/** A fresh row for one request, before the router knows how it ended. */
export function beginAudit(actor: string): AdminAuditRow {
  return { actor, action: "", target: "", result: "ok", details: {} };
}

/**
 * Writes the row. Called once per mutating request by the router, after the
 * answer is known; `deps.audit` is the same object the handlers filled in.
 *
 * The entry `path` is logged alongside, so an operator can find the route, but
 * the four fields an audit depends on are actor, action, target and result.
 */
export function writeAudit(deps: AdminRequestDeps, row: AdminAuditRow, path: string): void {
  const logger = deps.logger ?? auditLogger;
  try {
    logger.info("admin.mutation", {
      actor: row.actor,
      action: row.action,
      target: row.target,
      result: row.result,
      path,
      ...row.details,
    });
  } catch {
    // An audit row must never fail the request it describes.
  }
}

/**
 * Notes what a handler did, into the row the router will write.
 *
 * A handler calls this with the same fields it always used; without a draft (a
 * handler invoked directly by a test, say) the row is written immediately so a
 * mutation never goes unrecorded.
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
  const row = deps.audit;
  if (row !== undefined) {
    row.action = entry.action;
    if (entry.target.length > 0) row.target = entry.target;
    row.result = entry.outcome;
    Object.assign(row.details, entry.details ?? {});
    return;
  }
  writeAudit(
    deps,
    {
      actor: deps.actor ?? "operator",
      action: entry.action,
      target: entry.target,
      result: entry.outcome,
      details: { ...entry.details },
    },
    entry.path,
  );
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
