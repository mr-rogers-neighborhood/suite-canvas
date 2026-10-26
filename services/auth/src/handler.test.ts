import { describe, expect, it } from "vitest";
import { authEnvironment } from "./env.js";
import { type AuthHandlerDeps, type AuthHttpEvent, createAuthHandler } from "./handler.js";
import { memoryControlPlane } from "./memory.js";
import { seatLicence } from "./seats.js";
import type { AccountSession, LicenceClaims, OrganizationRole } from "./types.js";

/**
 * The routes, tested through the handler the deployment actually calls: one
 * event in, one status plus a named code out. The session reader is the only
 * seam a fake replaces — everything behind it (repositories, licence, seats) is
 * the real code.
 */
const NOW = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const ORG = "org-agency";
const WORKSPACE = "ws-q4";
const OWNER = "user-owner";
const EDITOR = "user-editor";
const TESTER = "user-tester";

function claims(overrides: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    v: 1,
    id: "lic-1",
    tier: "team",
    workspaces: 2,
    documentBytes: 1_000_000,
    attachmentBytes: 1_000_000,
    issuedAt: NOW - DAY,
    expiresAt: NOW + DAY,
    ...overrides,
  };
}

interface Harness {
  deps: AuthHandlerDeps;
  sessions: Map<string, AccountSession>;
  plane: ReturnType<typeof memoryControlPlane>;
}

function harness(
  options: { seats?: number; workspaces?: number; enabled?: boolean } = {},
): Harness {
  const plane = memoryControlPlane();
  plane.addOrganization({
    id: ORG,
    name: "Agency",
    members: [
      { userId: OWNER, role: "owner" },
      { userId: EDITOR, role: "member" },
    ],
  });
  plane.addWorkspace({ id: WORKSPACE, organizationId: ORG, name: "Q4", createdAt: 1 });
  plane.recordLicence(
    ORG,
    seatLicence(claims({ workspaces: options.workspaces ?? 2 }), options.seats ?? 5),
  );

  // Session lookup is by a header the real edge would have set from the cookie;
  // a fake here keeps the test out of Better Auth's cookie internals while the
  // rest of the request path stays real.
  const sessions = new Map<string, AccountSession>([
    [OWNER, { userId: OWNER, organizationId: ORG, role: "owner", admittedAt: 1 }],
    [EDITOR, { userId: EDITOR, organizationId: ORG, role: "member", admittedAt: 1 }],
    [TESTER, { userId: TESTER, organizationId: null, role: null, admittedAt: 1 }],
  ]);

  let sequence = 0;
  const deps: AuthHandlerDeps = {
    env: authEnvironment({
      SUITE_AUTH_ENABLED: options.enabled === false ? "0" : "1",
      SUITE_AUTH_SECRET: "s".repeat(32),
      SUITE_AUTH_URL: "https://suite.example",
    }),
    workspaces: plane.workspaces,
    invites: plane.invites,
    licences: plane.licences,
    memberships: plane.memberships,
    sessions: {
      sessionFor: async (headers) => {
        const user = headers["x-test-user"];
        return user === undefined ? null : (sessions.get(user) ?? null);
      },
    },
    now: () => NOW,
    newId: () => `invite-${++sequence}`,
  };
  return { deps, sessions, plane };
}

function post(path: string, body: unknown, user?: string): AuthHttpEvent {
  return {
    httpMethod: "POST",
    path,
    body: JSON.stringify(body),
    headers: user === undefined ? {} : { "x-test-user": user },
  };
}

function get(path: string, user?: string): AuthHttpEvent {
  return {
    httpMethod: "GET",
    path,
    headers: user === undefined ? {} : { "x-test-user": user },
  };
}

function bodyOf(response: { body: string }): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

describe("POST /api/workspaces/claim", () => {
  it("claims a workspace into the caller's organization and keeps the id", async () => {
    const { deps, plane } = harness();
    plane.addWorkspace({ id: "ws-anon", createdAt: 5 });

    const response = await createAuthHandler(deps)(
      post("/api/workspaces/claim", { workspaceId: "ws-anon" }, OWNER),
    );

    expect(response.statusCode).toBe(201);
    expect(bodyOf(response)).toMatchObject({
      ok: true,
      status: "claimed",
      workspaceId: "ws-anon",
      organizationId: ORG,
    });
    expect(plane.workspaceRow("ws-anon")?.organizationId).toBe(ORG);
  });

  it("answers a second claim with 200 and no change", async () => {
    const { deps } = harness();
    const handler = createAuthHandler(deps);
    await handler(post("/api/workspaces/claim", { workspaceId: "ws-anon" }, OWNER));
    const second = await handler(post("/api/workspaces/claim", { workspaceId: "ws-anon" }, OWNER));
    expect(second.statusCode).toBe(200);
    expect(bodyOf(second)).toMatchObject({ status: "unchanged" });
  });

  it("refuses without a session", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(
      post("/api/workspaces/claim", { workspaceId: "ws-anon" }),
    );
    expect(response.statusCode).toBe(401);
    expect(bodyOf(response)).toMatchObject({ error: "unauthorized" });
  });

  it("refuses a member who cannot manage links", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(
      post("/api/workspaces/claim", { workspaceId: "ws-anon" }, EDITOR),
    );
    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toMatchObject({ error: "forbidden" });
  });

  it("refuses a workspace already owned by another organization", async () => {
    const { deps, plane } = harness();
    plane.addOrganization({ id: "org-rival", members: [] });
    plane.addWorkspace({ id: "ws-theirs", organizationId: "org-rival", createdAt: 1 });

    const response = await createAuthHandler(deps)(
      post("/api/workspaces/claim", { workspaceId: "ws-theirs" }, OWNER),
    );
    expect(response.statusCode).toBe(409);
    expect(bodyOf(response)).toMatchObject({ error: "workspace-already-claimed" });
  });

  it("refuses a new workspace past the licence ceiling", async () => {
    const { deps, plane } = harness({ workspaces: 1 });
    plane.addWorkspace({ id: "ws-second", createdAt: 1 });

    const response = await createAuthHandler(deps)(
      post("/api/workspaces/claim", { workspaceId: "ws-second" }, OWNER),
    );
    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toMatchObject({ error: "seat-refused" });
  });

  it("rejects a body without a workspace id", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(post("/api/workspaces/claim", {}, OWNER));
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response)).toMatchObject({ error: "invalid-request" });
  });
});

describe("POST /api/auth/invites", () => {
  it("mints a key for an owner and returns it exactly once", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(
      post(
        "/api/auth/invites",
        { workspaceId: WORKSPACE, role: "member", maxUses: 2, expiresAt: NOW + DAY },
        OWNER,
      ),
    );

    expect(response.statusCode).toBe(201);
    const body = bodyOf(response);
    expect(typeof body.key).toBe("string");
    expect(body.invite).toMatchObject({
      workspaceId: WORKSPACE,
      role: "member",
      maxUses: 2,
      usedCount: 0,
    });
    expect(JSON.stringify(body.invite)).not.toContain("keyHash");
  });

  it("refuses a member, because a member cannot manage links", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(
      post("/api/auth/invites", { workspaceId: WORKSPACE, role: "member" }, EDITOR),
    );
    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toMatchObject({ error: "forbidden" });
  });

  it("refuses an owner grant", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(
      post("/api/auth/invites", { workspaceId: WORKSPACE, role: "owner" }, OWNER),
    );
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response)).toMatchObject({ error: "invalid-request" });
  });

  it("refuses an expiry in the past", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(
      post(
        "/api/auth/invites",
        { workspaceId: WORKSPACE, role: "member", expiresAt: NOW - 1 },
        OWNER,
      ),
    );
    expect(response.statusCode).toBe(400);
  });

  it("refuses a workspace nobody owns", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(
      post("/api/auth/invites", { workspaceId: "ws-anon", role: "member" }, OWNER),
    );
    expect(response.statusCode).toBe(404);
    expect(bodyOf(response)).toMatchObject({ error: "workspace-not-found" });
  });
});

describe("POST /api/invites/redeem", () => {
  async function mintKey(deps: AuthHandlerDeps, maxUses = 1): Promise<string> {
    const response = await createAuthHandler(deps)(
      post("/api/auth/invites", { workspaceId: WORKSPACE, role: "member", maxUses }, OWNER),
    );
    return String(bodyOf(response).key);
  }

  it("redeems into a member row once", async () => {
    const { deps, plane } = harness();
    const key = await mintKey(deps, 2);

    const response = await createAuthHandler(deps)(post("/api/invites/redeem", { key }, TESTER));

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toMatchObject({
      status: "redeemed",
      organizationId: ORG,
      role: "member",
    });
    expect(plane.memberRows().some((member) => member.userId === TESTER)).toBe(true);
  });

  it("answers 'already-member' without spending a use", async () => {
    const { deps, plane } = harness();
    const key = await mintKey(deps, 3);

    const response = await createAuthHandler(deps)(post("/api/invites/redeem", { key }, EDITOR));

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toMatchObject({ status: "already-member", role: "member" });
    expect(plane.inviteRows()[0]?.usedCount).toBe(0);
  });

  it("refuses when the organization has no seat left", async () => {
    const { deps, plane } = harness({ seats: 2 });
    const key = await mintKey(deps);

    const response = await createAuthHandler(deps)(post("/api/invites/redeem", { key }, TESTER));

    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toMatchObject({ error: "seat-refused" });
    // The refusal happens before the write, so the key still has its use and the
    // tester is not a member.
    expect(plane.inviteRows()[0]?.usedCount).toBe(0);
    expect(plane.memberRows().some((member) => member.userId === TESTER)).toBe(false);
  });

  it("refuses a revoked key with 409", async () => {
    const { deps, plane } = harness();
    const key = await mintKey(deps);
    const [row] = plane.inviteRows();
    if (row !== undefined) await plane.invites.revoke({ keyId: row.id, now: NOW });

    const response = await createAuthHandler(deps)(post("/api/invites/redeem", { key }, TESTER));
    expect(response.statusCode).toBe(409);
    expect(bodyOf(response)).toMatchObject({ error: "invite-revoked" });
  });

  it("refuses an unknown key with 404", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(
      post("/api/invites/redeem", { key: "a".repeat(43) }, TESTER),
    );
    expect(response.statusCode).toBe(404);
    expect(bodyOf(response)).toMatchObject({ error: "invite-not-found" });
  });

  it("refuses without a session", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(post("/api/invites/redeem", { key: "abc" }));
    expect(response.statusCode).toBe(401);
  });
});

describe("GET /api/workspaces/:id/members", () => {
  it("lists members to a member of the workspace", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(
      get(`/api/workspaces/${WORKSPACE}/members`, EDITOR),
    );

    expect(response.statusCode).toBe(200);
    const body = bodyOf(response);
    expect(body).toMatchObject({ ok: true, workspaceId: WORKSPACE, organizationId: ORG });
    const members = body.members as { userId: string; role: OrganizationRole }[];
    expect(members.map((member) => member.userId)).toEqual([OWNER, EDITOR]);
    expect(members[0]?.role).toBe("owner");
  });

  it("refuses a signed-in stranger", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(
      get(`/api/workspaces/${WORKSPACE}/members`, TESTER),
    );
    expect(response.statusCode).toBe(403);
  });

  it("refuses an anonymous workspace", async () => {
    const { deps, plane } = harness();
    plane.addWorkspace({ id: "ws-anon", createdAt: 1 });
    const response = await createAuthHandler(deps)(get("/api/workspaces/ws-anon/members", OWNER));
    expect(response.statusCode).toBe(404);
    expect(bodyOf(response)).toMatchObject({ error: "workspace-not-found" });
  });
});

describe("the surface itself", () => {
  it("says it is off rather than pretending", async () => {
    const { deps } = harness({ enabled: false });
    const response = await createAuthHandler(deps)(get("/api/workspaces/ws/members", OWNER));
    expect(response.statusCode).toBe(503);
    expect(bodyOf(response)).toMatchObject({ error: "auth-not-configured" });
  });

  it("refuses a wrong method with an Allow header", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(get("/api/auth/invites", OWNER));
    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe("POST");
  });

  it("answers an unknown path with 404", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)(get("/api/unknown", OWNER));
    expect(response.statusCode).toBe(404);
  });

  it("rejects a body that is not JSON", async () => {
    const { deps } = harness();
    const response = await createAuthHandler(deps)({
      httpMethod: "POST",
      path: "/api/workspaces/claim",
      body: "not json",
      headers: { "x-test-user": OWNER },
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response)).toMatchObject({ error: "invalid-request" });
  });
});
