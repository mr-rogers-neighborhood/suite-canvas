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
    });
  });

  it("should keep an unset period and a missing cancel flag usable", () => {
    const row = subscriptionRowOf({ plan: "solo", status: "trialing", periodEnd: null });

    assert.deepEqual(row, {
      plan: "solo",
      status: "trialing",
      periodEnd: null,
      cancelAtPeriodEnd: false,
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
  });
});
