import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BillingError } from "../errors.ts";
import { fixtureLimits, tierTableFixture } from "../testing/fixtures.ts";
import {
  type AuthorizeOrganizationInput,
  billingPluginOptions,
  createBillingPlugin,
  planList,
} from "./plugin.ts";

const TIERS = tierTableFixture();
const SECRET = "sk_test_51Nfixture";
const WEBHOOK_SECRET = "whsec_fixture";

function granting(): {
  authorize: (input: AuthorizeOrganizationInput) => Promise<boolean>;
  seen: AuthorizeOrganizationInput[];
} {
  const seen: AuthorizeOrganizationInput[] = [];
  return {
    seen,
    authorize: async (input) => {
      seen.push(input);
      return input.organizationId === "org_1";
    },
  };
}

function optionsWith(
  authorize: (input: AuthorizeOrganizationInput) => Promise<boolean>,
  extra: { coupon?: string } = {},
) {
  return billingPluginOptions({
    secretKey: SECRET,
    webhookSecret: WEBHOOK_SECRET,
    tiers: TIERS,
    authorizeOrganization: authorize,
    ...extra,
  });
}

/** The params hook called the way the plugin calls it, with one organization's reference. */
async function checkoutParams(extra: { coupon?: string } = {}) {
  const options = optionsWith(granting().authorize, extra);
  const params = subscriptionOf(options).getCheckoutSessionParams;
  assert.ok(params !== undefined);
  type Input = Parameters<typeof params>[0];
  return params(
    {
      user: { id: "user_1" },
      subscription: { referenceId: "org_1", plan: "solo", status: "incomplete" },
      plan: plansOf(options)[0],
    } as unknown as Input,
    {} as unknown as Parameters<typeof params>[1],
    {} as unknown as Parameters<typeof params>[2],
  );
}

function subscriptionOf(options: ReturnType<typeof optionsWith>) {
  const subscription = options.subscription;
  if (subscription === undefined || subscription.enabled !== true) {
    throw new Error("expected enabled subscription options");
  }
  return subscription;
}

function plansOf(options: ReturnType<typeof optionsWith>) {
  const plans = subscriptionOf(options).plans;
  if (typeof plans === "function") throw new Error("expected a static plan list");
  return plans;
}

describe("planList", () => {
  it("should carry each fixture plan with its limits", () => {
    const plans = planList(TIERS);
    const personal = fixtureLimits("personal");

    assert.equal(plans.length, 2);
    assert.deepEqual(plans[0], {
      name: "personal",
      priceId: "price_solo",
      limits: {
        workspaces: personal.workspaces,
        seats: personal.seats,
        documentBytes: personal.documentBytes,
        attachmentBytes: personal.attachmentBytes,
      },
    });
  });

  it("should sell the first price when two prices name one tier", () => {
    const monthly = fixtureLimits("personal");
    const tiers = new Map([
      ["price_monthly", monthly],
      ["price_annual", monthly],
    ]);

    assert.deepEqual(
      planList(tiers).map((plan) => plan.priceId),
      ["price_monthly"],
    );
  });

  it("should sell a plan that includes several people, carrying its allowance", () => {
    // A team plan is a fixed allowance, not a per-seat price: checkout writes a quantity
    // of one because no plan carries a `seatPriceId`, so the number the invitation check
    // counts comes from the table through `organization_licences.seats`. Refusing the
    // table here is what made a plan priced for a team admit only its owner.
    const team = { tier: "team", seats: 8, workspaces: 5, documentBytes: 1, attachmentBytes: 2 };

    const plans = planList(new Map([["price_team", team]]));
    assert.deepEqual(
      plans.map((plan) => plan.name),
      ["team"],
    );
    const sold = plans[0];
    assert.ok(sold !== undefined && sold.limits !== undefined);
    assert.equal(sold.limits.seats, 8);
  });
});

describe("billingPluginOptions", () => {
  it("should configure the organization reference and the webhook secret", () => {
    const options = optionsWith(granting().authorize);

    assert.equal(options.stripeWebhookSecret, WEBHOOK_SECRET);
    assert.equal(options.createCustomerOnSignUp, true);
    assert.equal(options.organization?.enabled, true);
    assert.deepEqual(
      plansOf(options).map((plan) => plan.name),
      ["personal", "organization"],
    );
  });

  it("should let a caller turn customer creation off", () => {
    const options = billingPluginOptions({
      secretKey: SECRET,
      webhookSecret: WEBHOOK_SECRET,
      tiers: TIERS,
      authorizeOrganization: granting().authorize,
      createCustomerOnSignUp: false,
    });

    assert.equal(options.createCustomerOnSignUp, false);
  });

  it("should refuse an empty Stripe key or webhook secret", () => {
    const deps = {
      secretKey: "  ",
      webhookSecret: WEBHOOK_SECRET,
      tiers: TIERS,
      authorizeOrganization: granting().authorize,
    };

    assert.throws(
      () => billingPluginOptions(deps),
      (error: unknown) => error instanceof BillingError && error.code === "not-configured",
    );
    assert.throws(
      () => billingPluginOptions({ ...deps, secretKey: SECRET, webhookSecret: "" }),
      (error: unknown) => error instanceof BillingError && error.code === "not-configured",
    );
  });

  it("should refuse a table that names no plan", () => {
    assert.throws(
      () =>
        billingPluginOptions({
          secretKey: SECRET,
          webhookSecret: WEBHOOK_SECRET,
          tiers: new Map(),
          authorizeOrganization: granting().authorize,
        }),
      (error: unknown) => error instanceof BillingError && error.code === "invalid-config",
    );
  });
});

describe("authorizeReference", () => {
  it("should ask whether the user administers the referenced organization", async () => {
    const granted = granting();
    const subscription = subscriptionOf(optionsWith(granted.authorize));
    const authorize = subscription.authorizeReference;
    assert.ok(authorize !== undefined);
    type Input = Parameters<typeof authorize>[0];

    const allowed = await authorize(
      {
        user: { id: "user_1" },
        referenceId: "org_1",
        action: "billing-portal",
      } as unknown as Input,
      {} as unknown as Parameters<typeof authorize>[1],
    );

    assert.equal(allowed, true);
    assert.deepEqual(granted.seen, [
      { userId: "user_1", organizationId: "org_1", action: "billing-portal" },
    ]);
  });
});

describe("getCheckoutSessionParams", () => {
  it("should write the organization onto the session", async () => {
    const subscription = subscriptionOf(optionsWith(granting().authorize));
    const params = subscription.getCheckoutSessionParams;
    assert.ok(params !== undefined);
    type Input = Parameters<typeof params>[0];

    const result = await params(
      {
        user: { id: "user_1" },
        subscription: { referenceId: "org_1", plan: "solo", status: "incomplete" },
        plan: plansOf(optionsWith(granting().authorize))[0],
      } as unknown as Input,
      {} as unknown as Parameters<typeof params>[1],
      {} as unknown as Parameters<typeof params>[2],
    );

    assert.equal(result?.params?.client_reference_id, "org_1");
    assert.deepEqual(result?.params?.metadata, { organizationId: "org_1" });
  });

  it("asks Checkout for a promotion-code field, so a comp needs no second price list", async () => {
    const subscription = subscriptionOf(optionsWith(granting().authorize));
    const params = subscription.getCheckoutSessionParams;
    assert.ok(params !== undefined);
    type Input = Parameters<typeof params>[0];

    const result = await params(
      {
        user: { id: "user_1" },
        subscription: { referenceId: "org_1", plan: "solo", status: "incomplete" },
        plan: plansOf(optionsWith(granting().authorize))[0],
      } as unknown as Input,
      {} as unknown as Parameters<typeof params>[1],
      {} as unknown as Parameters<typeof params>[2],
    );

    // Off by default on a Checkout Session, and the only place a discount can come from.
    assert.equal(result?.params?.allow_promotion_codes, true);
  });

  it("does not ask for a card when the amount due is nothing", async () => {
    // A free alpha behind a card form is a card form in front of a product nobody is
    // paying for. `if_required` is what lets a fully discounted first invoice through.
    const result = await checkoutParams();

    assert.equal(result?.params?.payment_method_collection, "if_required");
  });

  it("applies a configured coupon to every checkout instead of a code to type", async () => {
    const result = await checkoutParams({ coupon: "alpha-free" });

    assert.deepEqual(result?.params?.discounts, [{ coupon: "alpha-free" }]);
    // Stripe refuses both on one session, so the field goes when the discount arrives.
    assert.equal(result?.params?.allow_promotion_codes, undefined);
  });

  it("treats a blank coupon as none, rather than sending an empty id", async () => {
    const result = await checkoutParams({ coupon: "   " });

    assert.equal(result?.params?.discounts, undefined);
    assert.equal(result?.params?.allow_promotion_codes, true);
  });

  it("should refuse a reference the user does not administer", async () => {
    const subscription = subscriptionOf(optionsWith(granting().authorize));
    const params = subscription.getCheckoutSessionParams;
    assert.ok(params !== undefined);
    type Input = Parameters<typeof params>[0];

    const refuse = async (): Promise<unknown> =>
      params(
        {
          user: { id: "user_1" },
          subscription: { referenceId: "user_1", plan: "solo", status: "incomplete" },
          plan: plansOf(optionsWith(granting().authorize))[0],
        } as unknown as Input,
        {} as unknown as Parameters<typeof params>[1],
        {} as unknown as Parameters<typeof params>[2],
      );

    await assert.rejects(refuse, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /belongs to an organization/u);
      return true;
    });
  });
});

describe("createBillingPlugin", () => {
  it("should register the plugin and its two owned endpoints", () => {
    const plugin = createBillingPlugin({
      secretKey: SECRET,
      webhookSecret: WEBHOOK_SECRET,
      tiers: TIERS,
      authorizeOrganization: granting().authorize,
    }) as { id: string; endpoints: Record<string, { path: string }> };

    assert.equal(plugin.id, "stripe");
    assert.deepEqual(Object.keys(plugin.endpoints).sort(), [
      "cancelSubscription",
      "createBillingPortal",
      "listActiveSubscriptions",
      "restoreSubscription",
      "stripeWebhook",
      "subscriptionSuccess",
      "upgradeSubscription",
    ]);
    assert.equal(plugin.endpoints.stripeWebhook?.path, "/stripe/webhook");
    assert.equal(plugin.endpoints.upgradeSubscription?.path, "/subscription/upgrade");
  });

  it("should construct without a network call", () => {
    // A test-mode key is enough: no request leaves this process until a route runs.
    assert.doesNotThrow(() =>
      createBillingPlugin({
        secretKey: SECRET,
        webhookSecret: WEBHOOK_SECRET,
        tiers: TIERS,
        authorizeOrganization: async () => true,
      }),
    );
  });
});
