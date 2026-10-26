import type { AccountSession, Principal } from "../types.js";

/**
 * One resolver, one precedence: **session > owner key > share token**.
 *
 * This is the highest-risk function in the phase (ADR-0065, consequences), so
 * the rules are stated here rather than inferred from the order of `if`s:
 *
 * 1. A validated session wins — but only when it names the organization that
 *    owns *this* workspace (`session.activeOrganizationId`) **and** the account
 *    still holds a `member` row there. A session for another tenant, or one
 *    whose membership was removed, must not shadow the credential that actually
 *    opens this document: someone removed from an organization who later
 *    receives a share link is a share holder, not an account.
 * 2. Otherwise a non-empty owner-key hash wins. The relay verifies the key
 *    against the workspace before it ever calls this function, so a hash
 *    reaching here already means "this key owns this workspace".
 * 3. Otherwise a non-empty share token.
 *
 * Everything else is `null` — no identity, which the relay answers with a
 * refused join rather than a guess.
 *
 * The signature gains `workspaceId` and `organizationId` relative to the sketch
 * in the brief: a hash on its own names no workspace, and a session names a
 * tenant rather than a document, so without both the resolver could not tell an
 * account session for tenant A from a request for workspace B. Precedence
 * itself is untouched.
 */
export interface ResolvePrincipalInput {
  /** The workspace (document id) this request is for. */
  workspaceId: string;
  /** The organization that owns this workspace, or null when it is anonymous. */
  organizationId: string | null;
  /** The validated Better Auth session, if the request carried one. */
  session?: AccountSession | null;
  /** SHA-256 hash of a *verified* owner key, or null/empty when absent. */
  ownerKeyHash?: string | null;
  /** A share token the relay already resolved to this workspace and role. */
  shareToken?: string | null;
}

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolvePrincipal(input: ResolvePrincipalInput): Principal | null {
  const workspaceId = input.workspaceId.trim();
  if (workspaceId.length === 0) return null;

  const session = input.session;
  if (
    session !== null &&
    session !== undefined &&
    present(session.userId) &&
    session.organizationId !== null &&
    session.organizationId === input.organizationId &&
    session.role !== null
  ) {
    return {
      kind: "account",
      workspaceId,
      organizationId: session.organizationId,
      userId: session.userId.trim(),
      role: session.role,
    };
  }

  if (present(input.ownerKeyHash)) return { kind: "owner", workspaceId };
  if (present(input.shareToken)) return { kind: "share", workspaceId };
  return null;
}

/**
 * The precedence as data. The security-model page and the tests both state the
 * rule, so it is exported once instead of being re-derived from the code order.
 */
export const principalPrecedence = ["account", "owner", "share"] as const;
