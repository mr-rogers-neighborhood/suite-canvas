import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BILLING_PATHS,
  listPlans,
  openBillingPortal,
  PLAN_CATALOGUE_PATH,
  readEntitlement,
  readSubscription,
  startCheckout,
} from "./billing";

const BASE = "https://suite.test/api/auth";
const SERVICE = "https://suite.test";

vi.mock("./organization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./organization")>();
  return {
    ...actual,
    ensureOrganization: vi.fn(async () => ({ ok: true as const, organizationId: "org-1" })),
  };
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("plan list", () => {
  it("reads the plans the deployment publishes", async () => {
    const send = vi.fn(async () =>
      json({ plans: [{ name: "team", limits: { seats: 5 } }, "solo"] }),
    );
    const result = await listPlans({ base: BASE, serviceBase: SERVICE, fetch: send });

    expect(result).toEqual({
      ok: true,
      value: [
        { name: "team", limits: { seats: 5 } },
        { name: "solo", limits: {} },
      ],
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls as unknown as [string, RequestInit][])[0]?.[0]).toBe(
      `${SERVICE}${PLAN_CATALOGUE_PATH}`,
    );
  });

  it("is an empty list, not a failure, when the deployment sells nothing", async () => {
    const send = vi.fn(async () => json({}));
    expect(await listPlans({ base: BASE, serviceBase: SERVICE, fetch: send })).toEqual({
      ok: true,
      value: [],
    });
  });

  it("reports a refusal with the server's own code", async () => {
    const send = vi.fn(async () => json({ code: "NOT_CONFIGURED", message: "no keys" }, 400));
    expect(await listPlans({ base: BASE, serviceBase: SERVICE, fetch: send })).toEqual({
      ok: false,
      code: "NOT_CONFIGURED",
      message: "no keys",
    });
  });
});

describe("subscription", () => {
  it("reads the organization's subscription", async () => {
    const send = vi.fn(async () =>
      json([{ plan: "team", status: "active", seats: 4, periodEnd: 1_700 }]),
    );
    expect(await readSubscription("org-1", { base: BASE, fetch: send })).toEqual({
      ok: true,
      value: { plan: "team", status: "active", seats: 4, periodEnd: 1_700 },
    });
    const url = (send.mock.calls as unknown as [string][])[0]?.[0] ?? "";
    expect(url).toContain("referenceId=org-1");
    expect(url).toContain("customerType=organization");
  });

  it("answers null when there is no subscription to read", async () => {
    const send = vi.fn(async () => json([]));
    expect(await readSubscription("org-1", { base: BASE, fetch: send })).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe("checkout and the portal", () => {
  it("asks for an organization checkout, because a subscription belongs to a tenant", async () => {
    const send = vi.fn(async () => json({ url: "https://checkout.stripe.test/session" }));
    const result = await startCheckout({
      plan: "team",
      returnUrl: "https://app.test/?workspace=ws-1",
      seats: 3,
      options: { base: BASE, fetch: send },
    });

    expect(result).toEqual({ ok: true, value: "https://checkout.stripe.test/session" });
    const [url, init] = (send.mock.calls as unknown as [string, RequestInit][])[0] ?? [];
    expect(url).toBe(`https://suite.test/api/auth${BILLING_PATHS.upgrade}`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      plan: "team",
      customerType: "organization",
      referenceId: "org-1",
      seats: 3,
    });
    expect(init?.credentials).toBe("include");
  });

  it("hands the portal the same reference, so Stripe lists the same customer", async () => {
    const send = vi.fn(async () => json({ url: "https://billing.stripe.test/portal" }));
    expect(
      await openBillingPortal({
        returnUrl: "https://app.test/",
        options: { base: BASE, fetch: send },
      }),
    ).toEqual({ ok: true, value: "https://billing.stripe.test/portal" });

    const [url, init] = (send.mock.calls as unknown as [string, RequestInit][])[0] ?? [];
    expect(url).toBe(`https://suite.test/api/auth${BILLING_PATHS.portal}`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      customerType: "organization",
      referenceId: "org-1",
    });
  });

  it("reports an unverified address as the thing to fix, not as a broken button", async () => {
    const send = vi.fn(async () =>
      json({ code: "EMAIL_VERIFICATION_REQUIRED", message: "verify your address first" }, 400),
    );
    expect(
      await startCheckout({ plan: "team", returnUrl: "/", options: { base: BASE, fetch: send } }),
    ).toEqual({
      ok: false,
      code: "EMAIL_VERIFICATION_REQUIRED",
      message: "verify your address first",
    });
  });

  it("says nothing changed when the service cannot be reached", async () => {
    const send = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await openBillingPortal({
      returnUrl: "/",
      options: { base: BASE, fetch: send },
    });
    expect(result).toMatchObject({ ok: false, code: "unreachable" });
    if (!result.ok) expect(result.message).toContain("nothing changed");
  });
});

describe("the entitlement read", () => {
  it("asks the control plane for one organization, and takes its answer", async () => {
    const send = vi.fn(async () =>
      json({ tier: "solo", limits: { workspaces: 3, documentBytes: 268435456 } }),
    );
    const result = await readEntitlement("org-1", { serviceBase: SERVICE, fetch: send });

    expect(result).toEqual({
      ok: true,
      value: { tier: "solo", limits: { workspaces: 3, documentBytes: 268435456 } },
    });
    const [url, init] = (send.mock.calls as unknown as [string, RequestInit][])[0] ?? [];
    expect(url).toBe(`${SERVICE}/api/billing/entitlement`);
    expect(JSON.parse(String(init?.body))).toEqual({ organizationId: "org-1" });
  });

  it("answers free with no limits rather than failing when the plan is unknown", async () => {
    const send = vi.fn(async () => json({ tier: "free", limits: {} }));
    expect(await readEntitlement("org-1", { serviceBase: SERVICE, fetch: send })).toEqual({
      ok: true,
      value: { tier: "free", limits: {} },
    });
  });
});
