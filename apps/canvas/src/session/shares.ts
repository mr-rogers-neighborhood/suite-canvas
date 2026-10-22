/**
 * Client for the collab server's share API. A share is a capability link: the
 * token is the whole credential, so it is only ever returned by `createShare`
 * and can never be read back from the listing.
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

/** Creates a share and returns its one-time capability token. */
export async function createShare(input: CreateShareInput): Promise<CreatedShare> {
  const body = await request<unknown>(SHARE_API_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return createdShare(body);
}

/** Active shares of a workspace, newest first. Tokens are not included. */
export async function listShares(workspaceId: string): Promise<Share[]> {
  const query = new URLSearchParams({ workspaceId });
  const body = await request<unknown>(`${SHARE_API_PATH}?${query.toString()}`);
  if (!isRecord(body) || !Array.isArray(body.shares)) {
    throw new ShareApiError("The share server sent an unexpected response.");
  }
  return body.shares as unknown as Share[];
}

/** Resolves a capability token to its share, or throws when revoked or unknown. */
export async function resolveShare(token: string): Promise<Share> {
  const body = await request<unknown>(`${SHARE_API_PATH}/${encodeURIComponent(token)}`);
  return shareRecord(body);
}

/** Revokes a share by id and returns the updated record. */
export async function revokeShare(id: string): Promise<Share> {
  const body = await request<unknown>(`${SHARE_API_PATH}/${encodeURIComponent(id)}`, {
    method: "DELETE",
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
  return url.toString();
}

/** Human-readable message for anything thrown by this client. */
export function shareErrorMessage(cause: unknown): string {
  if (cause instanceof ShareApiError) return cause.message;
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  return "The share request failed.";
}
