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
  orgs: Pick<WorkspaceOrgStore, "get" | "claim">;
  /**
   * The entitlement record, or null/absent on a self-host: a self-host has no
   * subscription, so it has nothing to record and no licence caps to apply.
   */
  licences?: Pick<LicenceClaimStore, "get" | "record"> | null;
  now?: () => number;
}

/** What recording a session for a workspace found. */
export type WorkspaceClaimOutcome = "claimed" | "owned" | "conflict" | "organization-required";

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
