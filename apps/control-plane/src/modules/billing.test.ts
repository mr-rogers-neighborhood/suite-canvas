import { BillingError, type OrganizationEntitlements, parseTierTable } from "@suite/billing";
import { afterEach, describe, expect, it } from "vitest";
import { type ControlPlane, createControlPlane } from "../host.js";
import { createLogger } from "../logging.js";
import type { RouteModule } from "../routes.js";
import { type BillingModuleDeps, createBillingModule } from "./billing.js";

/**
 * The billing routes over a real socket: the paths, the statuses and the one read they
 * serve are wire behaviour, and the plugin's own routes are asserted by what this module
 * refuses.
 */

const running: ControlPlane[] = [];

function tiers() {
  const parsed = parseTierTable(
    JSON.stringify({
      price_solo: { tier: "solo", workspaces: 3, documentBytes: 1_000, attachmentBytes: 2_000 },
    }),
  );
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

const ENTITLEMENT: OrganizationEntitlements = {
  forOrganization: async (organizationId) =>
    organizationId === "org_1"
      ? { tier: "solo", limits: { workspaces: 3, documentBytes: 1_000, attachmentBytes: 2_000 } }
      : { tier: "free", limits: {} },
};

async function start(options: {
  resolve?: () => Promise<BillingModuleDeps>;
  next?: RouteModule;
}): Promise<string> {
  const billing = createBillingModule({
    resolve:
      options.resolve ??
      (async () => ({ entitlements: ENTITLEMENT, tiers: tiers(), mode: "test" as const })),
    logger: createLogger({ level: "error", write: () => undefined }),
  });
  const plane = createControlPlane({
    modules: options.next === undefined ? [billing] : [billing, options.next],
    statuses: [],
    buildId: "test-build",
    logger: createLogger({ level: "error", write: () => undefined }),
  });
  running.push(plane);
  const port = await plane.listen(0);
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((plane) => plane.close({ drainMs: 100 })));
});

function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("billing module", () => {
  it("should answer the entitlement read for an organization", async () => {
    const url = await start({});

    const response = await post(`${url}/api/billing/entitlement`, { organizationId: "org_1" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tier: "solo",
      limits: { workspaces: 3, documentBytes: 1_000, attachmentBytes: 2_000 },
    });
  });

  it("should answer free for an organization with no subscription", async () => {
    const url = await start({});

    const response = await post(`${url}/api/billing/entitlement`, { organizationId: "org_2" });

    expect(await response.json()).toEqual({ tier: "free", limits: {} });
  });

  it("should refuse a body with no organization id", async () => {
    const url = await start({});

    const response = await post(`${url}/api/billing/entitlement`, { organization: "org_1" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid-request" });
  });

  it("should publish the plan catalogue", async () => {
    const url = await start({});

    const response = await post(`${url}/api/billing/plans`);

    // This body is the contract `apps/canvas/src/auth/billing.test.ts` reads. The two
    // drifted once, and the panel showed an empty catalogue on a deployment selling two.
    expect(await response.json()).toEqual({
      mode: "test",
      plans: [
        {
          tier: "solo",
          priceId: "price_solo",
          limits: { workspaces: 3, documentBytes: 1_000, attachmentBytes: 2_000 },
        },
      ],
    });
  });

  it("should allow only POST on the two paths", async () => {
    const url = await start({});

    const response = await fetch(`${url}/api/billing/entitlement`);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("should answer 404 for a path under its prefix it does not serve", async () => {
    const url = await start({});

    const response = await post(`${url}/api/billing/checkout`, {});

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_found" });
  });

  it("should leave /api/auth/* to the auth module", async () => {
    const seen: string[] = [];
    const auth: RouteModule = {
      name: "auth",
      handle: (request, response) => {
        seen.push(request.url ?? "");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ module: "auth" }));
        return true;
      },
    };
    const url = await start({ next: auth });

    const webhook = await post(`${url}/api/auth/stripe/webhook`);
    const session = await fetch(`${url}/api/auth/get-session`);

    expect(await webhook.json()).toEqual({ module: "auth" });
    expect(await session.json()).toEqual({ module: "auth" });
    expect(seen).toEqual(["/api/auth/stripe/webhook", "/api/auth/get-session"]);
  });

  it("should answer 503 when it has no configuration", async () => {
    const url = await start({
      resolve: async () => {
        throw new BillingError("not-configured", "SUITE_CONTROL_PLANE_DATABASE_URL is not set");
      },
    });

    const first = await post(`${url}/api/billing/entitlement`, { organizationId: "org_1" });
    const second = await post(`${url}/api/billing/plans`);

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(await first.json()).toMatchObject({ error: "not-configured" });
  });

  it("should answer 500 for a fault it cannot explain", async () => {
    const url = await start({
      resolve: async () => {
        throw new Error("the pool refused");
      },
    });

    const response = await post(`${url}/api/billing/entitlement`, { organizationId: "org_1" });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "unexpected" });
  });
});
