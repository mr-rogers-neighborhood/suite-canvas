import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseStripeEvent,
  readCheckoutSession,
  readInvoice,
  SIGNATURE_TOLERANCE_SECONDS,
  verifyStripeSignature,
} from "./events.ts";
import {
  CUSTOMER_EMAIL,
  CUSTOMER_ID,
  checkoutObject,
  DAY,
  eventBody,
  invoiceObject,
  NOW,
  PRICE_SOLO,
  signatureHeader,
  WEBHOOK_SECRET,
} from "./testing.ts";

const BODY = eventBody("checkout.session.completed", checkoutObject());

describe("verifyStripeSignature", () => {
  it("accepts a signature made with the configured secret", () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: signatureHeader(BODY),
      secret: WEBHOOK_SECRET,
      now: NOW,
    });
    assert.deepEqual(result, { ok: true, timestamp: Math.floor(NOW / 1000) });
  });

  it("accepts a Buffer body, so a base64-decoded request verifies too", () => {
    const result = verifyStripeSignature({
      rawBody: Buffer.from(BODY, "utf8"),
      header: signatureHeader(BODY),
      secret: WEBHOOK_SECRET,
      now: NOW,
    });
    assert.equal(result.ok, true);
  });

  it("rejects a signature made with a different secret", () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: signatureHeader(BODY, "whsec_wrong"),
      secret: WEBHOOK_SECRET,
      now: NOW,
    });
    assert.deepEqual(result, { ok: false, reason: "no-matching-signature" });
  });

  it("rejects a stale timestamp even when the signature matches", () => {
    const stale = Math.floor(NOW / 1000) - SIGNATURE_TOLERANCE_SECONDS - 1;
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: signatureHeader(BODY, WEBHOOK_SECRET, stale),
      secret: WEBHOOK_SECRET,
      now: NOW,
    });
    assert.deepEqual(result, { ok: false, reason: "timestamp-out-of-tolerance" });
  });

  it("rejects a timestamp far in the future", () => {
    const future = Math.floor(NOW / 1000) + SIGNATURE_TOLERANCE_SECONDS + 1;
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: signatureHeader(BODY, WEBHOOK_SECRET, future),
      secret: WEBHOOK_SECRET,
      now: NOW,
    });
    assert.deepEqual(result, { ok: false, reason: "timestamp-out-of-tolerance" });
  });

  it("rejects a body that changed after signing", () => {
    const header = signatureHeader(BODY);
    const tampered = BODY.replace(CUSTOMER_EMAIL, "attacker@example.com");
    const result = verifyStripeSignature({
      rawBody: tampered,
      header,
      secret: WEBHOOK_SECRET,
      now: NOW,
    });
    assert.deepEqual(result, { ok: false, reason: "no-matching-signature" });
  });

  it("reports why it refused: no secret, no header, bad header", () => {
    assert.deepEqual(
      verifyStripeSignature({ rawBody: BODY, header: "t=1,v1=x", secret: "", now: NOW }),
      {
        ok: false,
        reason: "no-secret",
      },
    );
    assert.deepEqual(
      verifyStripeSignature({ rawBody: BODY, header: null, secret: WEBHOOK_SECRET, now: NOW }),
      {
        ok: false,
        reason: "missing-header",
      },
    );
    assert.deepEqual(
      verifyStripeSignature({ rawBody: BODY, header: "v1=abc", secret: WEBHOOK_SECRET, now: NOW }),
      {
        ok: false,
        reason: "malformed-header",
      },
    );
  });

  it("accepts one good v1 among several signatures", () => {
    const header = `${signatureHeader(BODY, "whsec_old")},${signatureHeader(BODY)}`;
    const result = verifyStripeSignature({
      rawBody: BODY,
      header,
      secret: WEBHOOK_SECRET,
      now: NOW,
    });
    assert.equal(result.ok, true);
  });
});

describe("parseStripeEvent", () => {
  it("reads the envelope", () => {
    const event = parseStripeEvent(BODY);
    assert.ok(event !== null);
    assert.equal(event.id, "evt_test_1");
    assert.equal(event.type, "checkout.session.completed");
    assert.equal(event.createdAt, Math.floor(NOW / 1000));
  });

  it("rejects anything that is not an event", () => {
    assert.equal(parseStripeEvent("not json"), null);
    assert.equal(parseStripeEvent("[]"), null);
    assert.equal(parseStripeEvent(JSON.stringify({ id: "evt_1", type: "x" })), null);
  });
});

describe("readCheckoutSession", () => {
  it("prefers the price pinned in metadata and keeps the email", () => {
    const session = readCheckoutSession(checkoutObject());
    assert.deepEqual(session, {
      id: "cs_test_1",
      customerId: CUSTOMER_ID,
      email: CUSTOMER_EMAIL,
      priceId: PRICE_SOLO,
      subscriptionId: "sub_test_1",
      paymentStatus: "paid",
    });
  });

  it("falls back to line items, then customer_email, and expands objects", () => {
    const session = readCheckoutSession({
      id: "cs_test_2",
      customer: { id: CUSTOMER_ID },
      customer_email: CUSTOMER_EMAIL,
      payment_status: "unpaid",
      subscription: { id: "sub_test_2" },
      line_items: { data: [{ price: { id: PRICE_SOLO } }] },
    });
    assert.ok(session !== null);
    assert.equal(session.customerId, CUSTOMER_ID);
    assert.equal(session.subscriptionId, "sub_test_2");
    assert.equal(session.priceId, PRICE_SOLO);
    assert.equal(session.email, CUSTOMER_EMAIL);
    assert.equal(session.paymentStatus, "unpaid");
  });

  it("returns null without a session or customer id", () => {
    assert.equal(readCheckoutSession({ customer: CUSTOMER_ID }), null);
    assert.equal(readCheckoutSession({ id: "cs_test_3" }), null);
    assert.equal(readCheckoutSession(null), null);
  });
});

describe("readInvoice", () => {
  it("reads the paid period in milliseconds", () => {
    const invoice = readInvoice(invoiceObject());
    assert.ok(invoice !== null);
    assert.equal(invoice.id, "in_test_1");
    assert.equal(invoice.customerId, CUSTOMER_ID);
    assert.equal(invoice.email, CUSTOMER_EMAIL);
    assert.equal(invoice.subscriptionId, "sub_test_1");
    assert.equal(invoice.billingReason, "subscription_cycle");
    assert.equal(invoice.periodStartMs, Math.floor(NOW / 1000) * 1000);
    assert.equal(invoice.periodEndMs, Math.floor((NOW + 60 * DAY) / 1000) * 1000);
  });

  it("falls back to the first line period, and to null when absent", () => {
    const fromLine = readInvoice({
      ...invoiceObject(),
      period_start: undefined,
      period_end: undefined,
      lines: { data: [{ period: { start: 10, end: 20 }, price: { id: PRICE_SOLO } }] },
    });
    assert.equal(fromLine?.periodStartMs, 10_000);
    assert.equal(fromLine?.periodEndMs, 20_000);

    const none = readInvoice({ id: "in_2", customer: CUSTOMER_ID });
    assert.equal(none?.periodStartMs, null);
    assert.equal(none?.periodEndMs, null);
  });
});
