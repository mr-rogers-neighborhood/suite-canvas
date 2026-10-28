import { memoryAdapter } from "better-auth/adapters/memory";
import { testUtils } from "better-auth/plugins";
import { describe, expect, it } from "vitest";
import { authEnvironment } from "../http/env.js";
import { createAuthService } from "./betterAuth.js";

/**
 * What the admin plugin's impersonation does, against the configuration this deployment
 * runs.
 *
 * The route that will call it is ours and owns the consent gate; the plugin owns the
 * mechanism, and the mechanism is one thing: impersonating returns a session *cookie for
 * the target*, so the browser becomes that account and the relay mints for it. Stopping
 * returns the operator's own. Both are asserted here through the plugin's own HTTP
 * endpoints, which is the same path the browser takes.
 *
 * `testUtils()` is registered in this file and nowhere else, so it never reaches a
 * production auth instance: it exposes privileged helpers on `ctx.test`.
 */
const BASE_URL = "http://localhost:5173";

const MODEL_NAMES = [
  "user",
  "session",
  "account",
  "verification",
  "organization",
  "member",
  "invitation",
  "passkey",
  "twoFactor",
  "invite",
  "inviteUse",
  "jwks",
] as const;

interface TestHelpers {
  saveUser: (user: Record<string, unknown>) => Promise<{ id: string }>;
  login: (input: { userId: string }) => Promise<{ headers: Headers }>;
}

function environment() {
  return authEnvironment({
    SUITE_AUTH_ENABLED: "1",
    SUITE_AUTH_SECRET: "t".repeat(40),
    SUITE_AUTH_URL: BASE_URL,
    SUITE_AUTH_DATABASE_URL: "postgres://unused/test",
    SUITE_GOOGLE_CLIENT_ID: "google-id",
    SUITE_GOOGLE_CLIENT_SECRET: "google-secret",
    SUITE_AUTH_RP_ID: "suite.example",
    SUITE_AUTH_RP_NAME: "Suite",
    SUITE_AUTH_MAX_ORGS_PER_USER: "1",
  });
}

function harness() {
  const store: Record<string, unknown[]> = Object.fromEntries(
    MODEL_NAMES.map((name) => [name, []]),
  );
  const auth = createAuthService({
    env: environment(),
    database: memoryAdapter(store),
    licences: { forOrganization: async () => null },
    memberships: {
      countForOrganization: async () => 0,
      countForUser: async () => 0,
      roleFor: async () => null,
      listForOrganization: async () => [],
    },
    sendMagicLink: async () => {},
    sendVerificationEmail: async () => {},
    sendOrganizationInvitation: async () => {},
    now: () => 1_700_000_000_000,
    extraPlugins: [testUtils()],
  } as never);
  return auth;
}

/**
 * The cookie jar a browser would hold after one response.
 *
 * `Set-Cookie` is applied in order and an empty value deletes: impersonation clears the
 * operator's `session_token`, keeps it as `admin_session`, and sets the target's own. A
 * naive join would send both `session_token`s and the deleted one would win.
 */
function nextJar(current: string, response: Response): string {
  const jar = new Map<string, string>();
  for (const pair of current.split("; ").filter(Boolean)) {
    const at = pair.indexOf("=");
    if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair = ""] = line.split(";");
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (value.length === 0) jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** One call to the plugin's own endpoint, the way a browser would make it. */
async function call(
  auth: ReturnType<typeof createAuthService>,
  path: string,
  headers: Headers,
  body?: unknown,
) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: {
        ...Object.fromEntries(headers.entries()),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        origin: BASE_URL,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

describe("admin impersonation", () => {
  it("returns a session for the target, and stopping returns to the operator", async () => {
    const auth = harness();
    const context = (await (auth as unknown as { $context: Promise<{ test: TestHelpers }> })
      .$context) as { test: TestHelpers };
    const operator = await context.test.saveUser({
      id: "operator-1",
      email: "operator@example.test",
      name: "Operator",
      emailVerified: true,
      role: "admin",
      // An account that can manage people must enrol a second factor first (mfa.ts), so
      // the operator in this test is one that has.
      twoFactorEnabled: true,
    });
    const target = await context.test.saveUser({
      id: "target-1",
      email: "target@example.test",
      name: "Target",
      emailVerified: true,
    });
    const signIn = await context.test.login({ userId: operator.id });

    const impersonated = await call(auth, "/admin/impersonate-user", signIn.headers, {
      userId: target.id,
    });

    expect(impersonated.status).toBe(200);
    // The mechanism is a cookie: the browser becomes the target, and nothing else has to
    // learn a second way to identify a session.
    const cookie = nextJar("", impersonated);

    expect(cookie).toContain("session_token");
    const body = (await impersonated.json()) as { session?: { userId?: string } };
    expect(body.session?.userId).toBe(target.id);

    // The jar now holds the target's `session_token` and the operator's `admin_session`,
    // which is exactly what stopping reads to know who to go back to.
    const beforeStop = nextJar(
      (signIn.headers.getSetCookie?.() ?? []).map((line) => line.split(";")[0]).join("; "),
      impersonated,
    );
    const stopped = await call(
      auth,
      "/admin/stop-impersonating",
      new Headers({ cookie: beforeStop }),
    );
    expect(stopped.status).toBe(200);
    const stoppedBody = (await stopped.json()) as { session?: { userId?: string } };
    expect(stoppedBody.session?.userId).toBe(operator.id);
  });

  it("refuses an account the deployment did not make an admin", async () => {
    const auth = harness();
    const context = (await (auth as unknown as { $context: Promise<{ test: TestHelpers }> })
      .$context) as { test: TestHelpers };
    const member = await context.test.saveUser({
      id: "member-1",
      email: "member@example.test",
      name: "Member",
      emailVerified: true,
    });
    const target = await context.test.saveUser({
      id: "target-2",
      email: "target2@example.test",
      name: "Target",
      emailVerified: true,
    });
    const signIn = await context.test.login({ userId: member.id });

    const response = await call(auth, "/admin/impersonate-user", signIn.headers, {
      userId: target.id,
    });

    // The plugin's own gate is "is this account an admin", which is *not* the whole rule:
    // the consent grant is enforced by the route that calls it, and this asserts the
    // plugin half so the two are not confused for one another.
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
