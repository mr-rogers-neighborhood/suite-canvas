import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { EnrollmentOutcome, EnrollmentRedeemInput } from "../invitations/enrollment.js";
import { seatLicence } from "../organizations/seats.js";
import { memoryControlPlane } from "../store/memory.js";
import type { AccountSession, LicenceClaims, OrganizationRole } from "../types.js";
import { authEnvironment } from "./env.js";
import { AuthError } from "./errors.js";
import { type AuthHandlerDeps, type AuthHttpEvent, createAuthHandler } from "./handler.js";

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
  /** Every redemption the route forwarded, so a test can see what crossed the seam. */
  redemptions: EnrollmentRedeemInput[];
  /** Answer the next redemption instead of the default success. */
  redeeming: (outcome: EnrollmentOutcome | Error) => void;
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

  const redemptions: EnrollmentRedeemInput[] = [];
  let next: EnrollmentOutcome | Error = {
    status: "redeemed",
    organizationId: ORG,
    role: "member",
    signedIn: false,
  };

  const deps: AuthHandlerDeps = {
    env: authEnvironment({
      SUITE_AUTH_ENABLED: options.enabled === false ? "0" : "1",
      SUITE_AUTH_SECRET: "s".repeat(32),
      SUITE_AUTH_URL: "https://suite.example",
    }),
    workspaces: plane.workspaces,
    licences: plane.licences,
    memberships: plane.memberships,
    enrollment: {
      // The port is the seam: redemption itself belongs to the plugin and is tested
      // against a real instance in `betterAuth.test.ts`. What this fake proves is the
      // *contract* — what crosses the seam, and what a refusal becomes.
      redeem: async (input) => {
        redemptions.push(input);
        // The port answers with a `Result`; a fixture may still hand over an
        // `AuthError` to say "the engine refused with this code".
        if (next instanceof Error) {
          return err({
            kind: "refused" as const,
            code: next instanceof AuthError ? next.code : "forbidden",
            message: next.message,
          });
        }
        return ok(next);
      },
    },
    sessions: {
      sessionFor: async (headers) => {
        const user = headers["x-test-user"];
        return user === undefined ? null : (sessions.get(user) ?? null);
      },
    },
    now: () => NOW,
  };
  return {
    deps,
    sessions,
    plane,
    redemptions,
    redeeming: (outcome) => {
      next = outcome;
    },
  };
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

describe("POST /api/invites/redeem", () => {
  it("redeems without a session, because a private invite creates the account", async () => {
    const { deps, redemptions } = harness();

    const response = await createAuthHandler(deps)(
      post("/api/invites/redeem", {
        token: "t0ken",
        password: "correct horse battery",
        name: "Ada",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toMatchObject({
      ok: true,
      status: "redeemed",
      organizationId: ORG,
      role: "member",
    });
    expect(redemptions).toEqual([
      { token: "t0ken", password: "correct horse battery", name: "Ada", headers: {} },
    ]);
  });

  it("forwards the cookie and nothing else, so a shareable link knows who is signed in", async () => {
    const { deps, redemptions } = harness();
    await createAuthHandler(deps)({
      httpMethod: "POST",
      path: "/api/invites/redeem",
      body: JSON.stringify({ token: "t0ken" }),
      headers: { cookie: "better-auth.session_token=abc", "x-test-user": OWNER },
    });
    expect(redemptions[0]?.headers).toEqual({
      cookie: "better-auth.session_token=abc",
      "x-test-user": OWNER,
    });
  });

  it("answers 'sign in first' with 401 when the invitation needs an account", async () => {
    const { deps, redeeming } = harness();
    redeeming({ status: "sign-in-required" });

    const response = await createAuthHandler(deps)(post("/api/invites/redeem", { token: "t0ken" }));

    expect(response.statusCode).toBe(401);
    expect(bodyOf(response)).toMatchObject({ error: "unauthorized" });
  });

  it("turns a refusal from the engine into our code and our status", async () => {
    const { deps, redeeming } = harness();
    redeeming(new AuthError("seat-refused", "no seat"));

    const response = await createAuthHandler(deps)(post("/api/invites/redeem", { token: "t0ken" }));

    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toMatchObject({ error: "seat-refused" });
  });

  it("answers a 429 with 429, so a caller can back off", async () => {
    const { deps, redeeming } = harness();
    redeeming(new AuthError("rate-limited", "slow down"));

    const response = await createAuthHandler(deps)(post("/api/invites/redeem", { token: "t0ken" }));

    expect(response.statusCode).toBe(429);
    expect(bodyOf(response)).toMatchObject({ error: "rate-limited" });
  });

  it("rejects a body without a token, and one that is not JSON", async () => {
    const { deps } = harness();
    const handler = createAuthHandler(deps);

    expect(
      (await handler(post("/api/invites/redeem", { password: "aaaaaaaaaa" }))).statusCode,
    ).toBe(400);
    const notJson = await handler({
      httpMethod: "POST",
      path: "/api/invites/redeem",
      body: "nope",
    });
    expect(notJson.statusCode).toBe(400);
    expect(bodyOf(notJson)).toMatchObject({ error: "invalid-request" });
  });

  it("refuses to redeem at all when the engine is not wired", async () => {
    const { deps } = harness();
    const handler = createAuthHandler({ ...deps, enrollment: null });

    const response = await handler(post("/api/invites/redeem", { token: "t0ken" }));

    expect(response.statusCode).toBe(503);
    expect(bodyOf(response)).toMatchObject({ error: "auth-not-configured" });
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
    const response = await createAuthHandler(deps)(get("/api/invites/redeem", OWNER));
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
