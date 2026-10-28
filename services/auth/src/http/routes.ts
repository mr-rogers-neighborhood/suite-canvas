import { err, fromPromise, ok, type Result } from "neverthrow";
import { eraseAccount } from "../account/erase.js";
import { accountExport, accountExportFileName } from "../account/export.js";
import type { AccountStore, WorkspaceDataStore } from "../account/store.js";
import { capabilitiesForRole } from "../identity/capabilities.js";
import type { EnrollmentRedeemInput, RedemptionRefusal } from "../invitations/enrollment.js";
import { licenceStateFor } from "../licensing/licences.js";
import { canAddWorkspace, seatProblemMessage } from "../organizations/seats.js";
import { claimWorkspace, roleIn } from "../organizations/workspaces.js";
import type { AccountSession, OrganizationRole } from "../types.js";
import { authEnabled } from "./env.js";
import { AuthError } from "./errors.js";
import type { AuthHandlerDeps, AuthLogger } from "./handler.js";
import {
  type AuthHttpEvent,
  type HandlerRefusal,
  json,
  methodNotAllowed,
  methodOf,
  pathOf,
  type RouteResult,
  refusalOf,
  unexpected,
} from "./response.js";

/**
 * The account-surface routes of the control plane.
 *
 * Every reader here answers with a `Result`, so validation composes instead of being
 * thrown up a level: a route lists the fields it needs, hands the first refusal back
 * unchanged, and the handler turns it into a response once.
 */

const REDEEM_PATH = "/api/invites/redeem";
const CLAIM_PATH = "/api/workspaces/claim";
const MEMBERS_PATH = /^\/api\/workspaces\/([^/]+)\/members$/u;
const ACCOUNT_PATH = "/api/account";
const ACCOUNT_EXPORT_PATH = "/api/account/export";
const ACCOUNT_WORKSPACES_PATH = "/api/account/workspaces";

/**
 * The request body, as a refusal rather than an exception.
 *
 * API Gateway base64-encodes a body it could not decode as UTF-8, so it is restored
 * before parsing. A body that is not a JSON object is a caller error, not a fault.
 */
function bodyOf(event: AuthHttpEvent): Result<Record<string, unknown>, HandlerRefusal> {
  const raw = event.body;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return err(new AuthError("invalid-request", "a JSON body is required"));
  }
  const text = event.isBase64Encoded === true ? Buffer.from(raw, "base64").toString("utf8") : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err(new AuthError("invalid-request", "the body is not JSON"));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err(new AuthError("invalid-request", "the body must be a JSON object"));
  }
  return ok(parsed as Record<string, unknown>);
}

/** A field that must be text. Two functions rather than a flag, so a call site reads. */
function requiredText(body: Record<string, unknown>, name: string): Result<string, HandlerRefusal> {
  const value = body[name];
  if (value === undefined || value === null) {
    return err(new AuthError("invalid-request", `${name} is required`));
  }
  return typeof value === "string"
    ? ok(value)
    : err(new AuthError("invalid-request", `${name} must be text`));
}

/** Every optional field at once: absent stays absent, anything not text refuses. */
function optionalTexts<Name extends string>(
  body: Record<string, unknown>,
  names: readonly Name[],
): Result<Partial<Record<Name, string>>, HandlerRefusal> {
  const values: Partial<Record<Name, string>> = {};
  for (const name of names) {
    const value = body[name];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      return err(new AuthError("invalid-request", `${name} must be text`));
    }
    values[name] = value;
  }
  return ok(values);
}

/** Resolves the session for a request, or refuses. Never falls back to a body field. */
async function requireSession(
  deps: AuthHandlerDeps,
  event: AuthHttpEvent,
): Promise<Result<AccountSession, HandlerRefusal>> {
  if (deps.sessions === null) {
    return err(new AuthError("auth-not-configured", "the account service is off"));
  }
  const session = await deps.sessions.sessionFor(event.headers ?? {});
  return session === null ? err(new AuthError("unauthorized", "sign in first")) : ok(session);
}

interface WorkspaceContext {
  organizationId: string;
  role: OrganizationRole;
}

/**
 * The workspace's organization plus the caller's role in it.
 *
 * A workspace nobody owns has no organization, so an account cannot act on it through
 * membership: it has to claim it, which is a separate route with its own ceiling. This
 * keeps "claim" the only door from anonymous to owned.
 */
async function workspaceContext(
  deps: AuthHandlerDeps,
  workspaceId: string,
  session: AccountSession,
): Promise<Result<WorkspaceContext, HandlerRefusal>> {
  const workspace = await deps.workspaces.find(workspaceId);
  if (workspace === null || workspace.organizationId === null) {
    return err(
      new AuthError("workspace-not-found", "this workspace is not owned by any organization"),
    );
  }
  const role = roleIn(workspace, session.userId);
  if (role === null) {
    return err(new AuthError("forbidden", "you are not a member of this workspace"));
  }
  return ok({ organizationId: workspace.organizationId, role });
}

function redeemFieldsOf(event: AuthHttpEvent): Result<EnrollmentRedeemInput, HandlerRefusal> {
  const body = bodyOf(event);
  if (body.isErr()) return err(body.error);
  const token = requiredText(body.value, "token");
  if (token.isErr()) return err(token.error);
  const optional = optionalTexts(body.value, ["password", "name", "email"]);
  if (optional.isErr()) return err(optional.error);
  return ok({
    token: token.value.trim(),
    headers: event.headers ?? {},
    ...optional.value,
  });
}

/**
 * Redeem an invitation.
 *
 * The only route that changes membership without a member session, and that is
 * structural rather than an exception: a private invitation exists to create the
 * account that accepts it, so there is nobody to authenticate as yet. The invitation
 * token *is* the credential, and the plugin verifies it — hashed at rest, single use,
 * expiring, revocable — while the seat question is answered inside the plugin from our
 * licence (`resolveSeatLimit`).
 *
 * Two things this route adds on top of the plugin, both guardrails:
 *
 * - **Our error vocabulary.** A plugin rename cannot turn "expired" into a 200;
 *   `redemptionResult` in `invitations/enrollment.ts` maps what it knows and refuses
 *   what it does not recognise.
 * - **Nothing but the token and the password crosses the boundary.** No role, no
 *   organization id and no user id come from the body: those are decided by the
 *   invitation row, which an owner wrote.
 */
async function redeemRoute(
  deps: AuthHandlerDeps,
  event: AuthHttpEvent,
  log: AuthLogger,
): Promise<RouteResult> {
  if (methodOf(event) !== "POST") return ok(methodNotAllowed("POST"));
  const enrollment = deps.enrollment;
  if (enrollment === null) {
    return err(new AuthError("auth-not-configured", "the invitation engine is not wired"));
  }

  const fields = redeemFieldsOf(event);
  if (fields.isErr()) return err(fields.error);

  const redemption = await enrollment.redeem(fields.value);
  if (redemption.isErr()) return err(refusalForRedemption(redemption.error, log));

  const outcome = redemption.value;
  if (outcome.status === "sign-in-required") {
    // Not a failure and not a redemption: the link is intact, but the person has an
    // account and has not proved it yet. Nothing was written.
    log("info", "invite redemption deferred", { status: outcome.status });
    return err(
      new AuthError("unauthorized", "sign in first, then open the invitation again to join"),
    );
  }

  log("info", "invite redeemed", {
    organizationId: outcome.organizationId,
    role: outcome.role,
    signedIn: outcome.signedIn,
  });
  return ok(
    json(200, {
      ok: true,
      status: outcome.status,
      organizationId: outcome.organizationId,
      role: outcome.role,
    }),
  );
}

/**
 * The redemption port's refusal, as this boundary's refusal.
 *
 * An engine outage is logged with its own sentence and answered `unexpected`: the
 * caller must not be told which internal step failed.
 */
function refusalForRedemption(refusal: RedemptionRefusal, log: AuthLogger): HandlerRefusal {
  if (refusal.kind === "refused") return { code: refusal.code, message: refusal.message };
  log("error", "invite redemption failed", { problem: refusal.message });
  return unexpected();
}

interface ClaimFields {
  workspaceId: string;
  organizationId: string | undefined;
  name: string | null;
}

function claimFieldsOf(event: AuthHttpEvent): Result<ClaimFields, HandlerRefusal> {
  const body = bodyOf(event);
  if (body.isErr()) return err(body.error);
  const workspaceId = requiredText(body.value, "workspaceId");
  if (workspaceId.isErr()) return err(workspaceId.error);
  const optional = optionalTexts(body.value, ["organizationId", "name"]);
  if (optional.isErr()) return err(optional.error);
  return ok({
    workspaceId: workspaceId.value.trim(),
    organizationId: optional.value.organizationId,
    name: optional.value.name ?? null,
  });
}

/** `POST /api/workspaces/claim` — the only door from an anonymous workspace to an owned one. */
async function claimRoute(
  deps: AuthHandlerDeps,
  event: AuthHttpEvent,
  now: () => number,
  log: AuthLogger,
): Promise<RouteResult> {
  if (methodOf(event) !== "POST") return ok(methodNotAllowed("POST"));

  const session = await requireSession(deps, event);
  if (session.isErr()) return err(session.error);
  const fields = claimFieldsOf(event);
  if (fields.isErr()) return err(fields.error);

  const organizationId = (fields.value.organizationId ?? session.value.organizationId ?? "").trim();
  if (organizationId.length === 0) {
    return err(new AuthError("invalid-request", "organizationId is required"));
  }
  const actorRole = await deps.memberships.roleFor(organizationId, session.value.userId);
  if (actorRole === null) {
    return err(new AuthError("forbidden", "you are not a member of that organization"));
  }
  if (!capabilitiesForRole(actorRole).canManageLinks) {
    return err(new AuthError("forbidden", "only an owner or admin may claim a workspace"));
  }

  // A claim that is already ours is a no-op and must not be refused by a ceiling it
  // already sits inside; only a genuinely new row counts.
  const existing = await deps.workspaces.find(fields.value.workspaceId);
  if (
    existing !== null &&
    existing.organizationId !== null &&
    existing.organizationId !== organizationId
  ) {
    return err(
      new AuthError(
        "workspace-already-claimed",
        "this workspace already belongs to another organization",
      ),
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
      // The two ceilings get two codes because they need two sentences in the app: a plan
      // with no workspace at all is "choose a plan", and a plan whose workspaces are used
      // up is "you have three already". `plan-required` is the launch state, because a
      // hosted account is born with a zero-workspace licence.
      const code =
        room.reason === "workspace-allowance-exhausted" && (licence?.claims.workspaces ?? 0) <= 0
          ? "plan-required"
          : room.reason === "workspace-allowance-exhausted"
            ? "workspace-limit"
            : "seat-refused";
      return err(new AuthError(code, seatProblemMessage(room.reason)));
    }
  }

  // The claim itself is a domain rule that throws (it refuses to move an owned
  // workspace and refuses to rename one); this is the seam where that becomes a
  // refusal like any other.
  const outcome = await fromPromise(
    claimWorkspace(
      {
        workspaceId: fields.value.workspaceId,
        organizationId,
        name: fields.value.name,
        now: now(),
      },
      { workspaces: deps.workspaces },
    ),
    refusalOf,
  );
  if (outcome.isErr()) return err(outcome.error);

  log("info", outcome.value.status === "claimed" ? "workspace claimed" : "claim no-op", {
    workspaceId: outcome.value.workspace.workspaceId,
    organizationId,
  });
  return ok(
    json(outcome.value.status === "claimed" ? 201 : 200, {
      ok: true,
      status: outcome.value.status,
      workspaceId: outcome.value.workspace.workspaceId,
      organizationId: outcome.value.workspace.organizationId,
      name: outcome.value.workspace.name,
    }),
  );
}

/** `GET /api/workspaces/:id/members` — who is in the tenant that owns this workspace. */
async function membersRoute(
  deps: AuthHandlerDeps,
  event: AuthHttpEvent,
  workspaceId: string,
): Promise<RouteResult> {
  if (methodOf(event) !== "GET") return ok(methodNotAllowed("GET"));

  const session = await requireSession(deps, event);
  if (session.isErr()) return err(session.error);
  const context = await workspaceContext(deps, workspaceId, session.value);
  if (context.isErr()) return err(context.error);

  const workspace = await deps.workspaces.find(workspaceId);
  const members = workspace?.members ?? [];
  return ok(
    json(200, {
      ok: true,
      workspaceId,
      organizationId: workspace?.organizationId ?? null,
      members: members.map((member) => ({
        userId: member.userId,
        role: member.role,
        createdAt: member.createdAt,
      })),
    }),
  );
}

/** The stores the account routes need, or the refusal a deployment earns by omitting them. */
function accountStores(
  deps: AuthHandlerDeps,
): Result<{ accounts: AccountStore; workspaceData: WorkspaceDataStore | null }, HandlerRefusal> {
  const accounts = deps.accounts ?? null;
  if (accounts === null) {
    return err(new AuthError("auth-not-configured", "the account store is not wired"));
  }
  return ok({ accounts, workspaceData: deps.workspaceData ?? null });
}

/**
 * `GET /api/account/export` — everything the account owns, as one download.
 *
 * The file references documents instead of copying them, and the reason is inside the
 * file: a `.suite` export already exists per workspace, and this service holds no
 * document store to copy from. Share metadata comes from the relay when a deployment
 * wired one, and a workspace says so when it did not, so an empty list is never
 * mistaken for "no links".
 */
async function exportRoute(
  deps: AuthHandlerDeps,
  event: AuthHttpEvent,
  now: () => number,
  log: AuthLogger,
): Promise<RouteResult> {
  if (methodOf(event) !== "GET") return ok(methodNotAllowed("GET"));

  const session = await requireSession(deps, event);
  if (session.isErr()) return err(session.error);
  const stores = accountStores(deps);
  if (stores.isErr()) return err(stores.error);

  const document = await accountExport(
    { userId: session.value.userId },
    { accounts: stores.value.accounts, workspaceData: stores.value.workspaceData, now },
  );
  log("info", "account exported", {
    userId: session.value.userId,
    organizations: document.organizations.length,
  });
  return ok({
    statusCode: 200,
    body: JSON.stringify(document),
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${accountExportFileName(
        document.account.userId,
        document.exportedAt,
      )}"`,
      "cache-control": "no-store",
    },
  });
}

/**
 * The body of a delete, as a confirmation the caller meant it.
 *
 * Same shape as the relay's workspace delete: the body repeats the id the route already
 * knows, so a request that arrives from the wrong tab or a stale form cannot erase an
 * account it never named.
 */
function eraseConfirmationOf(event: AuthHttpEvent, userId: string): Result<true, HandlerRefusal> {
  const body = bodyOf(event);
  if (body.isErr()) {
    return err(
      new AuthError("invalid-request", `deleting an account requires {"confirm":"${userId}"}`),
    );
  }
  const confirm = body.value.confirm;
  if (typeof confirm !== "string" || confirm.trim() !== userId) {
    return err(
      new AuthError("invalid-request", `deleting an account requires {"confirm":"${userId}"}`),
    );
  }
  return ok(true);
}

/**
 * `DELETE /api/account` — the account, and every store it owns.
 *
 * The answer is the report, never a bare success: what each store removed, what it
 * could not, and what a retry does. `200` means the account row is gone; `500` means it
 * is not, because the ordering stops before the control plane when a relay delete fails
 * and Postgres rolls back as one transaction. In both cases the body says which.
 */
async function eraseRoute(
  deps: AuthHandlerDeps,
  event: AuthHttpEvent,
  now: () => number,
  log: AuthLogger,
): Promise<RouteResult> {
  if (methodOf(event) !== "DELETE") return ok(methodNotAllowed("DELETE"));

  const session = await requireSession(deps, event);
  if (session.isErr()) return err(session.error);
  const stores = accountStores(deps);
  if (stores.isErr()) return err(stores.error);

  const confirmed = eraseConfirmationOf(event, session.value.userId);
  if (confirmed.isErr()) return err(confirmed.error);

  const report = await eraseAccount(
    { userId: session.value.userId },
    {
      accounts: stores.value.accounts,
      workspaceData: stores.value.workspaceData,
      now,
    },
  );
  log(report.deleted ? "info" : "warn", "account erased", {
    userId: report.userId,
    deleted: report.deleted,
    complete: report.complete,
    remaining: report.stores
      .filter((store) => store.status !== "removed")
      .map((store) => `${store.store}:${store.status}`),
  });
  return ok({
    statusCode: report.deleted ? 200 : 500,
    body: JSON.stringify(report),
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * `GET /api/account/workspaces` — the workspaces this account may open.
 *
 * The launcher asks this to tell a workspace saved in this browser from one the
 * account already holds, which is the difference between "on this device" and
 * "synced". Only the account's own memberships are read, so the answer is also the
 * list a second browser sees after signing in.
 *
 * A held account gets the same empty list as one with nothing yet: admission gates
 * *creating* an organization, so there is nothing here to refuse, and a `403` would
 * read as a fault rather than as a gate.
 */
async function workspacesRoute(deps: AuthHandlerDeps, event: AuthHttpEvent): Promise<RouteResult> {
  if (methodOf(event) !== "GET") return ok(methodNotAllowed("GET"));

  const session = await requireSession(deps, event);
  if (session.isErr()) return err(session.error);
  const stores = accountStores(deps);
  if (stores.isErr()) return err(stores.error);

  const snapshot = await stores.value.accounts.read(session.value.userId);
  const workspaces = (snapshot?.workspaces ?? []).map((workspace) => ({
    id: workspace.workspaceId,
    organizationId: workspace.organizationId,
    name: workspace.name,
    createdAt: workspace.createdAt,
    archivedAt: workspace.archivedAt,
  }));
  return ok({
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      workspaces,
      organizations: (snapshot?.organizations ?? []).map((organization) => ({
        id: organization.organizationId,
        name: organization.name,
        role: organization.role,
      })),
    }),
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** The route table, as one function: path first, then method, then the work. */
export async function routeOf(
  deps: AuthHandlerDeps,
  event: AuthHttpEvent,
  now: () => number,
  log: AuthLogger,
): Promise<RouteResult> {
  const method = methodOf(event);
  const path = pathOf(event);

  if (!authEnabled(deps.env)) {
    // Same posture as billing's 503: an off surface says it is off instead of
    // pretending every request is unauthenticated.
    log("warn", "control plane refused", { code: "auth-not-configured", path, method });
    return ok(json(503, { ok: false, error: "auth-not-configured" }));
  }

  if (path === REDEEM_PATH) return redeemRoute(deps, event, log);
  if (path === CLAIM_PATH) return claimRoute(deps, event, now, log);
  if (path === ACCOUNT_EXPORT_PATH) return exportRoute(deps, event, now, log);
  if (path === ACCOUNT_PATH) return eraseRoute(deps, event, now, log);
  if (path === ACCOUNT_WORKSPACES_PATH) return workspacesRoute(deps, event);

  const membersMatch = MEMBERS_PATH.exec(path);
  if (membersMatch !== null) {
    return membersRoute(deps, event, decodeURIComponent(membersMatch[1] ?? ""));
  }

  return ok(json(404, { ok: false, error: "not-found" }));
}
