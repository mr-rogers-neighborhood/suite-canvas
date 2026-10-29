import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DAY, NOW } from "../testing/fixtures.ts";
import {
  LIVE_SUBSCRIPTION_SQL,
  postgresSubscriptions,
  type Queryable,
  subscriptionRowOf,
} from "./postgres.ts";

interface Recorded {
  text: string;
  values: readonly unknown[] | undefined;
}

function recordingQueryable(rows: readonly Record<string, unknown>[]): {
  query: Queryable;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  return {
    calls,
    query: {
      query: async (text, values) => {
        calls.push({ text, values });
        return { rows };
      },
    },
  };
}

describe("subscriptionRowOf", () => {
  it("should read a complete row", () => {
    const row = subscriptionRowOf({
      plan: "Solo",
      status: "ACTIVE",
      periodEnd: new Date(NOW + 3 * DAY),
      cancelAtPeriodEnd: true,
    });

    assert.deepEqual(row, {
      plan: "Solo",
      status: "active",
      periodEnd: NOW + 3 * DAY,
      cancelAtPeriodEnd: true,
      billingMode: null,
    });
  });

  it("should read the universe the row was stamped with", () => {
    const row = subscriptionRowOf({ plan: "solo", status: "active", billing_mode: " Live " });

    assert.equal(row?.billingMode, "live");
  });

  it("should treat a stamp it cannot recognise as unknown", () => {
    // A value somebody typed into the column must not be able to refuse a paid plan, and
    // the guard honours a null.
    for (const value of ["prod", 2, null, undefined, ["live"]]) {
      const row = subscriptionRowOf({ plan: "solo", status: "active", billing_mode: value });
      assert.equal(row?.billingMode, null);
    }
  });

  it("should keep an unset period and a missing cancel flag usable", () => {
    const row = subscriptionRowOf({ plan: "solo", status: "trialing", periodEnd: null });

    assert.deepEqual(row, {
      plan: "solo",
      status: "trialing",
      periodEnd: null,
      cancelAtPeriodEnd: false,
      billingMode: null,
    });
  });

  it("should refuse a row with no plan or no status", () => {
    assert.equal(subscriptionRowOf({ status: "active" }), null);
    assert.equal(subscriptionRowOf({ plan: "  ", status: "active" }), null);
    assert.equal(subscriptionRowOf({ plan: "solo" }), null);
  });
});

describe("postgresSubscriptions", () => {
  it("should ask for the organization's live row and map it", async () => {
    const recorded = recordingQueryable([
      { plan: "solo", status: "active", periodEnd: new Date(NOW + DAY), cancelAtPeriodEnd: false },
    ]);

    const subscriptions = postgresSubscriptions(recorded.query);
    const row = await subscriptions.forOrganization("org_1");

    assert.deepEqual(row, {
      plan: "solo",
      status: "active",
      periodEnd: NOW + DAY,
      cancelAtPeriodEnd: false,
      billingMode: null,
    });
    assert.equal(recorded.calls.length, 1);
    assert.equal(recorded.calls[0]?.text, LIVE_SUBSCRIPTION_SQL);
    assert.deepEqual(recorded.calls[0]?.values, ["org_1"]);
  });

  it("should answer null when the organization has no row", async () => {
    const subscriptions = postgresSubscriptions(recordingQueryable([]).query);

    assert.equal(await subscriptions.forOrganization("org_1"), null);
  });

  it("should prefer the live row over a stale cancelled one in one statement", () => {
    assert.match(LIVE_SUBSCRIPTION_SQL, /"referenceId" = \$1/u);
    assert.match(LIVE_SUBSCRIPTION_SQL, /'active', 'trialing'/u);
    assert.match(LIVE_SUBSCRIPTION_SQL, /LIMIT 1/u);
    // The guard reads the stamp from the same statement: a second query on the token mint
    // path would be a second answer to one question.
    assert.match(LIVE_SUBSCRIPTION_SQL, /"billing_mode"/u);
  });
});
