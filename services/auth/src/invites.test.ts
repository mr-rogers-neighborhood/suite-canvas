import { describe, expect, it } from "vitest";
import { createInviteKey, redeemInviteKey, revokeInviteKey } from "./invites.js";
import { hashInviteKey } from "./keys.js";
import { memoryControlPlane } from "./memory.js";

/**
 * Invite keys, tested as behaviour: what a tester can do with a forwarded key,
 * what happens when it expires or is spent, and what a second simultaneous
 * redemption gets. The concurrency test is the important one — it is the only
 * reason the counter update is conditional.
 */
const NOW = 1_760_000_000_000;
const HOUR = 60 * 60 * 1000;
const ORG = "org-agency";
const WORKSPACE = "ws-q4-plan";
const OWNER = "user-owner";
const TESTER = "user-tester";
const SECOND_TESTER = "user-tester-2";

function setup() {
  const plane = memoryControlPlane();
  plane.addOrganization({
    id: ORG,
    name: "Agency",
    members: [{ userId: OWNER, role: "owner" }],
  });
  plane.addWorkspace({ id: WORKSPACE, organizationId: ORG, name: "Q4 plan", createdAt: 1 });
  return plane;
}

async function mint(
  plane: ReturnType<typeof setup>,
  overrides: Partial<Parameters<typeof createInviteKey>[0]> = {},
) {
  let sequence = 0;
  return createInviteKey(
    {
      workspaceId: WORKSPACE,
      role: "member",
      createdByUserId: OWNER,
      actorRole: "owner",
      expiresAt: NOW + HOUR,
      maxUses: 1,
      now: NOW,
      ...overrides,
    },
    {
      workspaces: plane.workspaces,
      invites: plane.invites,
      newId: () => `invite-${++sequence}`,
    },
  );
}

describe("createInviteKey", () => {
  it("stores only a hash, never the key itself", async () => {
    const plane = setup();
    const created = await mint(plane);

    expect(created.key).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const [row] = plane.inviteRows();
    expect(row?.keyHash).toBe(hashInviteKey(created.key));
    expect(row?.keyHash).not.toContain(created.key);
    expect(created.record).not.toHaveProperty("keyHash");
  });

  it("refuses an expiry that has already passed", async () => {
    const plane = setup();
    await expect(mint(plane, { expiresAt: NOW - 1 })).rejects.toMatchObject({
      code: "invalid-request",
    });
  });

  it("refuses a use count below one", async () => {
    const plane = setup();
    await expect(mint(plane, { maxUses: 0 })).rejects.toMatchObject({ code: "invalid-request" });
  });

  it("refuses to grant ownership", async () => {
    const plane = setup();
    // An invite key that hands out ownership recreates the "whoever opens the
    // link first owns the workspace" failure the phase exists to close.
    await expect(mint(plane, { role: "owner" as never })).rejects.toMatchObject({
      code: "invalid-request",
    });
  });

  it("refuses a member who cannot manage links", async () => {
    const plane = setup();
    plane.addMember(ORG, TESTER, "member");
    await expect(
      mint(plane, { createdByUserId: TESTER, actorRole: "member" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses a workspace that no organization owns", async () => {
    const plane = setup();
    plane.addWorkspace({ id: "ws-anonymous", createdAt: 1 });
    await expect(mint(plane, { workspaceId: "ws-anonymous" })).rejects.toMatchObject({
      code: "workspace-not-found",
    });
  });
});

describe("redeemInviteKey", () => {
  it("adds the member and spends exactly one use", async () => {
    const plane = setup();
    const created = await mint(plane, { maxUses: 2 });

    const outcome = await redeemInviteKey(
      { key: created.key, userId: TESTER, now: NOW + 1 },
      { workspaces: plane.workspaces, invites: plane.invites },
    );

    expect(outcome.status).toBe("redeemed");
    if (outcome.status !== "redeemed") return;
    expect(outcome.role).toBe("member");
    expect(outcome.organizationId).toBe(ORG);
    const [row] = plane.inviteRows();
    expect(row?.usedCount).toBe(1);
    expect(plane.memberRows().some((member) => member.userId === TESTER)).toBe(true);
  });

  it("refuses a key that was revoked", async () => {
    const plane = setup();
    const created = await mint(plane);
    await revokeInviteKey(
      {
        keyId: created.record.id,
        workspaceId: WORKSPACE,
        actorRole: "owner",
        now: NOW + 1,
      },
      { invites: plane.invites },
    );

    await expect(
      redeemInviteKey(
        { key: created.key, userId: TESTER, now: NOW + 2 },
        { workspaces: plane.workspaces, invites: plane.invites },
      ),
    ).rejects.toMatchObject({ code: "invite-revoked" });
  });

  it("refuses a key past its expiry", async () => {
    const plane = setup();
    const created = await mint(plane, { expiresAt: NOW + HOUR });

    await expect(
      redeemInviteKey(
        { key: created.key, userId: TESTER, now: NOW + HOUR },
        { workspaces: plane.workspaces, invites: plane.invites },
      ),
    ).rejects.toMatchObject({ code: "invite-expired" });
  });

  it("refuses a key with no uses left", async () => {
    const plane = setup();
    const created = await mint(plane, { maxUses: 1 });
    await redeemInviteKey(
      { key: created.key, userId: TESTER, now: NOW + 1 },
      { workspaces: plane.workspaces, invites: plane.invites },
    );

    await expect(
      redeemInviteKey(
        { key: created.key, userId: SECOND_TESTER, now: NOW + 2 },
        { workspaces: plane.workspaces, invites: plane.invites },
      ),
    ).rejects.toMatchObject({ code: "invite-exhausted" });
  });

  it("cannot spend a single-use key twice, even under a race", async () => {
    const plane = setup();
    const created = await mint(plane, { maxUses: 1 });

    // Two redemptions, both passing every read-only check first — this is the
    // exact interleaving the conditional UPDATE exists for. The second must be
    // refused, because a key that overspends is an unbounded invitation.
    const first = redeemInviteKey(
      { key: created.key, userId: TESTER, now: NOW + 1 },
      { workspaces: plane.workspaces, invites: plane.invites },
    );
    const second = redeemInviteKey(
      { key: created.key, userId: SECOND_TESTER, now: NOW + 1 },
      { workspaces: plane.workspaces, invites: plane.invites },
    );

    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "invite-exhausted",
    });
    expect(plane.inviteRows()[0]?.usedCount).toBe(1);
    expect(plane.memberRows()).toHaveLength(2);
  });

  it("answers 'already a member' instead of failing, and spends no use", async () => {
    const plane = setup();
    const created = await mint(plane, { maxUses: 5 });
    plane.addMember(ORG, TESTER, "member");

    const outcome = await redeemInviteKey(
      { key: created.key, userId: TESTER, now: NOW + 1 },
      { workspaces: plane.workspaces, invites: plane.invites },
    );

    expect(outcome.status).toBe("already-member");
    expect(plane.inviteRows()[0]?.usedCount).toBe(0);
    expect(plane.memberRows().filter((member) => member.userId === TESTER)).toHaveLength(1);
  });

  it("refuses an unknown key and a key-shaped non-key", async () => {
    const plane = setup();
    await expect(
      redeemInviteKey(
        { key: "a".repeat(43), userId: TESTER, now: NOW },
        { workspaces: plane.workspaces, invites: plane.invites },
      ),
    ).rejects.toMatchObject({ code: "invite-not-found" });
    await expect(
      redeemInviteKey(
        { key: '{"not":"a key"}', userId: TESTER, now: NOW },
        { workspaces: plane.workspaces, invites: plane.invites },
      ),
    ).rejects.toMatchObject({ code: "invite-not-found" });
  });

  it("refuses when the workspace behind the key is gone", async () => {
    const plane = setup();
    const created = await mint(plane);
    const orphan = { ...plane.workspaces, find: async () => null };

    await expect(
      redeemInviteKey(
        { key: created.key, userId: TESTER, now: NOW + 1 },
        { workspaces: orphan, invites: plane.invites },
      ),
    ).rejects.toMatchObject({ code: "workspace-not-found" });
  });
});

describe("revokeInviteKey", () => {
  it("refuses a member who cannot manage links", async () => {
    const plane = setup();
    const created = await mint(plane);
    await expect(
      revokeInviteKey(
        { keyId: created.record.id, workspaceId: WORKSPACE, actorRole: "member", now: NOW },
        { invites: plane.invites },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps the first revocation time", async () => {
    const plane = setup();
    const created = await mint(plane);
    await revokeInviteKey(
      { keyId: created.record.id, workspaceId: WORKSPACE, actorRole: "owner", now: NOW + 5 },
      { invites: plane.invites },
    );
    const second = await revokeInviteKey(
      { keyId: created.record.id, workspaceId: WORKSPACE, actorRole: "owner", now: NOW + 9 },
      { invites: plane.invites },
    );
    expect(second.revokedAt).toBe(NOW + 5);
  });
});
