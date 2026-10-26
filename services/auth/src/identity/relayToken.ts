import { type EntitlementReader, freeEntitlement } from "../licensing/entitlements.js";
import type { OrganizationRole } from "../types.js";

/**
 * The credential the relay accepts (ADR-0074).
 *
 * Better Auth signs a session JWT through its `jwt()` plugin and publishes the key
 * set at `/api/auth/jwks`; the relay verifies a token against that key set and holds
 * no identity table. Nothing here decides *whether* a session exists — the plugin
 * does — only which fields travel with it.
 *
 * Every field is read server-side when the token is minted: `org` and `role` from the
 * session and the `member` row, `tier` and `limits` from the injected entitlement
 * reader. A field a client could set is a field the relay would then trust.
 */

/**
 * Five minutes, in seconds and in the spelling the plugin's `expirationTime` takes.
 *
 * The TTL *is* the revocation window: a seat removed, a role lowered or a
 * subscription cancelled takes effect at the next mint, so a revoked member keeps a
 * working socket for at most this long. Making it longer buys fewer refreshes and
 * buys them with a stale entitlement.
 */
export const RELAY_TOKEN_TTL_SECONDS = 300;
export const RELAY_TOKEN_TTL = "5m";

/** Exactly the claims the relay reads, plus the subject every JWT carries. */
export interface RelayClaims {
  sub: string;
  org: string | null;
  role: OrganizationRole | null;
  tier: string;
  limits: Readonly<Record<string, number>>;
}

export interface RelayClaimInput {
  userId: string;
  /** `session.activeOrganizationId`: the tenant this session is acting in. */
  activeOrganizationId: string | null;
  /** Reads the role from the `member` row, so a removed member mints no claim. */
  roleIn: (organizationId: string, userId: string) => Promise<OrganizationRole | null>;
  entitlements: EntitlementReader;
}

/**
 * The payload for one session.
 *
 * A session with no active organization still gets a token: it can read its own
 * settings and claim a workspace, and the relay refuses it at the seat check rather
 * than at the signature.
 */
export async function relayClaims(input: RelayClaimInput): Promise<RelayClaims> {
  const organizationId = input.activeOrganizationId;
  const role = organizationId === null ? null : await input.roleIn(organizationId, input.userId);
  // No organization, nothing bought: answered here so a reader never has to decide what
  // a null id means, and so the free answer needs no query.
  const entitlement =
    organizationId === null
      ? freeEntitlement
      : await input.entitlements.forOrganization(organizationId);
  return {
    sub: input.userId,
    org: organizationId,
    role,
    tier: entitlement.tier,
    limits: entitlement.limits,
  };
}
