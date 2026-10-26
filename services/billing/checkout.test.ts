import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BillingRoute,
  CHECKOUT_PATH,
  createCheckoutRoute,
  createPortalRoute,
  type FrontDoorEnvironment,
  NON_DURABLE_STORE,
  resetFrontDoorWarnings,
  stripeMode,
} from "./checkout.ts";
import type { LambdaHttpEvent, LambdaHttpResponse } from "./handler.ts";
import type { Logger } from "./log.ts";
import {
  APP_ORIGIN,
  CHECKOUT_URL,
  CUSTOMER_ID,
  fakeStripe,
  ORGANIZATION_ID,
  PORTAL_URL,
  PRICE_SOLO,
  PRICE_STUDIO,
  STRIPE_TEST_KEY,
  TIERS_JSON,
  WORKSPACE_ID,
} from "./testing.ts";

/**
 * The front door against a fake Stripe.
 *
 * What is worth pinning here is the wire format — `mode=subscription`,
 * `line_items[0][price]`, `client_reference_id`, `metadata[...]` — because a
 * field name that is merely wrong is accepted by nothing and diagnosed by
 * nobody: the checkout page simply refuses the session. The rest is the
 * refusal order: the switch before the key, the tier before the key, and the
 * durable-store warning on the answer.
 */

function envOf(overrides: Partial<FrontDoorEnvironment> = {}): FrontDoorEnvironment {
  return {
    SUITE_BILLING_ENABLED: "1",
    // Durable by default so the warning does not decorate every other test;
    // the tests that are about the warning take the in-process store on purpose.
    SUITE_BILLING_STORE: "postgres",
    STRIPE_PRICE_TIERS: TIERS_JSON,
    STRIPE_SECRET_KEY: STRIPE_TEST_KEY,
    SUITE_APP_ORIGIN: APP_ORIGIN,
    ...overrides,
  };
}

interface Harness {
  route: BillingRoute;
  calls: ReturnType<typeof fakeStripe>["calls"];
  lines: string[];
}

function harness(
  options: {
    route?: "checkout" | "portal";
    env?: Partial<FrontDoorEnvironment>;
    stripe?: ReturnType<typeof fakeStripe>;
  } = {},
): Harness {
  const stripe = options.stripe ?? fakeStripe();
  const lines: string[] = [];
  const log: Logger = (level, message, fields) => {
    lines.push(JSON.stringify({ level, message, ...fields }));
  };
  const deps = { env: envOf(options.env), fetch: stripe.fetch, log };
  return {
    route: options.route === "portal" ? createPortalRoute(deps) : createCheckoutRoute(deps),
    calls: stripe.calls,
    lines,
  };
}

function post(body: unknown, path = CHECKOUT_PATH): LambdaHttpEvent {
  return {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    rawPath: path,
  };
}

function bodyOf(response: LambdaHttpResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

const CHECKOUT_BODY = { organizationId: ORGANIZATION_ID, workspaceId: WORKSPACE_ID, tier: "solo" };

describe("checkout route", () => {
  it("answers a Stripe checkout url and sends the form Stripe expects", async () => {
    const { route, calls } = harness();
    const response = await route(post(CHECKOUT_BODY));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(bodyOf(response), {
      ok: true,
      url: CHECKOUT_URL,
      mode: "test",
    });

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call !== undefined);
    assert.equal(call.url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(call.method, "POST");
    assert.equal(call.headers.authorization, `Bearer ${STRIPE_TEST_KEY}`);
    assert.equal(call.headers["content-type"], "application/x-www-form-urlencoded");

    // Read as Stripe reads it, so the order of the fields is not the assertion.
    assert.equal(call.form.get("mode"), "subscription");
    assert.equal(call.form.get("line_items[0][price]"), PRICE_SOLO);
    assert.equal(call.form.get("line_items[0][quantity]"), "1");
    // The payer is the organization: it holds the members, the seats and the
    // licence, and it may hold many workspaces (ADR-0065).
    assert.equal(call.form.get("client_reference_id"), ORGANIZATION_ID);
    assert.equal(call.form.get("metadata[organizationId]"), ORGANIZATION_ID);
    assert.equal(call.form.get("metadata[workspaceId]"), WORKSPACE_ID);
    assert.equal(call.form.get("metadata[tier]"), "solo");
    // The webhook may only see metadata: a session does not expand line items
    // unless the endpoint asks, so the price has to ride along.
    assert.equal(call.form.get("metadata[price_id]"), PRICE_SOLO);
    assert.equal(
      call.form.get("success_url"),
      `${APP_ORIGIN}/?billing=success&organization=${ORGANIZATION_ID}&workspace=${WORKSPACE_ID}`,
    );
    assert.equal(
      call.form.get("cancel_url"),
      `${APP_ORIGIN}/?billing=cancelled&organization=${ORGANIZATION_ID}&workspace=${WORKSPACE_ID}`,
    );

    // The encoded body, not just the parsed one: Stripe parses a
    // form-urlencoded body, and that is what has to carry the bracket names.
    assert.ok(
      call.body.includes("line_items%5B0%5D%5Bprice%5D=price_solo"),
      `the price must be a bracketed line item, got: ${call.body}`,
    );
    assert.ok(call.body.startsWith("mode=subscription&"));
    assert.equal(call.body.includes(STRIPE_TEST_KEY), false, "the key belongs in a header");
  });

  it("sells a tier by its label, not by its price id", async () => {
    const { route, calls } = harness();
    const response = await route(
      post({ organizationId: ORGANIZATION_ID, workspaceId: WORKSPACE_ID, tier: "studio" }),
    );

    assert.equal(response.statusCode, 200);
    assert.equal(calls[0]?.form.get("line_items[0][price]"), PRICE_STUDIO);
    assert.equal(calls[0]?.form.get("metadata[tier]"), "studio");
  });

  it("answers 400 for a tier the price table does not name", async () => {
    const { route, calls } = harness();
    const response = await route(
      post({ organizationId: ORGANIZATION_ID, workspaceId: WORKSPACE_ID, tier: "gold" }),
    );

    assert.equal(response.statusCode, 400);
    assert.deepEqual(bodyOf(response), { ok: false, error: "unknown-tier" });
    assert.equal(calls.length, 0, "nothing is sent to Stripe for a tier we cannot price");
  });

  it("treats a price id in the tier field as an unknown tier", async () => {
    const { route } = harness();
    const response = await route(
      post({ organizationId: ORGANIZATION_ID, workspaceId: WORKSPACE_ID, tier: PRICE_SOLO }),
    );

    assert.equal(response.statusCode, 400);
    assert.deepEqual(bodyOf(response), { ok: false, error: "unknown-tier" });
  });

  it("refuses when billing is off, without reading the key", async () => {
    const { route, calls, lines } = harness({
      env: { SUITE_BILLING_ENABLED: "0", STRIPE_SECRET_KEY: undefined },
    });
    const response = await route(post(CHECKOUT_BODY));

    assert.equal(response.statusCode, 503);
    assert.deepEqual(bodyOf(response), { ok: false, error: "billing-disabled" });
    assert.equal(calls.length, 0);
    assert.ok(lines.some((line) => line.includes("billing-disabled")));
    assert.ok(
      !lines.some((line) => line.includes("missing-secret-key")),
      "the switch must be decided before the key is looked for",
    );
  });

  it("answers 500 when the deployment has no Stripe key", async () => {
    const { route, calls, lines } = harness({ env: { STRIPE_SECRET_KEY: undefined } });
    const response = await route(post(CHECKOUT_BODY));

    assert.equal(response.statusCode, 500);
    assert.deepEqual(bodyOf(response), {
      ok: false,
      error: "checkout-failed",
      code: "missing-secret-key",
    });
    assert.equal(calls.length, 0);
    assert.ok(
      lines.some((line) => line.includes("missing-secret-key")),
      "and says so in the log",
    );
  });

  it("answers 500 rather than a free session when the price table is unreadable", async () => {
    const { route, calls } = harness({ env: { STRIPE_PRICE_TIERS: "not json" } });
    const response = await route(post(CHECKOUT_BODY));

    assert.equal(response.statusCode, 500);
    assert.deepEqual(bodyOf(response), {
      ok: false,
      error: "checkout-failed",
      code: "invalid-config",
    });
    assert.equal(calls.length, 0);
  });

  it("answers 400 when the organization id is missing", async () => {
    const { route, calls } = harness();
    // A workspace alone is not a payer: subscriptions belong to organizations.
    const response = await route(post({ workspaceId: WORKSPACE_ID, tier: "solo" }));

    assert.equal(response.statusCode, 400);
    assert.deepEqual(bodyOf(response), { ok: false, error: "invalid-request" });
    assert.equal(calls.length, 0);
  });

  it("sells without a workspace, because an organization may buy before it has one", async () => {
    const { route, calls } = harness();
    const response = await route(post({ organizationId: ORGANIZATION_ID, tier: "solo" }));

    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call !== undefined);
    assert.equal(call.form.get("client_reference_id"), ORGANIZATION_ID);
    assert.equal(call.form.get("metadata[workspaceId]"), null, "no empty workspace key");
    assert.equal(
      call.form.get("success_url"),
      `${APP_ORIGIN}/?billing=success&organization=${ORGANIZATION_ID}`,
    );
  });

  it("answers 400 for a body that is not JSON", async () => {
    const { route, calls } = harness();
    const response = await route(post("workspace=ws_1"));

    assert.equal(response.statusCode, 400);
    assert.deepEqual(bodyOf(response), { ok: false, error: "invalid-request" });
    assert.equal(calls.length, 0);
  });

  it("accepts a base64-encoded body, as API Gateway may deliver one", async () => {
    const { route } = harness();
    const response = await route({
      body: Buffer.from(JSON.stringify(CHECKOUT_BODY), "utf8").toString("base64"),
      isBase64Encoded: true,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(bodyOf(response).url, CHECKOUT_URL);
  });

  it("says the store is not durable on an in-process store, once per container", async () => {
    resetFrontDoorWarnings();
    const { route, lines } = harness({ env: { SUITE_BILLING_STORE: undefined } });

    const first = await route(post(CHECKOUT_BODY));
    const second = await route(post(CHECKOUT_BODY));

    assert.equal(first.statusCode, 200, "test mode still works on the in-process store");
    assert.equal(bodyOf(first).warning, "billing store is not durable");
    assert.deepEqual(bodyOf(second).warning, NON_DURABLE_STORE);
    assert.equal(
      lines.filter((line) => line.includes(NON_DURABLE_STORE)).length,
      1,
      "the deployment fact is logged once, not once per checkout",
    );
  });

  it("does not warn when the store is durable", async () => {
    resetFrontDoorWarnings();
    const { route, lines } = harness({ env: { SUITE_BILLING_STORE: "postgres" } });
    const response = await route(post(CHECKOUT_BODY));

    assert.equal("warning" in bodyOf(response), false);
    assert.ok(!lines.some((line) => line.includes(NON_DURABLE_STORE)));
  });

  it("turns a Stripe refusal into a 500 without echoing the key", async () => {
    const stripe = fakeStripe({
      status: 402,
      body: { error: { type: "invalid_request_error", message: "No such price: 'price_solo'" } },
    });
    const { route, lines } = harness({ stripe });
    const response = await route(post(CHECKOUT_BODY));

    assert.equal(response.statusCode, 500);
    assert.deepEqual(bodyOf(response), {
      ok: false,
      error: "checkout-failed",
      code: "stripe-error",
    });
    assert.ok(!response.body.includes(STRIPE_TEST_KEY));
    assert.ok(
      lines.some((line) => line.includes("invalid_request_error")),
      "the operator needs Stripe's own type to fix it",
    );
    assert.ok(!lines.some((line) => line.includes(STRIPE_TEST_KEY)), "never log the key");
  });

  it("turns an answer without a url into a 500", async () => {
    const { route } = harness({ stripe: fakeStripe({ body: { id: "cs_test_1" } }) });
    const response = await route(post(CHECKOUT_BODY));

    assert.equal(response.statusCode, 500);
    assert.equal(bodyOf(response).code, "stripe-error");
  });

  it("answers 500 when the app origin is not a URL, rather than guessing one", async () => {
    const { route, calls } = harness({ env: { SUITE_APP_ORIGIN: "canvas.example.com" } });
    const response = await route(post(CHECKOUT_BODY));

    assert.equal(response.statusCode, 500);
    assert.equal(bodyOf(response).code, "invalid-config");
    assert.equal(calls.length, 0);
  });

  it("falls back to the canvas dev origin when none is configured", async () => {
    const { route, calls } = harness({ env: { SUITE_APP_ORIGIN: undefined } });
    const response = await route(post(CHECKOUT_BODY));

    assert.equal(response.statusCode, 200);
    assert.equal(
      calls[0]?.form.get("success_url"),
      `http://localhost:5173/?billing=success&organization=${ORGANIZATION_ID}&workspace=${WORKSPACE_ID}`,
    );
  });

  it("reports the mode the key belongs to", () => {
    assert.equal(stripeMode("sk_test_51Nabc"), "test");
    assert.equal(stripeMode("rk_test_51Nabc"), "test");
    assert.equal(stripeMode("sk_live_51Nabc"), "live");
    assert.equal(stripeMode("rk_live_51Nabc"), "live");
    // Anything unrecognised is reported as test: a surface must not claim money
    // is real on a guess.
    assert.equal(stripeMode("pk_something_else"), "test");
  });

  it("reports a live key as live on the answer", async () => {
    const { route } = harness({ env: { STRIPE_SECRET_KEY: "sk_live_51Nabc" } });
    const response = await route(post(CHECKOUT_BODY));

    assert.equal(bodyOf(response).mode, "live");
  });
});

describe("portal route", () => {
  const PORTAL_BODY = { customerId: CUSTOMER_ID };

  it("answers a Stripe portal url for the customer", async () => {
    const { route, calls } = harness({
      route: "portal",
      stripe: fakeStripe({ body: { url: PORTAL_URL } }),
    });
    const response = await route(post(PORTAL_BODY, "/api/billing/portal"));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(bodyOf(response), { ok: true, url: PORTAL_URL, mode: "test" });

    const call = calls[0];
    assert.ok(call !== undefined);
    assert.equal(call.url, "https://api.stripe.com/v1/billing_portal/sessions");
    assert.equal(call.form.get("customer"), CUSTOMER_ID);
    assert.equal(call.form.get("return_url"), APP_ORIGIN);
  });

  it("refuses when billing is off, without reading the key", async () => {
    const { route, calls } = harness({
      route: "portal",
      env: { SUITE_BILLING_ENABLED: "0", STRIPE_SECRET_KEY: undefined },
    });
    const response = await route(post(PORTAL_BODY));

    assert.equal(response.statusCode, 503);
    assert.deepEqual(bodyOf(response), { ok: false, error: "billing-disabled" });
    assert.equal(calls.length, 0);
  });

  it("answers 500 when the deployment has no Stripe key", async () => {
    const { route, calls } = harness({ route: "portal", env: { STRIPE_SECRET_KEY: undefined } });
    const response = await route(post(PORTAL_BODY));

    assert.equal(response.statusCode, 500);
    assert.deepEqual(bodyOf(response), {
      ok: false,
      error: "portal-failed",
      code: "missing-secret-key",
    });
    assert.equal(calls.length, 0);
  });

  it("answers 400 when the customer id is missing", async () => {
    const { route, calls } = harness({ route: "portal" });
    const response = await route(post({}));

    assert.equal(response.statusCode, 400);
    assert.deepEqual(bodyOf(response), { ok: false, error: "invalid-request" });
    assert.equal(calls.length, 0);
  });

  it("mints nothing, so an in-process store adds no warning", async () => {
    resetFrontDoorWarnings();
    const { route } = harness({ route: "portal", env: { SUITE_BILLING_STORE: undefined } });
    const response = await route(post(PORTAL_BODY));

    assert.equal("warning" in bodyOf(response), false);
  });
});
