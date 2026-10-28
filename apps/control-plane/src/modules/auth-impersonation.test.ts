import type { AccountSession, AuthEntry } from "@suite/auth";
import { afterEach, describe, expect, it } from "vitest";
import { type ControlPlane, createControlPlane } from "../host.js";
import { createLogger } from "../logging.js";
import { memoryAuditStore } from "./audit.js";
import { createAuthModule } from "./auth.js";
import type { GrantStore, SupportGrant } from "./grants.js";

/**
 * The consent gate around impersonation.
 *
 * The plugin mechanism itself is proved in
 * `services/auth/src/identity/impersonation.test.ts`; what this file pins is the door in
 * front of it — who may start an impersonation, what has to be true first, and the fact
 * that the account's own grant is what makes it allowed. The grant store and the Better
 * Auth entry are both fakes, so nothing here needs a database.
 */
const BASE_URL = "https://suite.example";
const OPERATOR = "user-operator";
const TARGET = "user-target";

const running: ControlPlane[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((plane) => plane.close({ drainMs: 100 })));
});

/** An in-memory grant store with the one behaviour the gate reads: `active`. */
function memoryGrants(active: readonly string[] = []): GrantStore {
  const rows = new Map<string, SupportGrant>(
    active.map((id) => [id, { userId: id, grantedAt: 1, revokedAt: null }]),
  );
  const live = (userId: string): boolean => {
    const row = rows.get(userId);
    return row !== undefined && row.revokedAt === null;
  };
  return {
    get: async (userId) => rows.get(userId) ?? null,
    active: async (userId) => live(userId),
    grant: async (userId) => {
      rows.set(userId, { userId, grantedAt: 2, revokedAt: null });
    },
    revoke: async (userId) => {
      const row = rows.get(userId);
      if (row !== undefined) rows.set(userId, { ...row, revokedAt: 3 });
    },
  };
}

interface Harness {
  url: string;
  /** Every path the Better Auth entry was asked to handle, in order. */
  calls: string[];
  /** The accounts whose plugin role this module wrote before impersonating. */
  roles: string[];
  /** The audit rows the module wrote. */
  trail: ReturnType<typeof memoryAuditStore>;
}

async function start(
  options: {
    /** The session the cookie names; `null` is anonymous. */
    session?: Partial<AccountSession> | null;
    /** The grants the account has already given. */
    granted?: readonly string[];
    /** A settings row that turns impersonation off. */
    flagOff?: boolean;
    /** The plugin's own refusal, as it answers one: a code on a 200. */
    pluginRefusal?: { code: string; message: string; enrollAt?: string };
  } = {},
): Promise<Harness> {
  const calls: string[] = [];
  const roles: string[] = [];
  const trail = memoryAuditStore();
  const session =
    options.session === null
      ? null
      : {
          userId: OPERATOR,
          organizationId: "org-1",
          role: "owner" as const,
          admittedAt: null,
          operator: true,
          ...options.session,
        };

  const entry: AuthEntry = {
    handler: async (request) => {
      const path = new URL(request.url).pathname;
      calls.push(path);
      if (path.endsWith("stop-impersonating")) {
        // Stopping restores the operator: the plugin clears the target and keeps its own.
        const headers = new Headers({ "content-type": "application/json" });
        headers.append("set-cookie", "better-auth.admin_session=; Max-Age=0; Path=/");
        headers.append("set-cookie", "better-auth.session_token=operator; Path=/; HttpOnly");
        return new Response(JSON.stringify({ session: null }), { status: 200, headers });
      }
      if (options.pluginRefusal !== undefined) {
        // Better Auth answers an endpoint refusal on a 200 with a code in the body.
        return new Response(JSON.stringify(options.pluginRefusal), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "better-auth.admin_session=operator; Path=/; HttpOnly");
      headers.append("set-cookie", "better-auth.session_token=target; Path=/; HttpOnly");
      return new Response(JSON.stringify({ session: { userId: TARGET } }), {
        status: 200,
        headers,
      });
    },
    redeem: async () => {
      throw new Error("unused");
    },
    sessions: {
      sessionFor: async () => session,
    },
    repositories: {
      licences: { read: async () => null, write: async () => {} } as never,
      memberships: {} as never,
      workspaces: {} as never,
    },
    close: async () => {},
  };

  const log = createLogger({ level: "error", write: () => {} });
  const plane = createControlPlane({
    modules: [
      createAuthModule({
        // No database: the flag reads the settings table, and an unset URL reads as the
        // registry default. `flagOff` writes no rows for the same reason, so the case is
        // proved where it can be — the gate unit below.
        env: {
          SUITE_AUTH_ENABLED: "1",
          SUITE_AUTH_SECRET: "t".repeat(40),
          SUITE_AUTH_URL: BASE_URL,
        },
        boot: async () => entry,
        grants: memoryGrants(options.granted),
        operatorRoles: async (userId) => {
          roles.push(userId);
        },
        audit: trail,
        logger: log,
      }),
    ],
    statuses: [{ name: "auth", state: "mounted" }],
    buildId: "test-build",
    logger: log,
  });
  running.push(plane);
  const port = await plane.listen(0);
  return { url: `http://127.0.0.1:${port}`, calls, roles, trail };
}

const impersonate = (url: string, body: unknown = { userId: TARGET }) =>
  fetch(`${url}/api/account/impersonate`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "better-auth.session_token=abc" },
    body: JSON.stringify(body),
  });

describe("starting an impersonation", () => {
  it("refuses an anonymous caller", async () => {
    const { url, calls } = await start({ session: null, granted: [TARGET] });

    const response = await impersonate(url);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
    // The plugin was never asked: the gate refuses before the mechanism runs.
    expect(calls).toHaveLength(0);
  });

  it("refuses an account that is not an operator", async () => {
    const { url, calls } = await start({ session: { operator: false }, granted: [TARGET] });

    const response = await impersonate(url);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("refuses without a live grant from the target", async () => {
    const { url, calls, roles } = await start({ granted: [] });

    const response = await impersonate(url);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "no-support-grant" });
    expect(calls).toHaveLength(0);
    // Nothing was written for a refusal, so a refused attempt leaves no trace.
    expect(roles).toHaveLength(0);
  });

  it("refuses an operator impersonating itself", async () => {
    const { url, calls } = await start({ granted: [OPERATOR] });

    const response = await impersonate(url, { userId: OPERATOR });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "self-impersonation" });
    expect(calls).toHaveLength(0);
  });

  it("needs a target id in the body", async () => {
    const { url } = await start({ granted: [TARGET] });

    expect((await impersonate(url, {})).status).toBe(400);
    expect((await impersonate(url, { userId: "  " })).status).toBe(400);
  });

  it("starts the impersonation and relays both cookies", async () => {
    const { url, calls, roles } = await start({ granted: [TARGET] });

    const response = await impersonate(url);

    expect(response.status).toBe(200);
    // The plugin's own endpoint, called the way a browser would.
    expect(calls).toEqual(["/api/auth/admin/impersonate-user"]);
    // The plugin's gate is the role, so the operator carries it before the call.
    expect(roles).toEqual([OPERATOR]);
    // Two cookies, in order: the operator's kept under `admin_session`, the target's own.
    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.admin_session=operator; Path=/; HttpOnly",
      "better-auth.session_token=target; Path=/; HttpOnly",
    ]);
  });
});

describe("stopping an impersonation", () => {
  it("puts the operator back without needing a grant", async () => {
    const { url, calls } = await start({ granted: [] });

    const response = await fetch(`${url}/api/account/stop-impersonating`, {
      method: "POST",
      headers: { cookie: "better-auth.admin_session=operator" },
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(["/api/auth/admin/stop-impersonating"]);
    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.admin_session=; Max-Age=0; Path=/",
      "better-auth.session_token=operator; Path=/; HttpOnly",
    ]);
  });

  it("is refused when nobody is signed in", async () => {
    const { url } = await start({ session: null });

    const response = await fetch(`${url}/api/account/stop-impersonating`, { method: "POST" });

    expect(response.status).toBe(401);
  });
});

describe("an account's own support access", () => {
  const supportAccess = (url: string, method: string) =>
    fetch(`${url}/api/account/support-access`, {
      method,
      headers: { cookie: "better-auth.session_token=abc" },
    });

  it("starts off, turns on, and turns off again", async () => {
    const { url } = await start({ session: { operator: false } });

    expect(await (await supportAccess(url, "GET")).json()).toMatchObject({ granted: false });
    expect(await (await supportAccess(url, "PUT")).json()).toMatchObject({ granted: true });
    expect(await (await supportAccess(url, "DELETE")).json()).toMatchObject({ granted: false });
  });

  it("needs a session", async () => {
    const { url } = await start({ session: null });

    expect((await supportAccess(url, "GET")).status).toBe(401);
  });

  it("refuses a method that is not a read, a grant or a revoke", async () => {
    const { url } = await start({ session: { operator: false } });

    const response = await fetch(`${url}/api/account/support-access`, {
      method: "POST",
      headers: { cookie: "better-auth.session_token=abc" },
    });

    expect(response.status).toBe(405);
  });
});

describe("the plugin's own refusal", () => {
  it("is a refusal, not a success", async () => {
    // `mfa-enrollment-required` is the one an operator meets first: an account that may
    // manage people needs a second factor. Answering 200 would tell the panel an
    // impersonation had started when nothing had changed.
    const { url, roles } = await start({
      granted: [TARGET],
      pluginRefusal: {
        code: "mfa-enrollment-required",
        message: "This account can manage people, so it needs a second factor.",
        enrollAt: "/two-factor/enable",
      },
    });

    const response = await impersonate(url);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "mfa-enrollment-required",
      enrollAt: "/two-factor/enable",
    });
    expect(response.headers.getSetCookie()).toHaveLength(0);
    // The role was still written: the refusal is about the operator, not the target.
    expect(roles).toEqual([OPERATOR]);
  });
});

describe("the audit trail", () => {
  it("records a started impersonation with the operator as the actor", async () => {
    const { url, trail } = await start({ granted: [TARGET] });

    await impersonate(url);

    expect(trail.entries).toEqual([
      expect.objectContaining({
        actor: OPERATOR,
        action: "impersonate",
        target: TARGET,
        outcome: "ok",
      }),
    ]);
  });

  it("records the plugin's refusal, because somebody tried", async () => {
    const { url, trail } = await start({
      granted: [TARGET],
      pluginRefusal: { code: "mfa-enrollment-required", message: "needs a second factor" },
    });

    await impersonate(url);

    expect(trail.entries).toEqual([
      expect.objectContaining({
        actor: OPERATOR,
        action: "impersonate",
        target: TARGET,
        outcome: "refused",
        details: { code: "mfa-enrollment-required" },
      }),
    ]);
  });

  it("records a stop so the pair reads as one session", async () => {
    const { url, trail } = await start({ granted: [TARGET] });

    await fetch(`${url}/api/account/stop-impersonating`, {
      method: "POST",
      headers: { cookie: "better-auth.admin_session=operator" },
    });

    expect(trail.entries.at(-1)).toMatchObject({ action: "impersonate.stop", outcome: "ok" });
  });

  it("records an account's own consent, which is what version two of a dispute cites", async () => {
    const { url, trail } = await start({ session: { operator: false } });

    await fetch(`${url}/api/account/support-access`, {
      method: "PUT",
      headers: { cookie: "better-auth.session_token=abc" },
    });

    expect(trail.entries).toEqual([
      expect.objectContaining({ action: "support-access.grant", outcome: "ok" }),
    ]);
  });

  it("writes nothing when nobody is signed in, because it names no actor", async () => {
    const { url, trail } = await start({ session: null });

    await fetch(`${url}/api/account/support-access`, { method: "PUT" });

    expect(trail.entries).toHaveLength(0);
  });
});
