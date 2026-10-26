import type { LicenceClaims, SeatLicence } from "@suite/auth";
import { checkSeat, type SeatDecision, type SeatRefusal, seatLicence } from "@suite/auth/seats";
import type { LicenceClaimRecord } from "./workspaceHttp.js";

/**
 * The relay-side seat gate (ADR-0065 §5: "the seat check is server-side or it is
 * decoration").
 *
 * What the relay can and cannot answer is the whole design of this module:
 *
 * - It **can** answer "is the licence behind this workspace still valid?" — it
 *   records that claim in its own store, and `verifyLicence` already refused an
 *   expired token when the claim was made. That is the "a lapsed licence loses
 *   sync and never loses local data" rule, enforced at the only moment the relay
 *   sees a credential.
 * - It **cannot** answer "does this person hold a seat", because a sync
 *   connection carries an owner key or a share token, not a session. Member
 *   counts live in the control plane, which is the only place that knows them.
 * - It deliberately does **not** re-check the workspace ceiling. That is a
 *   creation gate (`canAddWorkspace`), and enforcing it on connect would take
 *   documents away from someone who already holds them because a licence shrank.
 *   "Lapsed" ends sync; "narrowed" ends new work.
 *
 * So this gate decides for *capability* principals, and refuses an account
 * principal with `account-check-unavailable` rather than guessing. That refusal
 * is not a gap in the policy: it is the honest boundary until the browser sends a
 * session to the relay (a separate lane). Guessing here would be worse than
 * refusing, because a wrong "allow" is invisible and a wrong "deny" is a support
 * ticket.
 */

/**
 * Why the relay refused a connection that its credential check allowed: one of
 * the shared licence refusals, or the one refusal only the relay can produce
 * because it holds no member counts.
 */
export type RelaySeatRefusal = SeatRefusal | "account-check-unavailable";

export type RelaySeatDecision = SeatDecision | { ok: false; reason: RelaySeatRefusal };

export interface RelaySeatDeps {
  /**
   * True only on the hosted relay (`SUITE_HOSTED=1`). When false the gate is
   * inert: self-hosting has no licence, so it has nothing to enforce.
   */
  enforced: boolean;
  /** The verified licence recorded for a workspace, or null when none is. */
  licenceFor: (workspaceId: string) => SeatLicence | null;
  now?: () => number;
}

/** What a joined room's credential proved. Deliberately narrower than `Principal`. */
export type ConnectionPrincipal =
  | { kind: "owner"; workspaceId: string }
  | { kind: "share"; workspaceId: string }
  | { kind: "account"; workspaceId: string };

export interface RelaySeatGate {
  allow: (principal: ConnectionPrincipal) => RelaySeatDecision;
}

/**
 * The relay's licence projection, in the shape `@suite/auth` checks.
 *
 * `LicenceClaimRecord` was written from freshly verified claims, so rebuilding
 * `LicenceClaims` from it is not a guess — except for `issuedAt`, which the
 * record stores as `claimedAt`. That field is informational (the check reads
 * `expiresAt` and the caps), and saying so here is cheaper than storing it twice.
 *
 * Seats are not in this projection: the relay never checks them, and a zero would
 * be a lie about a licence that has them.
 */
export function claimsFromClaimRecord(record: LicenceClaimRecord): LicenceClaims {
  return {
    v: 1,
    id: record.licenceId,
    tier: record.tier,
    workspaces: record.quota.workspaces,
    documentBytes: record.quota.documentBytes,
    attachmentBytes: record.quota.attachmentBytes,
    issuedAt: record.claimedAt,
    expiresAt: record.expiresAt,
    ...(record.email === null ? {} : { email: record.email }),
  };
}

export function createRelaySeatGate(deps: RelaySeatDeps): RelaySeatGate {
  const now = deps.now ?? Date.now;

  return {
    allow: (principal) => {
      if (!deps.enforced) return { ok: true, seat: "anonymous" };

      if (principal.kind === "account") {
        // See the module comment: no member counts on this process.
        return { ok: false, reason: "account-check-unavailable" };
      }

      const licence = deps.licenceFor(principal.workspaceId);
      if (licence === null) return { ok: false, reason: "licence-missing" };

      return checkSeat({
        workspaceId: principal.workspaceId,
        principal: { kind: principal.kind, workspaceId: principal.workspaceId },
        licence: { kind: "licensed", licence },
        // Both counts are unused for a capability principal: `checkSeat` reads
        // them only for an account, and an account is refused above. Passing the
        // fields keeps the shape honest — they are zero because the relay knows
        // zero, not because zero was measured.
        workspaceCount: 0,
        memberCount: 0,
        now: now(),
      });
    },
  };
}

/**
 * Builds the gate from the relay's own licence claim store.
 *
 * Kept here rather than in `server.ts` so the mapping from the relay's rows to the
 * shared check is testable without booting the server.
 */
export function relaySeatGateFromClaims(
  claims: { get: (workspaceId: string) => LicenceClaimRecord | null } | null,
  enforced: boolean,
  now: () => number = Date.now,
): RelaySeatGate {
  return createRelaySeatGate({
    enforced,
    licenceFor: (workspaceId) => {
      const record = claims?.get(workspaceId) ?? null;
      // `seats: 0` is deliberate: the relay never consults it (see above), and
      // inventing a count would be the kind of number that ends up enforced.
      return record === null ? null : seatLicence(claimsFromClaimRecord(record), 0);
    },
    now,
  });
}
