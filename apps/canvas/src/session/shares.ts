/**
 * Client for the collab server's share API. A share is a capability link: the
 * token is the whole credential for reading, so it is only ever returned by
 * `createShare` and can never be read back from the listing. Creating, listing
 * and revoking are owner operations and present the workspace owner key.
 */

export const SHARE_API_PATH = "/api/shares";

/** Matches the collab HTTP server's default port. */
const DEFAULT_HTTP_URL = "http://localhost:1235";

export type ShareScope = "workspace" | "board" | "card";
export type ShareRole = "viewer" | "editor";

export const shareScopes: readonly ShareScope[] = ["workspace", "board", "card"];
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
  /**
   * Sync room this share opens. Workspace shares open the workspace room;
   * board and card shares open `share-<token>`. The server keeps only the token
   * hash, so this is null when a share is read back by id.
   */
  roomId: string | null;
}

export interface CreateShareInput {
  workspaceId: string;
  scope: ShareScope;
  role: ShareRole;
  boardId?: string | null;
  cardId?: string | null;
}

export interface CreatedShare {
  /** Raw capability token. Only returned once, at creation. */
  token: string;
  share: Share;
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

function httpBase(): string {
  const configured = import.meta.env.VITE_COLLAB_HTTP_URL as string | undefined;
  return (configured ?? DEFAULT_HTTP_URL).replace(/\/+$/, "");
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
    response = await fetch(`${httpBase()}${path}`, init);
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
 * Resolves a capability token to its share, or throws when revoked or unknown.
 * Public: the token the recipient holds is the whole credential.
 */
export async function resolveShare(token: string): Promise<Share> {
  const body = await request<unknown>(`${SHARE_API_PATH}/${encodeURIComponent(token)}`);
  return shareRecord(body);
}

/** Revokes a share by id and returns the updated record. Owner only. */
export async function revokeShare(id: string, ownerKey: string | null | undefined): Promise<Share> {
  const body = await request<unknown>(`${SHARE_API_PATH}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: ownerHeaders(ownerKey),
  });
  return shareRecord(body);
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
    return message.length > 0 ? { key: message, message, kind: null } : null;
  }
  if (!isRecord(value)) return null;
  const key = typeof value.key === "string" ? value.key : null;
  const message = typeof value.message === "string" ? value.message : null;
  if (!key && !message) return null;
  return {
    key: key ?? message ?? "change",
    message: message ?? key ?? "This change could not be published.",
    kind: typeof value.kind === "string" ? value.kind : null,
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
      `${httpBase()}${SHARE_API_PATH}/${encodeURIComponent(token)}/${action}`,
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
 * that is behind the editor's last WebSocket update. A `409` rejects the
 * publish without touching either side and arrives as a
 * `SharePublishConflictError` carrying the field-level conflicts.
 */
export async function publishShare(
  token: string,
  version: Record<string, number>,
): Promise<SharePublishResult> {
  const body = await postShareAction(token, "publish", { version });
  const applied = isRecord(body) && typeof body.applied === "number" ? body.applied : 0;
  return { applied };
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
