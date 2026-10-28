import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AdminModuleOptions, createAdminModule } from "./admin.js";
import { publishSessionReader, resetSessionReader } from "./context.js";

/**
 * The operator's people list, and the one thing it may change.
 *
 * Two facts carry the surface: the panel can see who exists and whether support access is
 * live, and an operator can only *end* that access. Granting it is the account's own act,
 * so a request that tries to grant is refused rather than quietly ignored.
 */
function silence() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
}

function request(
  method: string,
  url: string,
  body: string | null = null,
  headers: Record<string, string> = {},
): IncomingMessage {
  const stream = {
    method,
    url,
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
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      out.status = status;
      for (const [name, value] of Object.entries(headers ?? {})) {
        out.headers[name.toLowerCase()] = value;
      }
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
const authorized = { cookie: "session=operator" };

beforeEach(() =>
  publishSessionReader(async (headers) =>
    headers.cookie === authorized.cookie
      ? { userId: "user-1", organizationId: null, role: null, admittedAt: 1, operator: true }
      : null,
  ),
);
afterEach(() => resetSessionReader());

function moduleWith(rows: unknown[] = []) {
  const sql = query(rows);
  const module = createAdminModule({
    env: {
      SUITE_ADMIN_EMAILS: OPERATOR,
      SUITE_CONTROL_PLANE_DATABASE_URL: "postgres://localhost/suite",
    } as AdminModuleOptions["env"],
    logger: silence(),
    pool: sql.run as unknown as AdminModuleOptions["pool"],
  });
  return { module, sql };
}

const account = {
  id: "user-9",
  email: "person@example.com",
  name: "A Person",
  role: "member",
  createdAt: "2026-01-02T03:04:05.000Z",
  twoFactorEnabled: true,
  granted_at: 1_700_000_000_000,
  revoked_at: null,
};

describe("the people list", () => {
  it("carries each account's grant state", async () => {
    const { module } = moduleWith([account]);
    const { out, res } = response();

    await module.handle(request("GET", "/admin/accounts", null, authorized), res);

    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).accounts).toEqual([
      {
        id: "user-9",
        email: "person@example.com",
        name: "A Person",
        role: "member",
        createdAt: "2026-01-02T03:04:05.000Z",
        twoFactorEnabled: true,
        supportAccess: { granted: true, grantedAt: 1_700_000_000_000, revokedAt: null },
      },
    ]);
  });

  it("passes the search term to the query", async () => {
    const { module, sql } = moduleWith([account]);
    const { res } = response();

    await module.handle(request("GET", "/admin/accounts?q=person", null, authorized), res);

    // The last statement is the read; the one before it is the table guard.
    expect(sql.calls.at(-1)?.values).toEqual(["person"]);
  });

  it("is an operator's door", async () => {
    const { module } = moduleWith([account]);
    const { out, res } = response();

    await module.handle(request("GET", "/admin/accounts"), res);

    expect(out.status).toBe(401);
  });
});

describe("ending support access", () => {
  it("revokes the grant", async () => {
    const { module, sql } = moduleWith([]);
    const { out, res } = response();

    await module.handle(
      request("PUT", "/admin/accounts/user-9/support-access", "{}", authorized),
      res,
    );

    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toMatchObject({ ok: true, granted: false });
    expect(sql.calls.at(-1)?.text).toContain("SET revoked_at");
    expect(sql.calls.at(-1)?.values?.[0]).toBe("user-9");
  });

  it("refuses to grant, because consent is the account's", async () => {
    const { module, sql } = moduleWith([]);
    const { out, res } = response();

    await module.handle(
      request("PUT", "/admin/accounts/user-9/support-access", '{"granted":true}', authorized),
      res,
    );

    expect(out.status).toBe(403);
    expect(JSON.parse(out.body)).toMatchObject({ error: "consent-is-the-accounts" });
    expect(sql.calls.some((call) => call.text.includes("SET revoked_at"))).toBe(false);
  });

  it("does not read a path it does not own", async () => {
    const { module } = moduleWith([]);
    const { out, res } = response();

    const handled = await module.handle(
      request("PUT", "/admin/accounts/user-9/notes", "{}", authorized),
      res,
    );

    expect(handled).toBe(false);
    expect(out.status).toBe(0);
  });
});

describe("the mail test", () => {
  const post = (body: unknown) =>
    request("POST", "/admin/mail/test", JSON.stringify(body), authorized);

  it("refuses an address that is not one", async () => {
    const { module } = moduleWith([]);
    const { out, res } = response();

    await module.handle(post({ to: "not-an-address" }), res);

    expect(out.status).toBe(400);
  });

  it("is an operator's door", async () => {
    const { module } = moduleWith([]);
    const { out, res } = response();

    await module.handle(request("POST", "/admin/mail/test", '{"to":"a@b.co"}'), res);

    expect(out.status).toBe(401);
  });

  it("hands the message to the console transport when that is what is configured", async () => {
    // The default mail transport is `console`, so this proves the route reaches a
    // transport and says which one carried the message, without a network.
    const { module } = moduleWith([]);
    const { out, res } = response();

    await module.handle(post({ to: "operator@suite.run" }), res);

    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true, transport: "console" });
  });

  it("reports a transport that is configured but unusable", async () => {
    const sql = query([]);
    const module = createAdminModule({
      env: {
        SUITE_ADMIN_EMAILS: OPERATOR,
        SUITE_CONTROL_PLANE_DATABASE_URL: "postgres://localhost/suite",
        SUITE_MAIL_TRANSPORT: "smtp",
        // No SUITE_SMTP_URL: the transport refuses to build, and the panel has to say so
        // rather than claim the message went out.
      } as AdminModuleOptions["env"],
      logger: silence(),
      pool: sql.run as unknown as AdminModuleOptions["pool"],
    });
    const { out, res } = response();

    await module.handle(post({ to: "operator@suite.run" }), res);

    expect(out.status).toBe(502);
    expect(JSON.parse(out.body).message).toContain("SUITE_MAIL_TRANSPORT=smtp needs");
  });
});
