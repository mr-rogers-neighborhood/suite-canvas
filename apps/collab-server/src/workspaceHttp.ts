import type { IncomingMessage, ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { type AdminPaths, adminPaths, deleteWorkspace } from "./admin.js";
import {
  applyCors,
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendEmpty,
  sendJson,
} from "./http.js";
import {
  type LicenceClaims,
  type LicenceQuota,
  licenceProblemMessage,
  licencePublicKey,
  licenceQuota,
  licenceRequired,
  verifyLicence,
} from "./licence.js";
import { formatBytes, publicLimits, type QuotaService, shareBlockReason } from "./limits.js";
import { claimLimiter, clientAddress, rotateLimiter } from "./rateLimit.js";
import { validateClaimInput, validateRotateInput, type WorkspaceRegistry } from "./workspaces.js";

export const WORKSPACE_API_PATH = "/api/workspaces";

/** Licence data recorded next to a workspace claim on the hosted relay. */
export interface LicenceClaimRecord {
  workspaceId: string;
  licenceId: string;
  tier: string;
  quota: LicenceQuota;
  email: string | null;
  /** Epoch milliseconds at which the licence stops verifying. */
  expiresAt: number;
  /** Epoch milliseconds of the most recent claim that presented this licence. */
  claimedAt: number;
}

export interface LicenceClaimStore {
  /** Stores the licence behind a successful claim, replacing any earlier one. */
  record: (workspaceId: string, claims: LicenceClaims, now: number) => LicenceClaimRecord;
  get: (workspaceId: string) => LicenceClaimRecord | null;
  /** Workspaces this licence already claimed, for its workspace cap. */
  countForLicence: (licenceId: string) => number;
  /**
   * Drops a workspace's licence record, for a workspace delete. Returns the
   * number of rows removed, so the caller can report it.
   */
  remove: (workspaceId: string) => number;
  close: () => void;
}

/** Licence gate overrides; production reads the environment instead. */
export interface LicenceGateOptions {
  /** PEM or base64 raw Ed25519 public key; defaults to `SUITE_LICENCE_PUBLIC_KEY`. */
  publicKey?: string;
  /** Where claims are recorded; defaults to `SUITE_LICENCE_DB`, else memory. */
  claims?: LicenceClaimStore;
  /** Clock override for tests. */
  now?: () => number;
}

export interface WorkspaceRequestHooks {
  /**
   * Called after a successful rotation so live sessions holding the previous
   * owner key can be closed. The key is the request's current (now stale) key.
   */
  onRotated?: (workspaceId: string, previousOwnerKey: string) => void;
  /**
   * Called after an owner delete committed, so a host can close the workspace's
   * live sessions and drop its share projections. The data is already gone.
   */
  onDeleted?: (workspaceId: string) => void;
  /**
   * Where an owner delete finds the relay's SQLite files. Defaults to the same
   * `SUITE_DB`/`SUITE_SHARES_DB`/`SUITE_WORKSPACES_DB` the server booted from.
   */
  storage?: AdminPaths;
  /** Hosted licence gate. Ignored entirely while `SUITE_HOSTED` is unset. */
  licence?: LicenceGateOptions;
  /** Quotas that decide whether a *new* workspace may be created. */
  quota?: WorkspaceQuotaGate;
}

/**
 * The quota seam for workspace creation. An existing workspace is never
 * refused: only a claim that would create one more is, because at that boundary
 * nothing has been written yet.
 */
export interface WorkspaceQuotaGate {
  quotas: QuotaService;
  /** Workspaces already recorded against one licence, for its workspace cap. */
  licenceWorkspaces?: (licenceId: string) => number;
}

interface LicenceRow {
  workspace_id: string;
  licence_id: string;
  tier: string;
  quota_json: string | null;
  email: string | null;
  expires_at: number | null;
  claimed_at: number;
}

/**
 * Adds the columns of stores created before they existed, the same way the
 * share store migrates its older rows.
 */
function migrateLicenceColumns(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(workspace_licences)").all() as { name?: string }[];
  if (!columns.some((column) => column.name === "quota_json")) {
    db.exec("ALTER TABLE workspace_licences ADD COLUMN quota_json TEXT");
  }
  if (!columns.some((column) => column.name === "email")) {
    db.exec("ALTER TABLE workspace_licences ADD COLUMN email TEXT");
  }
  if (!columns.some((column) => column.name === "expires_at")) {
    db.exec("ALTER TABLE workspace_licences ADD COLUMN expires_at INTEGER");
  }
}

/**
 * Licence grant per claimed workspace. It lives in its own table so the owner
 * registry keeps its shape: a workspace still has one owner key, and the
 * licence beside it is bookkeeping for the relay and its operator.
 */
export function createLicenceClaimStore(path: string): LicenceClaimStore {
  const db = new DatabaseSync(path);
  db.exec(
    `CREATE TABLE IF NOT EXISTS workspace_licences (
       workspace_id TEXT PRIMARY KEY,
       licence_id TEXT NOT NULL,
       tier TEXT NOT NULL,
       claimed_at INTEGER NOT NULL
     );`,
  );
  migrateLicenceColumns(db);

  const upsert = db.prepare(
    `INSERT INTO workspace_licences
       (workspace_id, licence_id, tier, quota_json, email, expires_at, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       licence_id = excluded.licence_id,
       tier = excluded.tier,
       quota_json = excluded.quota_json,
       email = excluded.email,
       expires_at = excluded.expires_at,
       claimed_at = excluded.claimed_at`,
  );
  const select = db.prepare("SELECT * FROM workspace_licences WHERE workspace_id = ?");
  const countByLicence = db.prepare(
    "SELECT COUNT(*) AS count FROM workspace_licences WHERE licence_id = ?",
  );
  const removeByWorkspace = db.prepare("DELETE FROM workspace_licences WHERE workspace_id = ?");

  return {
    record: (workspaceId, claims, now) => {
      const id = workspaceId.trim();
      const quota = licenceQuota(claims);
      upsert.run(
        id,
        claims.id,
        claims.tier,
        JSON.stringify(quota),
        claims.email ?? null,
        claims.expiresAt,
        now,
      );
      return {
        workspaceId: id,
        licenceId: claims.id,
        tier: claims.tier,
        quota,
        email: claims.email ?? null,
        expiresAt: claims.expiresAt,
        claimedAt: now,
      };
    },

    get: (workspaceId) => {
      const row = select.get(workspaceId.trim()) as LicenceRow | undefined;
      if (!row) return null;
      return {
        workspaceId: row.workspace_id,
        licenceId: row.licence_id,
        tier: row.tier,
        quota: row.quota_json
          ? (JSON.parse(row.quota_json) as LicenceQuota)
          : { workspaces: 1, documentBytes: 0, attachmentBytes: 0 },
        email: row.email,
        expiresAt: row.expires_at ?? 0,
        claimedAt: row.claimed_at,
      };
    },

    countForLicence: (licenceId) => {
      const row = countByLicence.get(licenceId) as { count?: number } | undefined;
      return Number(row?.count ?? 0);
    },

    remove: (workspaceId) => Number(removeByWorkspace.run(workspaceId.trim()).changes),

    close: () => db.close(),
  };
}

let defaultLicenceClaims: LicenceClaimStore | null = null;

/**
 * The process-wide store the claim route records into. Server wiring opens it
 * once so the quota service reads the same rows the claim wrote.
 */
export function defaultLicenceClaimStore(): LicenceClaimStore {
  defaultLicenceClaims ??= createLicenceClaimStore(
    process.env.SUITE_LICENCE_DB?.trim() || ":memory:",
  );
  return defaultLicenceClaims;
}

/** The store the relay records into when the caller supplies no override. */
function licenceClaims(options: LicenceGateOptions | undefined): LicenceClaimStore {
  if (options?.claims) return options.claims;
  return defaultLicenceClaimStore();
}

/**
 * Verifies the licence a hosted claim presented. Self-host is untouched: the
 * gate returns null without reading the body, the env, or the store.
 */
function licenceGate(
  body: unknown,
  options: LicenceGateOptions | undefined,
):
  | { ok: true; claims: LicenceClaims; now: number }
  | { ok: false; refusal: string; reason: string }
  | null {
  if (!licenceRequired()) return null;

  const now = options?.now?.() ?? Date.now();
  const token = (body as Record<string, unknown>).licence;
  if (typeof token !== "string" || token.trim().length === 0) {
    return {
      ok: false,
      reason: "missing",
      refusal: `Hosted sync needs a licence key: ${licenceProblemMessage("missing")}. Local editing still works.`,
    };
  }

  const verification = verifyLicence(token, now, options?.publicKey ?? licencePublicKey());
  if (!verification.ok) {
    return {
      ok: false,
      reason: verification.reason,
      refusal: `Hosted sync needs a valid licence key: ${licenceProblemMessage(verification.reason)}. Local editing still works.`,
    };
  }
  return { ok: true, claims: verification.claims, now };
}

const CONFLICT_MESSAGE = "This workspace is protected by a different owner key.";
const ROTATE_FORBIDDEN_MESSAGE = "The current owner key does not match this workspace.";
const BEARER_PREFIX = /^bearer\s+/i;

interface QuotaRefusal {
  status: number;
  error: string;
  reason: string;
}

/**
 * Decides whether a new workspace may be created. The instance wide cap is the
 * tighter of `SUITE_MAX_WORKSPACES` and the licence's own workspace count; the
 * disk marks are instance wide. Above the soft mark the claim is allowed and
 * logged; above the hard mark it is refused, before the claim row exists.
 */
function newWorkspaceRefusal(
  gate: WorkspaceQuotaGate,
  licence: LicenceClaims | null,
): QuotaRefusal | null {
  const limits = gate.quotas.limits();
  const cap = Math.min(limits.maxWorkspaces, licence?.workspaces ?? Number.POSITIVE_INFINITY);
  const used =
    licence !== null && gate.licenceWorkspaces !== undefined
      ? gate.licenceWorkspaces(licence.id)
      : gate.quotas.instanceWorkspaces();
  if (used >= cap) {
    const scope = licence !== null ? "licence" : "instance";
    return {
      status: 429,
      reason: "workspace-limit",
      error: `This ${scope} already holds ${used} of ${cap} workspaces. Export or delete a workspace before creating another.`,
    };
  }

  const disk = gate.quotas.disk();
  if (disk >= limits.diskHardBytes) {
    return {
      status: 507,
      reason: "disk-full",
      error: `The document store uses ${formatBytes(disk)}, above its hard limit of ${formatBytes(limits.diskHardBytes)}; new workspaces are paused. Existing workspaces keep saving. Export or delete a workspace, then try again.`,
    };
  }
  if (disk >= limits.diskSoftBytes) {
    gate.quotas.noteSoftDisk(limits);
  }
  return null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, "The workspace identifier is malformed.");
  }
}

function parseOwnerKey(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "The request body must be a JSON object.");
  }
  const ownerKey = (body as Record<string, unknown>).ownerKey;
  if (typeof ownerKey !== "string" || ownerKey.trim().length === 0) {
    throw new HttpError(400, "An owner key is required.");
  }
  return ownerKey;
}

async function claim(
  request: IncomingMessage,
  response: ServerResponse,
  registry: WorkspaceRegistry,
  workspaceId: string,
  hooks?: WorkspaceRequestHooks,
): Promise<void> {
  const claim = claimLimiter.take(clientAddress(request));
  if (!claim.ok) {
    response.setHeader("retry-after", String(claim.retryAfter));
    throw new HttpError(429, "Too many ownership claims. Wait a moment and try again.");
  }

  const body = await readJsonBody(request);
  const ownerKey = parseOwnerKey(body);
  const problem = validateClaimInput(workspaceId, ownerKey);
  if (problem) throw new HttpError(400, problem);

  // Hosted relay only: a refused licence never claims the workspace. On a
  // self-host this is null and no body field is read.
  const licence = licenceGate(body, hooks?.licence);
  if (licence && !licence.ok) {
    sendJson(response, 402, { error: licence.refusal, reason: licence.reason });
    return;
  }

  // A quota refusal happens before the claim row exists: nothing is lost, and
  // an existing workspace is never refused.
  const gate = hooks?.quota;
  if (gate && !registry.has(workspaceId)) {
    const refusal = newWorkspaceRefusal(gate, licence?.ok ? licence.claims : null);
    if (refusal !== null) {
      sendJson(response, refusal.status, { error: refusal.error, reason: refusal.reason });
      return;
    }
  }

  const result = registry.claimOrVerify(workspaceId, ownerKey);
  if (result === "mismatch") {
    sendJson(response, 409, { error: CONFLICT_MESSAGE });
    return;
  }
  if (licence?.ok) {
    licenceClaims(hooks?.licence).record(workspaceId, licence.claims, licence.now);
  }
  sendJson(response, 200, { workspaceId: workspaceId.trim(), claimed: true });
}

/** The current key travels in the header, never in the URL or the body. */
function bearerKey(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (typeof header !== "string") throw new HttpError(401, "An owner key is required.");
  const match = BEARER_PREFIX.exec(header);
  const key = match ? header.slice(match[0].length).trim() : "";
  if (key.length === 0) throw new HttpError(401, "An owner key is required.");
  return key;
}

async function rotate(
  request: IncomingMessage,
  response: ServerResponse,
  registry: WorkspaceRegistry,
  workspaceId: string,
  hooks?: WorkspaceRequestHooks,
): Promise<void> {
  const rotation = rotateLimiter.take(clientAddress(request));
  if (!rotation.ok) {
    response.setHeader("retry-after", String(rotation.retryAfter));
    throw new HttpError(429, "Too many key rotations. Wait a moment and try again.");
  }

  const currentOwnerKey = bearerKey(request);
  const currentProblem = validateClaimInput(workspaceId, currentOwnerKey);
  if (currentProblem) throw new HttpError(400, currentProblem);

  const body = await readJsonBody(request);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "The request body must be a JSON object.");
  }
  const newOwnerKey = (body as Record<string, unknown>).newOwnerKey;
  const problem = validateRotateInput(newOwnerKey);
  if (problem !== null || typeof newOwnerKey !== "string") {
    throw new HttpError(400, problem ?? "A new owner key is required.");
  }

  if (!registry.rotate(workspaceId, currentOwnerKey, newOwnerKey)) {
    sendJson(response, 403, { error: ROTATE_FORBIDDEN_MESSAGE });
    return;
  }
  sendJson(response, 200, { workspaceId: workspaceId.trim(), rotated: true });
  try {
    hooks?.onRotated?.(workspaceId.trim(), currentOwnerKey);
  } catch (error) {
    console.error("[workspaces] rotation hook failed", error);
  }
}

const DELETE_FORBIDDEN_MESSAGE = "The owner key does not match this workspace.";

function deleteConfirmMessage(workspaceId: string): string {
  return `Deleting a workspace requires {"confirm":"${workspaceId}"} in the request body.`;
}

/**
 * Deletes a workspace on the owner's own authority: the owner key in the
 * `Authorization` header, never the operator's admin token. The body repeats the
 * workspace id, so a stray request cannot wipe a workspace it did not name.
 *
 * The data is removed by the operator CLI's `delete` (`admin.ts`), so both entry
 * points share one implementation: documents and projected share rooms, share
 * rows and their baselines, the owner row — and, on a hosted relay, the licence
 * record beside it. The delete is immediate and has no tombstone; see
 * `docs/security-model.md` for what that means for other devices.
 */
async function remove(
  request: IncomingMessage,
  response: ServerResponse,
  registry: WorkspaceRegistry,
  workspaceId: string,
  hooks?: WorkspaceRequestHooks,
): Promise<void> {
  // Deletion spends the rotation budget: both are rare, destructive owner
  // operations, and a flood of either must not reach the database.
  const removal = rotateLimiter.take(clientAddress(request));
  if (!removal.ok) {
    response.setHeader("retry-after", String(removal.retryAfter));
    throw new HttpError(429, "Too many workspace deletions. Wait a moment and try again.");
  }

  const ownerKey = bearerKey(request);
  const problem = validateClaimInput(workspaceId, ownerKey);
  if (problem) throw new HttpError(400, problem);

  const id = workspaceId.trim();
  if (!registry.has(id)) throw new HttpError(404, "Workspace not found.");
  if (!registry.verify(id, ownerKey)) {
    sendJson(response, 403, { error: DELETE_FORBIDDEN_MESSAGE });
    return;
  }

  const body = await readJsonBody(request);
  const confirm =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).confirm
      : undefined;
  if (typeof confirm !== "string" || confirm.trim() !== id) {
    throw new HttpError(400, deleteConfirmMessage(id));
  }

  const result = deleteWorkspace(hooks?.storage ?? adminPaths(), id);
  // The licence row only exists on a hosted relay, and only that deployment
  // opens the store; a self-host delete must not create one.
  const licenceRows =
    licenceRequired() || hooks?.licence ? licenceClaims(hooks?.licence).remove(id) : 0;

  sendJson(response, 200, { workspaceId: id, deleted: true, ...result, licenceRows });
  try {
    hooks?.onDeleted?.(id);
  } catch (error) {
    console.error("[workspaces] delete hook failed", error);
  }
}

/**
 * The owner's read of its own quota. This is the "next status call" the client
 * polls after a save: it reports whether the workspace is over its document
 * budget so the app can warn and offer an export, without ever blocking a save.
 */ function status(
  request: IncomingMessage,
  response: ServerResponse,
  registry: WorkspaceRegistry,
  workspaceId: string,
  hooks?: WorkspaceRequestHooks,
): void {
  const ownerKey = bearerKey(request);
  const problem = validateClaimInput(workspaceId, ownerKey);
  if (problem) throw new HttpError(400, problem);
  if (!registry.verify(workspaceId, ownerKey)) {
    throw new HttpError(403, ROTATE_FORBIDDEN_MESSAGE);
  }

  const quotaService = hooks?.quota?.quotas;
  if (!quotaService) {
    sendJson(response, 200, { workspaceId: workspaceId.trim(), quota: null });
    return;
  }
  const limits = quotaService.limits();
  const quota = quotaService.workspace(workspaceId);
  sendJson(response, 200, {
    workspaceId: workspaceId.trim(),
    quota,
    limits: publicLimits(limits),
    shareBlock: shareBlockReason(quota, limits),
  });
}

/**
 * Handles the workspace claim, rotation and status API. Returns false when the
 * request is not one of its routes so the caller can keep serving its own routes.
 */
export async function handleWorkspaceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  registry: WorkspaceRegistry,
  hooks?: WorkspaceRequestHooks,
): Promise<boolean> {
  applyCors(request, response);
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== WORKSPACE_API_PATH && !url.pathname.startsWith(`${WORKSPACE_API_PATH}/`)) {
    return false;
  }

  const method = request.method ?? "GET";
  if (method === "OPTIONS") {
    // Every response carries the share API's CORS headers.
    sendEmpty(response, 204);
    return true;
  }

  try {
    const segment = url.pathname.slice(WORKSPACE_API_PATH.length).replace(/^\//, "");
    const parts = segment.split("/");
    const action = parts[1];
    // `DELETE /api/workspaces/:id` is the owner's own delete. Any other method
    // on the bare workspace path stays a 404, like every unknown route here.
    if (parts.length === 1 && (parts[0]?.length ?? 0) > 0 && method === "DELETE") {
      await remove(request, response, registry, decodeSegment(parts[0] ?? ""), hooks);
      return true;
    }
    if (
      parts.length !== 2 ||
      parts[0]?.length === 0 ||
      (action !== "claim" && action !== "rotate" && action !== "status")
    ) {
      throw new HttpError(404, "Not found.");
    }

    const workspaceId = decodeSegment(parts[0] ?? "");
    if (action === "status") {
      if (method !== "GET") {
        methodNotAllowed(response, "GET, OPTIONS");
        return true;
      }
      status(request, response, registry, workspaceId, hooks);
      return true;
    }
    if (method !== "POST") {
      methodNotAllowed(response, "POST, OPTIONS");
      return true;
    }
    if (action === "rotate") await rotate(request, response, registry, workspaceId, hooks);
    else await claim(request, response, registry, workspaceId, hooks);
  } catch (error) {
    if (response.headersSent) return true;
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return true;
    }
    console.error("[workspaces] request failed", error);
    sendJson(response, 500, { error: "The workspace request failed." });
  }

  return true;
}
