import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CUSTOMER_EMAIL, CUSTOMER_ID, NOW, PRICE_SOLO } from "../stripe/testing.ts";
import { memoryStore } from "./store.ts";

function record() {
  return {
    customerId: CUSTOMER_ID,
    email: CUSTOMER_EMAIL,
    tier: "solo",
    priceId: PRICE_SOLO,
    licence: "payload.signature",
    licenceId: "lic-1",
    issuedAt: NOW,
    expiresAt: NOW + 86_400_000,
    updatedAt: NOW,
  };
}

describe("memoryStore", () => {
  it("claims an event id once", async () => {
    const store = memoryStore();
    assert.equal(await store.claimEvent("evt_1"), true);
    assert.equal(await store.claimEvent("evt_1"), false);
    assert.equal(await store.claimEvent("evt_2"), true);
  });

  it("lets a released claim be taken again, so a retry is processed", async () => {
    const store = memoryStore();
    await store.claimEvent("evt_1");
    await store.releaseEvent("evt_1");
    assert.equal(await store.claimEvent("evt_1"), true);
  });

  it("round-trips a licence record by customer", async () => {
    const store = memoryStore();
    assert.equal(await store.getCustomer(CUSTOMER_ID), null);
    const stored = record();
    await store.putCustomer(stored);
    assert.deepEqual(await store.getCustomer(CUSTOMER_ID), stored);
  });

  it("overwrites the record rather than accumulating history", async () => {
    const store = memoryStore();
    await store.putCustomer(record());
    await store.putCustomer({ ...record(), expiresAt: NOW + 172_800_000 });
    const current = await store.getCustomer(CUSTOMER_ID);
    assert.equal(current?.expiresAt, NOW + 172_800_000);
  });
});
