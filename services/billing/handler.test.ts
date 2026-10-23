import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BillingEnvironment,
  createHandler,
  type LambdaHttpEvent,
  type LambdaHttpResponse,
} from "./handler.ts";
import type { Logger } from "./log.ts";
import {
  CUSTOMER_EMAIL,
  CUSTOMER_ID,
  checkoutObject,
  claimsOf,
  DAY,
  eventBody,
  invoiceObject,
  NOW,
  privatePem,
  recordingEmailer,
  recordingStore,
  signatureHeader,
  TIERS_JSON,
  WEBHOOK_SECRET,
} from "./testing.ts";

const SELF_HOST = "https://example.com/self-host";

function testEnv(overrides: Partial<BillingEnvironment> = {}): BillingEnvironment {
  return {
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    SUITE_LICENCE_PRIVATE_KEY: privatePem,
    STRIPE_PRICE_TIERS: TIERS_JSON,
    SUITE_SELF_HOST_URL: SELF_HOST,
    SES_FROM_ADDRESS: undefined,
    SUITE_SES_REGION: undefined,
    ...overrides,
  };
}

interface Harness {
  handler: (event: LambdaHttpEvent) => Promise<LambdaHttpResponse>;
  store: ReturnType<typeof recordingStore>;
  messages: ReturnType<typeof recordingEmailer>["messages"];
  lines: string[];
}

function harness(
  options: { store?: ReturnType<typeof recordingStore>; env?: Partial<BillingEnvironment> } = {},
): Harness {
  const store = options.store ?? recordingStore();
  const mail = recordingEmailer();
  const lines: string[] = [];
  const log: Logger = (level, message, fields) => {
    lines.push(JSON.stringify({ level, message, ...fields }));
  };
  return {
    handler: createHandler({
      store,
      emailer: mail.emailer,
      env: testEnv(options.env),
      now: () => NOW,
      log,
    }),
    store,
    messages: mail.messages,
    lines,
  };
}

function signed(
  body: string,
  options: { secret?: string; timestamp?: number } = {},
): LambdaHttpEvent {
  return {
    body,
    headers: {
      "stripe-signature": signatureHeader(
        body,
        options.secret ?? WEBHOOK_SECRET,
        options.timestamp ?? Math.floor(NOW / 1000),
      ),
    },
  };
}

function checkoutBody(id = "evt_checkout_1", object = checkoutObject()): string {
  return eventBody("checkout.session.completed", object, id);
}

function invoiceBody(id = "evt_invoice_1", object = invoiceObject()): string {
  return eventBody("invoice.paid", object, id);
}

function bodyOf(response: LambdaHttpResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

const TOKEN_PATTERN = /[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}/;

describe("billing webhook", () => {
  it("accepts a correctly signed event and issues a licence that matches it", async () => {
    const { handler, store, messages } = harness();
    const response = await handler(signed(checkoutBody()));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(bodyOf(response), { ok: true, status: "issued" });

    assert.equal(store.puts.length, 1);
    assert.equal(messages.length, 1);
    const message = messages[0];
    assert.ok(message !== undefined);

    const token = TOKEN_PATTERN.exec(message.text)?.[0];
    assert.ok(token !== undefined, "the email must contain the token");

    assert.deepEqual(claimsOf(token), {
      v: 1,
      id: store.puts[0]?.licenceId,
      tier: "solo",
      workspaces: 3,
      documentBytes: 268_435_456,
      attachmentBytes: 1_073_741_824,
      issuedAt: NOW,
      expiresAt: NOW + 30 * DAY,
      email: CUSTOMER_EMAIL,
    });
    assert.equal(message.to, CUSTOMER_EMAIL);
    assert.ok(message.text.includes(`Self-host it: ${SELF_HOST}`));
    assert.ok(!response.body.includes(token), "the response must not echo the token");
  });

  it("rejects a signature made with another secret, without side effects", async () => {
    const { handler, store, messages } = harness();
    const response = await handler(signed(checkoutBody(), { secret: "whsec_wrong" }));

    assert.equal(response.statusCode, 400);
    assert.deepEqual(bodyOf(response), { ok: false, error: "no-matching-signature" });
    assert.deepEqual(store.claims, []);
    assert.equal(store.puts.length, 0);
    assert.equal(messages.length, 0);
  });

  it("rejects an old signature, even one that was once valid", async () => {
    const { handler, store } = harness();
    const response = await handler(
      signed(checkoutBody(), { timestamp: Math.floor(NOW / 1000) - 10 * 60 }),
    );

    assert.equal(response.statusCode, 400);
    assert.deepEqual(bodyOf(response), { ok: false, error: "timestamp-out-of-tolerance" });
    assert.equal(store.puts.length, 0);
  });

  it("treats a repeated delivery of one event as a no-op", async () => {
    const { handler, store, messages } = harness();
    const delivery = signed(checkoutBody());

    const first = await handler(delivery);
    const second = await handler(delivery);

    assert.deepEqual(bodyOf(first), { ok: true, status: "issued" });
    assert.deepEqual(bodyOf(second), { ok: true, status: "duplicate" });
    assert.equal(store.puts.length, 1, "one event id must never mint two licences");
    assert.equal(messages.length, 1, "and must never send two emails");
  });

  it("extends the licence when invoice.paid reports a renewal", async () => {
    const { handler, store, messages } = harness();

    await handler(signed(checkoutBody("evt_checkout_1")));
    const renewal = await handler(signed(invoiceBody("evt_invoice_1")));

    assert.equal(renewal.statusCode, 200);
    assert.deepEqual(bodyOf(renewal), { ok: true, status: "renewed" });
    assert.equal(store.puts.length, 2);
    assert.equal(store.puts[1]?.expiresAt, NOW + 60 * DAY);
    assert.equal(store.puts[1]?.licenceId, store.puts[0]?.licenceId);

    const renewed = messages[1];
    assert.ok(renewed !== undefined);
    const token = TOKEN_PATTERN.exec(renewed.text)?.[0];
    assert.ok(token !== undefined);
    assert.equal(claimsOf(token).expiresAt, NOW + 60 * DAY);
  });

  it("answers 200 and does nothing for an event it does not handle", async () => {
    const { handler, store, messages, lines } = harness();
    const response = await handler(
      signed(eventBody("customer.created", { id: CUSTOMER_ID }, "evt_other_1")),
    );

    assert.equal(response.statusCode, 200, "Stripe must stop retrying");
    assert.deepEqual(bodyOf(response), { ok: true, status: "ignored" });
    assert.deepEqual(store.claims, [], "an ignored event leaves no claim behind");
    assert.equal(store.puts.length, 0);
    assert.equal(messages.length, 0);
    assert.ok(lines.some((line) => line.includes("event ignored")));
  });

  it("answers 500 so Stripe retries when signing fails", async () => {
    const store = recordingStore();
    const broken = harness({ store, env: { SUITE_LICENCE_PRIVATE_KEY: "not a private key" } });

    const failed = await broken.handler(signed(checkoutBody()));
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(bodyOf(failed), {
      ok: false,
      error: "processing-failed",
      code: "signing-failed",
    });
    assert.equal(broken.messages.length, 0);
    assert.equal(store.puts.length, 0);
    assert.deepEqual(store.releases, ["evt_checkout_1"], "the failed claim must be released");

    // The retry, now that the key is fixed, is allowed through.
    const retried = await harness({ store }).handler(signed(checkoutBody()));
    assert.equal(retried.statusCode, 200);
    assert.deepEqual(bodyOf(retried), { ok: true, status: "issued" });
    assert.equal(store.puts.length, 1);
  });

  it("answers 500 when the price is not in the table, so the operator can fix it", async () => {
    const { handler, store } = harness();
    const response = await handler(
      signed(
        checkoutBody("evt_checkout_9", checkoutObject({ metadata: { price_id: "price_nope" } })),
      ),
    );

    assert.equal(response.statusCode, 500);
    assert.equal(bodyOf(response).code, "unknown-price");
    assert.equal(store.puts.length, 0);
    assert.deepEqual(store.releases, ["evt_checkout_9"]);
  });

  it("accepts a base64-encoded body, as API Gateway may deliver one", async () => {
    const { handler, store } = harness();
    const body = checkoutBody();
    const response = await handler({
      body: Buffer.from(body, "utf8").toString("base64"),
      isBase64Encoded: true,
      headers: { "Stripe-Signature": signatureHeader(body) },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(store.puts.length, 1);
  });

  it("rejects a delivery with no body", async () => {
    const { handler } = harness();
    const response = await handler({ headers: { "stripe-signature": "t=1,v1=abc" } });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(bodyOf(response), { ok: false, error: "missing-body" });
  });

  it("never writes the token to a log line", async () => {
    const { handler, messages, lines } = harness();
    await handler(signed(checkoutBody()));

    const token = TOKEN_PATTERN.exec(messages[0]?.text ?? "")?.[0];
    assert.ok(token !== undefined, "the email must contain the token");
    assert.ok(lines.length > 0, "the handler must log that it did something");
    for (const line of lines) {
      assert.ok(!line.includes(token), `a log line carried the token: ${line}`);
    }
  });

  it("keeps a delivery that failed SES out of the store, so the retry sends it", async () => {
    const store = recordingStore();
    const mail = recordingEmailer();
    const failing = createHandler({
      store,
      emailer: {
        async send() {
          throw new Error("SES is having a day");
        },
      },
      env: testEnv(),
      now: () => NOW,
      log: () => {},
    });

    const response = await failing(signed(checkoutBody()));
    assert.equal(response.statusCode, 500);
    assert.equal(bodyOf(response).code, "email-failed");
    assert.equal(store.puts.length, 0, "no record for an email that never arrived");
    assert.deepEqual(store.releases, ["evt_checkout_1"]);

    const retry = createHandler({
      store,
      emailer: mail.emailer,
      env: testEnv(),
      now: () => NOW,
      log: () => {},
    });
    const retried = await retry(signed(checkoutBody()));
    assert.deepEqual(bodyOf(retried), { ok: true, status: "issued" });
    assert.equal(mail.messages.length, 1);
  });

  it("does not double-issue when checkout and its first invoice both arrive", async () => {
    const { handler, store, messages } = harness();
    await handler(signed(checkoutBody("evt_checkout_1")));
    await handler(
      signed(
        invoiceBody(
          "evt_invoice_1",
          invoiceObject({
            billing_reason: "subscription_create",
            period_end: Math.floor((NOW + 30 * DAY) / 1000),
          }),
        ),
      ),
    );

    assert.equal(messages.length, 1, "the same month is bought twice on paper, not in fact");
    assert.equal(store.puts.length, 1);
  });
});
