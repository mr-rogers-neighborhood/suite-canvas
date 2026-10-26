import { describe, expect, it } from "vitest";
import { eraseAccount } from "./erase.js";
import { memoryAccountStore } from "./memory.js";
import type { AccountErasureReport, ErasureStore } from "./types.js";

/**
 * The erase, tested at the seam a route calls it through.
 *
 * The memory store obeys the two contracts the Postgres one has: the control-plane
 * erase applies as a whole or throws with nothing changed, and the relay erase is
 * idempotent. So a test here can assert the ordering, the report and the retry without
 * a database, and the SQL that keeps the same promises is exercised by `pnpm db:verify`.
 */

const NOW = 1_760_000_000_000;
const OWNER = "user-owner";
const COLLEAGUE = "user-colleague";
const OWNED_ORG = "org-owned";
const SHARED_ORG = "org-shared";
const WORKSPACE = "ws-q4";
const SHARED_WORKSPACE = "ws-shared";

function storeReport(report: AccountErasureReport, store: ErasureStore) {
  const found = report.stores.find((entry) => entry.store === store);
  if (found === undefined) throw new Error(`the report has no entry for ${store}`);
  return found;
}

/**
 * Two organizations and one workspace.
 *
 * `org-owned` has one member (the account) and the workspace; `org-shared` has a
 * colleague in it, whose workspace must survive. That pair is the whole question an
 * account erase has to answer: what is the account's to delete, and what belongs to
 * someone else.
 */
function twoOrganizations() {
  const store = memoryAccountStore();
  store.addUser({ id: OWNER, email: "owner@example.com", name: "Ada" });
  store.addUser({ id: COLLEAGUE, email: "colleague@example.com", name: "Grace" });
  store.addOrganization({ id: OWNED_ORG, name: "Ada's studio", slug: "ada-studio" });
  store.addOrganization({ id: SHARED_ORG, name: "Shared agency", slug: "shared-agency" });
  store.addMember(OWNED_ORG, OWNER, "owner");
  store.addMember(SHARED_ORG, OWNER, "admin");
  store.addMember(SHARED_ORG, COLLEAGUE, "owner");
  store.addWorkspace({ id: WORKSPACE, organizationId: OWNED_ORG, name: "Q4" });
  store.addWorkspace({ id: SHARED_WORKSPACE, organizationId: SHARED_ORG, name: "Shared" });
  store.addSession(OWNER);
  store.addSession(OWNER);
  store.addCredential(OWNER);
  store.addPasskey(OWNER);
  store.addSecondFactor(OWNER);
  store.addInvitation(OWNED_ORG, OWNER);
  store.addInvite(OWNED_ORG, OWNER);
  store.addInvite(SHARED_ORG, OWNER);
  store.addVerification("owner@example.com");
  store.addLicence(OWNED_ORG);
  store.addSubscription(OWNED_ORG);
  store.addShare(WORKSPACE, { shareId: "share-1" });
  store.addShare(WORKSPACE, { shareId: "share-2" });
  store.addAttachment(WORKSPACE);
  store.addAttachment(WORKSPACE);
  return store;
}

describe("eraseAccount", () => {
  it("deletes the account's own organization and every store under it, and leaves a colleague's", async () => {
    const store = twoOrganizations();

    const report = await eraseAccount(
      { userId: OWNER },
      { accounts: store, workspaceData: store.workspaceData, now: () => NOW },
    );

    expect(report.deleted).toBe(true);
    expect(report.complete).toBe(true);
    expect(report.completedAt).toBe(NOW);

    // The workspace's rows, not only the account row: the document, its share rows and
    // its attachment rows are gone because the organization that owned it is gone.
    const rows = store.rows();
    expect(rows.users).toEqual([COLLEAGUE]);
    expect(rows.organizations).toEqual([SHARED_ORG]);
    expect(rows.workspaces.map((workspace) => workspace.workspaceId)).toEqual([SHARED_WORKSPACE]);
    expect(rows.documents).not.toContain(WORKSPACE);
    expect(rows.shares).toEqual([]);
    expect(rows.attachments).toEqual([]);
    expect(rows.sessions).toEqual([]);
    expect(rows.credentials).toEqual([]);
    expect(rows.passkeys).toEqual([]);
    expect(rows.secondFactors).toEqual([]);
    expect(rows.invitations).toEqual([]);
    expect(rows.invites).toEqual([]);
    expect(rows.verifications).toEqual([]);
    expect(rows.licences).toEqual([]);
    expect(rows.subscriptions).toEqual([]);

    // The colleague's membership is untouched; the account's own row in the shared
    // organization is not.
    expect(rows.members.map((member) => `${member.organizationId}:${member.userId}`)).toEqual([
      `${SHARED_ORG}:${COLLEAGUE}`,
    ]);

    expect(storeReport(report, "workspaces").removed).toBe(1);
    expect(storeReport(report, "documents").removed).toBe(1);
    expect(storeReport(report, "shares").removed).toBe(2);
    expect(storeReport(report, "attachments").removed).toBe(2);
    expect(storeReport(report, "sessions").removed).toBe(2);
    expect(storeReport(report, "invites").removed).toBe(2);
    expect(storeReport(report, "verifications").removed).toBe(1);

    // Both organizations are in the report, with different outcomes.
    expect(report.organizations).toEqual([
      { organizationId: OWNED_ORG, outcome: "removed" },
      {
        organizationId: SHARED_ORG,
        outcome: "retained",
        reason: "another member still holds a seat here; only this account's member row is removed",
      },
    ]);
    // The colleague's workspace is reported as retained, and the relay was never asked
    // to erase it.
    expect(report.workspaces).toEqual(
      expect.arrayContaining([
        { workspaceId: WORKSPACE, organizationId: OWNED_ORG, outcome: "removed" },
        expect.objectContaining({ workspaceId: SHARED_WORKSPACE, outcome: "retained" }),
      ]),
    );
    expect(store.erasedWorkspaces()).toEqual([WORKSPACE]);
  });

  it("reports zeroes and still deletes the account when it owns nothing", async () => {
    const store = memoryAccountStore();
    store.addUser({ id: OWNER });
    store.addSession(OWNER);
    store.addCredential(OWNER);

    const report = await eraseAccount(
      { userId: OWNER },
      { accounts: store, workspaceData: store.workspaceData, now: () => NOW },
    );

    expect(report.deleted).toBe(true);
    expect(report.complete).toBe(true);
    expect(report.organizations).toEqual([]);
    expect(report.workspaces).toEqual([]);
    expect(report.stores.every((entry) => entry.status === "removed")).toBe(true);
    expect(storeReport(report, "users").removed).toBe(1);
    expect(storeReport(report, "sessions").removed).toBe(1);
    expect(storeReport(report, "accounts").removed).toBe(1);
    expect(storeReport(report, "organizations").removed).toBe(0);
    expect(storeReport(report, "documents").removed).toBe(0);
    expect(store.rows().users).toEqual([]);
    expect(store.erasedWorkspaces()).toEqual([]);
  });

  it("stops before the control plane when a relay delete fails partway, and a retry converges", async () => {
    const store = twoOrganizations();
    store.failWorkspaceErase({ workspaceId: WORKSPACE, after: "documents", reason: "disk full" });

    const first = await eraseAccount(
      { userId: OWNER },
      { accounts: store, workspaceData: store.workspaceData, now: () => NOW },
    );

    // The account is intact: nothing in Postgres was touched, so it can still sign in
    // and try again. This is the half-deleted state the ordering exists to prevent.
    const rows = store.rows();
    expect(rows.users).toEqual(expect.arrayContaining([OWNER, COLLEAGUE]));
    expect(rows.workspaces.map((workspace) => workspace.workspaceId)).toContain(WORKSPACE);
    expect(rows.sessions).toHaveLength(2);

    expect(first.deleted).toBe(false);
    expect(first.complete).toBe(false);
    // The count is what the control plane could confirm, not what the relay may have
    // done before it failed: a half-applied relay delete reports `removed: 0`.
    expect(storeReport(first, "documents")).toMatchObject({ status: "not-removed", removed: 0 });
    expect(storeReport(first, "shares").status).toBe("not-removed");
    expect(storeReport(first, "shares").removed).toBe(0);
    expect(storeReport(first, "attachments").status).toBe("not-removed");
    // The document did go before the failure, which is why the retry must be idempotent.
    expect(store.rows().documents).not.toContain(WORKSPACE);
    expect(storeReport(first, "users").status).toBe("not-attempted");
    expect(storeReport(first, "organizations").status).toBe("not-attempted");
    expect(first.organizations.every((entry) => entry.outcome === "not-attempted")).toBe(true);
    expect(first.retry).toContain("idempotent");

    // The retry runs from the same plan: the document delete already happened, so it
    // removes what is left and then the control plane.
    const second = await eraseAccount(
      { userId: OWNER },
      { accounts: store, workspaceData: store.workspaceData, now: () => NOW + 1 },
    );

    expect(second.deleted).toBe(true);
    expect(second.complete).toBe(true);
    expect(store.erasedWorkspaces()).toEqual([WORKSPACE, WORKSPACE]);
    expect(store.rows().users).toEqual([COLLEAGUE]);
    expect(store.rows().documents).not.toContain(WORKSPACE);
  });

  it("keeps a workspace it finished marked removed when a later one fails", async () => {
    const store = twoOrganizations();
    store.addWorkspace({ id: "ws-second", organizationId: OWNED_ORG, name: "Second" });
    store.failWorkspaceErase({ workspaceId: "ws-second", after: "nothing", reason: "quota" });

    const report = await eraseAccount(
      { userId: OWNER },
      { accounts: store, workspaceData: store.workspaceData, now: () => NOW },
    );

    expect(report.deleted).toBe(false);
    const byId = new Map(report.workspaces.map((entry) => [entry.workspaceId, entry]));
    // The first workspace's relay data is gone, so its entry says so; the second is the
    // one that failed. A run that erased one and stopped must not claim it did neither.
    expect(byId.get(WORKSPACE)).toMatchObject({ outcome: "removed" });
    expect(byId.get("ws-second")).toMatchObject({ outcome: "not-removed" });
    expect(store.rows().documents).toContain("ws-second");
    expect(store.rows().users).toEqual(expect.arrayContaining([OWNER, COLLEAGUE]));
  });

  it("rolls the control plane back as a whole, so an account is never half-erased", async () => {
    const store = twoOrganizations();
    store.failErase("connection reset");

    const report = await eraseAccount(
      { userId: OWNER },
      { accounts: store, workspaceData: store.workspaceData, now: () => NOW },
    );

    expect(report.deleted).toBe(false);
    expect(report.complete).toBe(false);
    expect(storeReport(report, "users")).toMatchObject({
      status: "not-attempted",
      removed: 0,
    });
    expect(storeReport(report, "users").reason).toContain("connection reset");
    // Every control-plane row is still there.
    expect(store.rows().organizations).toEqual([OWNED_ORG, SHARED_ORG]);
    expect(store.rows().users).toEqual(expect.arrayContaining([OWNER, COLLEAGUE]));
    expect(store.rows().sessions).toHaveLength(2);
    expect(report.retry).toContain("rolled back");
  });

  it("names documents, shares and attachments as not configured when no relay store is wired", async () => {
    const store = twoOrganizations();

    const report = await eraseAccount(
      { userId: OWNER },
      { accounts: store, workspaceData: null, now: () => NOW },
    );

    expect(report.deleted).toBe(true);
    expect(report.complete).toBe(false);
    for (const name of ["documents", "shares", "attachments"] as const) {
      expect(storeReport(report, name)).toMatchObject({
        status: "not-configured",
        removed: 0,
      });
      expect(storeReport(report, name).followUp).toContain(`/api/workspaces/${WORKSPACE}`);
    }
    expect(report.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workspaceId: WORKSPACE, outcome: "not-removed" }),
      ]),
    );
  });
});
