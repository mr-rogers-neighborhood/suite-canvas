import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type CreateShareInput,
  type Share,
  type ShareRole,
  type ShareScope,
  type ShareStore,
  validateShareInput,
} from "./shares.js";

export const SHARE_API_PATH = "/api/shares";

export interface ShareRequestHooks {
  /**
   * Called after a share is created or revoked so board and card projections can
   * follow. Optional: the share API works without a projection worker.
   */
  onSharesChanged?: (workspaceId: string) => void;
}

function notify(hooks: ShareRequestHooks | undefined, workspaceId: string): void {
  try {
    hooks?.onSharesChanged?.(workspaceId);
  } catch (error) {
    console.error("[shares] change hook failed", error);
  }
}

const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, CORS_HEADERS);
  response.end();
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
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

  if (size === 0) throw new HttpError(400, "A JSON body is required.");

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The request body must be valid JSON.");
  }
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
  store: ShareStore,
  response: ServerResponse,
  body: unknown,
  hooks: ShareRequestHooks | undefined,
): void {
  const input = parseCreateInput(body);

  // The store already supports board and card editors; their merge-back flow
  // ships with the projection phase.
  if (input.scope !== "workspace" && input.role === "editor") {
    throw new HttpError(400, "Board and card editor links are coming next.");
  }

  // A workspace viewer token would join the workspace room and therefore learn
  // the owner workspace id. Share management is keyed by that id and has no
  // accounts, so the holder could mint an editor link. Workspace viewer links
  // wait for management auth (S2a) or a full-workspace projection room.
  if (input.scope === "workspace" && input.role === "viewer") {
    throw new HttpError(400, "Workspace viewer links are coming next.");
  }

  const { token, share } = store.create(input);
  sendJson(response, 201, { token, share });
  notify(hooks, share.workspaceId);
}

function listShares(store: ShareStore, response: ServerResponse, url: URL): void {
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  if (workspaceId.length === 0) {
    throw new HttpError(400, "A workspace id is required.");
  }
  sendJson(response, 200, { shares: store.list(workspaceId) });
}

function resolveShare(store: ShareStore, response: ServerResponse, token: string): void {
  const share = store.resolve(token);
  if (!share) throw new HttpError(404, "Share not found.");
  sendJson(response, 200, { share: publicShare(share) });
}

function revokeShare(
  store: ShareStore,
  response: ServerResponse,
  id: string,
  hooks: ShareRequestHooks | undefined,
): void {
  const share = store.revoke(id);
  if (!share) throw new HttpError(404, "Share not found.");
  sendJson(response, 200, { share: publicShare(share) });
  if (share.revokedAt !== null) notify(hooks, share.workspaceId);
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

function methodNotAllowed(response: ServerResponse, allow: string): void {
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
 */
export async function handleShareRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: ShareStore,
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

    if (segment.length === 0) {
      if (method === "POST") {
        createShare(store, response, await readJsonBody(request), hooks);
      } else if (method === "GET") {
        listShares(store, response, url);
      } else {
        methodNotAllowed(response, "GET, POST, OPTIONS");
      }
      return true;
    }

    if (segment.includes("/")) throw new HttpError(404, "Not found.");
    const identifier = decodeSegment(segment);

    if (method === "GET") {
      resolveShare(store, response, identifier);
    } else if (method === "DELETE") {
      revokeShare(store, response, identifier, hooks);
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
