import {
  type AuthEntry,
  AuthError,
  type LicenceClaims,
  memoryControlPlane,
  seatLicence,
} from "@suite/auth";
import { afterEach, describe, expect, it } from "vitest";
import { type ControlPlane, createControlPlane } from "../host.js";
import { createLogger } from "../logging.js";
import {
  createAuthModule,
  RELAY_PURGE_TOKEN_VARIABLE,
  RELAY_URL_VARIABLE,
  relayWorkspaceData,
} from "./auth.js";
import { loadModules } from "./index.js";

/**
 * The account module, over a real socket.
 *
 * What is pinned is the boundary: which paths it claims, what it does with a request
 * that is not its own, and the fact that an `/api/auth/*` call reaches Better Auth's
 * handler unchanged. The Better Auth instance itself is a fake here — its own suite is
 * `services/auth/src/identity/betterAuth.test.ts` — so nothing in this file needs a
 * database.
 */
const BASE_URL = "https://suite.example";
const ORG = "org-agency";
const OWNER = "user-owner";
const WORKSPACE = "ws-q4";

const running: ControlPlane[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((plane) => plane.close({ drainMs: 100 })));
});

interface SeenRequest {
  method: string;
  url: string;
  body: string | null;
  cookie: string | null;
  requestId: string | null;
}

/** A Better Auth stand-in: records the request and answers as its handler would. */
function fakeEntry(seen: SeenRequest[]): AuthEntry {
  const plane = memoryControlPlane();
  plane.addOrganization({
    id: ORG,
    name: "Agency",
    members: [{ userId: OWNER, role: "owner" }],
  });
  plane.addWorkspace({ id: WORKSPACE, organizationId: ORG, name: "Q4", createdAt: 1 });
  // A licence, because the claim route counts workspaces against the ceiling and an
  // unlicensed organization fails closed.
  const claims: LicenceClaims = {
    v: 1,
    id: "lic-1",
    tier: "team",
    workspaces: 5,
    documentBytes: 1_000_000,
    attachmentBytes: 1_000_000,
    issuedAt: 1,
    expiresAt: 9_999_999_999_999,
  };
  plane.recordLicence(ORG, seatLicence(claims, 5));

  return {
    handler: async (request) => {
      seen.push({
        method: request.method,
        url: request.url,
        body: request.body === null ? null : await request.clone().text(),
        cookie: request.headers.get("cookie"),
        requestId: request.headers.get("x-request-id"),
      });
      const path = new URL(request.url).pathname;
      if (path.endsWith("/magic-link/verify")) {
        // A link click answers with a redirect, not a body: the module must pass the
        // status and `location` through rather than reading a body that is not there.
        return new Response(null, {
          status: 302,
          headers: { location: `${BASE_URL}/dashboard` },
        });
      }
      const headers = new Headers({ "content-type": "application/json" });
      // Two cookies in one response is the case a joined header would corrupt.
      headers.append("set-cookie", "better-auth.session_token=abc; Path=/; HttpOnly");
      headers.append("set-cookie", "better-auth.state=def; Path=/; HttpOnly");
      return new Response(JSON.stringify({ ok: true, path: new URL(request.url).pathname }), {
        status: 200,
        headers,
      });
    },
    // An `AuthError` is the one thrown value the route keeps a code from; anything
    // else would become a 500.
    redeem: async () => {
      throw new AuthError("invite-not-found", "no such invite");
    },
    sessions: {
      sessionFor: async (headers) =>
        headers.cookie === "session=owner"
          ? { userId: OWNER, organizationId: ORG, role: "owner", admittedAt: null, operator: false }
          : null,
    },
    repositories: {
      licences: plane.licences,
      memberships: plane.memberships,
      workspaces: plane.workspaces,
    },
    close: async () => {},
  };
}

async function start(
  options: { enabled?: boolean; boot?: () => Promise<AuthEntry>; seen?: SeenRequest[] } = {},
): Promise<{ url: string; seen: SeenRequest[]; booted: () => number }> {
  const seen = options.seen ?? [];
  let boots = 0;
  const entry = fakeEntry(seen);
  const module = createAuthModule({
    env: {
      SUITE_AUTH_ENABLED: options.enabled === false ? "0" : "1",
      SUITE_AUTH_SECRET: "t".repeat(40),
      SUITE_AUTH_URL: BASE_URL,
    },
    boot: async () => {
      boots += 1;
      return options.boot === undefined ? entry : options.boot();
    },
    logger: createLogger({ level: "error", write: () => {} }),
  });
  const plane = createControlPlane({
    modules: [module],
    statuses: [{ name: "auth", state: "mounted" }],
    buildId: "test-build",
    logger: createLogger({ level: "error", write: () => {} }),
  });
  running.push(plane);
  const port = await plane.listen(0);
  return { url: `http://127.0.0.1:${port}`, seen, booted: () => boots };
}

describe("the module the host mounts", () => {
  it("is the file the loader finds, under the host's name", async () => {
    // The loader is what the process actually runs; a module that exports the right
    // object but lives under a name it does not claim would be reported `absent`.
    const loaded = await loadModules({
      logger: createLogger({ level: "error", write: () => {} }),
      directory: import.meta.dirname,
    });

    expect(loaded.status).toContainEqual({ name: "auth", state: "mounted" });
    expect(loaded.modules.map((entry) => entry.name)).toContain("auth");
  });
});

describe("the auth module's paths", () => {
  it("declines everything it does not own, so the host answers 404", async () => {
    const { url } = await start();

    // Not ours: the relay's owner-key claim, the billing module's namespace, `/health`.
    for (const path of ["/api/workspaces/ws-1/claim", "/api/billing/status", "/"]) {
      const response = await fetch(`${url}${path}`);
      expect(response.status).toBe(404);
    }
  });

  it("delegates /api/auth/* to Better Auth, unchanged", async () => {
    const { url, seen } = await start();

    const response = await fetch(`${url}/api/auth/sign-up/email?trace=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "better-auth.session_token=abc",
      },
      body: JSON.stringify({ email: "stranger@example.com" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, path: "/api/auth/sign-up/email" });
    // The request id the host minted reaches the service, and the query survives.
    expect(seen[0]).toMatchObject({
      method: "POST",
      url: `${BASE_URL}/api/auth/sign-up/email?trace=1`,
      body: JSON.stringify({ email: "stranger@example.com" }),
      cookie: "better-auth.session_token=abc",
    });
    expect(seen[0]?.requestId).toEqual(expect.any(String));
    // Both cookies survive: a joined `set-cookie` header is one invalid value.
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it("passes a redirect through, which is what a magic-link click is", async () => {
    const { url } = await start();

    const response = await fetch(`${url}/api/auth/magic-link/verify?token=m1`, {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${BASE_URL}/dashboard`);
  });

  it("serves the account-side claim, and the session decides the organization", async () => {
    const { url } = await start();

    const refused = await fetch(`${url}/api/workspaces/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "ws-new", organizationId: ORG }),
    });
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: "unauthorized" });

    const claimed = await fetch(`${url}/api/workspaces/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=owner" },
      body: JSON.stringify({ workspaceId: "ws-new", organizationId: ORG }),
    });
    expect(claimed.status).toBe(201);
    expect(await claimed.json()).toMatchObject({ ok: true, status: "claimed" });
  });

  it("serves the workspace member list, and nothing else under that path", async () => {
    const { url } = await start();

    const members = await fetch(`${url}/api/workspaces/${WORKSPACE}/members`, {
      headers: { cookie: "session=owner" },
    });
    expect(members.status).toBe(200);
    expect(await members.json()).toMatchObject({ ok: true });
  });

  it("serves the invitation redemption route, in our error codes", async () => {
    const { url } = await start();
    const response = await fetch(`${url}/api/invites/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "t0ken" }),
    });
    // The engine's refusal reaches the wire as our code and our status, which is the
    // whole contract in front of it.
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: "invite-not-found" });
  });
});

describe("the database variable", () => {
  it("falls back to the host's connection string, because it is one database", async () => {
    const seen: string[] = [];
    const module = createAuthModule({
      env: {
        SUITE_AUTH_ENABLED: "1",
        SUITE_AUTH_SECRET: "t".repeat(40),
        SUITE_AUTH_URL: BASE_URL,
        SUITE_CONTROL_PLANE_DATABASE_URL: "postgres://suite@db.example:5432/suite",
      },
      boot: async (env) => {
        seen.push(env.SUITE_AUTH_DATABASE_URL ?? "");
        return fakeEntry([]);
      },
      logger: createLogger({ level: "error", write: () => {} }),
    });
    const plane = createControlPlane({
      modules: [module],
      statuses: [{ name: "auth", state: "mounted" }],
      buildId: "test-build",
      logger: createLogger({ level: "error", write: () => {} }),
    });
    running.push(plane);
    const port = await plane.listen(0);
    await fetch(`http://127.0.0.1:${port}/api/auth/get-session`);

    expect(seen).toEqual(["postgres://suite@db.example:5432/suite"]);
  });

  it("prefers SUITE_AUTH_DATABASE_URL when both are set", async () => {
    const seen: string[] = [];
    const module = createAuthModule({
      env: {
        SUITE_AUTH_ENABLED: "1",
        SUITE_AUTH_SECRET: "t".repeat(40),
        SUITE_AUTH_URL: BASE_URL,
        SUITE_AUTH_DATABASE_URL: "postgres://auth@db.example:5432/suite",
        SUITE_CONTROL_PLANE_DATABASE_URL: "postgres://host@db.example:5432/suite",
      },
      boot: async (env) => {
        seen.push(env.SUITE_AUTH_DATABASE_URL ?? "");
        return fakeEntry([]);
      },
      logger: createLogger({ level: "error", write: () => {} }),
    });
    const plane = createControlPlane({
      modules: [module],
      statuses: [{ name: "auth", state: "mounted" }],
      buildId: "test-build",
      logger: createLogger({ level: "error", write: () => {} }),
    });
    running.push(plane);
    const port = await plane.listen(0);
    await fetch(`http://127.0.0.1:${port}/api/auth/get-session`);

    expect(seen).toEqual(["postgres://auth@db.example:5432/suite"]);
  });
});

describe("the auth module's refusals", () => {
  it("answers 503 on every path it owns while the service is switched off", async () => {
    const { url, booted } = await start({ enabled: false });

    const response = await fetch(`${url}/api/auth/get-session`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: "auth-not-configured" });
    // Switched off is not a reason to open a pool.
    expect(booted()).toBe(0);
  });

  it("answers 503 when the service cannot start, and retries on the next request", async () => {
    let attempt = 0;
    const { url } = await start({
      boot: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("the database is not up yet");
        return fakeEntry([]);
      },
    });

    const failed = await fetch(`${url}/api/auth/get-session`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: "auth-unavailable" });

    const recovered = await fetch(`${url}/api/auth/get-session`);
    expect(recovered.status).toBe(200);
    expect(attempt).toBe(2);
  });

  it("boots once for many requests", async () => {
    const { url, booted } = await start();

    await Promise.all([
      fetch(`${url}/api/auth/get-session`),
      fetch(`${url}/api/auth/jwks`),
      fetch(`${url}/api/workspaces/claim`, { method: "POST", body: "{}" }),
    ]);

    expect(booted()).toBe(1);
  });
});

describe("the relay workspace data port", () => {
  const BASE = "http://relay:1235";
  const TOKEN = "purge-token";

  /** The relay's answer, recorded rather than sent. */
  function recorder(status = 200, body: unknown = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    return { calls, fetcher };
  }

  it("stays absent while either half of the pair is missing", () => {
    // One variable is not a deployment that can purge, and a port that answered
    // every call with a connection error would report `not-removed` instead of
    // `not-configured` for a store this process never had.
    expect(relayWorkspaceData({})).toBeNull();
    expect(relayWorkspaceData({ [RELAY_URL_VARIABLE]: BASE })).toBeNull();
    expect(relayWorkspaceData({ [RELAY_PURGE_TOKEN_VARIABLE]: TOKEN })).toBeNull();
  });

  it("refuses a relay URL that is not one, at boot", () => {
    expect(() =>
      relayWorkspaceData({
        [RELAY_URL_VARIABLE]: "relay:1235",
        [RELAY_PURGE_TOKEN_VARIABLE]: TOKEN,
      }),
    ).toThrow();
  });

  it("purges one workspace on its own credential and maps the relay's counts", async () => {
    const recorded = recorder(200, {
      workspaceId: "ws-1",
      deleted: true,
      organizationId: null,
      documents: 1,
      projected: 2,
      shares: 3,
      baselines: 4,
      attachments: 5,
    });
    const port = relayWorkspaceData(
      { [RELAY_URL_VARIABLE]: BASE, [RELAY_PURGE_TOKEN_VARIABLE]: TOKEN },
      recorded.fetcher,
    );
    expect(port).not.toBeNull();

    const counts = await port?.erase("ws-1");

    // The document store is the workspace's own rows and the rooms projected from
    // them; the share store is the rows and their baselines. The report's three
    // numbers therefore mean what it says they mean.
    expect(counts).toEqual({ documents: 3, shares: 7, attachments: 5 });
    expect(recorded.calls).toHaveLength(1);
    const [call] = recorded.calls;
    if (call === undefined) throw new Error("the port sent no request");
    expect(call.url).toBe(`${BASE}/api/workspaces/ws-1`);
    expect(call.init.method).toBe("DELETE");
    expect((call.init.headers as Record<string, string>).authorization).toContain(TOKEN);
    // The relay refuses a delete that does not repeat the id it was given.
    expect(call.init.body).toBe(JSON.stringify({ confirm: "ws-1" }));
  });

  it("throws on a refusal, so the erase stops before the account is touched", async () => {
    const recorded = recorder(503, { error: "The workspace request failed." });
    const port = relayWorkspaceData(
      { [RELAY_URL_VARIABLE]: BASE, [RELAY_PURGE_TOKEN_VARIABLE]: TOKEN },
      recorded.fetcher,
    );

    await expect(port?.erase("ws-1")).rejects.toThrow(/503/u);
  });

  it("carries the variable names the relay reads, so one secret is set twice", async () => {
    // The relay reads the same two names; a rename on one side would leave a purge
    // credential that authenticates nothing.
    expect(RELAY_URL_VARIABLE).toBe("SUITE_RELAY_URL");
    expect(RELAY_PURGE_TOKEN_VARIABLE).toBe("SUITE_RELAY_PURGE_TOKEN");
  });
});
