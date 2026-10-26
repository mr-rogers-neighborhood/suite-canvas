import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BillingError } from "../errors.ts";
import { fixturedTiersJson, fixturePlans } from "../testing/fixtures.ts";
import { limitsOf, parseTierTable, tierTableByTier } from "./tiers.ts";

function failureOf(raw: string | null): BillingError {
  const parsed = parseTierTable(raw);
  assert.equal(parsed.isErr(), true, `expected ${String(raw)} to be refused`);
  return parsed.isErr() ? parsed.error : new BillingError("unexpected", "unreachable");
}

describe("parseTierTable", () => {
  it("should read the fixture table", () => {
    const parsed = parseTierTable(fixturedTiersJson());
    assert.equal(parsed.isOk(), true);
    if (parsed.isErr()) return;

    const solo = fixturePlans()[0];
    assert.ok(solo !== undefined);
    assert.equal(parsed.value.size, fixturePlans().length);
    assert.deepEqual(parsed.value.get("price_solo"), {
      tier: solo.tier,
      workspaces: solo.workspaces,
      documentBytes: solo.documentBytes,
      attachmentBytes: solo.attachmentBytes,
    });
  });

  it("should refuse a missing, malformed or empty table", () => {
    assert.equal(failureOf("").message, "STRIPE_PRICE_TIERS is not set");
    assert.equal(failureOf(null).message, "STRIPE_PRICE_TIERS is not set");
    assert.equal(failureOf("{oops").message, "STRIPE_PRICE_TIERS is not valid JSON");
    assert.equal(
      failureOf("[]").message,
      "STRIPE_PRICE_TIERS must be a JSON object keyed by price id",
    );
    assert.equal(failureOf("{}").message, "STRIPE_PRICE_TIERS maps no prices");
  });

  it("should name the price id whose plan is incomplete", () => {
    assert.match(failureOf('{"price_1":{"tier":"solo","workspaces":3}}').message, /price_1/u);
  });

  it("should refuse a tier that is blank or too long", () => {
    const plan = { tier: " ", workspaces: 1, documentBytes: 0, attachmentBytes: 0 };

    assert.match(failureOf(JSON.stringify({ price_1: plan })).message, /price_1/u);
    const long = { ...plan, tier: "t".repeat(65) };
    assert.match(failureOf(JSON.stringify({ price_1: long })).message, /price_1/u);
  });
});

describe("tierTableByTier", () => {
  it("should key plans by lower-cased tier so a stored plan name matches", () => {
    const parsed = parseTierTable(
      JSON.stringify({
        price_1: { tier: "Solo", workspaces: 3, documentBytes: 1, attachmentBytes: 2 },
      }),
    );
    assert.equal(parsed.isOk(), true);
    if (parsed.isErr()) return;

    assert.deepEqual(tierTableByTier(parsed.value).get("solo"), parsed.value.get("price_1"));
  });
});

describe("limitsOf", () => {
  it("should name the three caps the relay enforces", () => {
    const plan = fixturePlans()[0];
    assert.ok(plan !== undefined);

    assert.deepEqual(limitsOf(plan), {
      workspaces: plan.workspaces,
      documentBytes: plan.documentBytes,
      attachmentBytes: plan.attachmentBytes,
    });
  });
});
