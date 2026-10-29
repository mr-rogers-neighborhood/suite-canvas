import { BillingError } from "../errors.ts";
import type { OrganizationSubscriptions, SubscriptionRow } from "./entitlement.ts";

/**
 * The entitlement read against the control-plane Postgres, where the Stripe plugin
 * wrote the `subscription` row.
 *
 * The driver is injected, so no test needs a database and this module never imports
 * `pg`: `createPostgresSubscriptions` is the one place that does, and only when a
 * caller asks for it.
 */

/** The one method this adapter uses from a pool or a client. */
export interface Queryable {
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: readonly Record<string, unknown>[] }>;
}

/**
 * The live row first, then the newest.
 *
 * An organization can carry more than one row over its life: an upgrade writes the same
 * row, a cancelled subscription that was replaced leaves another. Preferring `active`
 * and `trialing` means a stale cancelled row can never shadow the one being paid for.
 */
export const LIVE_SUBSCRIPTION_SQL = `
  SELECT "plan", "status", "periodEnd", "cancelAtPeriodEnd", "billing_mode"
  FROM "subscription"
  WHERE "referenceId" = $1
  ORDER BY
    CASE WHEN "status" IN ('active', 'trialing') THEN 0 ELSE 1 END,
    COALESCE("periodEnd", to_timestamp(0)) DESC
  LIMIT 1
`;

function millisOf(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** The stamp `0012_subscription_billing_mode.sql` added, or null when there is none. */
function billingModeOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mode = value.trim().toLowerCase();
  return mode === "test" || mode === "live" ? mode : null;
}

/** Maps one row, or null when the row says nothing usable about plan and status. */
export function subscriptionRowOf(value: Record<string, unknown>): SubscriptionRow | null {
  const plan = value.plan;
  const status = value.status;
  if (typeof plan !== "string" || plan.trim().length === 0) return null;
  if (typeof status !== "string" || status.trim().length === 0) return null;
  return {
    plan,
    status: status.trim().toLowerCase(),
    periodEnd: millisOf(value.periodEnd),
    cancelAtPeriodEnd: value.cancelAtPeriodEnd === true,
    // An unrecognised or absent stamp reads as null, which the entitlement read honours:
    // a value somebody typed into the column must not be able to refuse a paid plan.
    billingMode: billingModeOf(value.billing_mode),
  };
}

/** The read, over any client that can answer one parameterised statement. */
export function postgresSubscriptions(query: Queryable): OrganizationSubscriptions {
  return {
    forOrganization: async (organizationId) => {
      const result = await query.query(LIVE_SUBSCRIPTION_SQL, [organizationId]);
      const row = result.rows[0];
      return row === undefined ? null : subscriptionRowOf(row);
    },
  };
}

export interface PostgresSubscriptions extends OrganizationSubscriptions {
  close: () => Promise<void>;
}

/**
 * A pool of four for the life of the process.
 *
 * A pool per request is a connection storm under a login rush, and the entitlement read
 * runs on every token mint, so one pool is the only shape that holds.
 */
export async function createPostgresSubscriptions(options: {
  connectionString: string;
}): Promise<PostgresSubscriptions> {
  const connectionString = options.connectionString.trim();
  if (connectionString.length === 0) {
    throw new BillingError("invalid-config", "the billing database URL is empty");
  }
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString, max: 4 });
  const subscriptions = postgresSubscriptions({
    query: (text, values) => pool.query(text, values as unknown[] | undefined),
  });
  return {
    forOrganization: subscriptions.forOrganization,
    close: async () => {
      await pool.end();
    },
  };
}
