import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AuthEntry,
  AuthEnvironment,
  AuthHttpEvent,
  createAuthHandler,
  MembershipReader,
} from "@suite/auth";
import type { Logger } from "../logging.js";
import { sessionReader } from "./context.js";
import type { GrantStore } from "./grants.js";
import type { NoticeStore } from "./notices.js";
import { type createRoleOverrideStore, isWearableRole, overrideBody } from "./roleOverride.js";

/** The account-side routes that are ours rather than Better Auth's. */
export const ACCOUNT_PATHS: readonly string[] = [
  // Support access and impersonation, which are ours: the plugin owns the mechanism and
  // this module owns the consent gate, the flag and the audit line.
  "/api/account/support-access",
  "/api/account/role-override",
  "/api/account/notices",
  "/api/account/impersonate",
  "/api/account/stop-impersonating",
  "/api/workspaces/claim",
  "/api/invites/redeem",
  "/api/account",
  "/api/account/export",
  "/api/account/workspaces",
];

/** `GET /api/workspaces/:id/members`. The relay's `:id/claim` deliberately does not match. */
export const MEMBERS_PATH = /^\/api\/workspaces\/[^/]+\/members$/u;

/** A body larger than this is not a sign-in, a claim or an invitation. */
export const MAX_BODY_BYTES = 1_048_576;

export function pathOf(target: string | undefined): string {
  if (target === undefined) return "/";
  const query = target.indexOf("?");
  return query === -1 ? target : target.slice(0, query);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The origin Better Auth should think the request arrived on. */
export function originOf(env: AuthEnvironment, request: IncomingMessage): string {
  const configured = env.SUITE_AUTH_URL?.trim();
  if (configured !== undefined && configured.length > 0) return new URL(configured).origin;
  const host = request.headers.host ?? "localhost";
  return `http://${host}`;
}

/** Inbound headers as a `Headers`, dropping the array-valued ones Node allows. */
export function headersOf(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  return headers;
}

/** Reads the body, refusing one that is not an auth payload. */
export async function bodyOf(
  request: IncomingMessage,
): Promise<{ ok: true; body: string | null } | { ok: false }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) return { ok: false };
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return { ok: true, body: body.length === 0 ? null : body };
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  response.end(text);
}

/** A `Response` from Better Auth, written onto the node response. */
export async function writeResponse(response: ServerResponse, source: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  source.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") headers[name] = value;
  });
  // `set-cookie` is the one header that repeats; `forEach` joins it, which would
  // corrupt two cookies into one invalid value.
  const cookies = source.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;

  const bytes = Buffer.from(await source.arrayBuffer());
  response.writeHead(source.status, headers);
  response.end(bytes.byteLength === 0 ? undefined : bytes);
}

/**
 * The plugin's own refusal, when the body is one.
 *
 * Better Auth answers an endpoint-level refusal with a `code` and a `message` on a 200,
 * so a caller that only reads the status reports success for a thing that did not happen.
 */
export function refusalOf(
  body: string,
): { code: string; message: string; enrollAt?: string } | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown; enrollAt?: unknown };
    if (typeof parsed.code !== "string" || parsed.code.length === 0) return null;
    return {
      code: parsed.code,
      message: typeof parsed.message === "string" ? parsed.message : parsed.code,
      ...(typeof parsed.enrollAt === "string" ? { enrollAt: parsed.enrollAt } : {}),
    };
  } catch {
    return null;
  }
}

/** The request id the host put on the header, when it is there. */
export function requestIdOf(request: IncomingMessage): string | undefined {
  const value = request.headers["x-request-id"];
  return typeof value === "string" ? value : undefined;
}

/**
 * What this account has been told, and the act of reading it.
 *
 * `GET` lists its own notices, each with the time it arrived and whether it has been read;
 * `PUT /api/account/notices/:id` marks one read. Both read the id from the session, so one
 * account can never mark another's notice.
 */
export async function handleNotices(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  notices: () => NoticeStore,
): Promise<boolean> {
  if (path !== "/api/account/notices" && !path.startsWith("/api/account/notices/")) {
    return false;
  }

  const cookies = typeof request.headers.cookie === "string" ? request.headers.cookie : "";
  const session = await sessionReader()?.({ cookie: cookies });
  if (!session) {
    sendJson(response, 401, {
      ok: false,
      error: "unauthorized",
      message: "sign in to read your notices",
    });
    return true;
  }

  const method = request.method ?? "GET";
  if (path === "/api/account/notices") {
    if (method !== "GET") {
      sendJson(response, 405, { error: "method-not-allowed", requestId: requestIdOf(request) });
      return true;
    }
    const list = await notices().listFor(session.userId);
    sendJson(response, 200, {
      ok: true,
      notices: list,
      unread: list.filter((notice) => notice.readAt === null).length,
    });
    return true;
  }

  if (method !== "PUT") {
    sendJson(response, 405, { error: "method-not-allowed", requestId: requestIdOf(request) });
    return true;
  }
  const id = Number.parseInt(path.slice("/api/account/notices/".length), 10);
  if (!Number.isFinite(id)) {
    sendJson(response, 400, { ok: false, error: "invalid-id", message: "expected a notice id" });
    return true;
  }
  const marked = await notices().markRead(session.userId, id);
  if (!marked) {
    sendJson(response, 404, {
      ok: false,
      error: "not-found",
      message: "no notice with that id belongs to this account",
    });
    return true;
  }
  sendJson(response, 200, { ok: true, id, readAt: Date.now() });
  return true;
}

export interface RoleOverrideContext {
  roleOverrides: () => ReturnType<typeof createRoleOverrideStore>;
  realRoleOf: (
    organizationId: string | null,
    userId: string,
  ) => Promise<Awaited<ReturnType<MembershipReader["roleFor"]>>>;
  record: (entry: {
    actor: string;
    action: string;
    target: string;
    outcome: string;
    details?: Record<string, unknown>;
  }) => void;
  logger: Logger;
}

/**
 * Wearing a role: read it, put it on, take it off.
 *
 * Any signed-in account may *read* its own answer, because the app draws a strip from it
 * and a member with no override should get a quiet `null` rather than a 403. Only an
 * operator may write: the organization comes from the session, never from the body, so a
 * worn role cannot point at a tenant the operator is not in.
 */
export async function handleRoleOverride(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  ctx: RoleOverrideContext,
): Promise<boolean> {
  if (path !== "/api/account/role-override") return false;

  const cookies = typeof request.headers.cookie === "string" ? request.headers.cookie : "";
  const session = await sessionReader()?.({ cookie: cookies });
  if (!session) {
    sendJson(response, 401, {
      ok: false,
      error: "unauthorized",
      message: "sign in to read or change your role",
    });
    return true;
  }

  const method = request.method ?? "GET";
  if (method === "GET") {
    // A non-operator never has one, so the read does not touch the table for them.
    const override = session.operator ? await ctx.roleOverrides().get(session.userId) : null;
    sendJson(response, 200, {
      ok: true,
      ...overrideBody(override),
      realRole: await ctx.realRoleOf(session.organizationId, session.userId),
    });
    return true;
  }

  if (method !== "PUT" && method !== "DELETE") {
    sendJson(response, 405, { error: "method-not-allowed", requestId: requestIdOf(request) });
    return true;
  }
  if (!session.operator) {
    sendJson(response, 403, {
      ok: false,
      error: "forbidden",
      message: "wearing a role is an operator surface",
    });
    return true;
  }
  if (session.organizationId === null) {
    sendJson(response, 400, {
      ok: false,
      error: "no-organization",
      message: "choose an organization before wearing a role in it",
    });
    return true;
  }

  if (method === "DELETE") {
    await ctx.roleOverrides().clear(session.userId);
    await ctx.record({
      actor: session.userId,
      action: "role.clear",
      target: session.organizationId,
      outcome: "ok",
    });
    sendJson(response, 200, {
      ok: true,
      ...overrideBody(null),
      realRole: await ctx.realRoleOf(session.organizationId, session.userId),
    });
    return true;
  }

  const read = await bodyOf(request);
  let body: { role?: unknown } | null = null;
  try {
    body = read.ok && read.body !== null ? (JSON.parse(read.body) as { role?: unknown }) : null;
  } catch {
    body = null;
  }
  const role = body?.role;
  if (!isWearableRole(role)) {
    sendJson(response, 400, {
      ok: false,
      error: "invalid-body",
      message: "expected { role } to be owner, admin or member",
    });
    return true;
  }

  const written = await ctx.roleOverrides().set({
    userId: session.userId,
    organizationId: session.organizationId,
    role,
  });
  await ctx.record({
    actor: session.userId,
    action: "role.play",
    target: session.organizationId,
    outcome: "ok",
    details: { role, realRole: await ctx.realRoleOf(session.organizationId, session.userId) },
  });
  ctx.logger.info("an operator is wearing a role", {
    actor: session.userId,
    role,
    organizationId: session.organizationId,
  });
  sendJson(response, 200, {
    ok: true,
    ...overrideBody(written),
    realRole: await ctx.realRoleOf(session.organizationId, session.userId),
  });
  return true;
}

export interface SupportAccessContext {
  grants: () => GrantStore;
  record: (entry: {
    actor: string;
    action: string;
    target: string;
    outcome: string;
    details?: Record<string, unknown>;
  }) => void;
  logger: Logger;
}

/**
 * The account's own view of its support grant.
 *
 * This is the whole consent surface: the account reads whether support access is on,
 * turns it on, and turns it off again. It never names an operator, so the permission is
 * "support may look while this is on", not a standing relationship with a person.
 */
export async function handleSupportAccess(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  ctx: SupportAccessContext,
): Promise<boolean> {
  if (path !== "/api/account/support-access") return false;

  const cookies = typeof request.headers.cookie === "string" ? request.headers.cookie : "";
  const session = await sessionReader()?.({ cookie: cookies });
  if (!session) {
    sendJson(response, 401, {
      ok: false,
      error: "unauthorized",
      message: "sign in to change your support access",
    });
    return true;
  }

  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "PUT" && method !== "DELETE") {
    sendJson(response, 405, { error: "method-not-allowed", requestId: requestIdOf(request) });
    return true;
  }
  if (method === "PUT") await ctx.grants().grant(session.userId);
  if (method === "DELETE") await ctx.grants().revoke(session.userId);

  const grant = await ctx.grants().get(session.userId);
  if (method !== "GET") {
    await ctx.record({
      actor: session.userId,
      action: method === "PUT" ? "support-access.grant" : "support-access.revoke",
      target: session.userId,
      outcome: "ok",
    });
    ctx.logger.info("support access changed", {
      account: session.userId,
      granted: method === "PUT",
    });
  }
  sendJson(response, 200, {
    ok: true,
    granted: grant !== null && grant.revokedAt === null,
    grantedAt: grant?.grantedAt ?? null,
    revokedAt: grant?.revokedAt ?? null,
  });
  return true;
}

export async function handleAccount(
  request: IncomingMessage,
  response: ServerResponse,
  entry: AuthEntry,
  handlerFor: (entry: AuthEntry) => ReturnType<typeof createAuthHandler>,
): Promise<void> {
  const read = await bodyOf(request);
  if (!read.ok) {
    sendJson(response, 413, { error: "payload_too_large", requestId: requestIdOf(request) });
    return;
  }
  const event: AuthHttpEvent = {
    httpMethod: request.method ?? "GET",
    path: pathOf(request.url),
    body: read.body,
    headers: {
      ...(typeof request.headers.cookie === "string" ? { cookie: request.headers.cookie } : {}),
      ...(typeof request.headers["x-request-id"] === "string"
        ? { "x-request-id": request.headers["x-request-id"] }
        : {}),
    },
  };
  const answer = await handlerFor(entry)(event);
  const headers: Record<string, string> = { ...answer.headers };
  const requestId = requestIdOf(request);
  if (requestId !== undefined) headers["x-request-id"] = requestId;
  response.writeHead(answer.statusCode, headers);
  response.end(answer.body);
}
