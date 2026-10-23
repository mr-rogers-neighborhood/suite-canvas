/**
 * Client for the collab server's share API. A share is a capability link: the
 * token is the whole credential for reading, so it is only ever returned by
 * `createShare` and can never be read back from the listing. Creating, listing
 * and revoking are owner operations and present the workspace owner key.
 *
 * Opening a link trades the token for a short-lived session (`suite_share`
 * cookie) and removes the token from the URL; see `resolveShare`.
 */

import { collabHttpBase } from "./endpoints";

export const SHARE_API_PATH = "/api/shares";

/** Trades a link token for the short-lived session cookie. */
export const SHARE_SESSION_PATH = `${SHARE_API_PATH}/session`;

/**
 * Sentinel `resolveShareToken` returns when the address bar no longer carries a
 * token but this tab may still hold a share session cookie. It is never a
 * credential: the cookie is the credential, and it is unreadable from script.
 */
export const SHARE_SESSION_RESUME = "session-cookie";

/** Fragment marker left behind after the token leaves the URL, so a reload can resume. */
export const SHARE_SESSION_FRAGMENT = "#share-session";

export type ShareScope = "workspace" | "board" | "card" | "selection";
export type ShareRole = "viewer" | "editor";

export const shareScopes: readonly ShareScope[] = ["workspace", "board", "card", "selection"];
export const shareRoles: readonly ShareRole[] = ["viewer", "editor"];

export interface Share {
  id: string;
  scope: ShareScope;
  role: ShareRole;
  workspaceId: string;
  boardId: string | null;
  cardId: string | null;
  createdAt: number;
  revokedAt: number | null;
  /** Epoch milliseconds; null means the link does not expire. */
  expiresAt: number | null;
  /**
   * Sync room this share opens. Workspace shares open the workspace room;
   * board, card and selection shares open `share-<token>`. The server keeps only
   * the token hash, so this is null when a share is read back by id.
   */
  roomId: string | null;
  /**
   * Cards of a selection share, in the owner's order. Empty for every other
   * scope, and always empty for a link holder: the server only sends the ids to
   * the workspace owner.
   */
  cardIds: string[];
  /** How many cards the link projects: the selection size, 1 for a card share. */
  cardCount: number;
}

export interface CreateShareInput {
  workspaceId: string;
  scope: ShareScope;
  role: ShareRole;
  boardId?: string | null;
  cardId?: string | null;
  /** Cards of a selection share; ignored by every other scope. */
  cardIds?: readonly string[];
  /** Epoch milliseconds; omit or null for a link that does not expire. */
  expiresAt?: number | null;
}

export interface CreatedShare {
  /** Raw capability token. Only returned once, at creation. */
  token: string;
  share: Share;
}

/** The result of exchanging a link token for a session. */
export interface OpenedShareSession {
  /** The resolved public share, so the caller boots without a second call. */
  share: Share;
  /**
   * Short-lived session id. It is what this page presents to the sync server
   * instead of the link token; the cookie only serves the HTTP resolve.
   */
  session: string;
}

/** A share request the server rejected, with its message made readable. */
export class ShareApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ShareApiError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(body: unknown, status: number): string {
  if (isRecord(body) && typeof body.error === "string" && body.error.trim().length > 0) {
    return body.error.trim();
  }
  return `The share request failed (${status}).`;
}

/**
 * Authorization for a management call. The owner key is a bearer capability the
 * relay only stores a hash of; it never travels in a URL.
 */
function ownerHeaders(ownerKey: string | null | undefined): Record<string, string> {
  const key = ownerKey?.trim() ?? "";
  if (key.length === 0) throw new ShareApiError("An owner key is required to manage links.");
  return { authorization: `Bearer ${key}` };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${collabHttpBase()}${path}`, init);
  } catch {
    throw new ShareApiError("Could not reach the share server.");
  }

  const body = await readBody(response);
  if (!response.ok) throw new ShareApiError(errorMessage(body, response.status), response.status);
  if (body === null) throw new ShareApiError("The share server sent an empty response.");
  return body as T;
}

function createdShare(body: unknown): CreatedShare {
  if (!isRecord(body) || typeof body.token !== "string" || !isRecord(body.share)) {
    throw new ShareApiError("The share server sent an unexpected response.");
  }
  return { token: body.token, share: body.share as unknown as Share };
}

function shareRecord(body: unknown): Share {
  if (!isRecord(body) || !isRecord(body.share)) {
    throw new ShareApiError("The share server sent an unexpected response.");
  }
  return body.share as unknown as Share;
}

function openedSession(body: unknown): OpenedShareSession {
  if (!isRecord(body) || !isRecord(body.share) || typeof body.session !== "string") {
    throw new ShareApiError("The share server sent an unexpected response.");
  }
  const session = body.session.trim();
  if (session.length === 0)
    throw new ShareApiError("The share server sent an unexpected response.");
  return { share: body.share as unknown as Share, session };
}

/**
 * The session credential this page exchanged, if any. `sessionForShare` turns it
 * into the session's `token`, so the WebSocket join and the draft API present a
 * short-lived session rather than the permanent link token.
 */
let activeSession: string | null = null;

/** The credential this page should present for a share, or null when it has none. */
export function activeShareCredential(): string | null {
  return activeSession;
}

/** Drops the in-memory credential. Used on sign-out and between tests. */
export function forgetShareSession(): void {
  activeSession = null;
}

/** True for the sentinel `resolveShareToken` returns once the URL is token-free. */
export function isShareSessionResume(value: string | null | undefined): boolean {
  return value === SHARE_SESSION_RESUME;
}

/** Creates a share and returns its one-time capability token. Owner only. */
export async function createShare(
  input: CreateShareInput,
  ownerKey: string | null | undefined,
): Promise<CreatedShare> {
  const body = await request<unknown>(SHARE_API_PATH, {
    method: "POST",
    headers: { ...ownerHeaders(ownerKey), "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return createdShare(body);
}

/** Active shares of a workspace, newest first. Tokens are not included. Owner only. */
export async function listShares(
  workspaceId: string,
  ownerKey: string | null | undefined,
): Promise<Share[]> {
  const headers = ownerHeaders(ownerKey);
  const query = new URLSearchParams({ workspaceId });
  const body = await request<unknown>(`${SHARE_API_PATH}?${query.toString()}`, { headers });
  if (!isRecord(body) || !Array.isArray(body.shares)) {
    throw new ShareApiError("The share server sent an unexpected response.");
  }
  return body.shares as unknown as Share[];
}

/**
 * Resolves a capability token to its share exactly as links always have, or
 * throws when revoked or unknown. Public: the token the recipient holds is the
 * whole credential. This is the legacy path, kept for older servers and for a
 * token the exchange rejected.
 */
async function resolveLegacyShare(token: string): Promise<Share> {
  const body = await request<unknown>(`${SHARE_API_PATH}/${encodeURIComponent(token)}`);
  return shareRecord(body);
}

/**
 * Boot resolver for `?share=<token>`.
 *
 * The link token is a permanent capability, so it is traded for a short-lived
 * session as the first thing the page does: the exchange posts the token in a
 * body, the server answers with a `HttpOnly` cookie and the public share, and
 * the address bar is rewritten so the token is gone from history, proxy logs and
 * screenshots. Reloads resume from the cookie through the fragment marker.
 *
 * If the exchange is unavailable — an older server without the route, or a
 * network hiccup — the page falls back to today's `?share=<token>` resolve and
 * keeps the token as its credential, so a link in the wild never breaks.
 */
export async function resolveShare(token: string): Promise<Share> {
  if (isShareSessionResume(token)) {
    const { share, session } = await resolveShareSession();
    activeSession = session;
    return share;
  }

  try {
    const { share, session } = await openShareSession(token);
    activeSession = session;
    rewriteShareUrl();
    return share;
  } catch {
    activeSession = null;
    return resolveLegacyShare(token);
  }
}

/** Replaces the address bar URL with a token-free one, keeping the resume marker. */
function rewriteShareUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("share")) return;
  url.searchParams.delete("share");
  url.hash = SHARE_SESSION_FRAGMENT;
  window.history.replaceState(null, "", url.toString());
}

/**
 * Exchanges a link token for a session. The token travels in the body only, so
 * it never becomes part of a URL the browser or a proxy records.
 */
export async function openShareSession(token: string): Promise<OpenedShareSession> {
  const body = await request<unknown>(SHARE_SESSION_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
    credentials: "include",
  });
  return openedSession(body);
}

/** Resolves the share behind the session cookie, for a reload with no token in the URL. */
export async function resolveShareSession(): Promise<OpenedShareSession> {
  const body = await request<unknown>(SHARE_SESSION_PATH, { credentials: "include" });
  return openedSession(body);
}

/**
 * Signs this page out of its share: the server drops the session row and clears
 * the cookie. Best effort — the credential is already dead server-side when the
 * share was revoked, so a failure here only leaves a stale cookie behind.
 */
export async function closeShareSession(): Promise<void> {
  activeSession = null;
  try {
    await fetch(`${collabHttpBase()}${SHARE_SESSION_PATH}`, {
      method: "DELETE",
      credentials: "include",
    });
  } catch {
    // Nothing to report: the page is leaving the share either way.
  }
}

/** Revokes a share by id and returns the updated record. Owner only. */
export async function revokeShare(id: string, ownerKey: string | null | undefined): Promise<Share> {
  const body = await request<unknown>(`${SHARE_API_PATH}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: ownerHeaders(ownerKey),
  });
  return shareRecord(body);
}

/** Revokes every active link in a workspace. Owner only. */
export async function revokeAllShares(
  workspaceId: string,
  ownerKey: string | null | undefined,
): Promise<Share[]> {
  const query = new URLSearchParams({ workspaceId });
  const body = await request<unknown>(`${SHARE_API_PATH}?${query.toString()}`, {
    method: "DELETE",
    headers: ownerHeaders(ownerKey),
  });
  if (!isRecord(body) || !Array.isArray(body.shares)) {
    throw new ShareApiError("The share server sent an unexpected response.");
  }
  return body.shares as unknown as Share[];
}

/**
 * The recipient URL of a token share. It carries the token only, so opening it
 * cannot leak the workspace id before the token is validated.
 */
export function shareLink(token: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("share", token);
  // A viewer link must never carry the owner key, even if the editor URL had it.
  url.hash = "";
  return url.toString();
}

/** Human-readable message for anything thrown by this client. */
export function shareErrorMessage(cause: unknown): string {
  if (cause instanceof ShareApiError) return cause.message;
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  return "The share request failed.";
}

/** One field-level reason a publish was rejected. */
export interface SharePublishConflictEntry {
  /** Stable key from the merge plan, e.g. `card:abc:body` or `section:xyz`. */
  key: string;
  message: string;
  /** Change kind (`body`, `placement`, `unsupported`, …) when the server sends one. */
  kind: string | null;
  /** Human object name from the server, when it can name one. */
  label?: string | null;
}

/** Body of a `409` publish response. */
export interface SharePublishConflict {
  /** Changed in both the draft and the source since the draft started. */
  conflicts: SharePublishConflictEntry[];
  /** A change this share may not publish (new card, schema, trash, …). */
  unsupported: SharePublishConflictEntry[];
  /** Why the publish was rejected, when the server offers a summary. */
  reason: string | null;
}

/** Body of a successful publish or reload. */
export interface SharePublishResult {
  /** Number of changes the publish applied (or a reload discarded). */
  applied: number;
}

/** Whether an editor's draft still holds changes the workspace has not seen. */
export interface ShareStatus {
  dirty: boolean;
  hasBaseline: boolean;
}

/** A publish rejected because the draft and the source diverged. */
export class SharePublishConflictError extends Error {
  readonly conflict: SharePublishConflict;

  constructor(conflict: SharePublishConflict) {
    const count = conflict.conflicts.length + conflict.unsupported.length;
    const first = conflict.conflicts[0] ?? conflict.unsupported[0];
    super(
      conflict.reason ??
        (first
          ? `${first.message} (${first.key})`
          : `The publish conflicted in ${count} place${count === 1 ? "" : "s"}.`),
    );
    this.name = "SharePublishConflictError";
    this.conflict = conflict;
  }
}

function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function conflictEntry(value: unknown): SharePublishConflictEntry | null {
  if (typeof value === "string") {
    const message = value.trim();
    return message.length > 0 ? { key: message, message, kind: null, label: null } : null;
  }
  if (!isRecord(value)) return null;
  const key = typeof value.key === "string" ? value.key : null;
  const message = typeof value.message === "string" ? value.message : null;
  if (!key && !message) return null;
  return {
    key: key ?? message ?? "change",
    message: message ?? key ?? "This change could not be published.",
    kind: typeof value.kind === "string" ? value.kind : null,
    label: typeof value.label === "string" && value.label.trim() ? value.label.trim() : null,
  };
}

function conflictEntries(value: unknown): SharePublishConflictEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = conflictEntry(entry);
    return parsed ? [parsed] : [];
  });
}

function conflictBody(body: unknown): SharePublishConflict {
  if (!isRecord(body)) {
    return { conflicts: [], unsupported: [], reason: null };
  }
  return {
    conflicts: conflictEntries(body.conflicts),
    unsupported: conflictEntries(body.unsupported),
    reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null,
  };
}

async function postShareAction(
  token: string,
  action: "publish" | "reload",
  payload?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(
      `${collabHttpBase()}${SHARE_API_PATH}/${encodeURIComponent(token)}/${action}`,
      {
        method: "POST",
        headers: payload
          ? { ...bearerHeaders(token), "content-type": "application/json" }
          : bearerHeaders(token),
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      },
    );
  } catch {
    throw new ShareApiError("Could not reach the share server.");
  }

  const body = await readBody(response);
  if (response.status === 409) throw new SharePublishConflictError(conflictBody(body));
  if (!response.ok) {
    throw new ShareApiError(errorMessage(body, response.status), response.status);
  }
  return body;
}

/**
 * Publishes the draft of an editor share to the owner's workspace. `version`
 * is the share document's version at click time: the worker waits until its
 * room has received at least that version, so a publish never applies a draft
 * that is behind the editor's last WebSocket update. `overwrite` names the
 * conflicting keys whose draft value wins; an empty list keeps every workspace
 * value. A `409` rejects the publish without touching either side and arrives
 * as a `SharePublishConflictError` carrying the field-level conflicts.
 */
export async function publishShare(
  token: string,
  version: Record<string, number>,
  overwrite?: readonly string[],
): Promise<SharePublishResult> {
  const payload = overwrite === undefined ? { version } : { version, overwrite: [...overwrite] };
  const body = await postShareAction(token, "publish", payload);
  const applied = isRecord(body) && typeof body.applied === "number" ? body.applied : 0;
  return { applied };
}

/**
 * Whether the editor's draft still holds unpublished changes. The token is the
 * whole credential; the answer drives the small `Draft`/`Published` label.
 */
export async function shareStatus(token: string): Promise<ShareStatus> {
  const body = await request<unknown>(`${SHARE_API_PATH}/${encodeURIComponent(token)}/status`, {
    headers: bearerHeaders(token),
  });
  if (!isRecord(body)) throw new ShareApiError("The share server sent an unexpected response.");
  return { dirty: body.dirty === true, hasBaseline: body.hasBaseline === true };
}

/**
 * Discards the draft and rebuilds the share from the owner's workspace. The
 * caller must confirm first: unpublished changes are lost.
 */
export async function reloadShare(token: string): Promise<void> {
  await postShareAction(token, "reload");
}

/** Human-readable message for a failed publish or reload. */
export function sharePublishErrorMessage(cause: unknown): string {
  if (cause instanceof SharePublishConflictError) return cause.message;
  return shareErrorMessage(cause);
}
