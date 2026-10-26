import {
  createBillingPlugin,
  createEntitlementReader,
  type OrganizationEntitlements,
  parseTierTable,
  postgresSubscriptions,
  type Queryable,
} from "@suite/billing";
import type { Logger } from "../logging.js";

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

/** True when a checkout, a portal and a webhook all have what they need. */
export function billingConfigured(env: Env): boolean {
  const flag = env.SUITE_BILLING_ENABLED?.trim().toLowerCase();
  if (flag !== "1" && flag !== "true") return false;
  return (
    (env.STRIPE_SECRET_KEY?.trim().length ?? 0) > 0 &&
    (env.STRIPE_WEBHOOK_SECRET?.trim().length ?? 0) > 0 &&
    (env.STRIPE_PRICE_TIERS?.trim().length ?? 0) > 0
  );
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
  /** Releases the pool. Called on shutdown. */
  close: () => Promise<void>;
}

/**
 * Builds the billing plugin and the entitlement reader, or `null` when billing is off.
 *
 * One pool serves both the subscription read and the membership check, for the life of
 * the process. The entitlement read runs on every token mint, so a pool per request
 * would be a connection storm under a login rush.
 */
export async function composeBilling(env: Env, logger: Logger): Promise<BillingComposition | null> {
  if (!billingConfigured(env)) {
    logger.info("billing is off; no billing routes mounted");
    return null;
  }

  const parsed = parseTierTable(env.STRIPE_PRICE_TIERS);
  if (parsed.isErr()) throw new Error(`STRIPE_PRICE_TIERS is unusable: ${parsed.error.message}`);
  const tiers = parsed.value;

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrlOf(env), max: 4 });

  const queryable: Queryable = {
    query: async (text, values) => pool.query(text, values as unknown[] | undefined),
  };

  const entitlements = createEntitlementReader({
    subscriptions: postgresSubscriptions(queryable),
    tiers,
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
      secretKey: (env.STRIPE_SECRET_KEY ?? "").trim(),
      webhookSecret: (env.STRIPE_WEBHOOK_SECRET ?? "").trim(),
      tiers,
      authorizeOrganization,
    }),
    entitlements,
    close: async () => {
      await pool.end();
    },
  };
}
