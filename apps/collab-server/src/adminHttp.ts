import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createWorkspaceFile,
  documentAttachments,
  WorkspaceDocument,
  type WorkspaceFileAttachmentInput,
} from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { type AdminPaths, adminPaths, deleteWorkspace, resetOwner } from "./admin.js";
import type { AttachmentStore } from "./attachments.js";
import { serverVersion } from "./config.js";
import {
  applyCors,
  CORS_HEADERS,
  HttpError,
  methodNotAllowed,
  sendEmpty,
  sendJson,
} from "./http.js";
import {
  LIMIT_ENV,
  LIMIT_KEYS,
  type LimitKey,
  limitsProblem,
  parseLimitOverrides,
  publicLimits,
  type QuotaService,
  type ResolvedLimits,
  readLimitOverrides,
  resolveLimits,
  writeLimitOverrides,
} from "./limits.js";
import { createLogger, type Logger } from "./logging.js";
import { type MetricsCollector, metrics as processMetrics, readProcessRss } from "./metrics.js";
import type { DocumentInventory, DocumentStore } from "./persistence.js";
import {
  loadLoroDocument,
  loroDocumentKey,
  type ProjectionRoomInfo,
  type ProjectionRoomStats,
  type RoomSweepReport,
} from "./projectionWorker.js";
import { clientAddress, createRateLimiter } from "./rateLimit.js";
import type { SettingsStore } from "./settings.js";
import { MAX_SELECTION_CARDS, SHARE_ROOM_PREFIX, type Share, type ShareStore } from "./shares.js";
import type { WorkspaceRegistry } from "./workspaces.js";

export const ADMIN_API_PATH = "/api/admin";

/**
 * Prometheus scrape path. It sits beside `/api/admin/*` rather than under it
 * because a scraper is configured with one URL, but it is gated by exactly the
 * same token: unset means 404, a wrong token means 401.
 */
export const METRICS_PATH = "/metrics";

/** Largest page `/api/admin/workspaces` will return, whatever `limit` asks. */
export const MAX_ADMIN_PAGE = 200;
const DEFAULT_ADMIN_PAGE = 50;
/** Mirrors `MAX_ACTIVE_SHARES` in http.ts, which owns the creation cap. */
const DEFAULT_SHARES_PER_WORKSPACE = 100;
/** Mirrors the windows in rateLimit.ts; only their per-minute limits are reported. */
const DEFAULT_PUBLISH_PER_MINUTE = 20;
const DEFAULT_CLAIM_PER_MINUTE = 600;
const DEFAULT_ADMIN_PER_MINUTE = 300;

/**
 * Upper bounds of one fixture run. They keep a reproduction call small enough
 * to stay a reproduction: a fixture larger than this is load testing, not a
 * bug report.
 */
export const FIXTURE_CAPS = {
  boards: 50,
  cards: 2_000,
  sections: 200,
  shares: 20,
} as const;

const BEARER = /^bearer\s+(.+)$/iu;

const adminLimiter = createRateLimiter(
  envLimit("SUITE_ADMIN_RATE_LIMIT", DEFAULT_ADMIN_PER_MINUTE),
  60_000,
);
const processStartedAt = Date.now() - Math.round(process.uptime() * 1000);

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

interface AdminDatabaseRow {
  path?: string;
  bytes: number;
  ok: boolean;
}

interface AdminWorkspaceRow {
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

interface WorkspaceCounters {
  cards: number;
  boards: number;
  sections: number;
  types: number;
  tags: number;
}

interface StoredWorkspace {
  id: string;
  lastSavedAt: number;
}

function envLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** The configured operator token, or "" when the admin API is switched off. */
function adminToken(): string {
  return process.env.SUITE_ADMIN_TOKEN?.trim() ?? "";
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return null;
  const match = BEARER.exec(value.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, "The workspace identifier is malformed.");
  }
}

function pageNumber(raw: string | null, fallback: number, max?: number): number {
  if (raw === null || raw.trim().length === 0) return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new HttpError(400, "limit and offset must be integers.");
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value)) throw new HttpError(400, "limit and offset must be integers.");
  return max === undefined ? value : Math.min(value, max);
}

/**
 * The room id a stored document key belongs to, or null when the key is not a
 * workspace room. Share projections live under `share-` rooms and are excluded.
 */
function workspaceIdOf(name: string): string | null {
  const separator = name.indexOf(":");
  if (separator <= 0) return null;
  const roomId = name.slice(separator + 1);
  if (roomId.length === 0 || roomId.startsWith(SHARE_ROOM_PREFIX)) return null;
  return roomId;
}

/** Workspace ids the store holds, newest save first, without loading any state. */
function storedWorkspaces(documents: AdminRequestDeps["documents"]): StoredWorkspace[] {
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

function loadWorkspace(documents: AdminRequestDeps["documents"], id: string) {
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

function countersOf(workspace: WorkspaceDocument | null): WorkspaceCounters {
  if (!workspace) return { cards: 0, boards: 0, sections: 0, types: 0, tags: 0 };
  return {
    cards: workspace.listCards().length,
    boards: workspace.listViews().length,
    sections: workspace.listSections().length,
    types: workspace.listTypes().length,
    tags: workspace.listTags().length,
  };
}

function claimedOf(deps: AdminRequestDeps, id: string): boolean {
  try {
    return deps.workspaces.has(id);
  } catch {
    return false;
  }
}

function sharesOf(deps: AdminRequestDeps, id: string): number {
  try {
    return deps.shares.countActive(id);
  } catch {
    return 0;
  }
}

function workspaceRow(deps: AdminRequestDeps, stored: StoredWorkspace): AdminWorkspaceRow {
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
function effectiveLimits(deps: AdminRequestDeps): ResolvedLimits {
  return deps.limits?.() ?? resolveLimits(process.env, null);
}

/** Overrides as JSON: `Infinity` is "unlimited" on disk and null in a response. */
function publicOverrides(
  overrides: Partial<Record<LimitKey, number>>,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const key of LIMIT_KEYS) {
    const value = overrides[key];
    if (value === undefined) continue;
    out[key] = Number.isFinite(value) ? value : null;
  }
  return out;
}

/** Effective limits, their source, the disk reading and the overrides in force. */
function limitsBody(deps: AdminRequestDeps) {
  const resolved = effectiveLimits(deps);
  const contradiction = limitsProblem(resolved.limits);
  const problems = [...resolved.problems];
  if (contradiction !== null) problems.push(contradiction);
  let overrides: Record<string, number | null> = {};
  if (deps.settings) {
    try {
      overrides = publicOverrides(readLimitOverrides(deps.settings));
    } catch {
      overrides = {};
    }
  }
  return {
    ok: true,
    hosted: process.env.SUITE_HOSTED === "1",
    limits: publicLimits(resolved.limits),
    sources: resolved.sources,
    env: LIMIT_ENV,
    overrides,
    diskBytes: deps.diskBytes?.() ?? deps.documents.size?.() ?? 0,
    problems,
  };
}

/** The limits route answers `PUT` too, so its CORS methods differ from the rest. */
function sendLimits(response: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    ...CORS_HEADERS,
    "access-control-allow-methods": "GET, PUT, OPTIONS",
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(json)),
  });
  response.end(json);
}

/**
 * The public view of a share: never the room id (a projection room embeds the
 * raw link token) and never a token hash.
 */
function publicShare(share: Share) {
  return {
    id: share.id,
    scope: share.scope,
    role: share.role,
    boardId: share.boardId,
    cardId: share.cardId,
    cardIds: share.cardIds,
    cardCount: share.cardCount,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
  };
}

function databaseRow(path: string | undefined, fallback?: () => number): AdminDatabaseRow {
  if (path !== undefined && path.length > 0) {
    try {
      return { path, bytes: statSync(path).size, ok: true };
    } catch {
      return { path, bytes: 0, ok: false };
    }
  }
  if (fallback) {
    try {
      return { bytes: fallback(), ok: true };
    } catch {
      return { bytes: 0, ok: false };
    }
  }
  return { bytes: 0, ok: false };
}

/**
 * The process's resident set size, or null when it cannot be read. A zero
 * reading is treated as "unknown" rather than published: no process uses zero
 * bytes, and a zero is what makes an operator believe a broken gauge.
 */
function rssBytesOf(deps: AdminRequestDeps): number | null {
  let value: number | null;
  try {
    value = (deps.rssBytes ?? readProcessRss)();
  } catch {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

/** The Loro peers of a workspace, or an empty map when its state is unreadable. */
function versionsOf(doc: LoroDoc | null): Record<string, number> {
  if (!doc) return {};
  const versions: Record<string, number> = {};
  for (const [peer, counter] of doc.oplogVersion().toJSON()) {
    versions[String(peer)] = Number(counter);
  }
  return versions;
}

function schemaVersionOf(doc: LoroDoc | null): number | null {
  if (!doc) return null;
  const value = doc.getMap(WorkspaceDocument.META_KEY).get("schemaVersion");
  return typeof value === "number" ? value : null;
}

function roomRows(deps: AdminRequestDeps): AdminRoomRow[] {
  return (deps.rooms?.() ?? []).map((room) => {
    const row: AdminRoomRow = { roomId: room.roomId, clients: room.clients };
    if (room.authKinds) {
      const kinds = room.authKinds;
      row.authKinds = {
        owner: kinds.owner,
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
function roomsBody(deps: AdminRequestDeps) {
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
function projectionStatsOf(deps: AdminRequestDeps): { projections?: ProjectionRoomStats } {
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

function statusBody(deps: AdminRequestDeps) {
  const rooms = roomRows(deps);
  const clamp = (value: number | undefined): number =>
    Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
  return {
    ok: true,
    version: serverVersion(),
    uptimeMs: Math.max(0, Date.now() - (deps.startedAt ?? processStartedAt)),
    node: process.version,
    pid: process.pid,
    rssBytes: rssBytesOf(deps),
    databases: {
      documents: databaseRow(deps.paths?.documents, () => deps.documents.size?.() ?? 0),
      shares: databaseRow(deps.paths?.shares),
      workspaces: databaseRow(deps.paths?.workspaces),
    },
    // `total` counts socket rooms, which the sync server can only enumerate on
    // some versions; projections are always known and are the number that
    // actually drives memory, so report them separately rather than letting a
    // bare zero imply the process holds no rooms at all.
    rooms: {
      total: rooms.length,
      workers: rooms.filter((room) => (room.authKinds?.internal ?? 0) > 0).length,
      clients: rooms.reduce((sum, room) => sum + clamp(room.clients), 0),
      projections: (deps.projectionRooms?.() ?? []).length,
    },
    // `opened` is the boot cost: it stays at zero on a restart with thousands of
    // stored links, and a number that grows with the link count is the signal
    // that rooms are being opened for existing rather than for being read.
    ...projectionStatsOf(deps),
    limits: {
      sharesPerWorkspace: envLimit("SUITE_MAX_SHARES_PER_WORKSPACE", DEFAULT_SHARES_PER_WORKSPACE),
      selectionCards: MAX_SELECTION_CARDS,
      publishPerMinute: envLimit("SUITE_PUBLISH_RATE_LIMIT", DEFAULT_PUBLISH_PER_MINUTE),
      claimPerMinute: envLimit("SUITE_CLAIM_RATE_LIMIT", DEFAULT_CLAIM_PER_MINUTE),
    },
    admin: { enabled: true as const },
  };
}

/**
 * Validates and stores runtime overrides. Unknown keys, non-numeric values and
 * a configuration that contradicts itself are all refused with the reason, so a
 * typo cannot silently stop a quota from firing. Every attempt is audited.
 */
async function updateLimits(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
  url: URL,
): Promise<void> {
  if (!deps.settings) {
    throw new HttpError(
      501,
      "Runtime limit overrides need a settings store; set SUITE_SETTINGS_DB.",
    );
  }
  const body = await readBody(request);
  const envelope = body?.overrides;
  const raw =
    typeof envelope === "object" && envelope !== null && !Array.isArray(envelope) ? envelope : body;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "The request body must be a JSON object of limits.");
  }

  const parsed = parseLimitOverrides(raw);
  if (parsed.problem !== null) {
    audit(deps, {
      path: url.pathname,
      target: "limits",
      action: "limits.update",
      outcome: "rejected",
      details: { reason: parsed.problem },
    });
    throw new HttpError(400, parsed.problem);
  }

  const changes = Object.keys(parsed.changes) as LimitKey[];
  if (changes.length === 0) {
    throw new HttpError(400, "No limits were given. Send at least one known limit key.");
  }

  const next = { ...readLimitOverrides(deps.settings) };
  for (const key of changes) {
    const value = parsed.changes[key];
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }

  const check = resolveLimits(process.env, next);
  const problem = limitsProblem(check.limits) ?? check.problems[0] ?? null;
  if (problem !== null) {
    audit(deps, {
      path: url.pathname,
      target: "limits",
      action: "limits.update",
      outcome: "rejected",
      details: { reason: problem },
    });
    throw new HttpError(400, problem);
  }

  writeLimitOverrides(deps.settings, next);
  audit(deps, {
    path: url.pathname,
    target: "limits",
    action: "limits.update",
    outcome: "updated",
    details: { changed: publicOverrides(next) },
  });
  sendLimits(response, 200, { ...limitsBody(deps), overrides: publicOverrides(next) });
}

function listWorkspaces(response: ServerResponse, deps: AdminRequestDeps, url: URL): void {
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

function workspaceDetail(
  response: ServerResponse,
  deps: AdminRequestDeps,
  workspaceId: string,
): void {
  const stored = storedWorkspaces(deps.documents).find((entry) => entry.id === workspaceId);
  if (!stored) {
    if (!claimedOf(deps, workspaceId)) throw new HttpError(404, "Not found.");
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

function listShares(response: ServerResponse, deps: AdminRequestDeps, url: URL): void {
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) throw new HttpError(400, "A workspaceId query parameter is required.");
  sendJson(response, 200, {
    workspaceId,
    shares: deps.shares.list(workspaceId).map(publicShare),
  });
}

/* ---------------------------------- mutations --------------------------------- */

/** Body cap for mutation calls; every body here is a small object. */
const MAX_ADMIN_BODY_BYTES = 64 * 1024;

const auditLogger = createLogger().child({ component: "admin" });

/** An empty body reads as null; anything but a JSON object is a 400. */
async function readBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > MAX_ADMIN_BODY_BYTES) {
      throw new HttpError(413, "The request body is too large.");
    }
    chunks.push(buffer);
  }
  if (size === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The request body must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * One line per mutation: the admin path, what it targeted and how it ended.
 * The bearer token is not a parameter here, so it cannot reach the line.
 */
function audit(
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

function requireMethod(
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
function mutationPaths(deps: AdminRequestDeps): AdminPaths {
  const fallback = adminPaths();
  return {
    documents: deps.paths?.documents ?? fallback.documents,
    shares: deps.paths?.shares ?? fallback.shares,
    workspaces: deps.paths?.workspaces ?? fallback.workspaces,
  };
}

/** A workspace is known when it is claimed, stored, or has an active link. */
function workspaceExists(deps: AdminRequestDeps, workspaceId: string): boolean {
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
function notifyRemoved(deps: AdminRequestDeps, share: Share): void {
  try {
    deps.onShareRemoved?.(share);
  } catch {
    // The row is already revoked; the next projection pass reconciles the rest.
  }
}

function notifyChanged(deps: AdminRequestDeps, workspaceId: string): void {
  try {
    deps.onSharesChanged?.(workspaceId);
  } catch {
    // Same as above: a rebuild hint must not fail the mutation.
  }
}

function closedSessions(deps: AdminRequestDeps, roomId: string): number {
  const closed = deps.disconnectRoom?.(roomId) ?? 0;
  return Number.isFinite(closed) ? Math.max(0, Math.floor(closed)) : 0;
}

/** Revokes one link through the store, then runs the share API's revoke hooks. */
function revokeOneShare(
  response: ServerResponse,
  deps: AdminRequestDeps,
  shareId: string,
  url: URL,
): void {
  const existing = deps.shares.get(shareId);
  if (!existing) throw new HttpError(404, "Share not found.");
  const share = deps.shares.revoke(shareId);
  if (!share) throw new HttpError(404, "Share not found.");

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
function revokeWorkspaceShares(response: ServerResponse, deps: AdminRequestDeps, url: URL): void {
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  if (workspaceId.length === 0) {
    throw new HttpError(400, "A workspaceId query parameter is required.");
  }
  if (!workspaceExists(deps, workspaceId)) throw new HttpError(404, "Workspace not found.");

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
async function resetWorkspaceOwner(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
  workspaceId: string,
  url: URL,
): Promise<void> {
  const body = await readBody(request);
  const raw = body?.revokeShares;
  if (raw !== undefined && typeof raw !== "boolean") {
    throw new HttpError(400, "revokeShares must be true or false.");
  }
  const revokeShares = raw === true;

  if (!workspaceExists(deps, workspaceId)) throw new HttpError(404, "Workspace not found.");
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
async function deleteWorkspaceData(
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
    throw new HttpError(
      400,
      `Deleting a workspace requires {"confirm":"${workspaceId}"} in the request body.`,
    );
  }
  if (!workspaceExists(deps, workspaceId)) throw new HttpError(404, "Workspace not found.");

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
async function sweepProjectionRooms(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
  url: URL,
): Promise<void> {
  if (!deps.sweepRooms) {
    throw new HttpError(501, "This server cannot sweep projection rooms.");
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
async function dryRunFlag(request: IncomingMessage, url: URL): Promise<boolean> {
  const query = url.searchParams.get("dryRun")?.trim().toLowerCase() ?? "";
  let dryRun = query === "1" || query === "true" || query === "yes";
  const fromBody = (await readBody(request))?.dryRun;
  if (fromBody !== undefined) {
    if (typeof fromBody !== "boolean") {
      throw new HttpError(400, "dryRun must be true or false.");
    }
    dryRun = fromBody;
  }
  return dryRun;
}

/** Closes every session in a room; the counting seam the patched server exposes. */
function disconnectRoomSessions(
  response: ServerResponse,
  deps: AdminRequestDeps,
  roomId: string,
  url: URL,
): void {
  if (!deps.disconnectRoom) {
    throw new HttpError(501, "This server cannot close room sessions.");
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

interface FixtureShare {
  scope: Share["scope"];
  token: string;
  url: string;
}

/** A fixture count from the body, or a readable 400 when it is out of range. */
function fixtureCount(
  body: Record<string, unknown> | null,
  key: keyof typeof FIXTURE_CAPS,
  fallback: number,
  min: number,
): number {
  const raw = body?.[key];
  if (raw === undefined || raw === null) return fallback;
  const cap = FIXTURE_CAPS[key];
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > cap) {
    throw new HttpError(400, `${key} must be a whole number between ${min} and ${cap}.`);
  }
  return raw;
}

/**
 * The fixture workspace id: the caller's, or a fresh one. A `share-` prefix is
 * refused because room names with that prefix are projection rooms, not
 * workspaces, and a fixture must never masquerade as one.
 */
function fixtureWorkspaceId(body: Record<string, unknown> | null): string {
  const raw = body?.workspaceId;
  if (raw === undefined || raw === null) return `fixture-${randomUUID()}`;
  if (typeof raw !== "string") throw new HttpError(400, "workspaceId must be a string.");
  const id = raw.trim();
  if (id.length === 0) return `fixture-${randomUUID()}`;
  if (id.length > 512) throw new HttpError(400, "workspaceId is longer than 512 characters.");
  if (id.startsWith(SHARE_ROOM_PREFIX)) {
    throw new HttpError(400, `workspaceId must not start with "${SHARE_ROOM_PREFIX}".`);
  }
  return id;
}

/** Where a fixture link should point: an explicit public URL, else the caller's origin. */
function publicOrigin(request: IncomingMessage): string {
  const configured = process.env.SUITE_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/u, "");
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin.length > 0) return origin.replace(/\/+$/u, "");
  return "http://localhost:5173";
}

function fixtureShareUrl(origin: string, token: string): string {
  let url: URL;
  try {
    url = new URL(origin.endsWith("/") ? origin : `${origin}/`);
  } catch {
    // A malformed SUITE_PUBLIC_URL must not fail a fixture call.
    url = new URL("http://localhost:5173/");
  }
  url.searchParams.set("share", token);
  return url.toString();
}

/** Cycles a non-empty list; throws only if a caller broke that invariant. */
function cycle<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length];
  if (value === undefined) throw new Error("fixture list was empty");
  return value;
}

/**
 * Builds a disposable workspace (or appends to an existing one) through the
 * public `WorkspaceDocument` API, then saves it through the same document store
 * the sync server uses. Everything is created with explicit ids derived from a
 * per-run token, so ids are reproducible within a run and unique across runs.
 */
async function createFixtures(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
  url: URL,
): Promise<void> {
  const body = await readBody(request);
  const workspaceId = fixtureWorkspaceId(body);
  const numberOfBoards = fixtureCount(body, "boards", 1, 1);
  const numberOfCards = fixtureCount(body, "cards", 10, 0);
  const numberOfSections = fixtureCount(body, "sections", 0, 0);
  const numberOfShares = fixtureCount(body, "shares", 0, 0);

  // Claim before seeding: a key that cannot be handed back must fail the call
  // before it leaves half a fixture in the store.
  const claimed = claimedOf(deps, workspaceId);
  let ownerKey: string | null = null;

  const stored = loadLoroDocument(deps.documents, workspaceId);
  const doc = new LoroDoc();
  if (stored) {
    try {
      doc.import(stored);
    } catch {
      throw new HttpError(409, "The stored workspace state could not be read; choose another id.");
    }
  }

  if (!claimed) {
    const claim = deps.workspaces.claimOrVerify;
    if (!claim) throw new HttpError(501, "This server cannot claim workspaces.");
    const candidate = randomBytes(32).toString("base64url");
    if (claim(workspaceId, candidate) !== "owner") {
      throw new HttpError(409, "The workspace is already claimed.");
    }
    ownerKey = candidate;
  }

  const workspace = new WorkspaceDocument(doc);
  workspace.ensureDefaultTypes();

  const run = randomUUID().replace(/-/gu, "").slice(0, 12);
  const boardIds: string[] = [];
  for (let index = 0; index < numberOfBoards; index += 1) {
    const id = `fx-${run}-b${index + 1}`;
    workspace.createView({ id, name: `Fixture board ${index + 1}` });
    boardIds.push(id);
  }

  const cardIds: string[] = [];
  for (let index = 0; index < numberOfCards; index += 1) {
    const id = `fx-${run}-c${index + 1}`;
    // Row-major grid inside each board: six cards per row, 280px apart.
    const slot = Math.floor(index / numberOfBoards);
    workspace.createCard({
      id,
      boardId: cycle(boardIds, index),
      position: { x: (slot % 6) * 280, y: Math.floor(slot / 6) * 200 },
    });
    cardIds.push(id);
  }

  const sectionIds: string[] = [];
  for (let index = 0; index < numberOfSections; index += 1) {
    const id = `fx-${run}-s${index + 1}`;
    workspace.createSection({
      id,
      boardId: cycle(boardIds, index),
      title: `Fixture section ${index + 1}`,
      x: (index % 4) * 360,
      y: Math.floor(index / 4) * 320,
    });
    sectionIds.push(id);
  }
  if (!workspace.hasSeeded()) workspace.markSeeded();

  const createdShares: FixtureShare[] = [];
  if (numberOfShares > 0) {
    const create = deps.shares.create;
    if (!create) throw new HttpError(501, "This server cannot create share links.");
    const origin = publicOrigin(request);
    for (let index = 0; index < numberOfShares; index += 1) {
      // Every third link targets one card, the rest a board; a workspace with
      // no cards still gets board links. All are viewers, as fixtures are for
      // reproduction, not for testing what an editor may publish.
      const input =
        cardIds.length > 0 && index % 3 === 2
          ? {
              workspaceId,
              scope: "card" as const,
              role: "viewer" as const,
              cardId: cycle(cardIds, index),
            }
          : {
              workspaceId,
              scope: "board" as const,
              role: "viewer" as const,
              boardId: cycle(boardIds, index),
            };
      const created = create(input);
      createdShares.push({
        scope: input.scope,
        token: created.token,
        url: fixtureShareUrl(origin, created.token),
      });
    }
  }

  deps.documents.save(loroDocumentKey(workspaceId), workspace.doc.export({ mode: "snapshot" }));
  if (createdShares.length > 0) notifyChanged(deps, workspaceId);

  audit(deps, {
    path: url.pathname,
    target: workspaceId,
    action: "create-fixtures",
    outcome: "created",
    details: {
      seeded: stored !== null,
      boards: boardIds.length,
      cards: cardIds.length,
      sections: sectionIds.length,
      shares: createdShares.length,
    },
  });
  sendJson(response, 200, {
    ok: true,
    workspaceId,
    ownerKey,
    boards: boardIds,
    cards: cardIds,
    sections: sectionIds,
    shares: createdShares,
  });
}

/**
 * Downloads the stored snapshot as the `.suite` envelope the app already reads,
 * so an operator can reproduce a bug locally with the workspace it came from.
 *
 * Images are gathered from the same walker the app's export uses, so an image
 * this box holds ends up in the file byte-for-byte. An id whose bytes are gone
 * is skipped rather than failing the whole export: a partial reprex is still
 * better than none, and the document keeps the node either way.
 */
function exportWorkspace(
  response: ServerResponse,
  deps: AdminRequestDeps,
  workspaceId: string,
): void {
  const loaded = loadWorkspace(deps.documents, workspaceId);
  if (!loaded) throw new HttpError(404, "Workspace not found.");
  if (!loaded.workspace) {
    throw new HttpError(500, "The stored workspace state could not be read.");
  }

  const attachments: Record<string, WorkspaceFileAttachmentInput> = {};
  const store = deps.attachments;
  if (store) {
    for (const node of documentAttachments(loaded.workspace)) {
      const record = store.get(node.id);
      if (!record) continue;
      // The store holds bytes and a mime type, not a filename; the node's own
      // attributes are the only source for the name and dimensions the editor
      // drew, so they win and the store is the fallback for a node without them.
      attachments[node.id] = {
        mime: node.mime ?? record.mime,
        name: node.name ?? "",
        width: node.width,
        height: node.height,
        bytes: record.bytes,
      };
    }
  }

  const { json } = createWorkspaceFile(
    workspaceId,
    loaded.workspace,
    new Date().toISOString(),
    attachments,
  );
  const stem = workspaceId.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 96) || "workspace";
  response.writeHead(200, {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="suite-${stem}.suite"`,
    "content-length": String(Buffer.byteLength(json)),
  });
  response.end(json);
}

/** The Prometheus text body, never cached: a stale scrape is worse than no scrape. */
function sendMetrics(response: ServerResponse, collector: MetricsCollector): void {
  const body = collector.prometheus();
  response.writeHead(200, {
    ...CORS_HEADERS,
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body)),
  });
  response.end(body);
}

/**
 * Read-only operator API plus the controlled mutations behind the same token,
 * and the Prometheus scrape at `GET /metrics`. Like the share and workspace
 * handlers, it returns false when the path is not its own. Both routes only
 * exist while `SUITE_ADMIN_TOKEN` is set: an unconfigured server answers 404,
 * never 401. There is no owner-key path to a mutation or to a scrape: only the
 * bearer token above reaches any of them.
 */
export async function handleAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const isMetrics = url.pathname === METRICS_PATH;
  if (
    !isMetrics &&
    url.pathname !== ADMIN_API_PATH &&
    !url.pathname.startsWith(`${ADMIN_API_PATH}/`)
  ) {
    return false;
  }

  const token = adminToken();
  if (token.length === 0) return false;

  applyCors(request, response);
  const method = request.method ?? "GET";
  if (method === "OPTIONS") {
    sendEmpty(response, 204);
    return true;
  }

  try {
    const budget = adminLimiter.take(clientAddress(request));
    if (!budget.ok) {
      response.setHeader("retry-after", String(budget.retryAfter));
      throw new HttpError(429, "Too many admin requests. Wait a moment and try again.");
    }

    const presented = bearerToken(request);
    if (presented === null || !constantTimeEqual(presented, token)) {
      throw new HttpError(401, "A valid admin token is required.");
    }

    if (isMetrics) {
      requireMethod(response, method, "GET");
      sendMetrics(response, deps.metrics ?? processMetrics);
      return true;
    }

    const segment = url.pathname.slice(ADMIN_API_PATH.length).replace(/^\//, "");
    if (segment.length === 0) throw new HttpError(404, "Not found.");
    const parts = segment.split("/").map(decodeSegment);
    const [route = "", second, third] = parts;

    if (route === "status") {
      if (parts.length !== 1) throw new HttpError(404, "Not found.");
      requireMethod(response, method, "GET");
      sendJson(response, 200, statusBody(deps));
      return true;
    }

    if (route === "fixtures") {
      if (parts.length !== 1) throw new HttpError(404, "Not found.");
      requireMethod(response, method, "POST");
      await createFixtures(request, response, deps, url);
      return true;
    }

    if (route === "limits") {
      if (parts.length !== 1) throw new HttpError(404, "Not found.");
      requireMethod(response, method, "GET", "PUT");
      if (method === "PUT") {
        await updateLimits(request, response, deps, url);
        return true;
      }
      sendLimits(response, 200, limitsBody(deps));
      return true;
    }

    if (route === "rooms") {
      if (parts.length === 1) {
        requireMethod(response, method, "GET");
        sendJson(response, 200, roomsBody(deps));
        return true;
      }
      if (parts.length === 2 && second === "sweep") {
        requireMethod(response, method, "POST");
        await sweepProjectionRooms(request, response, deps, url);
        return true;
      }
      if (parts.length === 3 && second?.length && third === "disconnect") {
        requireMethod(response, method, "POST");
        disconnectRoomSessions(response, deps, second, url);
        return true;
      }
      throw new HttpError(404, "Not found.");
    }

    if (route === "shares") {
      if (parts.length === 1) {
        requireMethod(response, method, "GET", "DELETE");
        if (method === "DELETE") {
          revokeWorkspaceShares(response, deps, url);
          return true;
        }
        listShares(response, deps, url);
        return true;
      }
      if (parts.length === 3 && second?.length && third === "revoke") {
        requireMethod(response, method, "POST");
        revokeOneShare(response, deps, second, url);
        return true;
      }
      throw new HttpError(404, "Not found.");
    }

    if (route === "workspaces") {
      if (parts.length === 1) {
        requireMethod(response, method, "GET");
        listWorkspaces(response, deps, url);
        return true;
      }
      if (parts.length === 2 && second?.length) {
        requireMethod(response, method, "GET", "DELETE");
        if (method === "DELETE") {
          await deleteWorkspaceData(request, response, deps, second, url);
          return true;
        }
        workspaceDetail(response, deps, second);
        return true;
      }
      if (parts.length === 3 && second?.length && third === "export") {
        requireMethod(response, method, "GET");
        exportWorkspace(response, deps, second);
        return true;
      }
      if (parts.length === 3 && second?.length && third === "reset-owner") {
        requireMethod(response, method, "POST");
        await resetWorkspaceOwner(request, response, deps, second, url);
        return true;
      }
      throw new HttpError(404, "Not found.");
    }

    throw new HttpError(404, "Not found.");
  } catch (error) {
    if (response.headersSent) return true;
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return true;
    }
    (deps.logger ?? auditLogger).error("request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(response, 500, { error: "The admin request failed." });
  }

  return true;
}
