import { describe, expect, it } from "vitest";
import { AuthError } from "./errors.js";
import { memoryControlPlane } from "./memory.js";
import { CLAIM_WORKSPACE_SQL, claimWorkspace } from "./workspaces.js";

/**
 * Claiming is the promise of the whole phase: adopting an account never migrates
 * the work. These tests attack that promise from four sides — the id, the second
 * claim, another organization, and the row that already existed.
 */
const NOW = 1_760_000_000_000;
const ORG = "org-agency";
const OTHER_ORG = "org-rival";
const WORKSPACE = "0193f0e4-7a1c-7c9b-9f1e-2f6b8a4c1d22";

function setup() {
  const plane = memoryControlPlane();
  plane.addOrganization({
    id: ORG,
    name: "Agency",
    members: [{ userId: "user-1", role: "owner" }],
  });
  plane.addOrganization({
    id: OTHER_ORG,
    name: "Rival",
    members: [{ userId: "user-2", role: "owner" }],
  });
  return plane;
}

describe("claimWorkspace", () => {
  it("keeps the document id, which is the whole point", async () => {
    const plane = setup();
    plane.addWorkspace({ id: WORKSPACE, createdAt: 1 });

    const outcome = await claimWorkspace(
      { workspaceId: WORKSPACE, organizationId: ORG, now: NOW },
      { workspaces: plane.workspaces },
    );

    expect(outcome.status).toBe("claimed");
    expect(outcome.workspace.workspaceId).toBe(WORKSPACE);
    expect(plane.workspaceRow(WORKSPACE)?.id).toBe(WORKSPACE);
    // The relay's document id is the primary key; a claim that changed it would
    // orphan every share link ever handed out.
    expect(plane.workspaceRow(WORKSPACE)?.createdAt).toBe(1);
  });

  it("records the claim as an update, not a replacement", async () => {
    const plane = setup();
    plane.addWorkspace({ id: WORKSPACE, name: "Q4 plan", createdAt: 1 });

    await claimWorkspace(
      { workspaceId: WORKSPACE, organizationId: ORG, now: NOW },
      { workspaces: plane.workspaces },
    );

    const row = plane.workspaceRow(WORKSPACE);
    expect(row?.organizationId).toBe(ORG);
    // The name the workspace already had survives: claiming is about ownership.
    expect(row?.name).toBe("Q4 plan");
    expect(row?.createdAt).toBe(1);
  });

  it("is idempotent: a second claim by the same organization writes nothing", async () => {
    const plane = setup();
    plane.addWorkspace({ id: WORKSPACE, createdAt: 1 });
    const first = await claimWorkspace(
      { workspaceId: WORKSPACE, organizationId: ORG, now: NOW },
      { workspaces: plane.workspaces },
    );
    expect(first.status).toBe("claimed");

    let claimCalls = 0;
    const second = await claimWorkspace(
      { workspaceId: WORKSPACE, organizationId: ORG, now: NOW + 60_000 },
      {
        workspaces: {
          ...plane.workspaces,
          claim: async (input) => {
            claimCalls += 1;
            return plane.workspaces.claim(input);
          },
        },
      },
    );

    expect(second.status).toBe("unchanged");
    // No write at all: the browser retries a claim on reconnect, and a retry
    // must not move a timestamp or touch a row.
    expect(claimCalls).toBe(0);
    expect(plane.workspaceRow(WORKSPACE)?.id).toBe(WORKSPACE);
  });

  it("creates the row for a workspace the control plane has never seen", async () => {
    const plane = setup();
    const outcome = await claimWorkspace(
      { workspaceId: WORKSPACE, organizationId: ORG, name: "Brand new", now: NOW },
      { workspaces: plane.workspaces },
    );

    expect(outcome.status).toBe("claimed");
    expect(outcome.workspace.name).toBe("Brand new");
    expect(plane.workspaceRow(WORKSPACE)?.organizationId).toBe(ORG);
  });

  it("defaults the name to the id rather than leaving an unnamed workspace", async () => {
    const plane = setup();
    const outcome = await claimWorkspace(
      { workspaceId: WORKSPACE, organizationId: ORG, now: NOW },
      { workspaces: plane.workspaces },
    );
    expect(outcome.workspace.name).toBe(WORKSPACE);
  });

  it("refuses to move a workspace that already has a different owner", async () => {
    const plane = setup();
    plane.addWorkspace({ id: WORKSPACE, organizationId: OTHER_ORG, createdAt: 1 });

    await expect(
      claimWorkspace(
        { workspaceId: WORKSPACE, organizationId: ORG, now: NOW },
        { workspaces: plane.workspaces },
      ),
    ).rejects.toMatchObject({ code: "workspace-already-claimed" });
    expect(plane.workspaceRow(WORKSPACE)?.organizationId).toBe(OTHER_ORG);
  });

  it("reports a lost race as the same named refusal", async () => {
    const plane = setup();
    plane.addWorkspace({ id: WORKSPACE, createdAt: 1 });
    // Model the race: the read says "unclaimed", the conditional write finds a
    // row owned by someone else. The answer must not be a silent success.
    const racing = {
      ...plane.workspaces,
      find: async () => null,
      claim: async () => null,
    };

    await expect(
      claimWorkspace(
        { workspaceId: WORKSPACE, organizationId: ORG, now: NOW },
        { workspaces: racing },
      ),
    ).rejects.toMatchObject({ code: "workspace-already-claimed" });
  });

  it("refuses a repository that would rename the workspace", async () => {
    const plane = setup();
    plane.addWorkspace({ id: WORKSPACE, createdAt: 1 });
    const existing = await plane.workspaces.find(WORKSPACE);
    const renaming = {
      ...plane.workspaces,
      claim: async () => (existing === null ? null : { ...existing, workspaceId: "renamed" }),
    };
    // The invariant is asserted, not assumed: a repository that renames the row
    // would break every link while looking successful.
    await expect(
      claimWorkspace(
        { workspaceId: WORKSPACE, organizationId: ORG, now: NOW },
        { workspaces: renaming },
      ),
    ).rejects.toMatchObject({ code: "invalid-request" });
  });

  it("rejects an empty or control-character id", async () => {
    const plane = setup();
    for (const workspaceId of ["   ", "ws\u0000evil"]) {
      await expect(
        claimWorkspace(
          { workspaceId, organizationId: ORG, now: NOW },
          { workspaces: plane.workspaces },
        ),
      ).rejects.toBeInstanceOf(AuthError);
    }
  });

  it("never writes a member row", async () => {
    const plane = setup();
    plane.addWorkspace({ id: WORKSPACE, createdAt: 1 });
    const before = plane.memberRows().length;

    await claimWorkspace(
      { workspaceId: WORKSPACE, organizationId: ORG, now: NOW },
      { workspaces: plane.workspaces },
    );

    expect(plane.memberRows()).toHaveLength(before);
  });
});

describe("CLAIM_WORKSPACE_SQL", () => {
  it("only ever writes organization_id, and only for an unowned row", () => {
    // The statement is exported so the migration and the domain cannot drift;
    // these assertions pin the two properties the tests above rely on.
    expect(CLAIM_WORKSPACE_SQL).toMatch(/ON CONFLICT \(id\) DO UPDATE/u);
    expect(CLAIM_WORKSPACE_SQL).toMatch(/WHERE workspaces\.organization_id IS NULL/u);
    expect(CLAIM_WORKSPACE_SQL).not.toMatch(/SET\s+id\s*=/u);
    expect(CLAIM_WORKSPACE_SQL).not.toMatch(/SET\s+name\s*=/u);
  });
});
