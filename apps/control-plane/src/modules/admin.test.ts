import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { type AdminModuleOptions, createAdminModule } from "./admin.js";

/**
 * The operator door.
 *
 * What matters is that it cannot be used without the token, and that admitting
 * someone is one write followed by one notice — the queue is the only thing that
 * turns a held account into a working one.
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

const token = "operator-token-long-enough";

function moduleWith(options: Partial<AdminModuleOptions> & { rows?: unknown[] } = {}) {
  const sql = query(options.rows ?? []);
  const module = createAdminModule({
    env: {
      SUITE_ADMIN_TOKEN: token,
      SUITE_CONTROL_PLANE_DATABASE_URL: "postgres://localhost/suite",
      ...options.env,
    } as AdminModuleOptions["env"],
    logger: silence(),
    pool: sql.run as unknown as AdminModuleOptions["pool"],
  });
  return { module, sql };
}

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

  it("refuses without a token", async () => {
    const { module } = moduleWith();
    const { out, res } = response();
    await module.handle(request("GET", null), res);
    expect(out.status).toBe(401);
    expect(out.headers["www-authenticate"]).toBe("Bearer");
  });

  it("refuses a token that is not the token", async () => {
    const { module, sql } = moduleWith();
    const { out, res } = response();
    await module.handle(request("GET", null, { authorization: "Bearer guess" }), res);
    expect(out.status).toBe(401);
    expect(sql.calls).toHaveLength(0);
  });

  it("lists the accounts still waiting", async () => {
    const { module } = moduleWith({
      rows: [{ email: "held@example.com", name: "Held", createdAt: 1 }],
    });
    const { out, res } = response();
    await module.handle(request("GET", null, { authorization: `Bearer ${token}` }), res);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toMatchObject({
      ok: true,
      pending: [{ email: "held@example.com" }],
    });
  });

  it("admits the addresses it was given, in one write", async () => {
    const { module, sql } = moduleWith({ rows: [{ email: "held@example.com" }] });
    const { out, res } = response();
    await module.handle(
      request("POST", JSON.stringify({ emails: ["Held@Example.com"] }), {
        authorization: `Bearer ${token}`,
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
    const { module, sql } = moduleWith();
    const { out, res } = response();
    await module.handle(
      request("POST", JSON.stringify({ emails: [] }), { authorization: `Bearer ${token}` }),
      res,
    );
    expect(out.status).toBe(400);
    expect(sql.calls).toHaveLength(0);
  });

  it("is not a door at all when no token is configured", async () => {
    const { module } = moduleWith({ env: { SUITE_ADMIN_TOKEN: "" } as never });
    const { out, res } = response();
    await module.handle(request("GET", null, { authorization: "Bearer anything" }), res);
    expect(out.status).toBe(503);
  });
});
