import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { type AdminModuleOptions, createAdminModule } from "./admin.js";
import { publishSessionReader, resetSessionReader } from "./context.js";

/**
 * The operator door.
 *
 * What matters is who gets through it: a signed-in account this deployment named as
 * an operator, and nobody else — not an anonymous caller, not a signed-in account that
 * is not on the list, and not an organization owner, whose role is a tenant fact rather
 * than a platform one. Admitting someone is one write followed by one notice, because
 * the queue is the only thing that turns a held account into a working one.
 */
function silence() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
}

function request(
  method: string,
  body: string | null,
  headers: Record<string, string> = {},
): IncomingMessage {
  const stream = {
    method,
    url: "/admin/admissions",
    headers: { "x-request-id": "req-1", ...headers },
    async *[Symbol.asyncIterator]() {
      if (body !== null) yield Buffer.from(body, "utf8");
    },
  };
  return stream as unknown as IncomingMessage;
}

function response() {
  const out = { status: 0, body: "", headers: {} as Record<string, unknown> };
  const res = {
    statusCode: 200,
    setHeader: (name: string, value: unknown) => {
      out.headers[name.toLowerCase()] = value;
    },
    writeHead: (status: number) => {
      out.status = status;
      return res;
    },
    write: (chunk: string) => {
      out.body += chunk;
      return true;
    },
    end: (chunk?: string) => {
      if (chunk !== undefined) out.body += chunk;
    },
  };
  return { out, res: res as unknown as ServerResponse };
}

function query(rows: unknown[] = []) {
  const calls: { text: string; values: unknown[] | undefined }[] = [];
  return {
    calls,
    run: {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows };
      },
    },
  };
}

const OPERATOR = "operator@suite.run";

/** The cookie the fake session reader treats as a signed-in operator. */
const OPERATOR_COOKIE = "session=operator";

/**
 * Publishes a session reader, which is what the auth module does at boot.
 *
 * The module under test is the admin one; the reader stands in for Better Auth so the
 * test can ask the one question the gate asks — is this session an operator — without
 * a database.
 */
function signedIn(
  sessions: Record<string, { operator: boolean }> = {
    [OPERATOR_COOKIE]: { operator: true },
  },
) {
  publishSessionReader(async (headers) => {
    const found = sessions[headers.cookie ?? ""];
    if (found === undefined) return null;
    return {
      userId: "user-1",
      organizationId: null,
      role: null,
      admittedAt: 1,
      operator: found.operator,
    };
  });
}

function moduleWith(options: Partial<AdminModuleOptions> & { rows?: unknown[] } = {}) {
  const sql = query(options.rows ?? []);
  const module = createAdminModule({
    env: {
      SUITE_ADMIN_EMAILS: OPERATOR,
      SUITE_CONTROL_PLANE_DATABASE_URL: "postgres://localhost/suite",
      ...options.env,
    } as AdminModuleOptions["env"],
    logger: silence(),
    pool: sql.run as unknown as AdminModuleOptions["pool"],
  });
  return { module, sql };
}

afterEach(() => resetSessionReader());

describe("the operator admission queue", () => {
  it("answers only its own path", async () => {
    const { module } = moduleWith();
    const { res } = response();
    const handled = await module.handle(
      { method: "GET", url: "/health", headers: {} } as IncomingMessage,
      res,
    );
    expect(handled).toBe(false);
  });

  it("refuses a caller with no session", async () => {
    signedIn();
    const { module } = moduleWith();
    const { out, res } = response();
    await module.handle(request("GET", null), res);
    expect(out.status).toBe(401);
    expect(out.headers["www-authenticate"]).toBe("Session");
    expect(JSON.parse(out.body).error).toBe("unauthorized");
  });

  it("refuses a signed-in account that is not an operator", async () => {
    // The distinction that matters: being signed in is not being an operator, and an
    // account with its own organization is not one either.
    signedIn({ "session=member": { operator: false } });
    const { module, sql } = moduleWith();
    const { out, res } = response();
    await module.handle(request("GET", null, { cookie: "session=member" }), res);
    expect(out.status).toBe(403);
    expect(JSON.parse(out.body).error).toBe("forbidden");
    expect(sql.calls).toHaveLength(0);
  });

  it("lists the accounts still waiting", async () => {
    signedIn();
    const { module } = moduleWith({
      rows: [{ email: "held@example.com", name: "Held", createdAt: 1 }],
    });
    const { out, res } = response();
    await module.handle(request("GET", null, { cookie: OPERATOR_COOKIE }), res);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toMatchObject({
      ok: true,
      pending: [{ email: "held@example.com" }],
    });
  });

  it("admits the addresses it was given, in one write", async () => {
    signedIn();
    const { module, sql } = moduleWith({ rows: [{ email: "held@example.com" }] });
    const { out, res } = response();
    await module.handle(
      request("POST", JSON.stringify({ emails: ["Held@Example.com"] }), {
        cookie: OPERATOR_COOKIE,
        "content-type": "application/json",
      }),
      res,
    );
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true, admitted: ["held@example.com"] });
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]?.values?.[1]).toEqual(["held@example.com"]);
  });

  it("refuses a body with no addresses", async () => {
    signedIn();
    const { module, sql } = moduleWith();
    const { out, res } = response();
    await module.handle(
      request("POST", JSON.stringify({ emails: [] }), { cookie: OPERATOR_COOKIE }),
      res,
    );
    expect(out.status).toBe(400);
    expect(sql.calls).toHaveLength(0);
  });

  it("is not a door at all when the deployment names no operator", async () => {
    signedIn();
    const { module } = moduleWith({ env: { SUITE_ADMIN_EMAILS: "" } as never });
    const { out, res } = response();
    await module.handle(request("GET", null, { cookie: OPERATOR_COOKIE }), res);
    expect(out.status).toBe(503);
    expect(JSON.parse(out.body).error).toBe("admin-not-configured");
  });

  it("is not a door either when no account module is running here", async () => {
    // A control plane with identity switched off cannot tell who is calling, and a
    // guess in that position is the failure this gate exists to avoid.
    resetSessionReader();
    const { module } = moduleWith();
    const { out, res } = response();
    await module.handle(request("GET", null, { cookie: OPERATOR_COOKIE }), res);
    expect(out.status).toBe(503);
    expect(JSON.parse(out.body).error).toBe("auth-not-configured");
  });
});
