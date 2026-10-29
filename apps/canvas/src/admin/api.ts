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
    /** The server's own error code, when it sent one, so a caller can act on it. */
    readonly code: string | null = null,
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

async function failureFor(response: Response): Promise<{ message: string; code: string | null }> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      return {
        message:
          typeof body.message === "string" && body.message.trim().length > 0
            ? body.message
            : body.error,
        code: body.error,
      };
    }
  } catch {
    // Not JSON; fall through to the status line.
  }
  return { message: `${response.status} ${response.statusText}`.trim(), code: null };
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
    const { message, code } = await failureFor(response);
    if (response.status === 401) {
      throw new AdminApiError(401, message || "Sign in to use the operator surface.", code);
    }
    if (response.status === 403) {
      throw new AdminApiError(
        403,
        message || "This account is not an operator on this deployment.",
        code,
      );
    }
    throw new AdminApiError(response.status, message, code);
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

/** The licence the gate would read for a workspace, as the relay reports it. */
export interface WorkspaceLicence {
  tier: string;
  licenceId: string;
  expiresAt: number;
  expired: boolean;
  email: string | null;
}

export interface WorkspaceRow {
  id: string;
  claimed: boolean;
  licence: WorkspaceLicence | null;
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
  if (!response.ok) {
    const { message, code } = await failureFor(response);
    throw new AdminApiError(response.status, message, code);
  }

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

/**
 * Settings live in the control plane, not the relay: it owns the account database and
 * therefore the table, and the relay reads its values through the environment fallback.
 */
const SETTINGS_BASE = `${authServiceBase()}/admin/settings`;

export interface AdminSetting {
  key: string;
  group: "billing" | "mail" | "licence" | "backup" | "limits" | "flags";
  kind: "string" | "number" | "boolean" | "enum" | "secret";
  help: string;
  overridable: boolean;
  values?: readonly string[];
  value: string | number | boolean | null;
  source: "organization" | "global" | "env" | "default";
  env: string;
  /** When this row was last written, or null when it has never been written. */
  savedAt?: number | null;
}

/** What one Stripe profile holds, and what it is waiting for. */
export interface StripeProfile {
  complete: boolean;
  /** Registry keys still holding nothing, named so the panel can say which to fill. */
  missing: string[];
  /** Plans the price table names, or null when it does not parse. */
  plans: number | null;
  problem: string | null;
}

export interface BillingProfiles {
  /** The mode the settings row names, which is what the next boot will spend. */
  active: "test" | "live";
  profiles: Record<"test" | "live", StripeProfile>;
}

export async function listSettings(organizationId?: string | null): Promise<{
  organizationId: string | null;
  /** When the control plane that answered this started, for the restart marker. */
  bootedAt?: number;
  /** Both Stripe profiles, so switching modes is a decision rather than a discovery. */
  billing?: BillingProfiles;
  settings: AdminSetting[];
}> {
  const scope = organizationId ? `?organization=${encode(organizationId)}` : "";
  return requestUrl(`${SETTINGS_BASE}${scope}`);
}

/** What Stripe answered when a profile was checked, in the mode that would spend it. */
export interface ProfileCheck {
  mode: "test" | "live";
  /** False when Stripe could not be reached at all, which decides nothing about the key. */
  reachable: boolean;
  keyWorks: boolean;
  prices: { priceId: string; tier: string; exists: boolean }[];
  problem: string | null;
  ok: boolean;
}

/**
 * Ask Stripe whether a mode can charge, without switching to it.
 *
 * Readiness in `listSettings` is shape. This is the question that catches a price table
 * copied from the other mode, where every id parses and none of them exist.
 */
export async function verifyBillingProfile(mode: "test" | "live"): Promise<ProfileCheck> {
  return requestUrl(`${SETTINGS_BASE}/billing/verify`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export async function writeSetting(
  key: string,
  value: string | number | boolean,
  organizationId?: string | null,
): Promise<void> {
  const query = organizationId ? `?organization=${encode(organizationId)}` : "";
  await requestUrl(`${SETTINGS_BASE}/${encode(key)}${query}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

export async function resetSetting(key: string, organizationId?: string | null): Promise<void> {
  const query = organizationId ? `?organization=${encode(organizationId)}` : "";
  await requestUrl(`${SETTINGS_BASE}/${encode(key)}${query}`, { method: "DELETE" });
}

/**
 * People and support access, on the control plane beside the settings.
 *
 * Impersonation is a cookie exchange, not a token: the account service sets the target's
 * session cookie and keeps the operator's as `admin_session`, so the browser becomes the
 * account and `stop` puts it back. Nothing about that exchange is held here.
 */
const ACCOUNTS_BASE = `${authServiceBase()}/admin/accounts`;

/** Who is paying. Read-only: a plan is changed by the organization itself, in the app. */
const ADMIN_SUBSCRIPTIONS_PATH = `${authServiceBase()}/admin/subscriptions`;
const ACCOUNT_BASE = `${authServiceBase()}/api/account`;

export interface SupportAccess {
  granted: boolean;
  grantedAt: number | null;
  revokedAt: number | null;
}

export interface AdminAccount {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  createdAt: string | null;
  twoFactorEnabled: boolean;
  supportAccess: SupportAccess;
}

/**
 * One organization's subscription, as the panel reads it.
 *
 * `periodEnd` and the tier ceilings are the two numbers an operator actually asks about:
 * when money next moves, and what the plan allows either way.
 */
export interface AdminSubscription {
  organizationId: string;
  organizationName: string | null;
  plan: string;
  status: string;
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  seats: number | null;
  /** Stripe's own ids, for the dashboard link. Null before the customer exists. */
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

export function listSubscriptions(): Promise<{
  ok: boolean;
  /** Which credential pair is active, so a link opens the matching dashboard. */
  mode?: "test" | "live";
  subscriptions: AdminSubscription[];
}> {
  return requestUrl(`${ADMIN_SUBSCRIPTIONS_PATH}`);
}

/**
 * Where Stripe keeps one subscription, in the right mode.
 *
 * Managing a plan stays Stripe's job: a panel that could cancel would be a second way to
 * spend somebody's money, and a link cannot drift from what Stripe actually holds.
 */
export function stripeDashboardUrl(
  subscription: AdminSubscription,
  mode: "test" | "live",
): string | null {
  const prefix =
    mode === "test" ? "https://dashboard.stripe.com/test" : "https://dashboard.stripe.com";
  if (subscription.stripeSubscriptionId) {
    return `${prefix}/subscriptions/${encodeURIComponent(subscription.stripeSubscriptionId)}`;
  }
  if (subscription.stripeCustomerId) {
    return `${prefix}/customers/${encodeURIComponent(subscription.stripeCustomerId)}`;
  }
  return null;
}

export function listAccounts(query: string): Promise<{ ok: boolean; accounts: AdminAccount[] }> {
  const term = query.trim();
  return requestUrl(`${ACCOUNTS_BASE}${term.length === 0 ? "" : `?q=${encode(term)}`}`);
}

/** Ends support access. Only the account can start it. */
export async function revokeSupportAccess(accountId: string): Promise<void> {
  await requestUrl(`${ACCOUNTS_BASE}/${encode(accountId)}/support-access`, {
    method: "PUT",
    body: JSON.stringify({ granted: false }),
  });
}

/** Starts an impersonation; the browser's own cookies are what change. */
export async function impersonate(accountId: string): Promise<void> {
  await requestUrl(`${ACCOUNT_BASE}/impersonate`, {
    method: "POST",
    body: JSON.stringify({ userId: accountId }),
  });
}

/** Puts the operator's own session back. */
export async function stopImpersonating(): Promise<void> {
  await requestUrl(`${ACCOUNT_BASE}/stop-impersonating`, { method: "POST" });
}

/**
 * One message, to prove the deployment can send one.
 *
 * The control plane builds the transport from the panel's own saved rows, so this is the
 * honest test of what a sign-up will get — not of what `.env` said at boot.
 */
export async function sendTestMail(to: string): Promise<{ ok: boolean; transport: string }> {
  return requestUrl(`${authServiceBase()}/admin/mail/test`, {
    method: "POST",
    body: JSON.stringify({ to }),
  });
}

/**
 * The signed-in operator's own second factor.
 *
 * The admin plugin refuses impersonation from an account that can manage people and has
 * no second factor, so the panel has to be able to enrol one — otherwise the feature is
 * reachable only by whoever can call the endpoint by hand. The secret is returned once,
 * as an `otpauth://` URI, and the backup codes once; neither is readable afterwards.
 */
const TWO_FACTOR_BASE = `${authServiceBase()}/api/auth/two-factor`;

export interface OwnSession {
  email: string;
  twoFactorEnabled: boolean;
}

export async function readOwnSession(): Promise<OwnSession | null> {
  const authorization = await credentialAuthorization();
  const response = await fetch(`${authServiceBase()}/api/auth/get-session`, {
    headers: { ...authorization },
    credentials: "include",
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    user?: { email?: unknown; twoFactorEnabled?: unknown };
  } | null;
  if (body?.user === undefined || typeof body.user.email !== "string") return null;
  return {
    email: body.user.email,
    twoFactorEnabled: body.user.twoFactorEnabled === true,
  };
}

export interface TotpEnrolment {
  totpURI: string;
  backupCodes: string[];
}

export async function beginTotpEnrolment(password: string): Promise<TotpEnrolment> {
  const authorization = await credentialAuthorization();
  const response = await fetch(`${TWO_FACTOR_BASE}/enable`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const { message, code } = await failureFor(response);
    throw new AdminApiError(response.status, message, code);
  }
  const body = (await response.json()) as { totpURI?: unknown; backupCodes?: unknown };
  if (typeof body.totpURI !== "string") {
    throw new AdminApiError(500, "The server did not return a secret to enrol.");
  }
  return {
    totpURI: body.totpURI,
    backupCodes: Array.isArray(body.backupCodes)
      ? body.backupCodes.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

/** Confirms the secret with one code, which is what turns the factor on. */
export async function confirmTotp(code: string): Promise<void> {
  const authorization = await credentialAuthorization();
  const response = await fetch(`${TWO_FACTOR_BASE}/verify-totp`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ code: code.trim() }),
  });
  if (!response.ok) {
    const { message, code: failureCode } = await failureFor(response);
    throw new AdminApiError(response.status, message, failureCode);
  }
}

/**
 * The trail of what operators did, newest first.
 *
 * `before` is the `(at, id)` watermark a page ended on, so paging continues exactly where
 * the last page stopped even when two acts share a millisecond.
 */
const ACTIVITY_BASE = `${authServiceBase()}/admin/activity`;

export interface ActivityEntry {
  id: number;
  at: number;
  actor: string;
  action: string;
  target: string;
  outcome: string;
  details: Record<string, unknown>;
}

export interface ActivityPage {
  ok: boolean;
  entries: ActivityEntry[];
  next: { beforeAt: number; beforeId: number } | null;
}

export function listActivity(options: {
  limit?: number;
  before?: { beforeAt: number; beforeId: number } | null;
  actor?: string;
  action?: string;
}): Promise<ActivityPage> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.before) {
    query.set("beforeAt", String(options.before.beforeAt));
    query.set("beforeId", String(options.before.beforeId));
  }
  if (options.actor !== undefined && options.actor.length > 0) query.set("actor", options.actor);
  if (options.action !== undefined && options.action.length > 0) {
    query.set("action", options.action);
  }
  const suffix = query.toString();
  return requestUrl(`${ACTIVITY_BASE}${suffix.length === 0 ? "" : `?${suffix}`}`);
}

/**
 * The role this operator is wearing, if any.
 *
 * The override is a row on the control plane, wrapped around the memberships reader, so the
 * panel and the app read the same answer. Any signed-in account may read its own; only an
 * operator may write.
 */
const ROLE_OVERRIDE_BASE = `${authServiceBase()}/api/account/role-override`;

export type WearableRole = "owner" | "admin" | "member";

export interface RoleOverrideState {
  role: WearableRole | null;
  organizationId: string | null;
  setAt: number | null;
  realRole: WearableRole | null;
}

export async function readRoleOverride(): Promise<RoleOverrideState> {
  const authorization = await credentialAuthorization();
  const response = await fetch(ROLE_OVERRIDE_BASE, {
    headers: { ...authorization },
    credentials: "include",
  });
  if (!response.ok) return { role: null, organizationId: null, setAt: null, realRole: null };
  return (await response.json()) as RoleOverrideState;
}

export async function playRole(role: WearableRole): Promise<RoleOverrideState> {
  return requestUrl(`${ROLE_OVERRIDE_BASE}`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

export async function stopRole(): Promise<RoleOverrideState> {
  return requestUrl(`${ROLE_OVERRIDE_BASE}`, { method: "DELETE" });
}

/**
 * The four states a real subscription passes through, written straight into the row the
 * gate reads.
 *
 * This is the proof path for billing without a payment provider: an expired row is what a
 * lapsed subscription produces, and no row at all is what a cancellation produces. The
 * states are the product's words, so the panel never has to explain a raw tier.
 */
export type LicenceState = "trial" | "active" | "past-due" | "cancelled";

export async function writeLicence(
  workspaceId: string,
  state: Exclude<LicenceState, "cancelled">,
): Promise<void> {
  await requestUrl(`${BASE}/workspaces/${encode(workspaceId)}/licence`, {
    method: "PUT",
    body: JSON.stringify({ state }),
  });
}

export async function clearLicence(workspaceId: string): Promise<void> {
  await requestUrl(`${BASE}/workspaces/${encode(workspaceId)}/licence`, { method: "DELETE" });
}
