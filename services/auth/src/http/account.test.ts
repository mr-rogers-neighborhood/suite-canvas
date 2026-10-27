import { describe, expect, it } from "vitest";
import { memoryAccountStore } from "../account/memory.js";
import type { AccountSession } from "../types.js";
import { authEnvironment } from "./env.js";
import { type AuthHandlerDeps, type AuthHttpEvent, createAuthHandler } from "./handler.js";

/**
 * The account routes, through the handler the deployment calls.
 *
 * The session reader is the one fake: everything behind it is the real export, the real
 * erase and the real memory store. The routes are the part a client can reach, so this
 * is where the confirmation body, the download header and the status contract are
 * pinned.
 */

const NOW = 1_760_000_000_000;
const OWNER = "user-owner";
const COLLEAGUE = "user-colleague";
const ORG = "org-owned";
const SHARED_ORG = "org-shared";
const WORKSPACE = "ws-q4";

function harness(options: { accounts?: boolean } = {}) {
  const store = memoryAccountStore();
  store.addUser({ id: OWNER, email: "ada@example.com", name: "Ada" });
  store.addUser({ id: COLLEAGUE, email: "grace@example.com", name: "Grace" });
  store.addOrganization({ id: ORG, name: "Ada's studio", slug: "ada-studio" });
  store.addOrganization({ id: SHARED_ORG, name: "Shared agency", slug: "shared-agency" });
  store.addMember(ORG, OWNER, "owner");
  store.addMember(SHARED_ORG, OWNER, "admin");
  store.addMember(SHARED_ORG, COLLEAGUE, "owner");
  store.addWorkspace({ id: WORKSPACE, organizationId: ORG, name: "Q4" });
  store.addSession(OWNER);
  store.addShare(WORKSPACE, { shareId: "share-1" });
  store.addAttachment(WORKSPACE);

  const sessions = new Map<string, AccountSession>([
    [OWNER, { userId: OWNER, organizationId: ORG, role: "owner", admittedAt: 1 }],
  ]);

  const deps: AuthHandlerDeps = {
    env: authEnvironment({
      SUITE_AUTH_ENABLED: "1",
      SUITE_AUTH_SECRET: "s".repeat(32),
      SUITE_AUTH_URL: "https://suite.example",
    }),
    workspaces: {
      find: async () => null,
      claim: async () => null,
      countForOrganization: async () => 0,
    },
    licences: { forOrganization: async () => null },
    memberships: {
      countForOrganization: async () => 0,
      countForUser: async () => 0,
      roleFor: async () => null,
      listForOrganization: async () => [],
    },
    enrollment: null,
    sessions: {
      sessionFor: async (headers) => {
        const user = headers["x-test-user"];
        return user === undefined ? null : (sessions.get(user) ?? null);
      },
    },
    ...(options.accounts === false ? {} : { accounts: store, workspaceData: store.workspaceData }),
    now: () => NOW,
  };

  const handler = createAuthHandler(deps);
  const call = (event: AuthHttpEvent) => handler(event);
  return { store, call };
}

describe("the account routes", () => {
  it("refuses an export with no session", async () => {
    const { call } = harness();

    const response = await call({ httpMethod: "GET", path: "/api/account/export" });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "unauthorized" });
  });

  it("answers the export as a download the browser saves", async () => {
    const { call } = harness();

    const response = await call({
      httpMethod: "GET",
      path: "/api/account/export",
      headers: { "x-test-user": OWNER },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="suite-account-${OWNER}-2025-10-09.json"`,
    );
    const document = JSON.parse(response.body) as {
      format: string;
      organizations: { workspaces: { workspaceId: string; shares: unknown[] }[] }[];
    };
    expect(document.format).toBe("suite-account");
    expect(document.organizations[0]?.workspaces[0]?.workspaceId).toBe(WORKSPACE);
    expect(document.organizations[0]?.workspaces[0]?.shares).toHaveLength(1);
  });

  it("lists the workspaces the account may open", async () => {
    const { call } = harness();

    const response = await call({
      httpMethod: "GET",
      path: "/api/account/workspaces",
      headers: { "x-test-user": OWNER },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      ok: boolean;
      workspaces: { id: string; name: string }[];
      organizations: { id: string; role: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.workspaces.map((workspace) => workspace.id)).toEqual([WORKSPACE]);
    expect(body.organizations[0]?.role).toBe("owner");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("refuses the workspace list with no session", async () => {
    const { call } = harness();

    const response = await call({ httpMethod: "GET", path: "/api/account/workspaces" });

    expect(response.statusCode).toBe(401);
  });

  it("refuses a delete that is not a DELETE", async () => {
    const { call } = harness();

    const response = await call({
      httpMethod: "GET",
      path: "/api/account",
      headers: { "x-test-user": OWNER },
    });

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe("DELETE");
  });

  it("refuses a delete with no confirmation body", async () => {
    const { store, call } = harness();

    const response = await call({
      httpMethod: "DELETE",
      path: "/api/account",
      headers: { "x-test-user": OWNER },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toContain(`{"confirm":"${OWNER}"}`);
    expect(store.rows().users).toEqual([OWNER, COLLEAGUE]);
  });

  it("refuses a confirmation naming another account", async () => {
    const { store, call } = harness();

    const response = await call({
      httpMethod: "DELETE",
      path: "/api/account",
      headers: { "x-test-user": OWNER },
      body: JSON.stringify({ confirm: COLLEAGUE }),
    });

    expect(response.statusCode).toBe(400);
    expect(store.rows().users).toContain(OWNER);
  });

  it("deletes the account and every store under it, and reports each one", async () => {
    const { store, call } = harness();

    const response = await call({
      httpMethod: "DELETE",
      path: "/api/account",
      headers: { "x-test-user": OWNER },
      body: JSON.stringify({ confirm: OWNER }),
    });

    expect(response.statusCode).toBe(200);
    const report = JSON.parse(response.body) as {
      deleted: boolean;
      complete: boolean;
      stores: { store: string; status: string; removed: number }[];
    };
    expect(report.deleted).toBe(true);
    expect(report.complete).toBe(true);
    expect(
      Object.fromEntries(report.stores.map((entry) => [entry.store, entry.removed])),
    ).toMatchObject({
      organizations: 1,
      workspaces: 1,
      documents: 1,
      shares: 1,
      attachments: 1,
      users: 1,
      sessions: 1,
    });

    // The workspace's own rows are gone, not only the account row.
    const rows = store.rows();
    expect(rows.users).toEqual([COLLEAGUE]);
    expect(rows.workspaces.map((workspace) => workspace.workspaceId)).toEqual([]);
    expect(rows.documents).toEqual([]);
    expect(rows.shares).toEqual([]);
    expect(rows.attachments).toEqual([]);
    expect(rows.members.map((member) => member.organizationId)).toEqual([SHARED_ORG]);
  });

  it("answers 500 and keeps the account when the relay delete fails", async () => {
    const { store, call } = harness();
    store.failWorkspaceErase({ workspaceId: WORKSPACE, after: "nothing", reason: "relay down" });

    const response = await call({
      httpMethod: "DELETE",
      path: "/api/account",
      headers: { "x-test-user": OWNER },
      body: JSON.stringify({ confirm: OWNER }),
    });

    expect(response.statusCode).toBe(500);
    const report = JSON.parse(response.body) as {
      deleted: boolean;
      complete: boolean;
      stores: { store: string; status: string }[];
    };
    expect(report.deleted).toBe(false);
    expect(report.complete).toBe(false);
    expect(report.stores.find((entry) => entry.store === "documents")?.status).toBe("not-removed");
    expect(store.rows().users).toEqual([OWNER, COLLEAGUE]);
  });

  it("refuses as unconfigured when the deployment mounted no account store", async () => {
    const { call } = harness({ accounts: false });

    const exported = await call({
      httpMethod: "GET",
      path: "/api/account/export",
      headers: { "x-test-user": OWNER },
    });
    const erased = await call({
      httpMethod: "DELETE",
      path: "/api/account",
      headers: { "x-test-user": OWNER },
      body: JSON.stringify({ confirm: OWNER }),
    });

    expect(exported.statusCode).toBe(503);
    expect(JSON.parse(exported.body).error).toBe("auth-not-configured");
    expect(erased.statusCode).toBe(503);
  });
});
