/**
 * Admin API client. Deliberately tiny: plain `fetch`, no router, no store.
 * The token lives in `sessionStorage` only — not localStorage, never a URL —
 * so closing the tab ends the session.
 */

import { collabHttpBase } from "../session/endpoints";

const TOKEN_KEY = "suite.admin.token";
const BASE = `${collabHttpBase()}/api/admin`;

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

/** The token this tab remembers, or null. */
export function storedAdminToken(): string | null {
  try {
    const value = window.sessionStorage.getItem(TOKEN_KEY);
    return value !== null && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function rememberAdminToken(token: string): void {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // A disabled sessionStorage only costs the operator a re-entry.
  }
}

export function forgetAdminToken(): void {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function errorText(cause: unknown): string {
  if (cause instanceof AdminApiError) return cause.message;
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  return "The request failed.";
}

async function messageFor(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim().length > 0) return body.error;
  } catch {
    // Not JSON; fall through to the status line.
  }
  return `${response.status} ${response.statusText}`.trim();
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (init.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new AdminApiError(0, "Could not reach the collab server.");
  }

  if (!response.ok) {
    const message = await messageFor(response);
    if (response.status === 401) {
      throw new AdminApiError(401, message || "The admin token was rejected.");
    }
    throw new AdminApiError(response.status, message);
  }
  return (await response.json()) as T;
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

export interface AdminDatabase {
  path?: string;
  bytes: number;
  ok: boolean;
}

export interface AdminStatus {
  ok: boolean;
  uptimeMs: number;
  node: string;
  pid: number;
  databases: { documents: AdminDatabase; shares: AdminDatabase; workspaces: AdminDatabase };
  rooms: { total: number; workers: number; clients: number };
  limits: {
    sharesPerWorkspace: number;
    selectionCards: number;
    publishPerMinute: number;
    claimPerMinute: number;
  };
  admin: { enabled: boolean };
}

export interface AdminShare {
  id: string;
  scope: "workspace" | "board" | "card" | "selection";
  role: "viewer" | "editor";
  boardId: string | null;
  cardId: string | null;
  cardCount: number;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

export interface WorkspaceRow {
  id: string;
  claimed: boolean;
  documentBytes: number;
  cards: number;
  boards: number;
  sections: number;
  types: number;
  tags: number;
  shares: number;
  lastSavedAt: number | null;
}

export interface WorkspaceList {
  workspaces: WorkspaceRow[];
  total: number;
}

export interface WorkspaceDetail extends WorkspaceRow {
  shareList: AdminShare[];
  versions: Record<string, number>;
  schemaVersion: number | null;
}

export interface SocketRoom {
  roomId: string;
  clients: number;
  authKinds?: { owner: number; share: number; internal: number; anonymous: number };
}

export interface ProjectionRoom {
  roomId: string;
  shareId: string;
  workspaceId: string;
  role: "viewer" | "editor";
  hasBaseline: boolean;
  dirty: boolean;
}

export interface RoomList {
  rooms: SocketRoom[];
  projectionRooms: ProjectionRoom[];
  note: string;
}

export interface FixtureRequest {
  workspaceId?: string;
  boards?: number;
  cards?: number;
  sections?: number;
  shares?: number;
}

export interface FixtureShare {
  scope: "workspace" | "board" | "card" | "selection";
  token: string;
  url: string;
}

export interface FixtureResult {
  ok: boolean;
  workspaceId: string;
  boards: string[];
  cards: string[];
  sections: string[];
  shares: FixtureShare[];
}

export interface MutationResult {
  ok: boolean;
  [key: string]: unknown;
}

/**
 * The public readiness probe, with no token. `/health` answers `200 {"ok":true}`
 * on the relay's API port and needs no credential, which is exactly why the
 * support screen may show it: a status statement that required an operator token
 * would be unavailable to the person who needs it.
 */
export async function getRelayHealth(): Promise<{
  ok: boolean;
  status: number;
  at: number;
}> {
  const at = Date.now();
  let response: Response;
  try {
    response = await fetch(`${collabHttpBase()}/health`, { method: "GET" });
  } catch {
    return { ok: false, status: 0, at };
  }
  let ok = response.ok;
  try {
    const body = (await response.json()) as { ok?: unknown };
    if (body.ok === false) ok = false;
  } catch {
    // A body that is not JSON is not a readiness answer this panel can vouch for.
  }
  return { ok, status: response.status, at };
}

export function getStatus(token: string): Promise<AdminStatus> {
  return request<AdminStatus>("/status", token);
}

export function listWorkspaces(token: string): Promise<WorkspaceList> {
  return request<WorkspaceList>("/workspaces?limit=200", token);
}

export function getWorkspace(token: string, id: string): Promise<WorkspaceDetail> {
  return request<WorkspaceDetail>(`/workspaces/${encode(id)}`, token);
}

export function listRooms(token: string): Promise<RoomList> {
  return request<RoomList>("/rooms", token);
}

export function listShares(
  token: string,
  workspaceId: string,
): Promise<{ workspaceId: string; shares: AdminShare[] }> {
  return request(`/shares?workspaceId=${encode(workspaceId)}`, token);
}

export function revokeShare(token: string, shareId: string): Promise<MutationResult> {
  return request(`/shares/${encode(shareId)}/revoke`, token, { method: "POST" });
}

export function revokeAllShares(token: string, workspaceId: string): Promise<MutationResult> {
  return request(`/shares?workspaceId=${encode(workspaceId)}`, token, { method: "DELETE" });
}

export function deleteWorkspace(token: string, workspaceId: string): Promise<MutationResult> {
  return request(`/workspaces/${encode(workspaceId)}`, token, {
    method: "DELETE",
    body: JSON.stringify({ confirm: workspaceId }),
  });
}

export function disconnectRoom(token: string, roomId: string): Promise<MutationResult> {
  return request(`/rooms/${encode(roomId)}/disconnect`, token, { method: "POST" });
}

export function createFixtures(token: string, input: FixtureRequest): Promise<FixtureResult> {
  return request("/fixtures", token, { method: "POST", body: JSON.stringify(input) });
}

/** Fetches the export with the bearer header, then saves it through a blob URL. */
export async function downloadExport(token: string, workspaceId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/workspaces/${encode(workspaceId)}/export`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    throw new AdminApiError(0, "Could not reach the collab server.");
  }
  if (!response.ok) throw new AdminApiError(response.status, await messageFor(response));

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stem = workspaceId.replace(/[^A-Za-z0-9._-]/gu, "_") || "workspace";
  anchor.href = url;
  anchor.download = `suite-${stem}.suite`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
