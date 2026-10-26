import { describe, expect, it } from "vitest";
import { principalPrecedence, resolvePrincipal } from "./principal.js";

/**
 * Precedence is the highest-risk rule in the phase (ADR-0065, consequences).
 * These tests state it as a table and then attack the two ways it can go wrong:
 * a session that should not apply, and a request that carries several
 * credentials at once.
 */
const WORKSPACE = "ws-q4";
const ORG = "org-agency";
const OTHER_ORG = "org-rival";

const session = {
  userId: "user-1",
  organizationId: ORG,
  role: "admin" as const,
};

describe("resolvePrincipal", () => {
  it("declares its precedence once, in order", () => {
    expect(principalPrecedence).toEqual(["account", "owner", "share"]);
  });

  it("prefers a session that names this workspace's organization", () => {
    const principal = resolvePrincipal({
      workspaceId: WORKSPACE,
      organizationId: ORG,
      session,
      ownerKeyHash: "a".repeat(64),
      shareToken: "share-token",
    });
    expect(principal).toEqual({
      kind: "account",
      workspaceId: WORKSPACE,
      organizationId: ORG,
      userId: "user-1",
      role: "admin",
    });
  });

  it("prefers the owner key over a share token", () => {
    expect(
      resolvePrincipal({
        workspaceId: WORKSPACE,
        organizationId: ORG,
        ownerKeyHash: "b".repeat(64),
        shareToken: "share-token",
      }),
    ).toEqual({ kind: "owner", workspaceId: WORKSPACE });
  });

  it("falls back to the share token when nothing stronger applies", () => {
    expect(
      resolvePrincipal({
        workspaceId: WORKSPACE,
        organizationId: ORG,
        shareToken: "share-token",
      }),
    ).toEqual({ kind: "share", workspaceId: WORKSPACE });
  });

  it("returns no identity when no credential is present", () => {
    expect(resolvePrincipal({ workspaceId: WORKSPACE, organizationId: ORG })).toBeNull();
    expect(
      resolvePrincipal({
        workspaceId: WORKSPACE,
        organizationId: ORG,
        ownerKeyHash: "",
        shareToken: "   ",
        session: null,
      }),
    ).toBeNull();
  });

  it("ignores a session for a different tenant, so a share link still works", () => {
    // Signed in, but acting in another organization: the session must not shadow
    // the share token that actually opens this document.
    const principal = resolvePrincipal({
      workspaceId: WORKSPACE,
      organizationId: ORG,
      session: { ...session, organizationId: OTHER_ORG },
      shareToken: "share-token",
    });
    expect(principal?.kind).toBe("share");
  });

  it("ignores a session whose membership was removed", () => {
    const principal = resolvePrincipal({
      workspaceId: WORKSPACE,
      organizationId: ORG,
      session: { ...session, role: null },
      shareToken: "share-token",
    });
    expect(principal?.kind).toBe("share");
  });

  it("ignores a session with no active organization", () => {
    const principal = resolvePrincipal({
      workspaceId: WORKSPACE,
      organizationId: ORG,
      session: { userId: "user-1", organizationId: null, role: "owner" },
      ownerKeyHash: "c".repeat(64),
    });
    expect(principal?.kind).toBe("owner");
  });

  it("does not treat a session as an account principal for an anonymous workspace", () => {
    // An unclaimed workspace has no organization, so no session can speak for it.
    const principal = resolvePrincipal({
      workspaceId: WORKSPACE,
      organizationId: null,
      session,
      shareToken: "share-token",
    });
    expect(principal?.kind).toBe("share");
  });

  it("returns no identity for an empty workspace id", () => {
    expect(
      resolvePrincipal({ workspaceId: "  ", organizationId: ORG, ownerKeyHash: "d".repeat(64) }),
    ).toBeNull();
  });
});
