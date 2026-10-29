import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { entitlementFor, freeEntitlement } from "../entitlement/entitlement.ts";
import { BillingError } from "../errors.ts";
import { billingPluginOptions } from "../stripe/plugin.ts";
import { fixtureLimits, fixturePlans, NOW, tierTableFixture } from "../testing/fixtures.ts";
import {
  createLicenceProjection,
  freeLicenceRow,
  type LicenceRow,
  type LicenceRows,
  licenceRowFor,
  licenceRowValues,
  type SubscriptionView,
  subscriptionViewOf,
  UPSERT_LICENCE_SQL,
} from "./projection.ts";

const TIERS = tierTableFixture();
const DAY = 24 * 60 * 60 * 1000;
const ORG = "org_1";

/** The free tier exactly as `@suite/auth`'s `FREE_LICENCE_TIER` names it. */
const FREE = {
  tier: "free",
  workspaces: 1,
  seats: 1,
  documentBytes: 64 * 1024 * 1024,
  attachmentBytes: 8 * 1024 * 1024,
  days: 36_525,
};

function view(overrides: Partial<SubscriptionView> = {}): SubscriptionView {
  return {
    organizationId: ORG,
    plan: "personal",
    status: "active",
    periodEnd: NOW + DAY,
    cancelAtPeriodEnd: false,
    seats: null,
    subscriptionId: "sub_1",
    ...overrides,
  };
}

function recording(): LicenceRows & { rows: LicenceRow[] } {
  const rows: LicenceRow[] = [];
  return {
    rows,
    upsert: async (row) => {
      rows.push(row);
    },
  };
}

describe("subscriptionViewOf", () => {
  it("should read the plugin's row as the licence projection needs it", () => {
    assert.deepEqual(
      subscriptionViewOf({
        referenceId: ORG,
        plan: "personal",
        status: "active",
        periodEnd: new Date(NOW + DAY),
        cancelAtPeriodEnd: false,
        seats: 3,
        stripeSubscriptionId: "sub_1",
      }),
      {
        organizationId: ORG,
        plan: "personal",
        status: "active",
        periodEnd: NOW + DAY,
        cancelAtPeriodEnd: false,
        seats: 3,
        subscriptionId: "sub_1",
      },
    );
  });

  it("should report a missing period end and seat count as absent, not as zero", () => {
    const read = subscriptionViewOf({ referenceId: ORG, plan: "personal", status: "active" });
    assert.equal(read.periodEnd, null);
    assert.equal(read.seats, null);
    assert.equal(read.subscriptionId, null);
  });

  it("should read a seat count that is not a whole quantity as absent", () => {
    // `seats` becomes a ceiling compared against a member count, so a fraction would admit
    // a fraction of a person and a negative number would fall below the free tier.
    for (const seats of [2.5, -1, Number.NaN]) {
      const read = subscriptionViewOf({
        referenceId: ORG,
        plan: "personal",
        status: "active",
        seats,
      });
      assert.equal(read.seats, null, `${String(seats)} is not a seat count`);
    }
  });
});

describe("licenceRowFor", () => {
  it("should write the plan's tier and limits for a live subscription", () => {
    const personal = fixtureLimits("personal");
    const subscription = view();
    const row = licenceRowFor({
      organizationId: ORG,
      subscription,
      entitlement: entitlementFor(subscription, TIERS, NOW),
      free: FREE,
      now: NOW,
    });

    assert.deepEqual(row, {
      organizationId: ORG,
      licenceId: "stripe:sub_1",
      tier: "personal",
      workspaces: personal.workspaces,
      seats: personal.seats,
      documentBytes: personal.documentBytes,
      attachmentBytes: personal.attachmentBytes,
      // The paid horizon is the period Stripe last billed, so a lapsed renewal stops
      // granting the plan at the same instant the token does.
      expiresAt: NOW + DAY,
    });
  });

  it("should carry the plan's allowance, and honour a larger quantity over it", () => {
    const personal = fixtureLimits("personal");
    const withSeats = (seats: number) => {
      const subscription = view({ seats });
      return licenceRowFor({
        organizationId: ORG,
        subscription,
        entitlement: entitlementFor(subscription, TIERS, NOW),
        free: FREE,
        now: NOW,
      });
    };

    // A bigger quantity is a customer who bought more than the plan's allowance through
    // the API; it never shrinks the row, because a seat is access and access is not
    // something to take away by accident.
    assert.equal(withSeats(personal.seats + 5).seats, personal.seats + 5);
    assert.equal(withSeats(0).seats, personal.seats);
  });

  it("should grant every fixture plan the members it declares", () => {
    // `services/auth` compares the organization's member count plus the invitee against
    // this number and answers `seat-refused` with `reason: "seat-allowance-exhausted"`
    // above it (`checkSeatAllowance`, `services/auth/src/organizations/seats.ts`). The
    // quantity cannot supply it, because the plugin writes one for a plan with no
    // `seatPriceId`, so the table does: a plan that includes a team writes a team.
    for (const plan of fixturePlans()) {
      const subscription = view({ plan: plan.tier });
      const row = licenceRowFor({
        organizationId: ORG,
        subscription,
        entitlement: entitlementFor(subscription, TIERS, NOW),
        free: FREE,
        now: NOW,
      });

      assert.equal(row.tier, plan.tier);
      assert.equal(row.seats, plan.seats, `${plan.tier} must admit the members it declares`);
    }
  });

  it("should take the table's allowance over a quantity of one", () => {
    // The reported defect: the card said eight, the invitation check counted one, because
    // the row was written from the Stripe quantity and checkout always sends one.
    const subscription = view({ plan: "personal", seats: 1 });
    const row = licenceRowFor({
      organizationId: ORG,
      subscription,
      entitlement: entitlementFor(subscription, TIERS, NOW),
      free: FREE,
      now: NOW,
    });

    assert.ok(
      row.seats > 1,
      `a plan that includes ${String(fixtureLimits("personal").seats)} people must admit them`,
    );
    assert.equal(row.seats, Math.max(fixtureLimits("personal").seats, FREE.seats));
  });

  it("should keep the organization readable when the subscription drops a plan", () => {
    const personal = fixtureLimits("personal");
    const downgraded = view({ seats: 1 });
    const row = licenceRowFor({
      organizationId: ORG,
      subscription: downgraded,
      entitlement: entitlementFor(downgraded, TIERS, NOW),
      free: FREE,
      now: NOW,
    });

    // Downgrading writes a row rather than deleting one, so the organization keeps its
    // plan, its documents and a horizon in the future; a missing row would read
    // `licence-unprovisioned`, a fault no upgrade fixes. What no longer fits is whoever is
    // over the smaller plan's allowance, and the refusal says so: "this organization has
    // more members than its licence allows" with `seat-allowance-exhausted`.
    assert.equal(row.tier, "personal");
    assert.equal(row.workspaces, personal.workspaces);
    assert.equal(row.seats, personal.seats);
    assert.ok(row.expiresAt > NOW);
  });

  it("should write the free row for a cancelled subscription, not delete anything", () => {
    const subscription = view({ status: "canceled" });
    const row = licenceRowFor({
      organizationId: ORG,
      subscription,
      entitlement: entitlementFor(subscription, TIERS, NOW),
      free: FREE,
      now: NOW,
    });

    assert.deepEqual(row, freeLicenceRow(ORG, FREE, NOW));
    assert.equal(row.tier, FREE.tier);
    assert.equal(row.workspaces, FREE.workspaces);
    assert.equal(row.seats, FREE.seats);
  });

  it("should fall back to free once a past-due grace window has closed", () => {
    const lapsed = view({ status: "past_due", periodEnd: NOW - 1 });
    const row = licenceRowFor({
      organizationId: ORG,
      subscription: lapsed,
      entitlement: entitlementFor(lapsed, TIERS, NOW),
      free: FREE,
      now: NOW,
    });
    assert.equal(row.tier, FREE.tier);
  });

  it("should refuse a paid row for a subscription with no period end", () => {
    const subscription = view({ periodEnd: null });
    const row = licenceRowFor({
      organizationId: ORG,
      subscription,
      entitlement: entitlementFor(subscription, TIERS, NOW),
      free: FREE,
      now: NOW,
    });
    // The entitlement read still grants the plan (an `active` row is live), but a paid
    // licence with no horizon is worse than the honest free row: it would never expire.
    assert.equal(row.tier, FREE.tier);
  });

  it("should keep a plan that left the tier table on the free row", () => {
    const subscription = view({ plan: "retired" });
    const row = licenceRowFor({
      organizationId: ORG,
      subscription,
      entitlement: entitlementFor(subscription, TIERS, NOW),
      free: FREE,
      now: NOW,
    });
    assert.equal(row.tier, FREE.tier);
  });
});

describe("the licence row and the entitlement read", () => {
  /**
   * The deliverable: one answer.
   *
   * The seat check counts the tier written to `organization_licences`; the relay's token
   * carries the tier `entitlementFor` answers. A paying customer used to hold both, one
   * tier apart. Every status Stripe can report is asserted here, because the bug was
   * never in one branch — it was that the licence row was never written at all.
   */
  const statuses: readonly { name: string; subscription: SubscriptionView | null; tier: string }[] =
    [
      { name: "active", subscription: view({ status: "active" }), tier: "personal" },
      { name: "trialing", subscription: view({ status: "trialing" }), tier: "personal" },
      {
        name: "past due inside the period",
        subscription: view({ status: "past_due" }),
        tier: "personal",
      },
      {
        name: "past due past the period",
        subscription: view({ status: "past_due", periodEnd: NOW - 1 }),
        tier: "free",
      },
      { name: "cancelled", subscription: view({ status: "canceled" }), tier: "free" },
      { name: "paused", subscription: view({ status: "paused" }), tier: "free" },
      { name: "unpaid", subscription: view({ status: "unpaid" }), tier: "free" },
      { name: "no subscription", subscription: null, tier: "free" },
    ];

  for (const status of statuses) {
    it(`should name one tier for ${status.name}`, async () => {
      const rows = recording();
      const licence = createLicenceProjection({ rows, tiers: TIERS, free: FREE, now: () => NOW });

      const written =
        status.subscription === null
          ? await licence.release(ORG)
          : await licence.project(status.subscription);

      const carried =
        status.subscription === null
          ? freeEntitlement
          : entitlementFor(status.subscription, TIERS, NOW);

      assert.equal(written.tier, carried.tier, "the written tier is not the minted one");
      assert.equal(written.tier, status.tier);
      assert.deepEqual(rows.rows, [written], "the write did not happen exactly once");
    });
  }
});

describe("createLicenceProjection", () => {
  it("should replace the row rather than add one, through one upsert", async () => {
    const rows = recording();
    const licence = createLicenceProjection({ rows, tiers: TIERS, free: FREE, now: () => NOW });

    await licence.project(view({ status: "active" }));
    await licence.project(view({ status: "canceled" }));

    assert.deepEqual(
      rows.rows.map((row) => row.tier),
      ["personal", "free"],
    );
    assert.equal(UPSERT_LICENCE_SQL.includes("ON CONFLICT (organization_id) DO UPDATE"), true);
  });

  it("should bind the row's values in the order the statement names them", () => {
    const row = freeLicenceRow(ORG, FREE, NOW);
    const columns = /INSERT INTO organization_licences \(([\s\S]*?)\)\s*VALUES/iu
      .exec(UPSERT_LICENCE_SQL)?.[1]
      ?.split(",")
      .map((name) => name.trim());

    assert.deepEqual(columns, [
      "organization_id",
      "licence_id",
      "tier",
      "workspaces",
      "seats",
      "document_bytes",
      "attachment_bytes",
      "expires_at",
    ]);
    const values = licenceRowValues(row);
    assert.equal(values.length, columns?.length);
    assert.equal(values[0], ORG);
    assert.equal(values[2], FREE.tier);
    assert.deepEqual(values[7], new Date(NOW + FREE.days * DAY));
  });

  it("should stamp the universe beside the licence it projects", async () => {
    const stamps: string[] = [];
    const licence = createLicenceProjection({
      rows: {
        upsert: async () => {},
        stampMode: async (organizationId, mode) => {
          stamps.push(`${organizationId}:${mode}`);
        },
      },
      tiers: TIERS,
      free: FREE,
      now: () => NOW,
      billingMode: "live",
    });

    await licence.project(view());
    assert.deepEqual(stamps, [`${ORG}:live`]);
  });

  it("should stamp nothing when the store records no universe", async () => {
    let stamped = 0;
    const licence = createLicenceProjection({
      rows: {
        upsert: async () => {},
        stampMode: async () => {
          stamped += 1;
        },
      },
      tiers: TIERS,
      free: FREE,
      now: () => NOW,
    });

    await licence.project(view());
    assert.equal(stamped, 0);
  });

  it("should stamp nothing when a licence is released", async () => {
    // A released licence belongs to an organization whose subscription row is stale or
    // gone, and stamping it would claim a universe for a subscription nobody pays for.
    const stamps: string[] = [];
    const licence = createLicenceProjection({
      rows: {
        upsert: async () => {},
        stampMode: async (organizationId, mode) => {
          stamps.push(`${organizationId}:${mode}`);
        },
      },
      tiers: TIERS,
      free: FREE,
      now: () => NOW,
      billingMode: "live",
    });

    await licence.release(ORG);
    assert.deepEqual(stamps, []);
  });

  it("should report a failed stamp instead of throwing through the webhook", async () => {
    const failures: string[] = [];
    const licence = createLicenceProjection({
      rows: {
        upsert: async () => {},
        stampMode: async () => {
          throw new BillingError("invalid-config", "the stamp failed");
        },
      },
      tiers: TIERS,
      free: FREE,
      now: () => NOW,
      billingMode: "test",
      onError: (error, context) => {
        failures.push(`${context.organizationId}:${(error as Error).message}`);
      },
    });

    const row = await licence.project(view());
    assert.equal(row.tier, "personal");
    assert.deepEqual(failures, [`${ORG}:the stamp failed`]);
  });

  it("should report a failed write instead of throwing through the webhook", async () => {
    const failures: string[] = [];
    const licence = createLicenceProjection({
      rows: {
        upsert: async () => {
          throw new BillingError("invalid-config", "the database is gone");
        },
      },
      tiers: TIERS,
      free: FREE,
      now: () => NOW,
      onError: (error, context) => {
        failures.push(`${context.organizationId}:${(error as Error).message}`);
      },
    });

    const row = await licence.project(view());
    // The row is still answered: the caller is the plugin's hook, and the plugin treats a
    // thrown hook as "log it and answer the webhook 200" either way.
    assert.equal(row.tier, "personal");
    assert.deepEqual(failures, [`${ORG}:the database is gone`]);
  });
});

describe("the plugin's lifecycle hooks", () => {
  const subscription = {
    id: "row_1",
    referenceId: ORG,
    plan: "personal",
    status: "active",
    periodEnd: new Date(NOW + DAY),
    cancelAtPeriodEnd: false,
    seats: 2,
    stripeSubscriptionId: "sub_1",
  };

  function hooksOf(projected: LicenceRow[]) {
    const licence = createLicenceProjection({
      rows: {
        upsert: async (row) => {
          projected.push(row);
        },
      },
      tiers: TIERS,
      free: FREE,
      now: () => NOW,
    });
    const options = billingPluginOptions({
      secretKey: "sk_test_51Nfixture",
      webhookSecret: "whsec_fixture",
      tiers: TIERS,
      authorizeOrganization: async () => true,
      licence,
    });
    const configured = options.subscription;
    if (configured === undefined || configured.enabled !== true) {
      throw new Error("expected enabled subscription options");
    }
    return configured;
  }

  it("should write the licence from every hook that sees a subscription change", async () => {
    const projected: LicenceRow[] = [];
    const hooks = hooksOf(projected);

    await hooks.onSubscriptionCreated?.({ subscription } as never);
    await hooks.onSubscriptionComplete?.({ subscription } as never, undefined as never);
    await hooks.onSubscriptionUpdate?.({ subscription } as never);
    // `deleted` stores `canceled` before the hook runs, which is the fallback path.
    await hooks.onSubscriptionDeleted?.({
      subscription: { ...subscription, status: "canceled" },
    } as never);

    assert.deepEqual(
      projected.map((row) => row.tier),
      ["personal", "personal", "personal", "free"],
    );
    // The plan's allowance, not the subscription's quantity: checkout writes a quantity of
    // one for a plan with no seat price, so reading the quantity alone is what made a team
    // plan admit its owner and nobody else.
    assert.equal(projected[0]?.seats, Math.max(2, fixtureLimits("personal").seats));
  });

  it("should register no hook at all when no projection is supplied", () => {
    const options = billingPluginOptions({
      secretKey: "sk_test_51Nfixture",
      webhookSecret: "whsec_fixture",
      tiers: TIERS,
      authorizeOrganization: async () => true,
    });
    const configured = options.subscription;
    if (configured === undefined || configured.enabled !== true) {
      throw new Error("expected enabled subscription options");
    }
    assert.equal(configured.onSubscriptionUpdate, undefined);
  });
});
