import type { OrganizationRole } from "@suite/auth";
import type { SeatDecision, SeatRefusal } from "@suite/auth/seats";

/**
 * The relay-side seat gate (ADR-0065 §5: "the seat check is server-side or it is
 * decoration").
 *
 * What the relay can and cannot answer is the whole design of this module:
 *
 * - It **can** answer "may this session sync this workspace?" from the verified
 *   token alone. `org`, `tier` and `limits` are minted server-side from the
 *   organization's subscription (ADR-0074, ADR-0075), so the answer costs no
 *   database read and no control-plane call.
 * - It **cannot** answer "does this person hold a seat", because member counts
 *   live in the control plane and this process holds no Postgres credential. It
 *   does not need to: the token's TTL is the revocation window, so a seat
 *   removed, a role lowered or a subscription cancelled takes effect at the next
 *   mint, at most `RELAY_TOKEN_TTL_SECONDS` later.
 * - It deliberately does **not** re-check the workspace ceiling. That is a
 *   creation gate (`canAddWorkspace`) in the control plane, and enforcing it on
 *   connect would take documents away from someone who already holds them
 *   because a licence shrank. "Lapsed" ends sync; "narrowed" ends new work.
 *
 * A share visitor is not a seat and is never asked about one: the link is a
 * capability minted by an account, bounded by its own expiry and revocation.
 */

/**
 * Why the relay refused a connection that its credential check allowed: one of
 * the shared licence refusals, or the one refusal only the relay can produce
 * because it never sees an organization-less session as a tenant.
 */
export type RelaySeatRefusal = SeatRefusal | "organization-required";

export type RelaySeatDecision = SeatDecision | { ok: false; reason: RelaySeatRefusal };

export interface RelaySeatDeps {
  /**
   * True only on the hosted relay (`SUITE_HOSTED=1`). When false the gate is
   * inert: self-hosting has no subscription, so it has nothing to enforce.
   */
  enforced: boolean;
}

/** What a joined room's credential proved. Deliberately narrower than `Principal`. */
export type ConnectionPrincipal =
  /** A share link or an exchanged share session: a capability, not a seat. */
  | { kind: "share"; workspaceId: string }
  /** A verified session JWT acting in an organization. */
  | {
      kind: "account";
      workspaceId: string;
      organizationId: string;
      userId: string;
      role: OrganizationRole | null;
      tier: string;
      limits: Readonly<Record<string, number>>;
    };

export interface RelaySeatGate {
  allow: (principal: ConnectionPrincipal) => RelaySeatDecision;
}

/** True when the token actually carries an entitlement rather than an empty claim. */
function entitled(tier: string): boolean {
  return tier.trim().length > 0;
}

export function createRelaySeatGate(deps: RelaySeatDeps): RelaySeatGate {
  return {
    allow: (principal) => {
      if (!deps.enforced) return { ok: true, seat: "anonymous" };

      if (principal.kind === "share") {
        // The link is the grant. Its role was settled when it was minted and its
        // lifetime is the share's own expiry, so there is no seat to consult.
        return { ok: true, seat: "share" };
      }

      if (principal.organizationId.trim().length === 0) {
        // A personal session names no tenant, so there is no subscription behind
        // it and no workspace it could already own.
        return { ok: false, reason: "organization-required" };
      }

      if (!entitled(principal.tier)) {
        // A token without a tier is not an entitlement; refusing is the only
        // answer that cannot be read as "free forever".
        return { ok: false, reason: "licence-missing" };
      }

      return { ok: true, seat: principal.role === "owner" ? "owner" : "licensed-member" };
    },
  };
}

/**
 * Builds the gate the server wires in. Kept as a named function so the wiring
 * reads as one decision — "hosted means enforced" — rather than a boolean
 * literal at the call site.
 */
export function relaySeatGate(enforced: boolean): RelaySeatGate {
  return createRelaySeatGate({ enforced });
}
