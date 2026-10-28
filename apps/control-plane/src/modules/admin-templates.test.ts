import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AdminModuleOptions, createAdminModule } from "./admin.js";
import { publishSessionReader, resetSessionReader } from "./context.js";

/**
 * The template routes.
 *
 * Two properties carry the feature: the launcher can read the list before anybody
 * signs in, and nobody can write one unless the deployment named them an operator.
 * The rest is CRUD against a stubbed pool — the statements themselves are the
 * migration's business, and these tests only assert which one ran and with what.
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

function failing(error: unknown) {
  const calls: { text: string }[] = [];
  return {
    calls,
    run: {
      query: async (text: string) => {
        calls.push({ text });
        throw error;
      },
    },
  };
}

const OPERATOR = "operator@suite.run";
/** The cookie stands in for the session Better Auth would resolve. */
const authorized = { cookie: "session=operator" };
const template = {
  id: "weekly-review",
  name: "Weekly review",
  description: "Three prompts and a place to answer them",
  version: 1,
  data: { boards: [], cards: [] },
};

/** A session reader that treats the operator cookie as the operator, and nobody else. */
function operatorSession() {
  publishSessionReader(async (headers) =>
    headers.cookie === authorized.cookie
      ? { userId: "user-1", organizationId: null, role: null, admittedAt: 1, operator: true }
      : null,
  );
}

beforeEach(() => operatorSession());
afterEach(() => resetSessionReader());

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

describe("the public template list", () => {
  it("answers before anybody signs in, and says a minute of caching is fine", async () => {
    const { module } = moduleWith({ rows: [template] });
    const { out, res } = response();
    await module.handle(request("GET", "/api/templates"), res);
    expect(out.status).toBe(200);
    expect(out.headers["cache-control"]).toBe("public, max-age=60");
    expect(JSON.parse(out.body)).toEqual({ ok: true, templates: [template] });
  });

  it("lists by name", async () => {
    const { module, sql } = moduleWith({ rows: [template] });
    const { res } = response();
    await module.handle(request("GET", "/api/templates"), res);
    expect(sql.calls[0]?.text).toContain("ORDER BY name");
  });

  it("is a read only door", async () => {
    const { module, sql } = moduleWith();
    const { out, res } = response();
    await module.handle(request("POST", "/api/templates", "{}"), res);
    expect(out.status).toBe(405);
    expect(out.headers.allow).toBe("GET");
    expect(sql.calls).toHaveLength(0);
  });

  it("does not answer a path one segment deeper", async () => {
    const { module } = moduleWith();
    const { res } = response();
    const handled = await module.handle(request("GET", "/api/templates/one"), res);
    expect(handled).toBe(false);
  });

  it("names the migration when the table is not there", async () => {
    const sql = failing(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    const module = createAdminModule({
      env: { SUITE_CONTROL_PLANE_DATABASE_URL: "postgres://localhost/suite" } as never,
      logger: silence(),
      pool: sql.run as unknown as AdminModuleOptions["pool"],
    });
    const { out, res } = response();
    await module.handle(request("GET", "/api/templates"), res);
    expect(out.status).toBe(503);
    expect(JSON.parse(out.body)).toMatchObject({ ok: false, error: "templates-missing" });
    expect(JSON.parse(out.body).message).toContain("0010_templates.sql");
  });

  it("is not configured when the database URL is missing", async () => {
    const { module } = moduleWith({ env: { SUITE_CONTROL_PLANE_DATABASE_URL: "" } as never });
    const { out, res } = response();
    await module.handle(request("GET", "/api/templates"), res);
    expect(out.status).toBe(503);
  });
});

describe("the operator template list", () => {
  it("refuses without a token", async () => {
    const { module, sql } = moduleWith();
    const { out, res } = response();
    await module.handle(request("GET", "/admin/templates"), res);
    expect(out.status).toBe(401);
    expect(out.headers["www-authenticate"]).toBe("Session");
    expect(sql.calls).toHaveLength(0);
  });

  it("refuses a token that is not the token", async () => {
    const { module, sql } = moduleWith();
    const { out, res } = response();
    await module.handle(
      request("GET", "/admin/templates", null, { authorization: "Bearer not-the-token" }),
      res,
    );
    expect(out.status).toBe(401);
    expect(sql.calls).toHaveLength(0);
  });

  it("lists the same rows, uncached", async () => {
    const { module } = moduleWith({ rows: [template] });
    const { out, res } = response();
    await module.handle(request("GET", "/admin/templates", null, authorized), res);
    expect(out.status).toBe(200);
    expect(out.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(out.body)).toEqual({ ok: true, templates: [template] });
  });

  it("is not a door at all when the deployment names no operator", async () => {
    const { module } = moduleWith({ env: { SUITE_ADMIN_EMAILS: "" } as never });
    const { out, res } = response();
    await module.handle(request("GET", "/admin/templates", null, authorized), res);
    expect(out.status).toBe(503);
  });
});

describe("writing a template", () => {
  it("creates one and answers with what the database stored", async () => {
    const { module, sql } = moduleWith({ rows: [template] });
    const { out, res } = response();
    await module.handle(
      request(
        "POST",
        "/admin/templates",
        JSON.stringify({
          id: "weekly-review",
          name: "Weekly review",
          description: "Three prompts and a place to answer them",
          data: { boards: [], cards: [] },
        }),
        authorized,
      ),
      res,
    );
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true, template });
    expect(sql.calls[0]?.text).toContain("INSERT INTO templates");
    // The data travels as JSON text and is cast in the statement, and an omitted version
    // is null so the statement's COALESCE picks the default.
    expect(sql.calls[0]?.values).toEqual([
      "weekly-review",
      "Weekly review",
      "Three prompts and a place to answer them",
      null,
      JSON.stringify({ boards: [], cards: [] }),
    ]);
  });

  it("keeps a version it was given", async () => {
    const { module, sql } = moduleWith({ rows: [template] });
    const { res } = response();
    await module.handle(
      request(
        "POST",
        "/admin/templates",
        JSON.stringify({ id: "a", name: "A", data: {}, version: 7 }),
        authorized,
      ),
      res,
    );
    expect(sql.calls[0]?.values?.[3]).toBe(7);
  });

  it("says the id is taken rather than throwing", async () => {
    const { module } = moduleWith({ rows: [] });
    const { out, res } = response();
    await module.handle(
      request(
        "POST",
        "/admin/templates",
        JSON.stringify({ id: "a", name: "A", data: {} }),
        authorized,
      ),
      res,
    );
    expect(out.status).toBe(409);
    expect(JSON.parse(out.body)).toMatchObject({ ok: false, error: "template-exists" });
  });

  it("refuses a body that names no id", async () => {
    const { module, sql } = moduleWith({ rows: [template] });
    const { out, res } = response();
    await module.handle(
      request("POST", "/admin/templates", JSON.stringify({ name: "A", data: {} }), authorized),
      res,
    );
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body)).toMatchObject({ ok: false, error: "invalid-request" });
    expect(sql.calls).toHaveLength(0);
  });

  it("refuses a body whose data is not an object", async () => {
    const { module, sql } = moduleWith({ rows: [template] });
    const { out, res } = response();
    await module.handle(
      request(
        "POST",
        "/admin/templates",
        JSON.stringify({ id: "a", name: "A", data: [1, 2] }),
        authorized,
      ),
      res,
    );
    expect(out.status).toBe(400);
    expect(sql.calls).toHaveLength(0);
  });

  it("refuses a version that is not a whole number of one or more", async () => {
    const { module } = moduleWith({ rows: [template] });
    const { out, res } = response();
    await module.handle(
      request(
        "POST",
        "/admin/templates",
        JSON.stringify({ id: "a", name: "A", data: {}, version: 0 }),
        authorized,
      ),
      res,
    );
    expect(out.status).toBe(400);
  });

  it("refuses an empty name", async () => {
    const { module } = moduleWith({ rows: [template] });
    const { out, res } = response();
    await module.handle(
      request(
        "POST",
        "/admin/templates",
        JSON.stringify({ id: "a", name: "  ", data: {} }),
        authorized,
      ),
      res,
    );
    expect(out.status).toBe(400);
  });

  it("replaces one and answers with the stored row", async () => {
    const { module, sql } = moduleWith({ rows: [{ ...template, name: "Weekly review v2" }] });
    const { out, res } = response();
    await module.handle(
      request(
        "PUT",
        "/admin/templates/weekly-review",
        JSON.stringify({ name: "Weekly review v2", data: { boards: [] }, version: 2 }),
        authorized,
      ),
      res,
    );
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).template.name).toBe("Weekly review v2");
    expect(sql.calls[0]?.text).toContain("updated_at = now()");
    expect(sql.calls[0]?.values?.[0]).toBe("weekly-review");
  });

  it("says a replace found nothing", async () => {
    const { module } = moduleWith({ rows: [] });
    const { out, res } = response();
    await module.handle(
      request(
        "PUT",
        "/admin/templates/absent",
        JSON.stringify({ name: "A", data: {} }),
        authorized,
      ),
      res,
    );
    expect(out.status).toBe(404);
    expect(JSON.parse(out.body)).toMatchObject({ ok: false, error: "template-not-found" });
  });

  it("refuses a body whose id contradicts the path", async () => {
    const { module, sql } = moduleWith({ rows: [template] });
    const { out, res } = response();
    await module.handle(
      request(
        "PUT",
        "/admin/templates/weekly-review",
        JSON.stringify({ id: "other", name: "A", data: {} }),
        authorized,
      ),
      res,
    );
    expect(out.status).toBe(400);
    expect(sql.calls).toHaveLength(0);
  });

  it("deletes one", async () => {
    const { module, sql } = moduleWith({ rows: [{ id: "weekly-review" }] });
    const { out, res } = response();
    await module.handle(request("DELETE", "/admin/templates/weekly-review", null, authorized), res);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true, deleted: true });
    expect(sql.calls[0]?.values).toEqual(["weekly-review"]);
  });

  it("says a delete found nothing", async () => {
    const { module } = moduleWith({ rows: [] });
    const { out, res } = response();
    await module.handle(request("DELETE", "/admin/templates/absent", null, authorized), res);
    expect(out.status).toBe(404);
  });

  it("does not answer a method the collection has no route for", async () => {
    const { module, sql } = moduleWith();
    const { out, res } = response();
    await module.handle(request("DELETE", "/admin/templates", null, authorized), res);
    expect(out.status).toBe(405);
    expect(out.headers.allow).toBe("GET, POST");
    expect(sql.calls).toHaveLength(0);
  });

  it("does not answer a method one template has no route for", async () => {
    const { module } = moduleWith();
    const { out, res } = response();
    await module.handle(request("POST", "/admin/templates/one", "{}", authorized), res);
    expect(out.status).toBe(405);
    expect(out.headers.allow).toBe("PUT, DELETE");
  });

  it("names the migration when a write meets a missing table", async () => {
    const sql = failing(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    const module = createAdminModule({
      env: {
        SUITE_ADMIN_EMAILS: OPERATOR,
        SUITE_CONTROL_PLANE_DATABASE_URL: "postgres://localhost/suite",
      } as never,
      logger: silence(),
      pool: sql.run as unknown as AdminModuleOptions["pool"],
    });
    const { out, res } = response();
    await module.handle(
      request(
        "POST",
        "/admin/templates",
        JSON.stringify({ id: "a", name: "A", data: {} }),
        authorized,
      ),
      res,
    );
    expect(out.status).toBe(503);
    expect(JSON.parse(out.body).message).toContain("0010_templates.sql");
  });

  it("leaves other paths to the next module", async () => {
    const { module } = moduleWith();
    const { res } = response();
    expect(await module.handle(request("GET", "/admin/other", null, authorized), res)).toBe(false);
  });
});
