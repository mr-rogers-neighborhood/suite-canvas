import type { IncomingMessage, ServerResponse } from "node:http";
import { licenceRequired } from "@suite/licence";
import type { SharePublishResult } from "../projection/index.js";
import { SHARE_SESSION_TTL_MS, type Share, type ShareStore } from "../store/shares.js";
import { HttpError } from "./errors.js";
import {
  assertWithinLimit,
  clientAddress,
  publishLimiter,
  shareResolveLimiter,
} from "./rateLimit.js";
import { bearerToken, readJsonBody, readOptionalJsonBody } from "./request.js";
import { sendEmpty, sendJson } from "./respond.js";
import type { ShareRequestHooks } from "./shareHooks.js";
import { notifyOpened } from "./shareHooks.js";
import { HOSTED_SHARE_EXPIRY_DAYS, publicShare } from "./shareLinks.js";

/**
 * The share session and draft routes: trading a token for a session cookie,
 * reading that session back, and publishing or reloading an editor's draft.
 */

/**
 * Cookie that carries the exchanged share session. HttpOnly keeps it out of
 * script, Secure keeps it off plain HTTP, SameSite=Lax keeps a cross-site page
 * from driving the resolve, and Path=/ scopes it to the whole app.
 */
export const SHARE_SESSION_COOKIE = "suite_share";
/** Reads one cookie without pulling in a parser dependency. */
function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string" || value.length === 0) return null;

  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    if (raw.length === 0) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function cookieHeader(maxAgeSeconds: number): string {
  return `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/**
 * Writes the session cookie. The value is a random session id; the store keeps
 * only its hash, so the cookie is the single copy of the credential.
 */
function setSessionCookie(response: ServerResponse, session: string, expiresAt: number): void {
  const maxAge = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  response.setHeader("set-cookie", `${SHARE_SESSION_COOKIE}=${session}; ${cookieHeader(maxAge)}`);
}

export function clearSessionCookie(response: ServerResponse): void {
  response.setHeader("set-cookie", `${SHARE_SESSION_COOKIE}=; ${cookieHeader(0)}`);
}

/** The session credential the browser presented, if any. */
function sessionFrom(request: IncomingMessage): string | null {
  return readCookie(request, SHARE_SESSION_COOKIE);
}

/**
 * `POST /api/shares/session`: trades the link token for a session cookie.
 *
 * The token arrives in the body, never in the URL, so this exchange is the one
 * request whose token could still reach a log — and it is the last one. The
 * response carries the public share so the caller boots without a second call,
 * and the session id so a WebSocket join can present it (the cookie is HttpOnly
 * and unreadable from script). The token is never returned as a value of its
 * own; the only copy left in the body is the one embedded in a projection room
 * id, which the caller already holds.
 */
export async function exchangeSession(
  request: IncomingMessage,
  store: ShareStore,
  response: ServerResponse,
  hooks: ShareRequestHooks | undefined,
): Promise<void> {
  assertWithinLimit(
    shareResolveLimiter,
    clientAddress(request),
    "Too many link lookups. Wait a moment and try again.",
  );

  const body = await readJsonBody(request);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw HttpError.badRequest("The request body must be a JSON object.");
  }
  const presented = (body as Record<string, unknown>).token;
  if (typeof presented !== "string" || presented.trim().length === 0) {
    throw HttpError.badRequest("A share token is required.");
  }

  const share = store.resolve(presented.trim());
  if (!share) throw HttpError.notFound("Share not found.");

  const { session, expiresAt } = store.createSession(share);
  setSessionCookie(response, session, expiresAt);
  sendJson(response, 200, { share: publicShare(share), session });
  notifyOpened(hooks, share);
}

/**
 * `GET /api/shares/session`: resolves the share behind the cookie. This is what
 * a reload uses once the URL no longer carries the token, and it renews the
 * cookie to the slid expiry the store just wrote.
 */
export function readSessionShare(
  request: IncomingMessage,
  store: ShareStore,
  response: ServerResponse,
  hooks: ShareRequestHooks | undefined,
): void {
  assertWithinLimit(
    shareResolveLimiter,
    clientAddress(request),
    "Too many link lookups. Wait a moment and try again.",
  );

  const session = sessionFrom(request);
  const share = session ? store.resolveSession(session) : null;
  if (!session || !share) {
    if (session) clearSessionCookie(response);
    throw HttpError.notFound("Share not found.");
  }

  setSessionCookie(response, session, Date.now() + SHARE_SESSION_TTL_MS);
  sendJson(response, 200, { share: publicShare(share), session });
  notifyOpened(hooks, share);
}

/**
 * `GET /api/shares/defaults`: how a new link is created when the caller does not
 * choose. Only the hosted switch and a day count; no token, no share, no owner
 * key needed, so the dialog can preselect before it creates anything.
 */
export function readDefaults(response: ServerResponse): void {
  const hosted = licenceRequired();
  sendJson(response, 200, {
    hosted,
    defaultExpiryDays: hosted ? HOSTED_SHARE_EXPIRY_DAYS : 0,
  });
}

/** `DELETE /api/shares/session`: drops the session and clears the cookie. */
export function endSession(
  request: IncomingMessage,
  store: ShareStore,
  response: ServerResponse,
): void {
  const session = sessionFrom(request);
  if (session) store.deleteSession(session);
  clearSessionCookie(response);
  sendEmpty(response, 204);
}

/**
 * The share a request authenticates. The path token must be the presented
 * bearer token, so one token can never address another share's draft.
 *
 * The bearer may be the raw link token or the session the browser exchanged for
 * it (a session is scoped to one share and dies with it, so it carries exactly
 * the same permission the token had).
 */
function authenticatedShare(request: IncomingMessage, store: ShareStore, token: string): Share {
  const presented = bearerToken(request);
  if (!presented) throw HttpError.unauthorized("A share token is required.");

  // Resolving the presented token (not the path token) is what authenticates.
  const share = store.resolve(presented) ?? store.resolveSession(presented);
  if (!share || share.roomId === null || token !== presented) {
    throw HttpError.notFound("Share not found.");
  }
  return share;
}

/**
 * Publishes or reloads the draft behind an editor share. The share token is the
 * credential: a viewer's token must never reach the worker, and a workspace
 * share has no draft of its own.
 */
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
    throw HttpError.badRequest("The request body must be a JSON object.");
  }

  const record = body as Record<string, unknown>;
  const payload: PublishPayload = {};

  const rawVersion = record.version;
  if (rawVersion !== undefined && rawVersion !== null) {
    if (typeof rawVersion !== "object" || Array.isArray(rawVersion)) {
      throw HttpError.badRequest("version must be an object of peer counters.");
    }

    const version: Record<string, number> = {};
    for (const [peer, counter] of Object.entries(rawVersion)) {
      if (typeof counter !== "number" || !Number.isSafeInteger(counter) || counter < 0) {
        throw HttpError.badRequest("version counters must be non-negative integers.");
      }
      version[peer] = counter;
    }
    payload.version = version;
  }

  const rawOverwrite = record.overwrite;
  if (rawOverwrite !== undefined && rawOverwrite !== null) {
    if (!Array.isArray(rawOverwrite)) {
      throw HttpError.badRequest("overwrite must be an array of conflict keys.");
    }
    const overwrite: string[] = [];
    for (const entry of rawOverwrite) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        throw HttpError.badRequest("overwrite entries must be non-empty strings.");
      }
      overwrite.push(entry);
    }
    payload.overwrite = overwrite;
  }

  return payload;
}

export async function draftAction(
  request: IncomingMessage,
  store: ShareStore,
  response: ServerResponse,
  token: string,
  action: "publish" | "reload",
  hooks: ShareRequestHooks | undefined,
): Promise<void> {
  const share = authenticatedShare(request, store, token);
  if (share.scope === "workspace") {
    throw HttpError.forbidden("Workspace shares do not publish.");
  }
  if (share.role !== "editor") {
    throw HttpError.forbidden("Only an editor link may publish.");
  }

  if (action === "publish") {
    assertWithinLimit(publishLimiter, share.id, "Too many publishes. Wait a moment and try again.");
  }

  let result: SharePublishResult;
  if (action === "publish") {
    const handler = hooks?.publish;
    if (!handler) throw HttpError.unavailable("Publishing is not available.");
    const { version, overwrite } = parsePublishPayload(await readOptionalJsonBody(request));
    result = await handler(share, version, overwrite);
  } else {
    const handler = hooks?.reload;
    if (!handler) throw HttpError.unavailable("Reloading is not available.");
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
export async function statusAction(
  request: IncomingMessage,
  store: ShareStore,
  response: ServerResponse,
  token: string,
  hooks: ShareRequestHooks | undefined,
): Promise<void> {
  const share = authenticatedShare(request, store, token);
  if (share.scope === "workspace") {
    throw HttpError.forbidden("Workspace shares do not publish.");
  }
  if (share.role !== "editor") {
    throw HttpError.forbidden("Only an editor link has a publish status.");
  }

  const handler = hooks?.status;
  if (!handler) throw HttpError.unavailable("Publish status is not available.");
  const status = await handler(share);
  sendJson(response, 200, {
    dirty: status.dirty === true,
    hasBaseline: status.hasBaseline === true,
  });
}
