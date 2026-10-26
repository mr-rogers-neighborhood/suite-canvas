import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BillingError } from "../errors.ts";
import { readCheckoutSession, readInvoice } from "./events.ts";
import {
  type Issuer,
  issueFromCheckout,
  issueFromInvoice,
  issueManual,
  licenceIdFor,
} from "./issue.ts";
import {
  CUSTOMER_EMAIL,
  CUSTOMER_ID,
  checkoutObject,
  claimsOf,
  DAY,
  invoiceObject,
  NOW,
  PRICE_SOLO,
  PRICE_STUDIO,
  privatePem,
  recordingEmailer,
  recordingStore,
  TIERS_JSON,
} from "./testing.ts";
import { DEFAULT_PERIOD_MS, parseTierTable, planFor, type TierTable } from "./tiers.ts";

/** The fixture table, unwrapped: a parse failure must break the test, not one issuer. */
function tierTable(): TierTable {
  const parsed = parseTierTable(TIERS_JSON);
  assert.ok(parsed.isOk(), "the fixture tier table must parse");
  return parsed.value;
}

function setup(overrides: Partial<Issuer> = {}) {
  const store = recordingStore();
  const mail = recordingEmailer();
  const issuer: Issuer = {
    store,
    tiers: tierTable(),
    emailer: mail.emailer,
    privateKeyPem: privatePem,
    selfHostUrl: "https://example.com/self-host",
    now: () => NOW,
    ...overrides,
  };
  return { issuer, store, messages: mail.messages };
}

function checkoutSession(overrides: Record<string, unknown> = {}) {
  const session = readCheckoutSession(checkoutObject(overrides));
  assert.ok(session !== null, "fixture must be a readable checkout session");
  return session;
}

function invoice(overrides: Record<string, unknown> = {}) {
  const parsed = readInvoice(invoiceObject(overrides));
  assert.ok(parsed !== null, "fixture must be a readable invoice");
  return parsed;
}

async function errorOf(run: () => Promise<unknown>): Promise<BillingError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof BillingError, `expected BillingError, got ${String(error)}`);
    return error;
  }
  assert.fail("expected the call to fail");
}

describe("parseTierTable", () => {
  it("maps every configured price onto its plan", () => {
    const tiers = tierTable();
    assert.equal(tiers.size, 2);
    assert.deepEqual(tiers.get(PRICE_SOLO), {
      tier: "solo",
      workspaces: 3,
      documentBytes: 268_435_456,
      attachmentBytes: 1_073_741_824,
    });
  });

  it("refuses a missing, unparseable or empty table", () => {
    for (const raw of [undefined, "", "   ", "{", "[]", "{}"]) {
      const parsed = parseTierTable(raw);
      assert.ok(parsed.isErr(), `expected ${String(raw)} to be refused`);
      assert.ok(parsed.error instanceof BillingError);
      assert.equal(parsed.error.code, "invalid-config");
    }
  });

  it("refuses a plan with a missing or nonsensical quota", () => {
    for (const entry of [
      { tier: "solo", workspaces: 3 },
      { tier: "solo", workspaces: 0, documentBytes: 1, attachmentBytes: 1 },
    ]) {
      const parsed = parseTierTable(JSON.stringify({ price_x: entry }));
      assert.ok(parsed.isErr());
      assert.equal(parsed.error.code, "invalid-config");
    }
  });

  it("refuses an unknown price instead of inventing a tier", () => {
    const tiers = tierTable();
    assert.throws(
      () => planFor(tiers, "price_nope"),
      (error: unknown) => error instanceof BillingError && error.code === "unknown-price",
    );
    assert.throws(
      () => planFor(tiers, null),
      (error: unknown) => error instanceof BillingError && error.code === "unknown-price",
    );
  });
});

describe("issueFromCheckout", () => {
  it("signs a licence whose claims match the purchase, and emails it", async () => {
    const { issuer, store, messages } = setup();
    const outcome = await issueFromCheckout(issuer, checkoutSession());

    assert.equal(outcome.status, "issued");

    const token = outcome.token;
    const [payload, signature] = token.split(".");
    assert.ok(payload && signature, "token must be payload.signature");

    assert.deepEqual(claimsOf(token), {
      v: 1,
      id: licenceIdFor(CUSTOMER_ID),
      tier: "solo",
      workspaces: 3,
      documentBytes: 268_435_456,
      attachmentBytes: 1_073_741_824,
      issuedAt: NOW,
      expiresAt: NOW + DEFAULT_PERIOD_MS,
      email: CUSTOMER_EMAIL,
    });

    assert.equal(store.puts.length, 1);
    assert.equal(store.puts[0]?.licence, token);
    assert.equal(store.puts[0]?.email, CUSTOMER_EMAIL);
    assert.equal(store.puts[0]?.priceId, PRICE_SOLO);

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.to, CUSTOMER_EMAIL);
    assert.ok(messages[0]?.text.includes(token), "the email must carry the token");
  });

  it("uses the studio plan when that is the price that was paid", async () => {
    const { issuer } = setup();
    const outcome = await issueFromCheckout(
      issuer,
      checkoutSession({ metadata: { price_id: PRICE_STUDIO } }),
    );
    assert.equal(outcome.status, "issued");
    assert.equal(outcome.record.tier, "studio");
    assert.equal(claimsOf(outcome.token).workspaces, 25);
  });

  it("ignores a session that has not been paid", async () => {
    const { issuer, store, messages } = setup();
    const outcome = await issueFromCheckout(issuer, checkoutSession({ payment_status: "unpaid" }));
    assert.equal(outcome.status, "ignored");
    assert.equal(store.puts.length, 0);
    assert.equal(messages.length, 0);
  });

  it("fails rather than issue a licence with no contact address", async () => {
    const { issuer } = setup();
    const error = await errorOf(() =>
      issueFromCheckout(
        issuer,
        checkoutSession({ customer_details: undefined, metadata: { price_id: PRICE_SOLO } }),
      ),
    );
    assert.equal(error.code, "no-email");
  });

  it("fails, without side effects, on a price that is not in the table", async () => {
    const { issuer, store, messages } = setup();
    const error = await errorOf(() =>
      issueFromCheckout(issuer, checkoutSession({ metadata: { price_id: "price_unknown" } })),
    );
    assert.equal(error.code, "unknown-price");
    assert.equal(store.puts.length, 0);
    assert.equal(messages.length, 0);
  });
});

describe("issueFromInvoice", () => {
  it("extends the expiry to the end of the paid period and keeps the licence id", async () => {
    const { issuer, store, messages } = setup();
    const first = await issueFromCheckout(issuer, checkoutSession());
    assert.equal(first.status, "issued");

    const renewal = await issueFromInvoice(issuer, invoice());

    assert.equal(renewal.status, "renewed");
    assert.equal(renewal.record.licenceId, first.record.licenceId);
    assert.equal(renewal.record.expiresAt, NOW + 60 * DAY);
    assert.equal(renewal.record.lastInvoiceId, "in_test_1");
    assert.notEqual(renewal.token, first.token, "a renewal mints a fresh token");

    assert.equal(claimsOf(renewal.token).expiresAt, NOW + 60 * DAY);
    assert.equal(messages.length, 2);
    assert.ok(messages[1]?.text.includes(renewal.token));
    assert.equal(store.puts.length, 2);
  });

  it("does not extend twice for one invoice", async () => {
    const { issuer, messages } = setup();
    await issueFromInvoice(issuer, invoice());
    const second = await issueFromInvoice(issuer, invoice());

    assert.equal(second.status, "unchanged");
    assert.equal(messages.length, 1);
  });

  it("ignores an invoice that is not a subscription renewal", async () => {
    const { issuer, store, messages } = setup();
    const outcome = await issueFromInvoice(issuer, invoice({ subscription: null }));
    assert.equal(outcome.status, "ignored");
    assert.equal(store.puts.length, 0);
    assert.equal(messages.length, 0);
  });

  it("issues from the invoice alone when the checkout event was missed", async () => {
    const { issuer, store } = setup();
    const outcome = await issueFromInvoice(issuer, invoice());
    assert.equal(outcome.status, "issued");
    assert.equal(outcome.record.licenceId, licenceIdFor(CUSTOMER_ID));
    assert.equal(store.puts.length, 1);
  });

  it("falls back to the stored price when line items are not expanded", async () => {
    const { issuer } = setup();
    const first = await issueFromCheckout(issuer, checkoutSession());
    assert.equal(first.status, "issued");

    const bare = await issueFromInvoice(
      issuer,
      invoice({ lines: undefined, period_end: Math.floor((NOW + 60 * DAY) / 1000) }),
    );
    assert.equal(bare.status, "renewed");
    assert.equal(bare.record.priceId, PRICE_SOLO);
    assert.equal(bare.record.tier, "solo");
  });
});

describe("issueManual", () => {
  it("issues the requested number of days to the address support was given", async () => {
    const { issuer, messages } = setup();
    const outcome = await issueManual(issuer, {
      email: "  Customer@Example.com ",
      priceId: PRICE_SOLO,
      days: 7,
    });

    assert.equal(outcome.status, "issued");
    assert.equal(outcome.record.email, "Customer@Example.com");
    assert.equal(outcome.record.expiresAt, NOW + 7 * DAY);
    assert.equal(outcome.record.licenceId, licenceIdFor("manual:customer@example.com"));
    assert.ok(messages[0]?.text.includes(outcome.token));
  });

  it("refuses an address that cannot be a customer", async () => {
    const { issuer } = setup();
    const error = await errorOf(() =>
      issueManual(issuer, { email: "not an email", priceId: PRICE_SOLO }),
    );
    assert.equal(error.code, "manual-request");
  });
});
