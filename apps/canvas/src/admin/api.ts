/**
 * Admin API client. Deliberately tiny: plain `fetch`, no router, no store.
 *
 * There is no credential to keep here any more. The panel signs in as an ordinary
 * account and sends the same short-lived session JWT every other relay call sends, so
 * "who is this" has one answer in both processes and a tab holds no secret of its own
 * (`auth/credential.ts`). Being on the operator list is what the *server* checks.
 */

import { credentialAuthorization } from "../auth/credential";
import { authServiceBase } from "../auth/endpoints";
import { collabHttpBase } from "../session/endpoints";

const BASE = `${collabHttpBase()}/api/admin`;

/**
 * Templates are rows in the control plane's database, not the relay's stores:
 * the account service owns the starter list because the launcher reads it
 * before anybody signs in. Everything else here talks to the relay.
 */
const TEMPLATES_BASE = `${authServiceBase()}/admin/templates`;

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
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

/**
 * One request, with the session's own token.
 *
 * A 401 means "not signed in, or the token expired" and a 403 means "signed in, not an
 * operator": two different next steps, so they stay two different errors.
 */
async function requestUrl<T>(url: string, init: RequestInit = {}): Promise<T> {
  const authorization = await credentialAuthorization();
  if (Object.keys(authorization).length === 0) {
    throw new AdminApiError(401, "Sign in to use the operator surface.");
  }
  const headers: Record<string, string> = { ...authorization };
  if (init.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, credentials: "include" });
  } catch {
    throw new AdminApiError(0, "Could not reach the server.");
  }

  if (!response.ok) {
    const message = await messageFor(response);
    if (response.status === 401) {
      throw new AdminApiError(401, message || "Sign in to use the operator surface.");
    }
    if (response.status === 403) {
      throw new AdminApiError(
        403,
        message || "This account is not an operator on this deployment.",
      );
    }
    throw new AdminApiError(response.status, message);
  }
  return (await response.json()) as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestUrl<T>(`${BASE}${path}`, init);
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
 * A starter template as the admin routes exchange it. `data` is deliberately
 * `unknown`: the control plane stores the object the client captured without
 * validating it, so the panel has to render whatever comes back.
 */
export interface AdminTemplate {
  id: string;
  name: string;
  description: string;
  version: number;
  data: unknown;
}

export interface TemplateList {
  ok: boolean;
  templates: AdminTemplate[];
}

/** The fields a replace carries. `version` is optional so a rename keeps the stored one. */
export interface TemplateDraft {
  name: string;
  description: string;
  data: unknown;
  version?: number;
}

export interface NewTemplate extends TemplateDraft {
  id: string;
}

export interface TemplateResult {
  ok: boolean;
  template: AdminTemplate;
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

export function getStatus(): Promise<AdminStatus> {
  return request<AdminStatus>("/status");
}

export function listWorkspaces(): Promise<WorkspaceList> {
  return request<WorkspaceList>("/workspaces?limit=200");
}

export function getWorkspace(id: string): Promise<WorkspaceDetail> {
  return request<WorkspaceDetail>(`/workspaces/${encode(id)}`);
}

export function listRooms(): Promise<RoomList> {
  return request<RoomList>("/rooms");
}

export function listShares(
  workspaceId: string,
): Promise<{ workspaceId: string; shares: AdminShare[] }> {
  return request(`/shares?workspaceId=${encode(workspaceId)}`);
}

export function revokeShare(shareId: string): Promise<MutationResult> {
  return request(`/shares/${encode(shareId)}/revoke`, { method: "POST" });
}

export function revokeAllShares(workspaceId: string): Promise<MutationResult> {
  return request(`/shares?workspaceId=${encode(workspaceId)}`, { method: "DELETE" });
}

export function deleteWorkspace(workspaceId: string): Promise<MutationResult> {
  return request(`/workspaces/${encode(workspaceId)}`, {
    method: "DELETE",
    body: JSON.stringify({ confirm: workspaceId }),
  });
}

export function disconnectRoom(roomId: string): Promise<MutationResult> {
  return request(`/rooms/${encode(roomId)}/disconnect`, { method: "POST" });
}

export function createFixtures(input: FixtureRequest): Promise<FixtureResult> {
  return request("/fixtures", { method: "POST", body: JSON.stringify(input) });
}

export function listTemplates(): Promise<TemplateList> {
  return requestUrl<TemplateList>(TEMPLATES_BASE);
}

export function createTemplate(input: NewTemplate): Promise<TemplateResult> {
  return requestUrl<TemplateResult>(TEMPLATES_BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTemplate(id: string, input: TemplateDraft): Promise<TemplateResult> {
  return requestUrl<TemplateResult>(`${TEMPLATES_BASE}/${encode(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteTemplate(id: string): Promise<{ ok: boolean; deleted: true }> {
  return requestUrl(`${TEMPLATES_BASE}/${encode(id)}`, { method: "DELETE" });
}

/** Fetches the export with the bearer header, then saves it through a blob URL. */
export async function downloadExport(workspaceId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/workspaces/${encode(workspaceId)}/export`, {
      headers: await credentialAuthorization(),
      credentials: "include",
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
