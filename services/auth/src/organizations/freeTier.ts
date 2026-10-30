import { FREE_TIER } from "../licensing/entitlements.js";
import type { SeatLicence } from "../types.js";

/**
 * The licence every organization is born with — and on a hosted deployment, the wall.
 *
 * An organization used to be born with *no* licence row at all, because nothing in this
 * package wrote one. `beforeAddMember` therefore read a row nobody created and refused
 * the creator their own organization with `seat-refusal: licence-missing`: signing up
 * was possible and creating a workspace was not. A trigger now writes this row in the
 * same transaction as the organization (`sql/0009_free_licence_provisioning.sql`), and
 * this module is where its numbers live.
 *
 * ## Unlimited workspaces with storage-based quotas (0013)
 *
 * Workspaces are documents/projects, not a metered commodity. Artificial workspace
 * limits created friction and prevented users from sharing their work. Free accounts
 * have unlimited workspaces (represented by integer max 2147483647), with storage-based
 * quotas: 32 MiB per document, 100 MiB total attachment storage for the organization,
 * and 1 seat for the owner.
 *
 * Paid plans expand storage and add additional team member seats.
 *
 * The seat stays at one for free accounts, and that is not an oversight: a seat *is*
 * a `member` row, and an organization whose owner cannot be a member cannot exist.
 * `0` seats would repeat the provisioning bug this row was created to fix.
 *
 * `Infinity` remains the self-host answer (`UNLIMITED_QUOTA`,
 * `packages/licence/src/quota.ts`), and a self-host never reads this row at all — the
 * gate is inert without `SUITE_HOSTED=1`.
 *
 * The same literals are written by the migration, because Postgres has to insert the row
 * in the organization's own transaction. `scripts/db-verify.mjs` reads the row the trigger
 * wrote and compares it with this object, so the two cannot drift without a failing gate.
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

export const FREE_LICENCE_TIER: FreeLicenceTier = {
  tier: FREE_TIER,
  // Free accounts have unlimited workspaces, gated by storage and seats.
  workspaces: 2_147_483_647,
  // The owner's own membership. A seat is a `member` row, so this cannot be zero.
  seats: 1,
  // 32 MiB per workspace document, 100 MiB total attachment storage for the organization.
  documentBytes: 33_554_432,
  attachmentBytes: 104_857_600,
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
