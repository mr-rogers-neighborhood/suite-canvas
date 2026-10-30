import { describe, expect, it } from "vitest";
import { FREE_TIER } from "../licensing/entitlements.js";
import { FREE_LICENCE_TIER, freeSeatLicence } from "./freeTier.js";
import { canAddWorkspace, checkSeatAllowance } from "./seats.js";

/**
 * The born-with licence: the owner's seat, and nothing else.
 *
 * Local and offline use is free, so an account exists to buy sync. The row therefore
 * grants **no workspace** — `sql/0011_no_free_workspace.sql` is the wall — while keeping
 * one seat, because a seat is a `member` row and an owner who cannot be a member cannot
 * exist. The two zeroes mean different things and this file is where that is stated.
 */
const NOW = 1_760_000_000_000;
const ORG = "org-agency";

describe("FREE_LICENCE_TIER", () => {
  it("grants unlimited workspaces and initial storage quotas", () => {
    expect(FREE_LICENCE_TIER.workspaces).toBe(2_147_483_647);
    expect(FREE_LICENCE_TIER.documentBytes).toBe(33_554_432);
    expect(FREE_LICENCE_TIER.attachmentBytes).toBe(104_857_600);
  });

  it("still holds the owner's seat, because a seat is a member row", () => {
    // Zero here would repeat the provisioning bug `0009` exists to fix: the creator of an
    // organization is refused their own membership, and the organization is unreachable.
    expect(FREE_LICENCE_TIER.seats).toBe(1);
    expect(Number.isSafeInteger(FREE_LICENCE_TIER.seats)).toBe(true);
  });

  it("never answers Infinity, which is the self-host answer and a free paid plan", () => {
    for (const key of ["workspaces", "seats", "documentBytes", "attachmentBytes"] as const) {
      expect(Number.isFinite(FREE_LICENCE_TIER[key]), `${key} is unlimited`).toBe(true);
    }
  });

  it("is the free tier the entitlement read already reports", () => {
    // `services/billing`'s reader answers `free` with no subscription; the licence row
    // has to agree about the label or the token and the seat check name two things.
    expect(FREE_LICENCE_TIER.tier).toBe(FREE_TIER);
  });

  it("admits workspaces without workspace-allowance-exhausted and admits the owner", () => {
    const licence = freeSeatLicence(ORG, NOW);

    expect(
      canAddWorkspace({
        organizationId: ORG,
        licence: { kind: "licensed", licence },
        workspaceCount: 1,
        now: NOW,
      }),
    ).toEqual({ ok: true, seat: "licensed-member" });

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
