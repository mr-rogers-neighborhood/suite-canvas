import type { IncomingMessage, ServerResponse } from "node:http";
import type { SharePublishResult, ShareStatus } from "./projectionWorker.js";
import {
  type CreateShareInput,
  type Share,
  type ShareRole,
  type ShareScope,
  type ShareStore,
  validateShareInput,
} from "./shares.js";
import type { WorkspaceRegistry } from "./workspaces.js";

export const SHARE_API_PATH = "/api/shares";

export interface ShareRequestHooks {
  /**
   * Called after a share is created or revoked so board and card projections can
   * follow. Optional: the share API works without a projection worker.
   */
  onSharesChanged?: (workspaceId: string) => void;
  /**
   * Publishes an editor's draft. `version` is the share document's version
   * vector as the editor saw it, so the worker can wait for the draft to arrive.
   * `overwrite` names the conflicting keys whose draft value wins.
   */
  publish?: (
    share: Share,
    version?: Record<string, number>,
    overwrite?: readonly string[],
  ) => Promise<SharePublishResult> | SharePublishResult;
  /** Discards an editor's draft and rebuilds it from the workspace. */
  reload?: (share: Share) => Promise<SharePublishResult> | SharePublishResult;
  /** Whether the share's draft holds unpublished changes. */
  status?: (share: Share) => Promise<ShareStatus> | ShareStatus;
}

function notify(hooks: ShareRequestHooks | undefined, workspaceId: string): void {
  try {
    hooks?.onSharesChanged?.(workspaceId);
  } catch (error) {
    console.error("[shares] change hook failed", error);
  }
}

const MAX_BODY_BYTES = 64 * 1024;

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-suite-owner",
  "access-control-max-age": "86400",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, CORS_HEADERS);
  response.end();
}

async function readBodyBuffer(request: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "The request body is too large.");
    }
    chunks.push(buffer);
  }

  return size === 0 ? null : Buffer.concat(chunks);
}

function parseJson(buffer: Buffer): unknown {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new HttpError(400, "The request body must be valid JSON.");
  }
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const buffer = await readBodyBuffer(request);
  if (!buffer) throw new HttpError(400, "A JSON body is required.");
  return parseJson(buffer);
}

/** Like `readJsonBody`, but a request with no body is allowed. */
async function readOptionalJsonBody(request: IncomingMessage): Promise<unknown> {
  const buffer = await readBodyBuffer(request);
  return buffer ? parseJson(buffer) : undefined;
}

/** A parsed publish body: the version gate and the optional resolution set. */
interface PublishPayload {
  version?: Record<string, number>;
  overwrite?: string[];
}

/**
 * Reads `{ version?: { <peer>: <counter> }, overwrite?: string[] }` from a
 * publish body. The version is how the editor gates its own publish: the worker
 * must hold that draft before it plans, or it would publish a stale room.
 * `overwrite` names the conflicts whose draft value wins; an empty list is a
 * valid "keep every workspace value" decision.
 */
function parsePublishPayload(body: unknown): PublishPayload {
  if (body === undefined) return {};
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "The request body must be a JSON object.");
  }

  const record = body as Record<string, unknown>;
  const payload: PublishPayload = {};

  const rawVersion = record.version;
  if (rawVersion !== undefined && rawVersion !== null) {
    if (typeof rawVersion !== "object" || Array.isArray(rawVersion)) {
      throw new HttpError(400, "version must be an object of peer counters.");
    }

    const version: Record<string, number> = {};
    for (const [peer, counter] of Object.entries(rawVersion)) {
      if (typeof counter !== "number" || !Number.isSafeInteger(counter) || counter < 0) {
        throw new HttpError(400, "version counters must be non-negative integers.");
      }
      version[peer] = counter;
    }
    payload.version = version;
  }

  const rawOverwrite = record.overwrite;
  if (rawOverwrite !== undefined && rawOverwrite !== null) {
    if (!Array.isArray(rawOverwrite)) {
      throw new HttpError(400, "overwrite must be an array of conflict keys.");
    }
    const overwrite: string[] = [];
    for (const entry of rawOverwrite) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        throw new HttpError(400, "overwrite entries must be non-empty strings.");
      }
      overwrite.push(entry);
    }
    payload.overwrite = overwrite;
  }

  return payload;
}

const BEARER = /^bearer\s+(.+)$/iu;

/** The bearer credential a request presents, without the legacy header fallback. */
function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return null;
  const match = BEARER.exec(value.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * The owner key a management request presents. `Authorization: Bearer` is the
 * documented form; `x-suite-owner` stays accepted for older editors.
 */
function ownerKeyFrom(request: IncomingMessage): string | null {
  const key = bearerToken(request);
  if (key) return key;
  const fallback = request.headers["x-suite-owner"];
  const alternate = Array.isArray(fallback) ? fallback[0] : fallback;
  const value = alternate?.trim();
  return value && value.length > 0 ? value : null;
}

/**
 * Share management is owner-only. A share token is a capability for one room;
 * it must never mint or revoke links, because the workspace id alone used to be
 * enough to manage them.
 */
function requireOwner(
  request: IncomingMessage,
  workspaces: Pick<WorkspaceRegistry, "verify">,
  workspaceId: string,
): void {
  const ownerKey = ownerKeyFrom(request);
  if (!ownerKey) throw new HttpError(401, "An owner key is required to manage links.");

  let owns = false;
  try {
    owns = workspaces.verify(workspaceId, ownerKey);
  } catch {
    owns = false;
  }
  if (!owns) throw new HttpError(403, "This workspace is protected by a different owner key.");
}

function parseCreateInput(body: unknown): CreateShareInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "The request body must be a JSON object.");
  }

  const record = body as Record<string, unknown>;
  const problem = validateShareInput(record);
  if (problem) throw new HttpError(400, problem);

  // Every field was narrowed by `validateShareInput`.
  return {
    workspaceId: (record.workspaceId as string).trim(),
    scope: record.scope as ShareScope,
    role: record.role as ShareRole,
    boardId: (record.boardId as string | null | undefined) ?? null,
    cardId: (record.cardId as string | null | undefined) ?? null,
  };
}

function createShare(
  request: IncomingMessage,
  store: ShareStore,
  workspaces: Pick<WorkspaceRegistry, "verify">,
  response: ServerResponse,
  body: unknown,
  hooks: ShareRequestHooks | undefined,
): void {
  const input = parseCreateInput(body);
  requireOwner(request, workspaces, input.workspaceId);

  const { token, share } = store.create(input);
  sendJson(response, 201, { token, share });
  notify(hooks, share.workspaceId);
}

function listShares(
  request: IncomingMessage,
  store: ShareStore,
  workspaces: Pick<WorkspaceRegistry, "verify">,
  response: ServerResponse,
  url: URL,
): void {
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  if (workspaceId.length === 0) {
    throw new HttpError(400, "A workspace id is required.");
  }
  requireOwner(request, workspaces, workspaceId);
  sendJson(response, 200, { shares: store.list(workspaceId) });
}

function resolveShare(store: ShareStore, response: ServerResponse, token: string): void {
  const share = store.resolve(token);
  if (!share) throw new HttpError(404, "Share not found.");
  sendJson(response, 200, { share: publicShare(share) });
}

function revokeShare(
  request: IncomingMessage,
  store: ShareStore,
  workspaces: Pick<WorkspaceRegistry, "verify">,
  response: ServerResponse,
  id: string,
  hooks: ShareRequestHooks | undefined,
): void {
  // The id alone does not authenticate: only the owner of the share's workspace
  // may revoke it, and the record is read before it is touched.
  const existing = store.get(id);
  if (!existing) throw new HttpError(404, "Share not found.");
  requireOwner(request, workspaces, existing.workspaceId);

  const share = store.revoke(id);
  if (!share) throw new HttpError(404, "Share not found.");
  sendJson(response, 200, { share: publicShare(share) });
  if (share.revokedAt !== null) notify(hooks, share.workspaceId);
}

/**
 * The share a request authenticates. The path token must be the presented
 * bearer token, so one token can never address another share's draft.
 */
function authenticatedShare(request: IncomingMessage, store: ShareStore, token: string): Share {
  const presented = bearerToken(request);
  if (!presented) throw new HttpError(401, "A share token is required.");

  // Resolving the presented token (not the path token) is what authenticates.
  const share = store.resolve(presented);
  if (!share || share.roomId === null || token !== presented) {
    throw new HttpError(404, "Share not found.");
  }
  return share;
}

/**
 * Publishes or reloads the draft behind an editor share. The share token is the
 * credential: a viewer's token must never reach the worker, and a workspace
 * share has no draft of its own.
 */
async function draftAction(
  request: IncomingMessage,
  store: ShareStore,
  response: ServerResponse,
  token: string,
  action: "publish" | "reload",
  hooks: ShareRequestHooks | undefined,
): Promise<void> {
  const share = authenticatedShare(request, store, token);
  if (share.scope === "workspace") {
    throw new HttpError(403, "Workspace shares do not publish.");
  }
  if (share.role !== "editor") {
    throw new HttpError(403, "Only an editor link may publish.");
  }

  let result: SharePublishResult;
  if (action === "publish") {
    const handler = hooks?.publish;
    if (!handler) throw new HttpError(503, "Publishing is not available.");
    const { version, overwrite } = parsePublishPayload(await readOptionalJsonBody(request));
    result = await handler(share, version, overwrite);
  } else {
    const handler = hooks?.reload;
    if (!handler) throw new HttpError(503, "Reloading is not available.");
    result = await handler(share);
  }
  if (result.ok) {
    sendJson(response, 200, { applied: result.applied });
    return;
  }
  sendJson(response, 409, {
    conflicts: result.conflicts,
    unsupported: result.unsupported,
    ...(result.reason ? { reason: result.reason } : {}),
  });
}

/**
 * Reports whether an editor's draft still holds unpublished changes. The token
 * is the whole credential; a viewer link has no draft to report.
 */
async function statusAction(
  request: IncomingMessage,
  store: ShareStore,
  response: ServerResponse,
  token: string,
  hooks: ShareRequestHooks | undefined,
): Promise<void> {
  const share = authenticatedShare(request, store, token);
  if (share.scope === "workspace") {
    throw new HttpError(403, "Workspace shares do not publish.");
  }
  if (share.role !== "editor") {
    throw new HttpError(403, "Only an editor link has a publish status.");
  }

  const handler = hooks?.status;
  if (!handler) throw new HttpError(503, "Publish status is not available.");
  const status = await handler(share);
  sendJson(response, 200, {
    dirty: status.dirty === true,
    hasBaseline: status.hasBaseline === true,
  });
}

/**
 * Shapes a share for the holder of its link. A board or card viewer must not
 * learn the owner workspace id: with it they could mint a workspace share and
 * escape the projection. The room they can actually open is the projection room,
 * so it stands in; a legacy record without one exposes no id at all. Workspace
 * shares keep the real id because it is already the room the viewer joins.
 */
function publicShare(share: Share): Share {
  if (share.scope === "workspace") return share;
  return { ...share, workspaceId: share.roomId ?? "" };
}

export function methodNotAllowed(response: ServerResponse, allow: string): void {
  response.setHeader("allow", allow);
  throw new HttpError(405, "Method not allowed.");
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, "The share identifier is malformed.");
  }
}

/**
 * Handles the share management API. Returns false when the request is not an
 * API route so the caller can keep serving its own routes.
 *
 * Creating, listing and revoking require the workspace owner key. Resolving a
 * token stays public: the token is the credential the recipient holds.
 */
export async function handleShareRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: ShareStore,
  workspaces: Pick<WorkspaceRegistry, "verify">,
  hooks?: ShareRequestHooks,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== SHARE_API_PATH && !url.pathname.startsWith(`${SHARE_API_PATH}/`)) {
    return false;
  }

  const method = request.method ?? "GET";
  if (method === "OPTIONS") {
    sendEmpty(response, 204);
    return true;
  }

  try {
    const segment = url.pathname.slice(SHARE_API_PATH.length).replace(/^\//, "");
    const parts = segment.split("/");

    if (segment.length === 0) {
      if (method === "POST") {
        createShare(request, store, workspaces, response, await readJsonBody(request), hooks);
      } else if (method === "GET") {
        listShares(request, store, workspaces, response, url);
      } else {
        methodNotAllowed(response, "GET, POST, OPTIONS");
      }
      return true;
    }

    if (parts.length === 2) {
      const [rawToken = "", action] = parts;
      if (action === "status") {
        if (method !== "GET") methodNotAllowed(response, "GET, OPTIONS");
        await statusAction(request, store, response, decodeSegment(rawToken), hooks);
        return true;
      }
      if (action !== "publish" && action !== "reload") throw new HttpError(404, "Not found.");
      if (method !== "POST") methodNotAllowed(response, "POST, OPTIONS");
      await draftAction(request, store, response, decodeSegment(rawToken), action, hooks);
      return true;
    }
    if (parts.length !== 1) throw new HttpError(404, "Not found.");

    const identifier = decodeSegment(segment);

    if (method === "GET") {
      resolveShare(store, response, identifier);
    } else if (method === "DELETE") {
      revokeShare(request, store, workspaces, response, identifier, hooks);
    } else {
      methodNotAllowed(response, "GET, DELETE, OPTIONS");
    }
  } catch (error) {
    if (response.headersSent) return true;
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return true;
    }
    console.error("[shares] request failed", error);
    sendJson(response, 500, { error: "The share request failed." });
  }

  return true;
}
