import { describe, expect, it } from "vitest";
import {
  currentEntitlement,
  entitlementView,
  freeWorkspaceLine,
  quotaLines,
  refusalKind,
  upgradeMessage,
} from "./entitlement";

describe("quota lines", () => {
  it("names the limits the relay enforces and formats bytes as bytes", () => {
    const rows = quotaLines({ seats: 5, documentBytes: 2_147_483_648, attachmentBytes: 1024 });
    expect(rows.map((row) => row.label)).toEqual([
      "Attachment storage",
      "Document storage",
      "Team members",
    ]);
    expect(rows.find((row) => row.id === "documentBytes")?.value).toBe("2.0 GB");
    expect(rows.find((row) => row.id === "attachmentBytes")?.value).toBe("1.0 KB");
    expect(rows.find((row) => row.id === "seats")?.value).toBe("5");
  });

  it("still shows a limit it has never heard of, rather than hiding it", () => {
    expect(quotaLines({ customWidgets: 3 })).toEqual([
      { id: "customWidgets", label: "Custom widgets", limit: 3, value: "3", zero: false },
    ]);
  });

  it("shows a zero as none yet, because hiding it is how this panel said no limits", () => {
    expect(quotaLines({ workspaces: 0, seats: 1 })).toEqual([
      { id: "seats", label: "Team members", limit: 1, value: "1", zero: false },
      { id: "workspaces", label: "Workspaces", limit: 0, value: "none yet", zero: true },
    ]);
  });

  it("never invents a row: a negative or non-finite limit is not an allowance", () => {
    expect(quotaLines({ boards: -1, cards: Number.POSITIVE_INFINITY })).toEqual([]);
    expect(quotaLines(undefined)).toEqual([]);
    expect(quotaLines(null)).toEqual([]);
  });

  it("names the free tier's zero even when the server sends no limits at all", () => {
    // The free licence is `limits: {}` — the tier is the only thing saying "no workspace".
    expect(freeWorkspaceLine()).toEqual({
      id: "workspaces",
      label: "Synced workspaces",
      limit: 0,
      value: "none yet",
      zero: true,
    });
  });
});

describe("the entitlement view", () => {
  it("is the token's own claims, with the quota derived from them", () => {
    const view = entitlementView({
      sub: "user-1",
      org: "org-1",
      role: "admin",
      tier: "team",
      limits: { seats: 3 },
      expiresAt: 1_700_000_000_000,
    });
    expect(view).toMatchObject({
      tier: "team",
      organizationId: "org-1",
      role: "admin",
      refreshesAt: 1_700_000_000_000,
    });
    expect(view?.quota.map((row) => row.id)).toEqual(["seats"]);
  });

  it("is null with no credential, because there is nothing to read", () => {
    expect(entitlementView(null)).toBeNull();
    // jsdom starts with no minted token in this file.
    expect(currentEntitlement()).toBeNull();
  });
});

describe("refusals", () => {
  it("tells the three kinds apart", () => {
    expect(refusalKind("seat-refused")).toBe("upgrade");
    expect(refusalKind("workspace-limit")).toBe("upgrade");
    // The hosted launch state: an account with no plan at all.
    expect(refusalKind("plan-required")).toBe("upgrade");
    expect(refusalKind(null, 402)).toBe("upgrade");
    expect(refusalKind("admission-pending")).toBe("admission");
    expect(refusalKind("quota-exceeded")).toBe("quota");
    expect(refusalKind("forbidden", 403)).toBe("other");
    expect(refusalKind(undefined)).toBe("other");
  });

  it("says what ran out, not just that something did", () => {
    expect(upgradeMessage("seat-refused")).toContain("no free seat");
    expect(upgradeMessage("plan-required")).toContain("Syncing needs a plan");
    expect(upgradeMessage("workspace-limit")).toContain("workspaces are all in use");
    expect(upgradeMessage("attachment-limit")).toContain("storage is full");
    expect(upgradeMessage("licence-expired")).toContain("subscription");
    // Anything unclassified still promises the one thing that is true.
    expect(upgradeMessage("mystery")).toContain("Everything here is safe");
  });
});
