import type { IncomingMessage } from "node:http";
import type { OrganizationRole } from "@suite/auth";
import type { LicenceClaims } from "@suite/licence";
import type { LicenceClaimStore } from "../store/licenceClaims.js";
import type { WorkspaceOrgStore } from "../store/workspaceOrgs.js";
import { HttpError } from "./errors.js";
import { assertWithinLimit, claimLimiter, clientAddress } from "./rateLimit.js";
import { bearerToken } from "./request.js";
import type { SessionClaims, SessionVerifier } from "./sessionToken.js";

/**
 * The credential every workspace-scoped HTTP route asks for (ADR-0074, ADR-0076).
 *
 * A management request carries the same session JWT a sync join carries, in the
 * `Authorization: Bearer` header. There is no owner key and no second form: the
 * relay accepts one credential, so a route that authenticates differently would
 * be a second seat gate by another name.
 *
 * Authorization is a comparison of two values the relay already holds: the
 * `org` claim the control plane signed, and the organization the relay recorded
 * for that workspace on the first verified open. Nothing here reads Postgres,
 * and nothing here trusts a body field.
 */

/** What a management request proved: an account, acting in an organization, on one workspace. */
export interface AccountPrincipal {
  kind: "account";
  userId: string;
  organizationId: string;
  role: OrganizationRole | null;
  tier: string;
  limits: Readonly<Record<string, number>>;
  workspaceId: string;
}

/** The stores a workspace credential is recorded in. */
export interface WorkspaceClaimDeps {
  orgs: Pick<WorkspaceOrgStore, "get" | "claim" | "countForOrganization">;
  /**
   * The entitlement record, or null/absent on a self-host: a self-host has no
   * subscription, so it has nothing to record and no licence caps to apply.
   */
  licences?: Pick<LicenceClaimStore, "get" | "record"> | null;
  now?: () => number;
}

/**
 * What recording a session for a workspace found.
 *
 * `plan-required` and `workspace-limit` are refusals, not findings: the organization may
 * not hold *this* workspace under its current licence. Neither is `conflict`, which is
 * about a workspace that already belongs to somebody else.
 */
export type WorkspaceClaimOutcome =
  | "claimed"
  | "owned"
  | "conflict"
  | "organization-required"
  | "plan-required"
  | "workspace-limit";

/**
 * The workspace ceiling the token carries, or null when it carries none.
 *
 * A paid licence mints `workspaces` from the tier table. A free organization's token
 * carries `tier: "free"` and no limits at all, which is why null here is not "no opinion":
 * it is the zero-workspace licence that a subscription replaces.
 */
function workspaceCeiling(claims: SessionClaims): number | null {
  const value = claims.limits.workspaces;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Whether this organization's plan covers opening this workspace.
 *
 * Two things this deliberately does not do. It does not ask the control plane, because the
 * relay holds no Postgres credential and a join must not wait on another process. And it
 * does not touch a workspace the organization already holds: a licence that shrank ends new
 * work, it does not take documents away from somebody mid-sentence.
 *
 * That leaves the case this exists for. The control plane refuses a fresh claim with
 * `plan-required` and the app turns it into the plan picker, but the socket used to walk in
 * regardless and record the organization anyway, which is how a free account came to read
 * "Synced" with no plan at all. The door is a door from both sides or it is decoration.
 */
export function planRefusal(
  deps: WorkspaceClaimDeps,
  claims: SessionClaims,
  recorded: { organizationId: string } | null,
): "plan-required" | "workspace-limit" | null {
  // A self-host has no subscription, so it has nothing to enforce.
  if (deps.licences === null || deps.licences === undefined) return null;
  const organizationId = claims.organizationId;
  if (organizationId === null) return null;
  if (recorded !== null && recorded.organizationId === organizationId) return null;

  const ceiling = workspaceCeiling(claims);
  if (ceiling === null || ceiling <= 0) return "plan-required";
  // The relay's own store is a lower bound on what the organization holds: a workspace
  // claimed in the control plane but never opened here is not counted, so this can only
  // refuse an organization the relay has itself watched reach its ceiling.
  return deps.orgs.countForOrganization(organizationId) >= ceiling ? "workspace-limit" : null;
}

/**
 * Turns the signed claims into the shape the relay's licence bookkeeping stores.
 *
 * The token's `limits` keys are the licence's cap names (`workspaces`,
 * `documentBytes`, `attachmentBytes`), because both come from the same tier
 * table. A missing cap is recorded as zero, which the quota service reads as
 * "this licence adds no budget" rather than as a limit of nothing.
 */
export function licenceClaimsOf(claims: SessionClaims, organizationId: string): LicenceClaims {
  const cap = (name: string): number => {
    const value = claims.limits[name];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  };
  return {
    v: 1,
    id: organizationId,
    tier: claims.tier,
    workspaces: cap("workspaces"),
    documentBytes: cap("documentBytes"),
    attachmentBytes: cap("attachmentBytes"),
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  };
}

/**
 * Records the organization a verified session proved for a workspace.
 *
 * Called from the sync join and from every workspace-scoped HTTP route, so the
 * mapping exists whichever way a client arrives. The first claim wins, exactly
 * as the owner-key claim did (ADR-0076 ships no migration and keeps the
 * workspace's identity); the control plane's row stays authoritative and this
 * store is the relay's copy of it.
 */
export function claimWorkspaceForSession(
  deps: WorkspaceClaimDeps,
  workspaceId: string,
  claims: SessionClaims,
): WorkspaceClaimOutcome {
  const organizationId = claims.organizationId;
  // A session with no active organization names no tenant, so there is nothing
  // to record and nothing to compare against. The seat gate refuses it too.
  if (organizationId === null) return "organization-required";

  const now = (deps.now ?? Date.now)();
  // Ownership conflict first: a plan refusal must never mask a workspace that belongs to
  // another organization, or the reader is told to pay for something they cannot have.
  const recorded = deps.orgs.get(workspaceId);
  if (recorded !== null && recorded.organizationId !== organizationId) return "conflict";
  const refusal = planRefusal(deps, claims, recorded);
  if (refusal !== null) return refusal;

  const outcome = deps.orgs.claim(workspaceId, organizationId, now);
  if (outcome === "conflict") return "conflict";

  // The entitlement rides along with the same verified token, so a save that
  // carries no token still finds the caps this organization bought. It is
  // written only when it changed: a reconnect is a read, not a write.
  const licences = deps.licences;
  if (licences !== null && licences !== undefined) {
    const next = licenceClaimsOf(claims, organizationId);
    const stored = licences.get(workspaceId);
    const changed =
      stored === null ||
      stored.licenceId !== next.id ||
      stored.tier !== next.tier ||
      stored.expiresAt !== next.expiresAt;
    if (changed) licences.record(workspaceId, next, now);
  }
  return outcome;
}

export interface WorkspaceAccessDeps extends WorkspaceClaimDeps {
  sessions: SessionVerifier;
}

export interface WorkspaceAccess {
  /** The verified session a request presents, or a 401. */
  session: (request: IncomingMessage) => Promise<SessionClaims>;
  /** The verified session, proven to belong to the organization that owns `workspaceId`. */
  forWorkspace: (request: IncomingMessage, workspaceId: string) => Promise<AccountPrincipal>;
}

const SIGN_IN_AGAIN = "Your session is no longer valid. Sign in again.";

export function createWorkspaceAccess(deps: WorkspaceAccessDeps): WorkspaceAccess {
  const session = async (request: IncomingMessage): Promise<SessionClaims> => {
    const token = bearerToken(request);
    if (token === null) throw HttpError.unauthorized("A session token is required.");
    const verified = await deps.sessions.verify(token);
    if (!verified.ok) throw HttpError.unauthorized(SIGN_IN_AGAIN);
    return verified.claims;
  };

  return {
    session,
    forWorkspace: async (request, workspaceId) => {
      const claims = await session(request);
      const id = workspaceId.trim();
      const organizationId = claims.organizationId;
      if (organizationId === null) {
        throw HttpError.forbidden("This session is not acting in an organization.");
      }

      // Recording an organization for a workspace the relay has never seen is
      // the one write an account can trigger on demand, so it spends the claim
      // budget: a script with a valid token cannot mint rows without limit.
      if (deps.orgs.get(id) === null) {
        assertWithinLimit(
          claimLimiter,
          clientAddress(request),
          "Too many new workspaces from this address. Wait a moment and try again.",
        );
      }
      const outcome = claimWorkspaceForSession(deps, id, claims);
      if (outcome === "organization-required") {
        throw HttpError.forbidden("This session is not acting in an organization.");
      }
      if (outcome === "conflict") {
        throw HttpError.forbidden("This workspace belongs to a different organization.");
      }
      if (outcome === "plan-required") {
        throw HttpError.forbidden("This workspace needs a plan before it can sync.");
      }
      if (outcome === "workspace-limit") {
        throw HttpError.forbidden("This account's plan does not cover another workspace.");
      }

      return {
        kind: "account",
        userId: claims.userId,
        organizationId,
        role: claims.role,
        tier: claims.tier,
        limits: claims.limits,
        workspaceId: id,
      };
    },
  };
}
