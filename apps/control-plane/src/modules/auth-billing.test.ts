import { authEnvironment, FREE_LICENCE_TIER, licenceStateFor, postgresLicences } from "@suite/auth";
import {
  parseTierTable,
  type SubscriptionView,
  subscriptionViewOf,
  type TierTable,
} from "@suite/billing";
import { describe, expect, it } from "vitest";
import {
  billingConfigured,
  missingStripeSettings,
  stripeCredentials,
  stripeMode,
  tierParts,
  verifyStripeProfile,
} from "./auth-billing.js";

/**
 * One answer, asserted where it can actually be wrong.
 *
 * The bug this proves fixed was not inside either package: `@suite/billing` minted a
 * token from the `subscription` row and nothing wrote `organization_licences`, so
 * `@suite/auth`'s seat check — the reader next to this one — counted a free row while the
 * token said `solo`. Only the composition knows both, so only this file can ask both
 * questions and compare the answers.
 *
 * The database is a fake `Queryable`, not a stub per call: the projection's own SQL and
 * the auth reader's own SQL run against it, so the row that is written is the row that is
 * read back, with each package's real statement in between. `pnpm db:verify` does the
 * same thing against a real Postgres.
 */

const ORG = "org_1";
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const TIERS: TierTable = (() => {
  const parsed = parseTierTable(
    JSON.stringify({
      price_solo: {
        tier: "solo",
        workspaces: 3,
        documentBytes: 268_435_456,
        attachmentBytes: 1_073_741_824,
      },
      price_studio: {
        tier: "studio",
        workspaces: 25,
        documentBytes: 2_147_483_648,
        attachmentBytes: 8_589_934_592,
      },
    }),
  );
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
})();

/** The columns `UPSERT_LICENCE_SQL` names, read from the statement the projection sends. */
function columnsOf(text: string): string[] {
  const match = /INSERT INTO organization_licences \(([\s\S]*?)\)\s*VALUES/iu.exec(text);
  if (match?.[1] === undefined) throw new Error(`not a licence upsert: ${text}`);
  return match[1].split(",").map((name) => name.trim());
}

/**
 * The two tables these paths touch, in memory.
 *
 * It answers only the three statements that reach it — the entitlement read's
 * `LIVE_SUBSCRIPTION_SQL`, the projection's upsert, and `postgresLicences`' own select —
 * and throws on anything else, so a statement that drifted somewhere unexpected fails
 * loudly instead of being answered with an empty row set.
 *
 * The rows are mutable arrays because `@suite/auth`'s `Queryable` says `unknown[]` and
 * `@suite/billing`'s says a readonly array: the narrower shape satisfies both, so one
 * fake can stand behind the writer and the reader.
 */
interface FakeControlPlane {
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
  setSubscription(row: Record<string, unknown> | null): void;
}

function fakeControlPlane(): FakeControlPlane {
  let subscription: Record<string, unknown> | null = null;
  let licence: Record<string, unknown> | null = null;
  return {
    setSubscription: (row) => {
      subscription = row;
    },
    query: async (text, values) => {
      if (text.includes(`FROM "subscription"`)) {
        return { rows: subscription === null ? [] : [subscription] };
      }
      if (text.includes("INSERT INTO organization_licences")) {
        const columns = columnsOf(text);
        const row: Record<string, unknown> = {};
        for (const [index, column] of columns.entries()) row[column] = values?.[index];
        licence = row;
        return { rows: [] };
      }
      if (text.includes("FROM organization_licences")) {
        return { rows: licence === null ? [] : [licence] };
      }
      throw new Error(`the fake control plane saw a statement it does not answer: ${text}`);
    },
  };
}

/** A subscription row as the Stripe plugin stores it, for one status. */
function storedSubscription(status: string, periodEnd: number | null = NOW + DAY) {
  return {
    plan: "solo",
    status,
    periodEnd: periodEnd === null ? null : new Date(periodEnd),
    cancelAtPeriodEnd: false,
    seats: 4,
    stripeSubscriptionId: "sub_1",
  };
}

function viewOf(status: string, periodEnd: number | null = NOW + DAY): SubscriptionView {
  return subscriptionViewOf({
    referenceId: ORG,
    plan: "solo",
    status,
    ...(periodEnd === null ? {} : { periodEnd: new Date(periodEnd) }),
    seats: 4,
    stripeSubscriptionId: "sub_1",
  });
}

async function answersFor(status: string, periodEnd: number | null = NOW + DAY) {
  const database = fakeControlPlane();
  database.setSubscription(storedSubscription(status, periodEnd));
  const parts = tierParts({
    queryable: database,
    tiers: TIERS,
    free: FREE_LICENCE_TIER,
    now: () => NOW,
  });

  await parts.licence.project(viewOf(status, periodEnd));

  // Both questions, asked the way each package asks them in production.
  const token = await parts.entitlements.forOrganization(ORG);
  const state = licenceStateFor(true, await postgresLicences(database).forOrganization(ORG));
  if (state.kind !== "licensed") throw new Error(`no licence row was written: ${state.kind}`);
  return { token, seat: state.licence };
}

describe("the entitlement read and the seat check", () => {
  const cases: readonly { status: string; periodEnd?: number | null; tier: string }[] = [
    { status: "active", tier: "solo" },
    { status: "trialing", tier: "solo" },
    { status: "past_due", tier: "solo" },
    { status: "past_due", periodEnd: NOW - 1, tier: "free" },
    { status: "canceled", tier: "free" },
    { status: "paused", tier: "free" },
    { status: "unpaid", tier: "free" },
  ];

  for (const entry of cases) {
    const label = `${entry.status}${entry.periodEnd === NOW - 1 ? ", grace window closed" : ""}`;
    it(`should name the same tier for ${label}`, async () => {
      const { token, seat } = await answersFor(entry.status, entry.periodEnd ?? NOW + DAY);

      expect(seat.claims.tier).toBe(token.tier);
      expect(seat.claims.tier).toBe(entry.tier);
    });
  }

  it("should name the free tier for an organization with no subscription at all", async () => {
    const database = fakeControlPlane();
    const parts = tierParts({
      queryable: database,
      tiers: TIERS,
      free: FREE_LICENCE_TIER,
      now: () => NOW,
    });

    // The fallback a cancelled subscription lands on, and the row 0009's trigger writes.
    await parts.licence.release(ORG);

    const token = await parts.entitlements.forOrganization(ORG);
    const state = licenceStateFor(true, await postgresLicences(database).forOrganization(ORG));
    if (state.kind !== "licensed") throw new Error(`no licence row was written: ${state.kind}`);

    expect(token.tier).toBe(FREE_LICENCE_TIER.tier);
    expect(state.licence.claims.tier).toBe(FREE_LICENCE_TIER.tier);
    expect(state.licence.claims.workspaces).toBe(FREE_LICENCE_TIER.workspaces);
    expect(state.licence.seats).toBe(FREE_LICENCE_TIER.seats);
  });

  it("should upgrade the seat check, not just the token, for a paying customer", async () => {
    // The reported bug, as a test: a subscriber's seat check counted the free row's one
    // seat while the token granted a plan that sells more.
    const { seat } = await answersFor("active");

    expect(seat.claims.workspaces).toBe(3);
    expect(seat.seats).toBe(4);
    expect(seat.claims.expiresAt).toBe(NOW + DAY);
  });

  it("should leave a lapsed subscriber on the free row rather than deleting it", async () => {
    const { seat } = await answersFor("canceled");

    expect(seat.claims.id).toBe(`free:${ORG}`);
    expect(seat.seats).toBe(FREE_LICENCE_TIER.seats);
    expect(seat.claims.workspaces).toBe(FREE_LICENCE_TIER.workspaces);
  });
});

describe("billingConfigured", () => {
  const stripe = {
    SUITE_BILLING_ENABLED: "1",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_TIERS: '{"price_solo":{"tier":"solo","workspaces":3}}',
  };

  it("should turn billing on for the process environment", () => {
    expect(billingConfigured(stripe)).toBe(true);
  });

  it("should read the credential set the mode names, and only that one", () => {
    const both = {
      ...stripe,
      SUITE_BILLING_MODE: "live",
      STRIPE_SECRET_KEY_LIVE: "sk_live_x",
      STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live",
      STRIPE_PRICE_TIERS_LIVE: '{"price_live":{"tier":"solo","workspaces":3}}',
    };

    expect(stripeCredentials(both)).toEqual({
      mode: "live",
      secretKey: "sk_live_x",
      webhookSecret: "whsec_live",
      priceTiers: '{"price_live":{"tier":"solo","workspaces":3}}',
    });
    // The test set is present and deliberately not read.
    expect(stripeCredentials({ ...both, SUITE_BILLING_MODE: "test" })).toEqual({
      mode: "test",
      secretKey: "sk_test_x",
      webhookSecret: "whsec_x",
      priceTiers: '{"price_solo":{"tier":"solo","workspaces":3}}',
    });
  });

  it("should stay off when the live mode has no live keys yet", () => {
    // The failure mode this prevents: mode flipped to live while the keys are still the
    // test ones, so test events would keep writing licences on a live deployment.
    const flipped = { ...stripe, SUITE_BILLING_MODE: "live" };

    expect(billingConfigured(flipped)).toBe(false);
    expect(missingStripeSettings(flipped)).toEqual([
      "STRIPE_SECRET_KEY_LIVE",
      "STRIPE_WEBHOOK_SECRET_LIVE",
      "STRIPE_PRICE_TIERS_LIVE",
    ]);
  });

  it("should treat an unknown mode as test rather than guessing", () => {
    expect(stripeMode({ ...stripe, SUITE_BILLING_MODE: "prod" })).toBe("test");
    expect(stripeMode(stripe)).toBe("test");
  });

  it("should stay off for the auth whitelist, which is why the boot passes the source", () => {
    // `AuthEnvironment` is a whitelist with no index signature and no Stripe variable, so
    // a boot that handed `authEnvironment(...)` to `composeBilling` reported billing off
    // whatever an operator set. This assertion is the reason `defaultBoot` reads `source`.
    expect(billingConfigured({ ...authEnvironment(stripe) })).toBe(false);
  });
});

describe("verifyStripeProfile", () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_PRICE_TIERS: JSON.stringify({
      price_solo: { tier: "solo", workspaces: 3, documentBytes: 1, attachmentBytes: 1 },
      price_team: { tier: "team", workspaces: 9, documentBytes: 1, attachmentBytes: 1 },
    }),
    SUITE_BILLING_MODE: "live",
    STRIPE_SECRET_KEY_LIVE: "sk_live_x",
    STRIPE_PRICE_TIERS_LIVE: JSON.stringify({
      price_solo: { tier: "solo", workspaces: 3, documentBytes: 1, attachmentBytes: 1 },
      price_team: { tier: "team", workspaces: 9, documentBytes: 1, attachmentBytes: 1 },
    }),
  };

  /** A Stripe that answers the way the real one does, keyed by path. */
  const stripe = (answers: Record<string, { status: number; body?: unknown }>) => {
    const seen: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      seen.push(path);
      const answer = answers[path] ?? {
        status: 404,
        body: { error: { message: "no such thing" } },
      };
      return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
    }) as typeof fetch;
    return { fetcher, seen };
  };

  it("should pass when the key works and every price exists in that mode", async () => {
    const { fetcher } = stripe({
      "/v1/account": { status: 200 },
      "/v1/prices/price_solo": { status: 200 },
      "/v1/prices/price_team": { status: 200 },
    });

    const check = await verifyStripeProfile(env, "live", { fetch: fetcher });

    expect(check).toMatchObject({ mode: "live", reachable: true, keyWorks: true, ok: true });
    expect(check.prices.map((price) => price.exists)).toEqual([true, true]);
    expect(check.problem).toBeNull();
  });

  it("should name a price that does not exist in the mode being checked", async () => {
    // The exact mistake a copied table makes: everything parses, and Stripe has never
    // heard of the ids in this mode.
    const { fetcher } = stripe({
      "/v1/account": { status: 200 },
      "/v1/prices/price_solo": { status: 404, body: { error: { message: "No such price" } } },
      "/v1/prices/price_team": { status: 404, body: { error: { message: "No such price" } } },
    });

    const check = await verifyStripeProfile(env, "live", { fetch: fetcher });

    expect(check.ok).toBe(false);
    expect(check.keyWorks).toBe(true);
    expect(check.problem).toContain("price_solo, price_team");
    expect(check.problem).toContain("not exist in live mode");
  });

  it("should reject a key Stripe refuses, quoting what it said", async () => {
    const { fetcher, seen } = stripe({
      "/v1/account": {
        status: 401,
        body: { error: { message: "Invalid API Key provided: v1.abc" } },
      },
    });

    const check = await verifyStripeProfile(env, "test", { fetch: fetcher });

    expect(check).toMatchObject({ reachable: true, keyWorks: false, ok: false });
    expect(check.problem).toContain("Stripe refused the test key");
    // The key was refused, so there is nothing to ask about the prices.
    expect(seen).toEqual(["/v1/account"]);
  });

  it("should say nothing was learned when Stripe cannot be reached", async () => {
    const fetcher = (async () => {
      throw new Error("getaddrinfo ENOTFOUND api.stripe.com");
    }) as unknown as typeof fetch;

    const check = await verifyStripeProfile(env, "test", { fetch: fetcher });

    // Reachable false is what the caller reads to decide not to refuse a write over a
    // network that happened to be down.
    expect(check).toMatchObject({ reachable: false, ok: false });
    expect(check.problem).toContain("could not be reached");
  });

  it("should name a missing key before it calls anything", async () => {
    const { fetcher, seen } = stripe({});

    const check = await verifyStripeProfile({}, "live", { fetch: fetcher });

    expect(check.problem).toContain("no live secret key");
    expect(seen).toEqual([]);
  });
});
