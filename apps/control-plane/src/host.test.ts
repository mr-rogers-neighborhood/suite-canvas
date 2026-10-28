import { afterEach, describe, expect, it } from "vitest";
import { type HealthCheck, healthStatus } from "./health.js";
import { type ControlPlane, createControlPlane } from "./host.js";
import { createLogger } from "./logging.js";
import type { ModuleStatus } from "./modules/index.js";
import type { RouteModule } from "./routes.js";

/**
 * The host is exercised over a real socket: routing, the request id and
 * `/health` are all wire behaviour, and a hand-built `IncomingMessage` would
 * only prove the mock.
 */

interface Started {
  url: string;
  plane: ControlPlane;
  lines: string[];
  logs: () => Record<string, unknown>[];
}

const running: ControlPlane[] = [];

async function start(options: {
  modules?: readonly RouteModule[];
  statuses?: readonly ModuleStatus[];
  checks?: () => Promise<readonly HealthCheck[]>;
  buildId?: string;
}): Promise<Started> {
  const lines: string[] = [];
  const plane = createControlPlane({
    modules: options.modules ?? [],
    statuses: options.statuses ?? [],
    ...(options.checks === undefined ? {} : { checks: options.checks }),
    buildId: options.buildId ?? "test-build",
    logger: createLogger({ level: "debug", write: (line) => lines.push(line) }),
  });
  running.push(plane);
  const port = await plane.listen(0);
  return {
    url: `http://127.0.0.1:${port}`,
    plane,
    lines,
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

function jsonModule(name: string, calls: string[]): RouteModule {
  return {
    name,
    handle: (request, response) => {
      calls.push(name);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ module: name, requestId: request.headers["x-request-id"] }));
      return true;
    },
  };
}

function decliningModule(name: string, calls: string[]): RouteModule {
  return {
    name,
    handle: () => {
      calls.push(name);
      return false;
    },
  };
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((plane) => plane.close({ drainMs: 100 })));
});

describe("control plane routing", () => {
  it("should route to the module that handles", async () => {
    const calls: string[] = [];
    const server = await start({ modules: [jsonModule("auth", calls)] });

    const response = await fetch(`${server.url}/api/auth/session`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ module: "auth" });
    expect(calls).toEqual(["auth"]);
  });

  it("should ask the next module when one declines", async () => {
    const calls: string[] = [];
    const server = await start({
      modules: [decliningModule("auth", calls), jsonModule("billing", calls)],
    });

    const response = await fetch(`${server.url}/api/billing/checkout`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ module: "billing" });
    expect(calls).toEqual(["auth", "billing"]);
  });

  it("should answer 404 when no module handles the request", async () => {
    const server = await start({ modules: [decliningModule("auth", [])] });

    const response = await fetch(`${server.url}/nothing/here`);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_found" });
  });

  it("should answer 500 when a module throws", async () => {
    const server = await start({
      modules: [
        {
          name: "billing",
          handle: () => {
            throw new Error("boom");
          },
        },
      ],
    });

    const response = await fetch(`${server.url}/stripe/webhook`, { method: "POST" });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "internal_error" });
    expect(server.logs().some((line) => line.msg === "request failed")).toBe(true);
  });
});

describe("request ids", () => {
  it("should mint an id, echo it and log it", async () => {
    const server = await start({ modules: [jsonModule("auth", [])] });

    const response = await fetch(`${server.url}/api/auth/session`);
    const body = (await response.json()) as { requestId: string };
    const echoed = response.headers.get("x-request-id");

    expect(echoed).toBeTruthy();
    expect(body.requestId).toBe(echoed);
    expect(server.logs()).toContainEqual(
      expect.objectContaining({ msg: "http.request", requestId: echoed, status: 200 }),
    );
  });

  it("should echo an inbound id the module and the log both see", async () => {
    const server = await start({ modules: [jsonModule("auth", [])] });

    const response = await fetch(`${server.url}/api/auth/session`, {
      headers: { "x-request-id": "req-42" },
    });

    expect(response.headers.get("x-request-id")).toBe("req-42");
    expect(await response.json()).toMatchObject({ requestId: "req-42" });
  });

  it("should replace an inbound id that could forge a log line", async () => {
    const server = await start({ modules: [jsonModule("auth", [])] });

    const response = await fetch(`${server.url}/api/auth/session`, {
      headers: { "x-request-id": "id with spaces and <angle>" },
    });
    const echoed = response.headers.get("x-request-id");

    expect(echoed).not.toBe("id with spaces and <angle>");
    expect(echoed).toMatch(/^[A-Za-z0-9._:-]{1,64}$/u);
  });

  it("should echo an id on a 404 too", async () => {
    const server = await start({});

    const response = await fetch(`${server.url}/missing`, { headers: { "x-request-id": "abc" } });

    expect(response.headers.get("x-request-id")).toBe("abc");
    expect(await response.json()).toMatchObject({ error: "not_found", requestId: "abc" });
  });
});

describe("control plane health", () => {
  it("should report the build id and one entry per module", async () => {
    const server = await start({
      buildId: "1.2.3",
      modules: [jsonModule("auth", [])],
      statuses: [
        { name: "auth", state: "mounted" },
        { name: "billing", state: "absent" },
      ],
    });

    const response = await fetch(`${server.url}/health`);
    const body = (await response.json()) as {
      status: string;
      buildId: string;
      uptimeMs: number;
      modules: ModuleStatus[];
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.buildId).toBe("1.2.3");
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(body.modules).toEqual([
      { name: "auth", state: "mounted" },
      { name: "billing", state: "absent" },
    ]);
  });

  it("should answer 503 and say degraded when a module failed", async () => {
    const server = await start({
      statuses: [
        { name: "auth", state: "absent" },
        { name: "billing", state: "failed", detail: "boom" },
      ],
    });

    const response = await fetch(`${server.url}/health`);
    const body = (await response.json()) as { status: string; modules: ModuleStatus[] };

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(
      healthStatus({ status: "ok", buildId: "x", uptimeMs: 0, modules: body.modules, checks: [] }),
    ).toBe(200);
  });

  it("should answer 503 when a dependency check fails", async () => {
    const server = await start({
      statuses: [{ name: "auth", state: "mounted" }],
      checks: async () => [{ name: "database", state: "failed", detail: "connect ECONNREFUSED" }],
    });

    const response = await fetch(`${server.url}/health`);
    const body = (await response.json()) as { status: string; checks: HealthCheck[] };

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks).toEqual([
      { name: "database", state: "failed", detail: "connect ECONNREFUSED" },
    ]);
  });

  it("should refuse every method but GET", async () => {
    const server = await start({});

    const post = await fetch(`${server.url}/health`, { method: "POST" });
    const head = await fetch(`${server.url}/health`, { method: "DELETE" });

    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
    expect(await post.json()).toMatchObject({ error: "method_not_allowed" });
    expect(head.status).toBe(405);
  });

  it("should serve /health before asking a module, even a greedy one", async () => {
    const calls: string[] = [];
    const server = await start({
      modules: [
        {
          name: "greedy",
          handle: (request, response) => {
            calls.push(request.url ?? "");
            response.writeHead(200);
            response.end("module");
            return true;
          },
        },
      ],
    });

    const response = await fetch(`${server.url}/health`);

    expect(response.status).toBe(200);
    expect(calls).toEqual([]);
  });
});
