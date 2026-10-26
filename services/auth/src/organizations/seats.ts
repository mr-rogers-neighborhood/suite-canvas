import type { LicenceClaims, Principal, SeatLicence } from "../types.js";

/**
 * The server-side seat and workspace check (ADR-0065 §5, amendment §7).
 *
 * Everything here is a pure function over counts and a *verified* licence. No
 * value in the inputs may come from a request body: the relay verifies the
 * Ed25519 signature, the control plane reads its own rows, and a client claim
 * is never an argument. That is the whole point — "the seat check is server-side
 * or it is decoration".
 */

/**
 * Whether a licence applies to the workspace at all.
 *
 * `anonymous` is not "no licence yet": it is the local-first case, a workspace
 * no organization owns. Anonymous workspaces are first-class in this product and
 * nothing may gate them (ADR-0065, consequences).
 *
 * `unlicensed` costs a name and a distinction, because two very different things
 * used to collapse into it:
 *
 * - a **free** organization is `licensed`, with the row
 *   `sql/0009_free_licence_provisioning.sql` writes. Its ceilings are real numbers
 *   (`FREE_LICENCE_TIER`), so exhausting one is a billing answer: buy a plan.
 * - **no row where a row must exist** is `unlicensed`, and that is a provisioning
 *   fault, not a customer's problem — every organization gets a licence row in the
 *   transaction that creates it. It fails closed (deleting a row must never be a way
 *   to keep syncing free) and it refuses with its own code, `licence-unprovisioned`,
 *   so it cannot be mistaken for "your plan does not cover this".
 */
export type LicenceState =
  | { kind: "anonymous" }
  | { kind: "unlicensed" }
  | { kind: "licensed"; licence: SeatLicence };

export type SeatRefusal =
  /** No licence row for an owned organization: a provisioning bug, never billing. */
  | "licence-unprovisioned"
  /** This credential was never a capability for this workspace. */
  | "licence-missing"
  | "licence-expired"
  | "workspace-allowance-exhausted"
  | "seat-allowance-exhausted";

export type SeatDecision =
  | { ok: true; seat: "anonymous" | "owner" | "share" | "licensed-member" }
  | { ok: false; reason: SeatRefusal };

/** One sentence per refusal, safe to show to the person being refused. */
export function seatProblemMessage(reason: SeatRefusal): string {
  switch (reason) {
    case "licence-unprovisioned":
      // Deliberately not "your licence has expired" or "you need a plan": the state
      // this describes is a deployment that never wrote the row, which no upgrade
      // fixes. Naming it for the operator is the only useful thing to say.
      return "this organization has no licence row at all, so its free licence was never provisioned; this is a deployment fault rather than a billing one";
    case "licence-missing":
      return "this credential is not a capability for this workspace";
    case "licence-expired":
      return "the licence for this organization has expired";
    case "workspace-allowance-exhausted":
      return "this organization holds more workspaces than its licence allows";
    case "seat-allowance-exhausted":
      return "this organization has more members than its licence allows";
  }
}

export interface LicenceInput {
  licence: LicenceState;
  /** Epoch milliseconds; injected so the check is deterministic in tests. */
  now: number;
}

/**
 * The licence has to be present and unexpired before any allowance means
 * anything. Expiry is checked again here even though the relay's
 * `verifyLicence` already refuses an expired token: a stored row can outlive
 * the token that produced it, and a second cheap check is the difference
 * between "expired last week" and "still syncing".
 */
function licenceRefusal(input: LicenceInput): SeatRefusal | null {
  if (input.licence.kind === "anonymous") return null;
  if (input.licence.kind === "unlicensed") return "licence-unprovisioned";
  return input.licence.licence.claims.expiresAt <= input.now ? "licence-expired" : null;
}

export interface WorkspaceAllowanceInput extends LicenceInput {
  /** Present when the caller knows it; the refusal itself never depends on it. */
  organizationId?: string;
  /** Non-archived workspaces this organization holds *now*, including the one asking. */
  workspaceCount: number;
}

/**
 * "How many workspaces may this organization hold?" — the licence's `workspaces`
 * field is a ceiling on the organization, not on the account (amendment §7).
 */
export function checkWorkspaceAllowance(input: WorkspaceAllowanceInput): SeatDecision {
  if (input.licence.kind === "anonymous") return { ok: true, seat: "anonymous" };
  const refusal = licenceRefusal(input);
  if (refusal !== null) return { ok: false, reason: refusal };
  if (input.licence.kind !== "licensed") return { ok: false, reason: "licence-unprovisioned" };
  const ceiling = input.licence.licence.claims.workspaces;
  if (!Number.isFinite(ceiling)) return { ok: true, seat: "licensed-member" };
  return input.workspaceCount <= ceiling
    ? { ok: true, seat: "licensed-member" }
    : { ok: false, reason: "workspace-allowance-exhausted" };
}

/**
 * The numeric seat ceiling a licence grants, or `0` when there is nothing to grant.
 *
 * One number, one meaning, because two writers ask the question: `checkSeatAllowance`
 * below (the relay and the organization hooks) and `resolveSeatLimit` in
 * `enrollment.ts` (the invitation plugin, which writes `member` rows through the
 * adapter and therefore never passes through a hook). A refused licence yields `0`
 * rather than a separate "no licence" answer, which is the fail-closed direction: a
 * missing row admits nobody but the people already counted.
 *
 * The consequence is the one place this distinction leaks: the invitation plugin turns
 * `0` into its own `SEAT_LIMIT_REACHED`, which `enrollment.ts` maps to `seat-refused`.
 * A redemption against an organization with no licence row therefore still reads like a
 * billing refusal rather than `licence-unprovisioned`. That is a real gap, reported
 * rather than papered over here: the plugin's answer is an ordinal, not a reason.
 */
export function seatCeiling(input: LicenceInput): number {
  if (input.licence.kind !== "licensed") return 0;
  if (input.licence.licence.claims.expiresAt <= input.now) return 0;
  return input.licence.licence.seats;
}

export interface SeatAllowanceInput extends LicenceInput {
  /** Present when the caller knows it; the refusal itself never depends on it. */
  organizationId?: string;
  /** `member` rows in the organization, owner included: a seat is a member. */
  memberCount: number;
}

/**
 * "How many people may this organization have?" — an organization seat is a
 * member row, and the owner holds one of them.
 *
 * The signed licence has no seat count (`licence.ts` signs `workspaces` and the
 * byte caps only), so the count lives beside the licence in
 * `organization_licences.seats` and defaults to 0. Failing closed means a
 * licence nobody configured seats for admits its owner and no one else, which
 * is the safe way to be wrong.
 */
export function checkSeatAllowance(input: SeatAllowanceInput): SeatDecision {
  if (input.licence.kind === "anonymous") return { ok: true, seat: "anonymous" };
  const refusal = licenceRefusal(input);
  if (refusal !== null) return { ok: false, reason: refusal };
  if (input.licence.kind !== "licensed") return { ok: false, reason: "licence-unprovisioned" };
  const seats = seatCeiling(input);
  if (!Number.isFinite(seats)) return { ok: true, seat: "licensed-member" };
  return input.memberCount <= seats
    ? { ok: true, seat: "licensed-member" }
    : { ok: false, reason: "seat-allowance-exhausted" };
}

/**
 * The creation boundary: "may one more workspace be created in this
 * organization?" It is the existing allowance check applied to the count *after*
 * the write, in one named function, so the endpoint and every future creation
 * path call the same rule instead of re-deriving `count + 1` and getting it
 * wrong by one (amendment §8's `beforeCreateWorkspace`).
 */
export function canAddWorkspace(input: WorkspaceAllowanceInput): SeatDecision {
  return checkWorkspaceAllowance({ ...input, workspaceCount: input.workspaceCount + 1 });
}

export interface SeatCheckInput extends LicenceInput {
  workspaceId: string;
  principal: Principal;
  /** Non-archived workspaces in the organization that owns this workspace. */
  workspaceCount: number;
  /** Member rows in that organization, owner included. */
  memberCount: number;
}

/**
 * The relay-facing check: may this principal sync this document?
 *
 * Which allowance applies depends on what the principal *is*:
 *
 * - a share token or an owner key is a capability, granted before this check
 *   ran. It still loses sync when the licence has expired or vanished, because a
 *   lapsed licence loses sync (ADR-0065 §5) — but its seat and workspace
 *   allowances were settled when the capability was minted, and re-litigating
 *   them here would lock an owner out of a workspace they already hold.
 * - an account acts through the organization, so the organization's allowance is
 *   the one that applies: an `owner` is bounded by the workspace ceiling, an
 *   `admin`/`member` is a seat.
 *
 * A null licence for an *owned* workspace must be `{ kind: "unlicensed" }`, not
 * `{ kind: "anonymous" }`; the two are different questions and only the caller
 * can tell them apart.
 */
export function checkSeat(input: SeatCheckInput): SeatDecision {
  if (input.licence.kind === "anonymous") return { ok: true, seat: "anonymous" };
  if (input.principal.workspaceId !== input.workspaceId) {
    // A principal that names another workspace is not a principal for this one.
    // Returning a refusal rather than throwing keeps the relay's answer binary.
    return { ok: false, reason: "licence-missing" };
  }

  if (input.principal.kind === "share" || input.principal.kind === "owner") {
    const refusal = licenceRefusal(input);
    if (refusal !== null) return { ok: false, reason: refusal };
    return { ok: true, seat: input.principal.kind === "share" ? "share" : "owner" };
  }

  return input.principal.role === "owner"
    ? checkWorkspaceAllowance(input)
    : checkSeatAllowance(input);
}

/**
 * Seats a licence should record for a role set. Not a policy — it exists so the
 * billing lane and the migration have one obvious value to seed, and so a test
 * can assert the fail-closed default is not silently bypassed.
 */
export const DEFAULT_SEATS: number = 0;

/**
 * Adapts verified `LicenceClaims` (from the relay's Ed25519 check) into the
 * shape above. `seats` is supplied by the control plane, which is the only
 * place that knows it; it defaults to `DEFAULT_SEATS`, which admits no member.
 */
export function seatLicence(claims: LicenceClaims, seats: number = DEFAULT_SEATS): SeatLicence {
  if (!Number.isSafeInteger(seats) || seats < 0) {
    throw new RangeError(`seats must be a non-negative integer, got ${String(seats)}`);
  }
  return { claims, seats };
}
