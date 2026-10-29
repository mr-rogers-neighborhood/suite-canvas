import { FREE_LICENCE_TIER } from "@suite/auth";
import {
  createBillingPlugin,
  createEntitlementReader,
  createLicenceProjection,
  type FreeLicenceTier,
  type LicenceProjection,
  type OrganizationEntitlements,
  parseTierTable,
  postgresLicenceRows,
  postgresSubscriptions,
  type Queryable,
  type TierTable,
} from "@suite/billing";
import type { Logger } from "../logging.js";
import { createPool } from "../pool.js";

/**
 * The one file that knows both `@suite/auth` and `@suite/billing` exist.
 *
 * `@suite/auth` takes a plugin and an entitlement reader as injected ports so the
 * identity package never imports the billing package. Something has to connect them,
 * and this process is that something: it owns neither package's rules, it only wires
 * the two ends together from the environment.
 *
 * Nothing here runs unless billing is switched on and the Stripe variables are present.
 * A control plane with no billing still serves sign-in, and `/health` reports no
 * `billing` module, which is the honest answer.
 */

export type Env = Readonly<Record<string, string | undefined>>;

/** Which credential set the deployment is spending. Absent or unknown reads as test. */
export function stripeMode(env: Env): "test" | "live" {
  return env.SUITE_BILLING_MODE?.trim().toLowerCase() === "live" ? "live" : "test";
}

/**
 * The Stripe keys for the active mode, and nothing from the other one.
 *
 * Both sets live in the settings table, so the mode is what decides which of them this
 * process holds. That is the pinning: a webhook is verified with the active mode's signing
 * secret only, so a test event that arrives while the deployment is live fails the
 * signature check instead of writing a licence. The cost is that switching modes needs
 * both keys for the new mode in place *before* the switch, which is why a half-configured
 * live set leaves billing off and names what is missing rather than half-working.
 */
export interface StripeCredentials {
  mode: "test" | "live";
  secretKey: string;
  webhookSecret: string;
  priceTiers: string;
}

/** One mode's credential set, named without needing to know which one it is. */
export function credentialsFor(env: Env, mode: "test" | "live"): StripeCredentials {
  const read = (name: string): string => (env[name] ?? "").trim();
  return mode === "live"
    ? {
        mode,
        secretKey: read("STRIPE_SECRET_KEY_LIVE"),
        webhookSecret: read("STRIPE_WEBHOOK_SECRET_LIVE"),
        priceTiers: read("STRIPE_PRICE_TIERS_LIVE"),
      }
    : {
        mode,
        secretKey: read("STRIPE_SECRET_KEY"),
        webhookSecret: read("STRIPE_WEBHOOK_SECRET"),
        priceTiers: read("STRIPE_PRICE_TIERS"),
      };
}

export function stripeCredentials(env: Env): StripeCredentials {
  return credentialsFor(env, stripeMode(env));
}

/** What one Stripe profile has, and what it is missing. */
export interface ProfileReadiness {
  /** A checkout, a portal and a webhook all have their credential. */
  complete: boolean;
  /** The registry keys that still hold nothing, in the order the panel shows them. */
  missing: string[];
  /** Plans the price table names; null when it does not parse. */
  plans: number | null;
  /** Why the price table does not parse, when it does not. */
  problem: string | null;
}

/**
 * Both profiles, side by side.
 *
 * The two credential sets exist so an operator can move the whole deployment between test
 * and live without a redeploy, and the order matters: the new mode's set has to be complete
 * *before* the switch, or billing boots with nothing and a deployment that charges nobody
 * syncs everybody. This is the read that lets the panel say so, and the write guard in
 * `settings.ts` refuses a switch that this would call incomplete.
 */
export interface BillingProfiles {
  /** What the settings row says, which is what the next boot will spend. */
  active: "test" | "live";
  profiles: Record<"test" | "live", ProfileReadiness>;
}

function readinessOf(env: Env, mode: "test" | "live"): ProfileReadiness {
  const credentials = credentialsFor(env, mode);
  const suffix = mode === "live" ? ".live" : ".test";
  const missing: string[] = [];
  if (credentials.secretKey.length === 0) missing.push(`billing.stripe.secretKey${suffix}`);
  if (credentials.webhookSecret.length === 0) missing.push(`billing.stripe.webhookSecret${suffix}`);
  if (credentials.priceTiers.length === 0) missing.push(`billing.stripe.prices${suffix}`);
  const table = credentials.priceTiers.length === 0 ? null : parseTierTable(credentials.priceTiers);
  return {
    complete: missing.length === 0 && table?.isOk() === true,
    missing,
    plans: table?.isOk() === true ? table.value.size : null,
    problem: table?.isErr() === true ? table.error.message : null,
  };
}

export function billingProfiles(env: Env): BillingProfiles {
  return {
    active: stripeMode(env),
    profiles: { test: readinessOf(env, "test"), live: readinessOf(env, "live") },
  };
}

/** True when a checkout, a portal and a webhook all have what the active mode needs. */
/**
 * What a Stripe call to one mode actually answers.
 *
 * Readiness above is shape: a key is present, a price table parses. That is not the same
 * as a profile that can charge, and the difference is invisible until a customer presses
 * the button. The case that costs money is a price table copied from test mode: the ids
 * parse, every field is right, and Stripe answers "No such price" for all of them in live
 * mode. So this asks Stripe, in the mode that would spend the key, and names what it found.
 */
export interface ProfileCheck {
  mode: "test" | "live";
  /** True when Stripe answered at all; false for a network failure, which decides nothing. */
  reachable: boolean;
  /** True when the key is accepted. */
  keyWorks: boolean;
  /** One row per price the table names, in table order. */
  prices: { priceId: string; tier: string; exists: boolean }[];
  /** The first thing wrong, in a sentence an operator can act on; null when nothing is. */
  problem: string | null;
  ok: boolean;
}

const STRIPE_API = "https://api.stripe.com";

interface StripeErrorBody {
  error?: { message?: string; type?: string };
}

/** One GET against Stripe, with the answer parsed and a deadline so a write cannot hang. */
async function stripeGet(
  fetcher: typeof fetch,
  path: string,
  secretKey: string,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const response = await fetcher(`${STRIPE_API}${path}`, {
    headers: { authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
}

function stripeMessage(body: unknown): string | null {
  const message = (body as StripeErrorBody | null)?.error?.message;
  return typeof message === "string" && message.length > 0 ? message : null;
}

export async function verifyStripeProfile(
  env: Env,
  mode: "test" | "live",
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<ProfileCheck> {
  const credentials = credentialsFor(env, mode);
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const check: ProfileCheck = {
    mode,
    reachable: false,
    keyWorks: false,
    prices: [],
    problem: null,
    ok: false,
  };
  if (credentials.secretKey.length === 0) {
    return {
      ...check,
      problem: `no ${mode} secret key is saved (billing.stripe.secretKey.${mode})`,
    };
  }

  try {
    const account = await stripeGet(fetcher, "/v1/account", credentials.secretKey, timeoutMs);
    check.reachable = true;
    if (account.status < 200 || account.status >= 300) {
      return {
        ...check,
        problem: `Stripe refused the ${mode} key: ${stripeMessage(account.body) ?? `HTTP ${account.status}`}`,
      };
    }
  } catch (cause) {
    // Nothing was learned: a network that cannot reach Stripe decides nothing about a key,
    // so this is a check that did not run rather than a profile that failed.
    return {
      ...check,
      problem: `Stripe could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  check.keyWorks = true;
  const table = parseTierTable(credentials.priceTiers);
  if (table.isErr()) {
    return { ...check, problem: table.error.message };
  }

  for (const [priceId, plan] of table.value) {
    try {
      const price = await stripeGet(
        fetcher,
        `/v1/prices/${encodeURIComponent(priceId)}`,
        credentials.secretKey,
        timeoutMs,
      );
      const exists = price.status >= 200 && price.status < 300;
      check.prices.push({ priceId, tier: plan.tier, exists });
    } catch (cause) {
      check.prices.push({ priceId, tier: plan.tier, exists: false });
      return {
        ...check,
        problem: `Stripe could not be reached while checking ${priceId}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      };
    }
  }

  // A price id belongs to one mode. A table copied from test mode reads as complete here
  // and fails at the first checkout, which is the mistake this names.
  const missing = check.prices.filter((price) => !price.exists);
  const problem =
    missing.length === 0
      ? null
      : `${missing.map((price) => price.priceId).join(", ")} ${
          missing.length === 1 ? "does" : "do"
        } not exist in ${mode} mode. A price id belongs to one mode, so a table copied from the other mode has to be replaced with ${mode} prices.`;
  return { ...check, problem, ok: problem === null };
}

export function billingConfigured(env: Env): boolean {
  const flag = env.SUITE_BILLING_ENABLED?.trim().toLowerCase();
  if (flag !== "1" && flag !== "true") return false;
  const active = stripeCredentials(env);
  return (
    active.secretKey.length > 0 && active.webhookSecret.length > 0 && active.priceTiers.length > 0
  );
}

/** What a mode is missing, for the one log line that explains billing staying off. */
export function missingStripeSettings(env: Env): string[] {
  const active = stripeCredentials(env);
  const suffix = active.mode === "live" ? "LIVE" : "";
  const missing: string[] = [];
  if (active.secretKey.length === 0) missing.push(`STRIPE_SECRET_KEY${suffix ? `_${suffix}` : ""}`);
  if (active.webhookSecret.length === 0)
    missing.push(`STRIPE_WEBHOOK_SECRET${suffix ? `_${suffix}` : ""}`);
  if (active.priceTiers.length === 0)
    missing.push(`STRIPE_PRICE_TIERS${suffix ? `_${suffix}` : ""}`);
  return missing;
}

/** Subscriptions live in the control-plane database, the same one accounts use. */
function databaseUrlOf(env: Env): string {
  const url =
    env.SUITE_CONTROL_PLANE_DATABASE_URL?.trim() ?? env.SUITE_AUTH_DATABASE_URL?.trim() ?? "";
  if (url.length === 0) {
    throw new Error(
      "SUITE_BILLING_ENABLED is set but SUITE_CONTROL_PLANE_DATABASE_URL is empty: " +
        "subscriptions are read from the control-plane database",
    );
  }
  return url;
}

/**
 * Roles that may spend an organization's money.
 *
 * Better Auth's organization plugin writes these into `member.role`. A plain member can
 * use a workspace; only an owner or an admin can start, change or cancel the
 * subscription that pays for it.
 */
const SPENDING_ROLES: readonly string[] = ["owner", "admin"];

const MEMBERSHIP_SQL = `
  SELECT 1
  FROM "member"
  WHERE "organizationId" = $1
    AND "userId" = $2
    AND "role" = ANY($3)
  LIMIT 1
`;

export interface BillingComposition {
  /** Registered into the auth plugin list; owns checkout, portal and the webhook. */
  plugin: ReturnType<typeof createBillingPlugin>;
  /** Read on every token mint, so a cancelled plan stops working within one TTL. */
  entitlements: OrganizationEntitlements;
  /** Written on every subscription change, so the seat check reads the same tier. */
  licence: LicenceProjection;
  /** Releases the pool. Called on shutdown. */
  close: () => Promise<void>;
}

/** The tier a token carries, and the same tier in the row the seat check counts against. */
export interface TierParts {
  entitlements: OrganizationEntitlements;
  licence: LicenceProjection;
}

export interface TierPartsDeps {
  queryable: Queryable;
  /** `STRIPE_PRICE_TIERS`, parsed: the only place a paid limit is written. */
  tiers: TierTable;
  /**
   * `FREE_LICENCE_TIER` from `@suite/auth`.
   *
   * Passed rather than imported by `@suite/billing`, because the numbers live with the
   * seat check that enforces them and the provisioning trigger that writes them.
   */
  free: FreeLicenceTier;
  now?: () => number;
  onProjectionError?: (error: unknown, context: { organizationId: string }) => void;
}

/**
 * The one answer, assembled: a read and a write over one database and one tier table.
 *
 * The two are built together on purpose. `createEntitlementReader` mints the token from
 * the `subscription` row, and `createLicenceProjection` writes `organization_licences`
 * from the *same* function — `entitlementFor` — so a subscriber's seat check and their
 * token cannot name different tiers. Building them apart is how the bug happened.
 */
export function tierParts(deps: TierPartsDeps): TierParts {
  return {
    entitlements: createEntitlementReader({
      subscriptions: postgresSubscriptions(deps.queryable),
      tiers: deps.tiers,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    }),
    licence: createLicenceProjection({
      rows: postgresLicenceRows(deps.queryable),
      tiers: deps.tiers,
      free: deps.free,
      ...(deps.now === undefined ? {} : { now: deps.now }),
      ...(deps.onProjectionError === undefined ? {} : { onError: deps.onProjectionError }),
    }),
  };
}

/**
 * Builds the billing plugin and the entitlement reader, or `null` when billing is off.
 *
 * One pool serves the subscription read, the licence write and the membership check, for
 * the life of the process. The entitlement read runs on every token mint, so a pool per
 * request would be a connection storm under a login rush.
 */
export async function composeBilling(env: Env, logger: Logger): Promise<BillingComposition | null> {
  if (!billingConfigured(env)) {
    logger.info("billing is off; no billing routes mounted", {
      mode: stripeMode(env),
      missing: missingStripeSettings(env),
    });
    return null;
  }

  const stripe = stripeCredentials(env);
  const parsed = parseTierTable(stripe.priceTiers);
  if (parsed.isErr()) throw new Error(`STRIPE_PRICE_TIERS is unusable: ${parsed.error.message}`);
  const tiers = parsed.value;

  const pool = createPool({ connectionString: databaseUrlOf(env), max: 4 });

  const queryable: Queryable = {
    query: async (text, values) => pool.query(text, values as unknown[] | undefined),
  };

  const parts = tierParts({
    queryable,
    tiers,
    free: FREE_LICENCE_TIER,
    onProjectionError: (error, { organizationId }) => {
      // The plugin answers the webhook 200 whatever a hook does, so this log line is the
      // only evidence a licence write failed. The next lifecycle event repairs it.
      logger.error("licence projection failed", {
        organizationId,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  /**
   * Whether this user administers this organization.
   *
   * A failed query refuses rather than allows: answering `true` on doubt would let any
   * signed-in account point a checkout at somebody else's organization.
   */
  const authorizeOrganization: Parameters<typeof createBillingPlugin>[0]["authorizeOrganization"] =
    async ({ userId, organizationId }) => {
      try {
        const result = await queryable.query(MEMBERSHIP_SQL, [
          organizationId,
          userId,
          SPENDING_ROLES,
        ]);
        return result.rows.length > 0;
      } catch (error) {
        logger.error("billing membership check failed", {
          organizationId,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    };

  return {
    plugin: createBillingPlugin({
      // The active mode's set, so a webhook signed by the other mode cannot verify.
      secretKey: stripe.secretKey,
      webhookSecret: stripe.webhookSecret,
      tiers,
      authorizeOrganization,
      licence: parts.licence,
    }),
    entitlements: parts.entitlements,
    licence: parts.licence,
    close: async () => {
      await pool.end();
    },
  };
}
