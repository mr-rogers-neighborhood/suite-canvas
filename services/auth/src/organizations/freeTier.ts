import { FREE_TIER } from "../licensing/entitlements.js";
import type { SeatLicence } from "../types.js";

/**
 * The free tier: the licence every organization is born with (ADR-0065 §7).
 *
 * An organization used to be born with *no* licence row at all, because nothing in this
 * package wrote one. `beforeAddMember` therefore read a row nobody created and refused
 * the creator their own organization with `seat-refusal: licence-missing`: signing up
 * was possible and creating a workspace was not. The row is now written by the same
 * transaction that writes the organization
 * (`sql/0009_free_licence_provisioning.sql`), and this module is where its numbers
 * live.
 *
 * Every ceiling is a named number, and both tempting alternatives are wrong:
 *
 * - `Infinity` is the self-host answer (`UNLIMITED_QUOTA`, `packages/licence/src/quota.ts`)
 *   and would make a hosted free organization a paid plan with no payment;
 * - `0` is the fail-closed default (`DEFAULT_SEATS`, `seats.ts`) and would repeat the
 *   bug this module exists to fix, one member short.
 *
 * The numbers are the cheapest ceiling the code already enforces, not new policy:
 * `isPlanEntry` in `services/billing/src/stripe/tiers.ts` refuses a plan with fewer than
 * one workspace, and one workspace with its owner in it is the smallest licensable
 * organization the product can be used for.
 *
 * The same literals are written by migration 0009, because Postgres has to insert the
 * row in the organization's own transaction. `scripts/db-verify.mjs` reads the row the
 * trigger wrote and compares it with this object, so the two cannot drift without a
 * failing gate.
 */
export interface FreeLicenceTier {
  /** Tier label. `free` is also what the entitlement read answers with no subscription. */
  tier: string;
  /** Workspaces the organization may claim. Never `Infinity`, never `0`. */
  workspaces: number;
  /** Members, owner included: a seat *is* a member row. */
  seats: number;
  /** Per-document cap the relay applies. */
  documentBytes: number;
  /** Per-attachment cap the relay applies; below its own 16 MiB hard cap, so it binds. */
  attachmentBytes: number;
  /**
   * How long a free licence runs, in days.
   *
   * Days rather than `interval '100 years'` because the in-memory row and the SQL row
   * have to name the same instant, and 36,525 days is exactly 100 Julian years in both.
   * A free licence that never expired would need `expires_at` to be `infinity`, which
   * `pg` hands back as `Infinity` and `millis()` in `store/postgresRepositories.ts`
   * refuses — the column is `NOT NULL`, so a finite horizon is the honest encoding.
   */
  days: number;
}

const MIB = 1024 * 1024;

export const FREE_LICENCE_TIER: FreeLicenceTier = {
  tier: FREE_TIER,
  workspaces: 1,
  seats: 1,
  documentBytes: 64 * MIB,
  attachmentBytes: 8 * MIB,
  days: 36_525,
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * The row a new organization gets, as the seat check reads it.
 *
 * The in-memory control plane writes this in `addOrganization`, so a test and a
 * deployment agree about what a fresh organization is licensed for. The licence id is
 * derived from the organization id rather than random: a second free row for the same
 * organization would be a bug, and `organization_licences.organization_id` is the
 * primary key so Postgres would refuse it anyway.
 */
export function freeSeatLicence(organizationId: string, now: number): SeatLicence {
  return {
    claims: {
      // `LICENCE_FORMAT_VERSION` lives in `@suite/licence`, which this package does not
      // depend on; `LicenceClaims` is declared structurally for exactly that reason.
      v: 1,
      id: `free:${organizationId}`,
      tier: FREE_LICENCE_TIER.tier,
      workspaces: FREE_LICENCE_TIER.workspaces,
      documentBytes: FREE_LICENCE_TIER.documentBytes,
      attachmentBytes: FREE_LICENCE_TIER.attachmentBytes,
      issuedAt: now,
      expiresAt: now + FREE_LICENCE_TIER.days * DAY,
    },
    seats: FREE_LICENCE_TIER.seats,
  };
}
