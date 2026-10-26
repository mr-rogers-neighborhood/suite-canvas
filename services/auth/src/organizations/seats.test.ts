import { describe, expect, it } from "vitest";
import type { LicenceClaims, Principal, SeatLicence } from "../types.js";
import { freeSeatLicence } from "./freeTier.js";
import type { LicenceState } from "./seats.js";
import {
  canAddWorkspace,
  checkSeat,
  checkSeatAllowance,
  checkWorkspaceAllowance,
  seatLicence,
  seatProblemMessage,
} from "./seats.js";

/**
 * The seat check is server-side or it is decoration (ADR-0065 §5). Everything
 * here is a pure function over counts and a verified licence, so the tests can
 * name the exact boundary: one workspace under the ceiling is allowed, one over
 * is not; the same for seats.
 */
const NOW = 1_760_000_000_000;
const HOUR = 60 * 60 * 1000;
const ORG = "org-agency";
const WORKSPACE = "ws-q4";

function claims(overrides: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    v: 1,
    id: "lic-1",
    tier: "team",
    workspaces: 3,
    documentBytes: 1_000_000,
    attachmentBytes: 1_000_000,
    issuedAt: NOW - HOUR,
    expiresAt: NOW + 24 * HOUR,
    ...overrides,
  };
}

function licence(seats: number, overrides: Partial<LicenceClaims> = {}): SeatLicence {
  return seatLicence(claims(overrides), seats);
}

const licensed = (value: SeatLicence): LicenceState => ({ kind: "licensed", licence: value });

/** The row an organization is born with: `0009_free_licence_provisioning.sql`. */
const freeLicence = (): SeatLicence => freeSeatLicence(ORG, NOW);

const accountPrincipal = (role: "owner" | "admin" | "member"): Principal => ({
  kind: "account",
  workspaceId: WORKSPACE,
  organizationId: ORG,
  userId: "user-1",
  role,
});

describe("checkWorkspaceAllowance", () => {
  it("allows an organization at or under its workspace ceiling", () => {
    const decision = checkWorkspaceAllowance({
      organizationId: ORG,
      licence: licensed(licence(5)),
      workspaceCount: 3,
      now: NOW,
    });
    expect(decision).toEqual({ ok: true, seat: "licensed-member" });
  });

  it("refuses an organization over its workspace ceiling", () => {
    const decision = checkWorkspaceAllowance({
      organizationId: ORG,
      licence: licensed(licence(5)),
      workspaceCount: 4,
      now: NOW,
    });
    expect(decision).toEqual({ ok: false, reason: "workspace-allowance-exhausted" });
  });
});

describe("canAddWorkspace", () => {
  it("allows the workspace that fills the ceiling", () => {
    // Three allowed, two held: the third is fine, and this is the off-by-one the
    // named function exists to get right exactly once.
    expect(
      canAddWorkspace({
        organizationId: ORG,
        licence: licensed(licence(0, { workspaces: 3 })),
        workspaceCount: 2,
        now: NOW,
      }).ok,
    ).toBe(true);
  });

  it("refuses the workspace past the ceiling", () => {
    expect(
      canAddWorkspace({
        organizationId: ORG,
        licence: licensed(licence(0, { workspaces: 3 })),
        workspaceCount: 3,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "workspace-allowance-exhausted" });
  });
});

describe("checkSeatAllowance", () => {
  it("allows a member count within the seats", () => {
    expect(
      checkSeatAllowance({
        organizationId: ORG,
        licence: licensed(licence(2)),
        memberCount: 2,
        now: NOW,
      }).ok,
    ).toBe(true);
  });

  it("refuses a member count past the seats", () => {
    expect(
      checkSeatAllowance({
        organizationId: ORG,
        licence: licensed(licence(2)),
        memberCount: 3,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "seat-allowance-exhausted" });
  });

  it("fails closed when a licence has no seat count", () => {
    // `licence.ts` signs no seat count, so a row without one admits the owner and
    // nobody else. Being wrong in this direction costs a support message; being
    // wrong the other way gives away seats.
    const zeroSeats = seatLicence(claims());
    expect(
      checkSeatAllowance({
        organizationId: ORG,
        licence: licensed(zeroSeats),
        memberCount: 1,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "seat-allowance-exhausted" });
  });
});

describe("licence validity", () => {
  it("names a missing licence row as a provisioning fault, not billing", () => {
    const missing: LicenceState = { kind: "unlicensed" };
    expect(
      checkSeatAllowance({ organizationId: ORG, licence: missing, memberCount: 1, now: NOW }),
    ).toEqual({ ok: false, reason: "licence-unprovisioned" });
    expect(
      checkWorkspaceAllowance({
        organizationId: ORG,
        licence: missing,
        workspaceCount: 1,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "licence-unprovisioned" });
  });

  it("distinguishes no row from a free row that ran out of seats", () => {
    const free = freeLicence();
    // The free row admits its owner and no one else: exhausting it is a billing
    // answer, and it must not read like the provisioning fault above.
    expect(
      checkSeatAllowance({
        organizationId: ORG,
        licence: licensed(free),
        memberCount: 1,
        now: NOW,
      }),
    ).toEqual({ ok: true, seat: "licensed-member" });
    expect(
      checkSeatAllowance({
        organizationId: ORG,
        licence: licensed(free),
        memberCount: 2,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "seat-allowance-exhausted" });
    expect(
      checkSeatAllowance({
        organizationId: ORG,
        licence: { kind: "unlicensed" },
        memberCount: 2,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "licence-unprovisioned" });
  });

  it("refuses an expired licence even though the count fits", () => {
    const expired = licence(99, { expiresAt: NOW - 1 });
    expect(
      checkSeatAllowance({
        organizationId: ORG,
        licence: licensed(expired),
        memberCount: 1,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "licence-expired" });
  });

  it("gates nothing for an anonymous workspace", () => {
    const decision = checkSeatAllowance({
      organizationId: ORG,
      licence: { kind: "anonymous" },
      memberCount: 5_000,
      now: NOW,
    });
    expect(decision).toEqual({ ok: true, seat: "anonymous" });
  });
});

describe("checkSeat", () => {
  it("bounds an owner account by the workspace ceiling", () => {
    expect(
      checkSeat({
        workspaceId: WORKSPACE,
        principal: accountPrincipal("owner"),
        licence: licensed(licence(5, { workspaces: 1 })),
        workspaceCount: 2,
        memberCount: 1,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "workspace-allowance-exhausted" });
  });

  it("bounds a member account by the seats", () => {
    expect(
      checkSeat({
        workspaceId: WORKSPACE,
        principal: accountPrincipal("member"),
        licence: licensed(licence(1)),
        workspaceCount: 1,
        memberCount: 2,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "seat-allowance-exhausted" });
  });

  it("admits an owner key while the licence is valid, without re-checking seats", () => {
    // The owner key is the offline key: it was granted when the workspace was
    // claimed, and re-litigating the allowance here would lock an owner out of
    // their own document after a downgrade.
    expect(
      checkSeat({
        workspaceId: WORKSPACE,
        principal: { kind: "owner", workspaceId: WORKSPACE },
        licence: licensed(licence(0)),
        workspaceCount: 99,
        memberCount: 99,
        now: NOW,
      }),
    ).toEqual({ ok: true, seat: "owner" });
  });

  it("still stops an owner key when the licence has expired", () => {
    expect(
      checkSeat({
        workspaceId: WORKSPACE,
        principal: { kind: "owner", workspaceId: WORKSPACE },
        licence: licensed(licence(5, { expiresAt: NOW })),
        workspaceCount: 1,
        memberCount: 1,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "licence-expired" });
  });

  it("admits a share token on a valid licence", () => {
    expect(
      checkSeat({
        workspaceId: WORKSPACE,
        principal: { kind: "share", workspaceId: WORKSPACE },
        licence: licensed(licence(1)),
        workspaceCount: 1,
        memberCount: 1,
        now: NOW,
      }),
    ).toEqual({ ok: true, seat: "share" });
  });

  it("refuses a principal that names another workspace", () => {
    expect(
      checkSeat({
        workspaceId: WORKSPACE,
        principal: { kind: "owner", workspaceId: "ws-other" },
        licence: licensed(licence(5)),
        workspaceCount: 1,
        memberCount: 1,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "licence-missing" });
  });

  it("gates nothing at all on an anonymous workspace", () => {
    for (const principal of [
      accountPrincipal("owner"),
      { kind: "share", workspaceId: WORKSPACE },
    ] as const) {
      expect(
        checkSeat({
          workspaceId: WORKSPACE,
          principal,
          licence: { kind: "anonymous" },
          workspaceCount: 0,
          memberCount: 0,
          now: NOW,
        }),
      ).toEqual({ ok: true, seat: "anonymous" });
    }
  });
});

describe("seatLicence", () => {
  it("rejects a negative or fractional seat count", () => {
    expect(() => seatLicence(claims(), -1)).toThrow(RangeError);
    expect(() => seatLicence(claims(), 1.5)).toThrow(RangeError);
  });

  it("defaults to no seats, so an unconfigured licence fails closed", () => {
    expect(seatLicence(claims()).seats).toBe(0);
  });
});

describe("seatProblemMessage", () => {
  it("has a sentence for every refusal", () => {
    for (const reason of [
      "licence-unprovisioned",
      "licence-missing",
      "licence-expired",
      "workspace-allowance-exhausted",
      "seat-allowance-exhausted",
    ] as const) {
      expect(seatProblemMessage(reason).length).toBeGreaterThan(10);
    }
  });
});
