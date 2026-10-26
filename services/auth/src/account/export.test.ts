import { describe, expect, it } from "vitest";
import { accountExport, accountExportFileName } from "./export.js";
import { memoryAccountStore } from "./memory.js";

const NOW = 1_760_000_000_000;
const OWNER = "user-owner";
const COLLEAGUE = "user-colleague";
const ORG = "org-agency";
const WORKSPACE = "ws-q4";

function seeded() {
  const store = memoryAccountStore();
  store.addUser({
    id: OWNER,
    email: "ada@example.com",
    name: "Ada",
    twoFactorEnabled: true,
    createdAt: 1,
    admittedAt: 2,
  });
  store.addUser({ id: COLLEAGUE, email: "grace@example.com", name: "Grace" });
  store.addOrganization({ id: ORG, name: "Agency", slug: "agency", createdAt: 3 });
  store.addMember(ORG, OWNER, "owner", 4);
  store.addMember(ORG, COLLEAGUE, "member", 5);
  store.addWorkspace({ id: WORKSPACE, organizationId: ORG, name: "Q4 plan", createdAt: 6 });
  store.addShare(WORKSPACE, {
    shareId: "share-1",
    scope: "workspace",
    role: "viewer",
    createdAt: 7,
    expiresAt: 8,
  });
  return store;
}

describe("accountExport", () => {
  it("carries the profile, the account's own membership, the workspace list and share metadata", async () => {
    const store = seeded();

    const document = await accountExport(
      { userId: OWNER },
      { accounts: store, workspaceData: store.workspaceData, now: () => NOW },
    );

    expect(document.format).toBe("suite-account");
    expect(document.version).toBe(1);
    expect(document.exportedAt).toBe(NOW);
    expect(document.account).toEqual({
      userId: OWNER,
      email: "ada@example.com",
      name: "Ada",
      emailVerified: true,
      twoFactorEnabled: true,
      createdAt: 1,
      admittedAt: 2,
    });
    expect(document.organizations).toEqual([
      {
        organizationId: ORG,
        name: "Agency",
        slug: "agency",
        createdAt: 3,
        membership: { role: "owner", joinedAt: 4 },
        workspaces: [
          {
            workspaceId: WORKSPACE,
            name: "Q4 plan",
            createdAt: 6,
            archivedAt: null,
            document: {
              format: "suite",
              exportedHere: false,
              exportPath: `/api/admin/workspaces/${WORKSPACE}/export`,
              note: expect.stringContaining("not copied"),
            },
            shares: [
              {
                shareId: "share-1",
                scope: "workspace",
                role: "viewer",
                createdAt: 7,
                expiresAt: 8,
                revokedAt: null,
              },
            ],
          },
        ],
      },
    ]);
    expect(document.notes.documents).toContain("not copied");
    expect(document.notes.shares).toContain("credential");
    expect(document.notes.otherPeople).toContain("Other members");
    expect(document.notes.credentials).toContain("not exported");
  });

  it("contains nothing that belongs to another member", async () => {
    const store = seeded();

    const text = JSON.stringify(
      await accountExport(
        { userId: OWNER },
        { accounts: store, workspaceData: store.workspaceData, now: () => NOW },
      ),
    );

    expect(text).not.toContain(COLLEAGUE);
    expect(text).not.toContain("grace@example.com");
    // No share carries a token or a hash, even though the notes mention both.
    expect(text).not.toContain("tokenHash");
    expect(text).not.toMatch(/"token":/u);
    // The account's own rows are all there.
    expect(text).toContain("ada@example.com");
    expect(text).toContain(WORKSPACE);
  });

  it("says a workspace's shares were not read when no relay store is wired", async () => {
    const store = seeded();

    const document = await accountExport(
      { userId: OWNER },
      { accounts: store, workspaceData: null, now: () => NOW },
    );

    const workspace = document.organizations[0]?.workspaces[0];
    expect(workspace?.shares).toEqual([]);
    expect(workspace?.sharesUnavailableReason).toBe(
      "the deployment has no relay store wired, so this workspace's share rows were not read",
    );
  });

  it("names the file after the account and the day it was taken", () => {
    expect(accountExportFileName(OWNER, NOW)).toBe(`suite-account-${OWNER}-2025-10-09.json`);
  });

  it("refuses instead of exporting an empty file for an account that is gone", async () => {
    const store = seeded();

    await expect(
      accountExport(
        { userId: "user-missing" },
        { accounts: store, workspaceData: store.workspaceData, now: () => NOW },
      ),
    ).rejects.toThrowError(/no longer exists/);
  });
});
