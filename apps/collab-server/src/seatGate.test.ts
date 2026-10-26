import { describe, expect, it } from "vitest";
import { claimsFromClaimRecord, createRelaySeatGate, relaySeatGateFromClaims } from "./seatGate.js";
import type { LicenceClaimRecord } from "./workspaceHttp.js";

/**
 * The relay-side gate, tested where the relay lives.
 *
 * Two properties matter and both are about *not* over-claiming: a self-host is
 * inert, and an account principal is refused instead of being guessed at. The
 * licensed cases pin what a lapsed licence does to a live capability.
 */
const NOW = 1_760_000_000_000;
const HOUR = 60 * 60 * 1000;
const WORKSPACE = "ws-q4";
const OTHER = "ws-other";

function record(overrides: Partial<LicenceClaimRecord> = {}): LicenceClaimRecord {
  return {
    workspaceId: WORKSPACE,
    licenceId: "lic-1",
    tier: "team",
    quota: { workspaces: 2, documentBytes: 1_000_000, attachmentBytes: 1_000_000 },
    email: null,
    expiresAt: NOW + 24 * HOUR,
    claimedAt: NOW - 48 * HOUR,
    ...overrides,
  };
}

function claims(rows: LicenceClaimRecord[]) {
  const byWorkspace = new Map(rows.map((row) => [row.workspaceId, row]));
  return { get: (workspaceId: string) => byWorkspace.get(workspaceId) ?? null };
}

describe("claimsFromClaimRecord", () => {
  it("rebuilds the signed fields the seat check reads", () => {
    expect(claimsFromClaimRecord(record())).toMatchObject({
      v: 1,
      id: "lic-1",
      tier: "team",
      workspaces: 2,
      expiresAt: NOW + 24 * HOUR,
    });
  });

  it("omits the email rather than storing a null", () => {
    expect(claimsFromClaimRecord(record())).not.toHaveProperty("email");
    expect(claimsFromClaimRecord(record({ email: "a@b.c" }))).toHaveProperty("email", "a@b.c");
  });
});

describe("createRelaySeatGate", () => {
  it("is inert on a self-host", () => {
    const gate = createRelaySeatGate({
      enforced: false,
      licenceFor: () => null,
      now: () => NOW,
    });
    expect(gate.allow({ kind: "owner", workspaceId: WORKSPACE })).toEqual({
      ok: true,
      seat: "anonymous",
    });
    expect(gate.allow({ kind: "account", workspaceId: WORKSPACE }).ok).toBe(true);
  });

  it("admits an owner key while the licence is valid", () => {
    const gate = relaySeatGateFromClaims(claims([record()]), true, () => NOW);
    expect(gate.allow({ kind: "owner", workspaceId: WORKSPACE })).toEqual({
      ok: true,
      seat: "owner",
    });
    expect(gate.allow({ kind: "share", workspaceId: WORKSPACE })).toEqual({
      ok: true,
      seat: "share",
    });
  });

  it("refuses a workspace with no licence row on the hosted relay", () => {
    const gate = relaySeatGateFromClaims(claims([record()]), true, () => NOW);
    expect(gate.allow({ kind: "owner", workspaceId: OTHER })).toEqual({
      ok: false,
      reason: "licence-missing",
    });
  });

  it("refuses a lapsed licence: sync ends, the document does not", () => {
    const gate = relaySeatGateFromClaims(claims([record({ expiresAt: NOW - 1 })]), true, () => NOW);
    expect(gate.allow({ kind: "owner", workspaceId: WORKSPACE })).toEqual({
      ok: false,
      reason: "licence-expired",
    });
  });

  it("does not re-check the workspace ceiling on connect", () => {
    // A shrunken licence must not take away a document someone already holds;
    // the ceiling refuses the *next* claim instead (`canAddWorkspace`).
    const gate = relaySeatGateFromClaims(
      claims([record({ quota: { workspaces: 1, documentBytes: 1, attachmentBytes: 1 } })]),
      true,
      () => NOW,
    );
    expect(gate.allow({ kind: "share", workspaceId: WORKSPACE })).toEqual({
      ok: true,
      seat: "share",
    });
  });

  it("refuses an account principal instead of guessing at a seat", () => {
    // No member counts exist on this process. A guess here would either let a
    // payer's seat leak or lock a member out, and neither is recoverable by the
    // person affected.
    const gate = relaySeatGateFromClaims(claims([record()]), true, () => NOW);
    expect(gate.allow({ kind: "account", workspaceId: WORKSPACE })).toEqual({
      ok: false,
      reason: "account-check-unavailable",
    });
  });

  it("never consults a licence when nothing is enforced", () => {
    let reads = 0;
    const gate = createRelaySeatGate({
      enforced: false,
      licenceFor: () => {
        reads += 1;
        return null;
      },
      now: () => NOW,
    });
    gate.allow({ kind: "owner", workspaceId: WORKSPACE });
    expect(reads).toBe(0);
  });

  it("reads nothing at all when the claim store is absent but a licence is required", () => {
    const gate = relaySeatGateFromClaims(null, true, () => NOW);
    expect(gate.allow({ kind: "owner", workspaceId: WORKSPACE })).toEqual({
      ok: false,
      reason: "licence-missing",
    });
  });
});
