import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLAIM_EVENT_SQL,
  postgresStore,
  type Queryable,
  READ_CUSTOMER_SQL,
  WRITE_CUSTOMER_SQL,
} from "./store-postgres.ts";

/**
 * The Postgres store against a recording fake
 * ([ADR-0069](../docs/decisions/0069-billing-runs-on-the-stripe-plugin.md) amendment).
 *
 * What is worth pinning is the *idempotency mechanism*: a claim is one
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING`, and the presence or absence of a
 * returned row is the whole answer. A read-then-write would pass a test like this
 * while being wrong under two concurrent deliveries, so the SQL is asserted
 * directly rather than inferred from behaviour alone.
 */

interface Call {
  text: string;
  values: readonly unknown[] | undefined;
}

function fakeClient(
  rowsFor: (text: string, call: number) => unknown[] = () => [],
): Queryable & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: rowsFor(text, calls.length - 1) };
    },
  };
}

const RECORD = {
  customerId: "cus_1",
  email: "buyer@example.com",
  tier: "solo",
  priceId: "price_solo",
  licence: "token-abc",
  licenceId: "lic_1",
  issuedAt: 1_800_000_000_000,
  expiresAt: 1_800_086_400_000,
  updatedAt: 1_800_000_000_000,
};

describe("claiming an event", () => {
  it("is one statement that returns a row only when it inserted", async () => {
    // First statement inserts (a row comes back); the repeat inserts nothing.
    const client = fakeClient((_text, call) => (call === 0 ? [{ event_id: "evt_1" }] : []));
    const store = postgresStore(client);

    const first = await store.claimEvent("evt_1");
    const second = await store.claimEvent("evt_1");

    assert.equal(first, true, "the first delivery inserts and returns its id");
    assert.equal(second, false, "the repeat inserts nothing and returns nothing");

    for (const call of client.calls) {
      assert.equal(call.text, CLAIM_EVENT_SQL);
      // No read before the write: that is the concurrency bug this shape avoids.
      assert.ok(call.text.includes("ON CONFLICT (event_id) DO NOTHING"));
      assert.ok(call.text.includes("RETURNING event_id"));
      assert.deepEqual(call.values?.[0], "evt_1");
    }
  });

  it("releases a claim with a delete, so a retry is allowed to try again", async () => {
    const client = fakeClient();
    const store = postgresStore(client);

    await store.releaseEvent("evt_1");

    assert.equal(client.calls.length, 1);
    assert.ok(client.calls[0]?.text.includes("DELETE FROM billing_event"));
    assert.deepEqual(client.calls[0]?.values, ["evt_1"]);
  });
});

describe("the customer record", () => {
  it("reads a row back as a record, with bigint times as numbers", async () => {
    const client = fakeClient(() => [
      {
        customer_id: "cus_1",
        email: "buyer@example.com",
        tier: "solo",
        price_id: "price_solo",
        licence: "token-abc",
        licence_id: "lic_1",
        // Drivers hand bigint columns back as strings; the record wants numbers.
        issued_at: "1800000000000",
        expires_at: "1800086400000",
        subscription_id: null,
        last_invoice_id: null,
        updated_at: "1800000000000",
      },
    ]);

    const record = await postgresStore(client).getCustomer("cus_1");

    assert.equal(client.calls[0]?.text, READ_CUSTOMER_SQL);
    assert.deepEqual(record, {
      customerId: "cus_1",
      email: "buyer@example.com",
      tier: "solo",
      priceId: "price_solo",
      licence: "token-abc",
      licenceId: "lic_1",
      issuedAt: 1_800_000_000_000,
      expiresAt: 1_800_086_400_000,
      updatedAt: 1_800_000_000_000,
    });
  });

  it("answers null for a customer it has never seen", async () => {
    assert.equal(await postgresStore(fakeClient()).getCustomer("cus_none"), null);
  });

  it("upserts in one statement, carrying every field including the optional two", async () => {
    const client = fakeClient();
    await postgresStore(client).putCustomer({ ...RECORD, subscriptionId: "sub_1" });

    assert.equal(client.calls.length, 1);
    const call = client.calls[0];
    assert.ok(call !== undefined);
    assert.equal(call.text, WRITE_CUSTOMER_SQL);
    assert.ok(call.text.includes("ON CONFLICT (customer_id) DO UPDATE"));
    // Absent optionals are written as null rather than dropped, so a renewal that
    // loses a subscription id clears it instead of silently keeping a stale one.
    assert.deepEqual(call.values, [
      "cus_1",
      "buyer@example.com",
      "solo",
      "price_solo",
      "token-abc",
      "lic_1",
      1_800_000_000_000,
      1_800_086_400_000,
      "sub_1",
      null,
      1_800_000_000_000,
    ]);
  });
});
