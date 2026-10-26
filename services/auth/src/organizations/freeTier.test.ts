import { describe, expect, it } from "vitest";
import { FREE_TIER } from "../licensing/entitlements.js";
import { FREE_LICENCE_TIER, freeSeatLicence } from "./freeTier.js";
import { canAddWorkspace, checkSeatAllowance } from "./seats.js";

/**
 * The free tier is the floor the product has to stand on: an organization that cannot
 * create a workspace and cannot hold its owner is the bug this tier exists to end
 * (`sql/0009_free_licence_provisioning.sql`).
 *
 * These are properties, not literals: the numbers may change, but never back to
 * `Infinity` ("unlimited" is the self-host answer and would make the free tier a paid
 * plan) and never to `0` (the fail-closed default, which admits nobody).
 */
const NOW = 1_760_000_000_000;
const ORG = "org-agency";

describe("FREE_LICENCE_TIER", () => {
  it("names a finite, positive ceiling for every allowance", () => {
    for (const key of ["workspaces", "seats", "documentBytes", "attachmentBytes"] as const) {
      const value = FREE_LICENCE_TIER[key];
      expect(Number.isSafeInteger(value), `${key} is not a safe integer: ${value}`).toBe(true);
      expect(
        value,
        `${key} is zero, so a free organization could not use the product`,
      ).toBeGreaterThan(0);
      expect(Number.isFinite(value), `${key} is unlimited, which is a paid plan`).toBe(true);
    }
  });

  it("is the free tier the entitlement read already reports", () => {
    // `services/billing`'s reader answers `free` with no subscription; the licence row
    // has to agree about the label or the token and the seat check name two things.
    expect(FREE_LICENCE_TIER.tier).toBe(FREE_TIER);
  });

  it("gives a new organization one workspace and its owner's seat", () => {
    const licence = freeSeatLicence(ORG, NOW);

    // Creating the first workspace is the floor: `canAddWorkspace` counts the row
    // *after* the write, so a ceiling of one has to allow the count of one.
    expect(
      canAddWorkspace({
        organizationId: ORG,
        licence: { kind: "licensed", licence },
        workspaceCount: 0,
        now: NOW,
      }),
    ).toEqual({ ok: true, seat: "licensed-member" });
    expect(
      canAddWorkspace({
        organizationId: ORG,
        licence: { kind: "licensed", licence },
        workspaceCount: 1,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "workspace-allowance-exhausted" });

    // The creator's own membership is the first `member` row, and `beforeAddMember`
    // asks about the count *after* the write as well.
    expect(
      checkSeatAllowance({
        organizationId: ORG,
        licence: { kind: "licensed", licence },
        memberCount: 1,
        now: NOW,
      }),
    ).toEqual({ ok: true, seat: "licensed-member" });
    expect(
      checkSeatAllowance({
        organizationId: ORG,
        licence: { kind: "licensed", licence },
        memberCount: 2,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "seat-allowance-exhausted" });
  });

  it("runs for a century and names the organization in its licence id", () => {
    const licence = freeSeatLicence(ORG, NOW);
    expect(licence.claims.expiresAt).toBeGreaterThan(NOW + 99 * 365 * 24 * 60 * 60 * 1000);
    expect(licence.claims.id).toBe(`free:${ORG}`);
    expect(licence.claims.issuedAt).toBe(NOW);
  });
});
