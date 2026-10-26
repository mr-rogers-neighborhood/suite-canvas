import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "../logging.js";
import type { ShareStore } from "../store/shares.js";
import type { WorkspaceAccess } from "./access.js";
import { HttpError, toProblem } from "./errors.js";
import { readJsonBody } from "./request.js";
import { applyCors, methodNotAllowed, sendEmpty, sendJson, sendProblem } from "./respond.js";
import {
  draftAction,
  endSession,
  exchangeSession,
  readDefaults,
  readSessionShare,
  statusAction,
} from "./shareDraft.js";
import type { ShareRequestHooks } from "./shareHooks.js";
import {
  createShare,
  listShares,
  resolveShare,
  revokeAllShares,
  revokeShare,
} from "./shareLinks.js";

/**
 * The share management API router. The routes themselves live in
 * `shareLinks.ts` (link CRUD) and `shareDraft.ts` (session and draft); this file
 * owns the paths, the reserved segments and the dispatch.
 */
const logger = createLogger().child({ component: "shares" });

export type { ShareRequestHooks } from "./shareHooks.js";

export const SHARE_API_PATH = "/api/shares";

/** Last segment of `SHARE_SESSION_PATH`; reserved so no token can shadow it. */
const SESSION_SEGMENT = "session";

/** Reserved segment reporting the create defaults, so a token can never shadow it. */
const DEFAULTS_SEGMENT = "defaults";

/** Route that trades a link token for a short-lived session. Never takes the token in the URL. */
export const SHARE_SESSION_PATH = `${SHARE_API_PATH}/session`;

/**
 * Route that reports how a new link is created by default. The dialog needs it
 * to preselect the expiry the server will apply; it exposes only the hosted
 * switch, never a token or a share.
 */
export const SHARE_DEFAULTS_PATH = `${SHARE_API_PATH}/defaults`;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw HttpError.badRequest("The share identifier is malformed.");
  }
}

/**
 * Handles the share management API. Returns false when the request is not an
 * API route so the caller can keep serving its own routes.
 *
 * Creating, listing and revoking need a session that is entitled to the
 * workspace. Resolving a token stays public: the token is the credential the
 * recipient holds, and a visitor needs no account to use a link. The session
 * route is the one place a token is accepted from a body rather than the URL,
 * because it exists to get the token out of the URL.
 */
export async function handleShareRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: ShareStore,
  access: WorkspaceAccess,
  hooks?: ShareRequestHooks,
): Promise<boolean> {
  applyCors(request, response);
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

    // The exchange route, before the token routes: "session" is a reserved word
    // here, because a link token is a long random value, never this word.
    if (segment === SESSION_SEGMENT) {
      if (method === "POST") {
        await exchangeSession(request, store, response, hooks);
      } else if (method === "GET") {
        readSessionShare(request, store, response, hooks);
      } else if (method === "DELETE") {
        endSession(request, store, response);
      } else {
        methodNotAllowed(response, "GET, POST, DELETE, OPTIONS");
      }
      return true;
    }

    // Reserved before the token routes for the same reason as `session`.
    if (segment === DEFAULTS_SEGMENT) {
      if (method === "GET") {
        readDefaults(response);
      } else {
        methodNotAllowed(response, "GET, OPTIONS");
      }
      return true;
    }

    if (segment.length === 0) {
      if (method === "POST") {
        await createShare(request, store, access, response, await readJsonBody(request), hooks);
      } else if (method === "GET") {
        await listShares(request, store, access, response, url);
      } else if (method === "DELETE") {
        await revokeAllShares(request, store, access, response, url, hooks);
      } else {
        methodNotAllowed(response, "GET, POST, DELETE, OPTIONS");
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
      if (action !== "publish" && action !== "reload") throw HttpError.notFound("Not found.");
      if (method !== "POST") methodNotAllowed(response, "POST, OPTIONS");
      await draftAction(request, store, response, decodeSegment(rawToken), action, hooks);
      return true;
    }
    if (parts.length !== 1) throw HttpError.notFound("Not found.");

    const identifier = decodeSegment(segment);

    if (method === "GET") {
      resolveShare(request, store, response, identifier, hooks);
    } else if (method === "DELETE") {
      await revokeShare(request, store, access, response, identifier, hooks);
    } else {
      methodNotAllowed(response, "GET, DELETE, OPTIONS");
    }
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
    sendJson(response, 500, { error: "The share request failed." });
  }

  return true;
}
