import { statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WorkspaceDocument } from "@suite/graph";
import type { LoroDoc } from "loro-crdt";
import { serverVersion } from "../../config/config.js";
import type { LimitKey, ResolvedLimits } from "../../config/limits.js";
import {
  LIMIT_ENV,
  LIMIT_KEYS,
  limitsProblem,
  parseLimitOverrides,
  publicLimits,
  readLimitOverrides,
  resolveLimits,
  writeLimitOverrides,
} from "../../config/limits.js";
import type { MetricsCollector } from "../../ops/metrics.js";
import { readProcessRss } from "../../ops/metrics.js";
import { MAX_SELECTION_CARDS } from "../../store/shares.js";
import { HttpError } from "../errors.js";
import { CORS_HEADERS } from "../respond.js";
import type { AdminDatabaseRow, AdminRequestDeps, WorkspaceCounters } from "./deps.js";
import { audit, envLimit, processStartedAt, readBody } from "./deps.js";
import { projectionStatsOf, roomRows } from "./rooms.js";

/**
 * `/api/admin/status`, the limits view and the Prometheus scrape: what the
 * process is holding, never what it contains.
 */

export const DEFAULT_SHARES_PER_WORKSPACE = 100;
/** Mirrors the windows in rateLimit.ts; only their per-minute limits are reported. */
export const DEFAULT_PUBLISH_PER_MINUTE = 20;

export const DEFAULT_CLAIM_PER_MINUTE = 600;

export function countersOf(workspace: WorkspaceDocument | null): WorkspaceCounters {
  if (!workspace) return { cards: 0, boards: 0, sections: 0, types: 0, tags: 0 };
  return {
    cards: workspace.listCards().length,
    boards: workspace.listBoards().length,
    sections: workspace.listSections().length,
    types: workspace.listTypes().length,
    tags: workspace.listTags().length,
  };
}

export function effectiveLimits(deps: AdminRequestDeps): ResolvedLimits {
  return deps.limits?.() ?? resolveLimits(process.env, null);
}

/** Overrides as JSON: `Infinity` is "unlimited" on disk and null in a response. */
export function publicOverrides(
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
export function limitsBody(deps: AdminRequestDeps) {
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
export function sendLimits(response: ServerResponse, status: number, body: unknown): void {
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
export function databaseRow(path: string | undefined, fallback?: () => number): AdminDatabaseRow {
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
export function rssBytesOf(deps: AdminRequestDeps): number | null {
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
export function versionsOf(doc: LoroDoc | null): Record<string, number> {
  if (!doc) return {};
  const versions: Record<string, number> = {};
  for (const [peer, counter] of doc.oplogVersion().toJSON()) {
    versions[String(peer)] = Number(counter);
  }
  return versions;
}

export function schemaVersionOf(doc: LoroDoc | null): number | null {
  if (!doc) return null;
  const value = doc.getMap(WorkspaceDocument.META_KEY).get("schemaVersion");
  return typeof value === "number" ? value : null;
}

export function statusBody(deps: AdminRequestDeps) {
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
export async function updateLimits(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
  url: URL,
): Promise<void> {
  if (!deps.settings) {
    throw HttpError.notImplemented(
      "Runtime limit overrides need a settings store; set SUITE_SETTINGS_DB.",
    );
  }
  const body = await readBody(request);
  const envelope = body?.overrides;
  const raw =
    typeof envelope === "object" && envelope !== null && !Array.isArray(envelope) ? envelope : body;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw HttpError.badRequest("The request body must be a JSON object of limits.");
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
    throw HttpError.badRequest(parsed.problem);
  }

  const changes = Object.keys(parsed.changes) as LimitKey[];
  if (changes.length === 0) {
    throw HttpError.badRequest("No limits were given. Send at least one known limit key.");
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
    throw HttpError.badRequest(problem);
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

export function sendMetrics(response: ServerResponse, collector: MetricsCollector): void {
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
 * exist while a control plane is configured: a server with no identity answers 404,
 * never 401. There is no owner-key path to a mutation or to a scrape: only the
 * bearer token above reaches any of them.
 */
