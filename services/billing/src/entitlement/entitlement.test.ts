import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DAY, fixtureLimits, NOW, tierTableFixture } from "../testing/fixtures.ts";
import {
  createEntitlementReader,
  entitlementFor,
  FREE_TIER,
  freeEntitlement,
  type SubscriptionRow,
} from "./entitlement.ts";

const TIERS = tierTableFixture();
const SOLO = fixtureLimits("solo");
const SOLO_LIMITS = {
  workspaces: SOLO.workspaces,
  documentBytes: SOLO.documentBytes,
  attachmentBytes: SOLO.attachmentBytes,
};

function row(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    plan: "solo",
    status: "active",
    periodEnd: NOW + 20 * DAY,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe("entitlementFor", () => {
  it("should grant the plan while the subscription is active", () => {
    assert.deepEqual(entitlementFor(row(), TIERS, NOW), { tier: "solo", limits: SOLO_LIMITS });
  });

  it("should grant the plan during a trial", () => {
    const trial = row({ status: "trialing", periodEnd: NOW + 7 * DAY });

    assert.deepEqual(entitlementFor(trial, TIERS, NOW), { tier: "solo", limits: SOLO_LIMITS });
  });

  it("should keep the plan while a past-due period is still running", () => {
    const dunning = row({ status: "past_due", periodEnd: NOW + 2 * DAY });

    assert.deepEqual(entitlementFor(dunning, TIERS, NOW), { tier: "solo", limits: SOLO_LIMITS });
  });

  it("should drop to free once a past-due period has ended", () => {
    const lapsed = row({ status: "past_due", periodEnd: NOW - 1 });

    assert.deepEqual(entitlementFor(lapsed, TIERS, NOW), freeEntitlement);
  });

  it("should keep the plan for a cancellation that only takes effect at period end", () => {
    const ending = row({ cancelAtPeriodEnd: true });

    assert.deepEqual(entitlementFor(ending, TIERS, NOW), { tier: "solo", limits: SOLO_LIMITS });
  });

  it("should report free for a cancelled subscription", () => {
    const cancelled = row({
      status: "canceled",
      periodEnd: NOW + 20 * DAY,
      cancelAtPeriodEnd: true,
    });

    assert.deepEqual(entitlementFor(cancelled, TIERS, NOW), freeEntitlement);
    assert.equal(entitlementFor(cancelled, TIERS, NOW).tier, FREE_TIER);
  });

  it("should report free when the organization has no subscription", () => {
    assert.deepEqual(entitlementFor(null, TIERS, NOW), freeEntitlement);
  });

  it("should deny every status that is not a paid period", () => {
    for (const status of ["unpaid", "incomplete", "incomplete_expired", "paused", "ended"]) {
      assert.deepEqual(entitlementFor(row({ status }), TIERS, NOW), freeEntitlement, status);
    }
  });

  it("should match the plan name whatever case Stripe stored", () => {
    assert.equal(entitlementFor(row({ plan: "Solo" }), TIERS, NOW).tier, "solo");
  });

  it("should deny a plan the tier table does not describe", () => {
    assert.deepEqual(entitlementFor(row({ plan: "enterprise" }), TIERS, NOW), freeEntitlement);
  });
});

describe("createEntitlementReader", () => {
  it("should read the organization's row and answer its tier", async () => {
    const asked: string[] = [];
    const reader = createEntitlementReader({
      tiers: TIERS,
      now: () => NOW,
      subscriptions: {
        forOrganization: async (organizationId) => {
          asked.push(organizationId);
          return row();
        },
      },
    });

    assert.deepEqual(await reader.forOrganization("org_1"), { tier: "solo", limits: SOLO_LIMITS });
    assert.deepEqual(asked, ["org_1"]);
  });

  it("should answer free when the organization has no row", async () => {
    const reader = createEntitlementReader({
      tiers: TIERS,
      subscriptions: { forOrganization: async () => null },
    });

    assert.deepEqual(await reader.forOrganization("org_1"), freeEntitlement);
  });
});
