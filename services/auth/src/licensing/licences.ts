import type { LicenceState } from "../organizations/seats.js";
import type { MemberRecord, OrganizationRole, SeatLicence } from "../types.js";

/** Where the control plane keeps the licence a seat check reads. */
export interface LicenceStore {
  forOrganization: (organizationId: string) => Promise<SeatLicence | null>;
}

/**
 * Member counts and roles, read from Better Auth's own `member` table.
 *
 * The control plane reads that table and writes it in exactly one place — the
 * invite-key redemption transaction — because the plugin's `addMember` endpoint
 * requires a session *inside* the organization and a redeemer is by definition
 * not one yet. Everything else about membership goes through the plugin.
 */
export interface MembershipReader {
  countForOrganization: (organizationId: string) => Promise<number>;
  /** Organizations this user belongs to, for the per-account tenant ceiling. */
  countForUser: (userId: string) => Promise<number>;
  roleFor: (organizationId: string, userId: string) => Promise<OrganizationRole | null>;
  listForOrganization: (organizationId: string) => Promise<MemberRecord[]>;
}

/**
 * The three-way state a seat check needs, assembled in one place.
 *
 * `owned` is a better name than "has a licence": an anonymous workspace has no
 * organization and therefore no licence to apply, while an owned workspace with
 * a missing row must fail closed. Collapsing the two would let a deleted row
 * grant free sync — the exact bug this distinction exists to prevent.
 */
export function licenceStateFor(owned: boolean, licence: SeatLicence | null): LicenceState {
  if (!owned) return { kind: "anonymous" };
  return licence === null ? UNPROVISIONED : { kind: "licensed", licence };
}

/**
 * No licence row where one must exist.
 *
 * The state means *unprovisioned*: every organization gets a free row from
 * `sql/0009_free_licence_provisioning.sql` and a paid one from the billing projection, so
 * a null read is a deployment fault and never a customer's plan. The discriminant string
 * is `unlicensed` because `organizations/seats.ts` declares the `LicenceState` union and
 * this module must not invent a member; the refusal it produces is already named
 * correctly (`licence-unprovisioned`), which is the name a caller sees.
 */
export const UNPROVISIONED: LicenceState = Object.freeze({ kind: "unlicensed" });
