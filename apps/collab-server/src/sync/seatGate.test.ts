import type { OrganizationRole } from "@suite/auth";
import { describe, expect, it } from "vitest";
import { type ConnectionPrincipal, createRelaySeatGate, relaySeatGate } from "./seatGate.js";

/**
 * The relay-side gate, tested where the relay lives.
 *
 * Two properties matter and both are about *not* over-claiming: a self-host is
 * inert, and an account is judged only on claims the control plane signed. The
 * gate holds no database, so every case here is a pure function of one token.
 */
const WORKSPACE = "ws-q4";

interface AccountOverrides {
  organizationId?: string;
  role?: OrganizationRole | null;
  tier?: string;
  limits?: Readonly<Record<string, number>>;
}

function account(overrides: AccountOverrides = {}): ConnectionPrincipal {
  return {
    kind: "account",
    workspaceId: WORKSPACE,
    organizationId: overrides.organizationId ?? "org-a",
    userId: "user-1",
    role: overrides.role === undefined ? "member" : overrides.role,
    tier: overrides.tier ?? "team",
    limits: overrides.limits ?? {
      workspaces: 3,
      documentBytes: 1_000_000,
      attachmentBytes: 1_000_000,
    },
  };
}

describe("createRelaySeatGate", () => {
  it("is inert on a self-host", () => {
    const gate = createRelaySeatGate({ enforced: false });
    expect(gate.allow({ kind: "share", workspaceId: WORKSPACE })).toEqual({
      ok: true,
      seat: "anonymous",
    });
    expect(gate.allow(account())).toEqual({ ok: true, seat: "anonymous" });
  });

  it("admits an account acting in an organization, from the claims alone", () => {
    const gate = createRelaySeatGate({ enforced: true });
    expect(gate.allow(account())).toEqual({ ok: true, seat: "licensed-member" });
    expect(gate.allow(account({ role: "owner" }))).toEqual({ ok: true, seat: "owner" });
    expect(gate.allow(account({ role: "admin" }))).toEqual({ ok: true, seat: "licensed-member" });
  });

  it("admits the free tier: a free plan is an entitlement, not a refusal", () => {
    const gate = createRelaySeatGate({ enforced: true });
    expect(gate.allow(account({ tier: "free", limits: {} }))).toEqual({
      ok: true,
      seat: "licensed-member",
    });
  });

  it("refuses a session that names no organization", () => {
    // Nothing is bought behind a personal session, and no workspace can be
    // recorded under it, so there is no tenant to enforce a licence on.
    const gate = createRelaySeatGate({ enforced: true });
    expect(gate.allow(account({ organizationId: "" }))).toEqual({
      ok: false,
      reason: "organization-required",
    });
  });

  it("refuses a token that carries no tier", () => {
    const gate = createRelaySeatGate({ enforced: true });
    expect(gate.allow(account({ tier: "  " }))).toEqual({ ok: false, reason: "licence-missing" });
  });

  it("never asks a share visitor for a seat", () => {
    // A link is a capability minted by an account. Its own expiry and revocation
    // bound it, and this process holds no licence table to check it against.
    const gate = createRelaySeatGate({ enforced: true });
    expect(gate.allow({ kind: "share", workspaceId: WORKSPACE })).toEqual({
      ok: true,
      seat: "share",
    });
  });

  it("does not re-check the workspace ceiling on connect", () => {
    // A shrunken plan must not take away a document someone already holds; the
    // ceiling refuses the next claim in the control plane instead.
    const gate = createRelaySeatGate({ enforced: true });
    expect(gate.allow(account({ limits: { workspaces: 0 } }))).toEqual({
      ok: true,
      seat: "licensed-member",
    });
  });

  it("builds the hosted gate from one flag", () => {
    expect(relaySeatGate(false).allow(account())).toEqual({ ok: true, seat: "anonymous" });
    expect(relaySeatGate(true).allow(account())).toEqual({
      ok: true,
      seat: "licensed-member",
    });
  });
});
