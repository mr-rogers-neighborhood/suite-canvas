import { capabilitiesForRole } from "./capabilities.js";
import { authEnabled } from "./env.js";
import { AuthError, isAuthError } from "./errors.js";
import { createInviteKey, type InviteKeyRepository, redeemInviteKey } from "./invites.js";
import { hashInviteKey } from "./keys.js";
import { type LicenceStore, licenceStateFor, type MembershipReader } from "./licences.js";
import { canAddWorkspace, checkSeatAllowance, seatProblemMessage } from "./seats.js";
import type { AccountSession, AuthEnvironment, OrganizationRole } from "./types.js";
import { isInviteKeyRole } from "./types.js";
import { claimWorkspace, memberOf, roleIn, type WorkspaceRepository } from "./workspaces.js";

/**
 * The four routes of the control plane.
 *
 * Shape follows `services/billing/handler.ts` on purpose: one function in, one
 * JSON response out, named error codes in the body, and status codes that are
 * the whole contract. The deployment wrappers differ (that one is a Stripe
 * webhook behind API Gateway, this one is a small REST surface), but an
 * operator who has read one should be able to read the other.
 *
 * Nothing here can write a document. This service has no Loro dependency, no
 * graph dependency and no document store: the strongest version of "an
 * invitation never touches the document" is not being able to reach it.
 */

export interface AuthSessionReader {
  sessionFor: (headers: Record<string, string | undefined>) => Promise<AccountSession | null>;
}

export interface AuthHandlerDeps {
  env: AuthEnvironment;
  workspaces: WorkspaceRepository;
  invites: InviteKeyRepository;
  licences: LicenceStore;
  memberships: MembershipReader;
  /** Null when the account service is off: every route then refuses as unconfigured. */
  sessions: AuthSessionReader | null;
  now?: () => number;
  newId?: () => string;
  log?: AuthLogger;
}

export type AuthLogger = (
  level: "info" | "warn" | "error",
  message: string,
  fields?: Record<string, unknown>,
) => void;

/** API Gateway (REST or HTTP API) proxy event, narrowed to what this service reads. */
export interface AuthHttpEvent {
  httpMethod?: string | null;
  path?: string | null;
  body?: string | null;
  headers?: Record<string, string | undefined> | null;
  isBase64Encoded?: boolean;
}

export interface AuthHttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export type AuthHandler = (event: AuthHttpEvent) => Promise<AuthHttpResponse>;

const JSON_HEADERS = { "content-type": "application/json" };

function json(statusCode: number, body: Record<string, unknown>): AuthHttpResponse {
  return { statusCode, body: JSON.stringify(body), headers: JSON_HEADERS };
}

/** One place mapping a named error to a status, so the contract cannot drift per route. */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  unauthorized: 401,
  forbidden: 403,
  "invalid-request": 400,
  "workspace-already-claimed": 409,
  "workspace-not-found": 404,
  "invite-not-found": 404,
  "invite-revoked": 409,
  "invite-expired": 409,
  "invite-exhausted": 409,
  "auth-not-configured": 503,
  "seat-refused": 403,
  "method-not-allowed": 405,
  "not-found": 404,
};

function failure(error: unknown): AuthHttpResponse {
  if (isAuthError(error)) {
    return json(STATUS_BY_CODE[error.code] ?? 500, {
      ok: false,
      error: error.code,
      message: error.message,
    });
  }
  return json(500, { ok: false, error: "unexpected", message: "the control plane failed" });
}

function bodyOf(event: AuthHttpEvent): Record<string, unknown> {
  const raw = event.body;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new AuthError("invalid-request", "a JSON body is required");
  }
  const text = event.isBase64Encoded === true ? Buffer.from(raw, "base64").toString("utf8") : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AuthError("invalid-request", "the body is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AuthError("invalid-request", "the body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function textField(body: Record<string, unknown>, name: string, required: true): string;
function textField(
  body: Record<string, unknown>,
  name: string,
  required: false,
): string | undefined;
function textField(
  body: Record<string, unknown>,
  name: string,
  required: boolean,
): string | undefined {
  const value = body[name];
  if (value === undefined || value === null) {
    if (required) throw new AuthError("invalid-request", `${name} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new AuthError("invalid-request", `${name} must be text`);
  return value;
}

function integerField(body: Record<string, unknown>, name: string, fallback: number): number {
  const value = body[name];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new AuthError("invalid-request", `${name} must be a whole number`);
  }
  return value;
}

/** Invite keys grant admin or member; `owner` is claimed, never handed out. */
function inviteRoleField(body: Record<string, unknown>): "admin" | "member" {
  const value = textField(body, "role", true);
  if (!isInviteKeyRole(value)) {
    throw new AuthError("invalid-request", "role must be admin or member");
  }
  return value;
}

/** `expiresAt` is epoch milliseconds; the browser sends a timestamp, never a duration. */
function expiryField(body: Record<string, unknown>): number | null {
  const value = body.expiresAt;
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AuthError("invalid-request", "expiresAt must be a timestamp or null");
  }
  return value;
}

/** Resolves the session for a request, or refuses. Never falls back to a body field. */
async function requireSession(
  deps: AuthHandlerDeps,
  event: AuthHttpEvent,
): Promise<AccountSession> {
  if (deps.sessions === null) {
    throw new AuthError("auth-not-configured", "the account service is off");
  }
  const session = await deps.sessions.sessionFor(event.headers ?? {});
  if (session === null) throw new AuthError("unauthorized", "sign in first");
  return session;
}

interface WorkspaceContext {
  organizationId: string;
  role: OrganizationRole;
}

/**
 * The workspace's organization plus the caller's role in it.
 *
 * A workspace nobody owns has no organization, so an account cannot act on it
 * through membership: it has to claim it, which is a separate route with its own
 * ceiling. This keeps "claim" the only door from anonymous to owned.
 */
async function requireWorkspaceRole(
  deps: AuthHandlerDeps,
  workspaceId: string,
  session: AccountSession,
): Promise<WorkspaceContext> {
  const workspace = await deps.workspaces.find(workspaceId);
  if (workspace === null || workspace.organizationId === null) {
    throw new AuthError("workspace-not-found", "this workspace is not owned by any organization");
  }
  const role = roleIn(workspace, session.userId);
  if (role === null) throw new AuthError("forbidden", "you are not a member of this workspace");
  return { organizationId: workspace.organizationId, role };
}

/**
 * The licence refusal for a redemption, raised before any write.
 *
 * A key that does not resolve is left to `redeemInviteKey`, which owns the named
 * "not found / revoked / expired / exhausted" answers: this function only answers
 * the seat question, and staying silent about everything else keeps one owner per
 * refusal.
 */
async function requireSeatForInvite(
  deps: AuthHandlerDeps,
  key: string,
  userId: string,
  now: number,
): Promise<void> {
  const stored = await deps.invites.findByHash(hashInviteKey(key));
  if (stored === null) return;
  const workspace = await deps.workspaces.find(stored.workspaceId);
  if (workspace === null || workspace.organizationId === null) return;
  if (memberOf(workspace, userId) !== null) return;
  const licence = await deps.licences.forOrganization(workspace.organizationId);
  const memberCount = await deps.memberships.countForOrganization(workspace.organizationId);
  const seat = checkSeatAllowance({
    organizationId: workspace.organizationId,
    licence: licenceStateFor(true, licence),
    memberCount: memberCount + 1,
    now,
  });
  if (!seat.ok) throw new AuthError("seat-refused", seatProblemMessage(seat.reason));
}

export function createAuthHandler(deps: AuthHandlerDeps): AuthHandler {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const log: AuthLogger = deps.log ?? (() => {});

  return async function authHandler(event) {
    const method = (event.httpMethod ?? "GET").toUpperCase();
    const path = (event.path ?? "").split("?")[0] ?? "";

    try {
      if (!authEnabled(deps.env)) {
        // Same posture as billing's 503: an off surface says it is off instead of
        // pretending every request is unauthenticated.
        log("warn", "control plane refused", { code: "auth-not-configured", path });
        return json(503, { ok: false, error: "auth-not-configured" });
      }

      if (path === "/api/auth/invites") {
        if (method !== "POST") return methodNotAllowed("POST");
        const session = await requireSession(deps, event);
        const body = bodyOf(event);

        const workspaceId = textField(body, "workspaceId", true).trim();
        const role = inviteRoleField(body);
        const context = await requireWorkspaceRole(deps, workspaceId, session);
        if (!capabilitiesForRole(context.role).canManageLinks) {
          throw new AuthError("forbidden", "only an owner or admin may create invite keys");
        }

        const created = await createInviteKey(
          {
            workspaceId,
            role,
            createdByUserId: session.userId,
            actorRole: context.role,
            expiresAt: expiryField(body),
            maxUses: integerField(body, "maxUses", 1),
            now: now(),
          },
          { workspaces: deps.workspaces, invites: deps.invites, newId },
        );
        log("info", "invite key created", {
          workspaceId,
          inviteKeyId: created.record.id,
          role: created.record.role,
          maxUses: created.record.maxUses,
        });
        // The plaintext key is returned exactly once, to its creator.
        return json(201, { ok: true, key: created.key, invite: created.record });
      }

      if (path === "/api/invites/redeem") {
        if (method !== "POST") return methodNotAllowed("POST");
        const session = await requireSession(deps, event);
        const body = bodyOf(event);
        const key = textField(body, "key", true);

        // The seat check runs *before* the redemption, against the organization
        // the key names, so a full organization never spends the key's last use.
        // A caller who is already a member is not a new seat and is skipped.
        await requireSeatForInvite(deps, key, session.userId, now());

        const outcome = await redeemInviteKey(
          { key, userId: session.userId, now: now() },
          { workspaces: deps.workspaces, invites: deps.invites },
        );
        if (outcome.status === "already-member") {
          log("info", "invite redemption skipped", {
            workspaceId: outcome.workspaceId,
            organizationId: outcome.organizationId,
            status: outcome.status,
          });
          return json(200, {
            ok: true,
            status: "already-member",
            organizationId: outcome.organizationId,
            workspaceId: outcome.workspaceId,
            role: outcome.role,
          });
        }

        log("info", "invite key redeemed", {
          workspaceId: outcome.workspaceId,
          organizationId: outcome.organizationId,
          role: outcome.role,
        });
        return json(200, {
          ok: true,
          status: "redeemed",
          organizationId: outcome.organizationId,
          workspaceId: outcome.workspaceId,
          role: outcome.role,
        });
      }

      if (path === "/api/workspaces/claim") {
        if (method !== "POST") return methodNotAllowed("POST");
        const session = await requireSession(deps, event);
        const body = bodyOf(event);

        const workspaceId = textField(body, "workspaceId", true).trim();
        const requested = textField(body, "organizationId", false);
        const organizationId = (requested ?? session.organizationId ?? "").trim();
        if (organizationId.length === 0) {
          throw new AuthError("invalid-request", "organizationId is required");
        }
        const actorRole = await deps.memberships.roleFor(organizationId, session.userId);
        if (actorRole === null) {
          throw new AuthError("forbidden", "you are not a member of that organization");
        }
        if (!capabilitiesForRole(actorRole).canManageLinks) {
          throw new AuthError("forbidden", "only an owner or admin may claim a workspace");
        }

        // A claim that is already ours is a no-op and must not be refused by a
        // ceiling it already sits inside; only a genuinely new row counts.
        const existing = await deps.workspaces.find(workspaceId);
        if (
          existing !== null &&
          existing.organizationId !== null &&
          existing.organizationId !== organizationId
        ) {
          throw new AuthError(
            "workspace-already-claimed",
            "this workspace already belongs to another organization",
          );
        }
        if (existing === null || existing.organizationId === null) {
          const count = await deps.workspaces.countForOrganization(organizationId);
          const licence = await deps.licences.forOrganization(organizationId);
          const room = canAddWorkspace({
            organizationId,
            licence: licenceStateFor(true, licence),
            workspaceCount: count,
            now: now(),
          });
          if (!room.ok) {
            throw new AuthError("seat-refused", seatProblemMessage(room.reason));
          }
        }

        const outcome = await claimWorkspace(
          {
            workspaceId,
            organizationId,
            name: textField(body, "name", false) ?? null,
            now: now(),
          },
          { workspaces: deps.workspaces },
        );
        log("info", outcome.status === "claimed" ? "workspace claimed" : "claim no-op", {
          workspaceId: outcome.workspace.workspaceId,
          organizationId,
        });
        return json(outcome.status === "claimed" ? 201 : 200, {
          ok: true,
          status: outcome.status,
          workspaceId: outcome.workspace.workspaceId,
          organizationId: outcome.workspace.organizationId,
          name: outcome.workspace.name,
        });
      }

      const membersMatch = /^\/api\/workspaces\/([^/]+)\/members$/u.exec(path);
      if (membersMatch !== null) {
        if (method !== "GET") return methodNotAllowed("GET");
        const session = await requireSession(deps, event);
        const workspaceId = decodeURIComponent(membersMatch[1] ?? "");
        await requireWorkspaceRole(deps, workspaceId, session);
        const workspace = await deps.workspaces.find(workspaceId);
        const members = workspace?.members ?? [];
        return json(200, {
          ok: true,
          workspaceId,
          organizationId: workspace?.organizationId ?? null,
          members: members.map((member) => ({
            userId: member.userId,
            role: member.role,
            createdAt: member.createdAt,
          })),
        });
      }

      return json(404, { ok: false, error: "not-found" });
    } catch (error) {
      const response = failure(error);
      const fields = isAuthError(error)
        ? { code: error.code, path, method }
        : { code: "unexpected", path, method, problem: String(error) };
      log(response.statusCode >= 500 ? "error" : "warn", "control plane refused", fields);
      return response;
    }
  };
}

function methodNotAllowed(allowed: string): AuthHttpResponse {
  return {
    statusCode: 405,
    body: JSON.stringify({ ok: false, error: "method-not-allowed" }),
    headers: { ...JSON_HEADERS, allow: allowed },
  };
}
