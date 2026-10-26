import type { FrontDoorEnvironment } from "../stripe/checkout.ts";

/**
 * Everything this deployment is configured by, and the two switches that decide
 * whether it does anything at all.
 *
 * The switches live here because two readers have to agree: the webhook refuses a
 * delivery and the checkout front door refuses a session under exactly the same
 * spellings. A second copy of `"1" || "true"` is how a deployment ends up with a
 * closed webhook and an open front door.
 */

/** Everything the webhook reads from the environment, once per invocation. */
export interface BillingEnvironment extends FrontDoorEnvironment {
  /**
   * `1` (or `true`) allows the endpoint to mint a licence. Anything else —
   * including unset — refuses, which is the alpha default: hosted billing is
   * not open, so a deployed function must not be able to issue a token by
   * accident.
   */
  SUITE_BILLING_ENABLED: string | undefined;
  STRIPE_WEBHOOK_SECRET: string | undefined;
  SUITE_LICENCE_PRIVATE_KEY: string | undefined;
  STRIPE_PRICE_TIERS: string | undefined;
  SUITE_SELF_HOST_URL: string | undefined;
  SES_FROM_ADDRESS: string | undefined;
  SUITE_SES_REGION: string | undefined;
  /**
   * `postgres` makes the event claims and customer records durable across
   * containers. Unset — the alpha default — keeps the in-memory store, which
   * is right for tests and dry runs and wrong for real money.
   */
  SUITE_BILLING_STORE: string | undefined;
  /**
   * The control plane this service writes to. `SUITE_AUTH_DATABASE_URL` is
   * accepted as a fallback because it is the same database: accounts,
   * organizations, subscriptions and licence records live together
   * (ADR-0069 amendment), and asking a deployment to set one connection string
   * twice invites them to drift.
   */
  SUITE_BILLING_DATABASE_URL: string | undefined;
  SUITE_AUTH_DATABASE_URL: string | undefined;
}

export const DEFAULT_SELF_HOST_URL =
  "https://github.com/mr-rogers-neighborhood/suite-canvas#deployment";

export function environment(
  source: Record<string, string | undefined> = process.env,
): BillingEnvironment {
  return {
    // Defaulted here rather than at the call site, so every deployment path
    // starts closed and opening it is one explicit variable.
    SUITE_BILLING_ENABLED: source.SUITE_BILLING_ENABLED ?? "0",
    STRIPE_WEBHOOK_SECRET: source.STRIPE_WEBHOOK_SECRET,
    SUITE_LICENCE_PRIVATE_KEY: source.SUITE_LICENCE_PRIVATE_KEY,
    STRIPE_PRICE_TIERS: source.STRIPE_PRICE_TIERS,
    SUITE_SELF_HOST_URL: source.SUITE_SELF_HOST_URL,
    SES_FROM_ADDRESS: source.SES_FROM_ADDRESS,
    SUITE_SES_REGION: source.SUITE_SES_REGION,
    SUITE_BILLING_STORE: source.SUITE_BILLING_STORE,
    SUITE_BILLING_DATABASE_URL: source.SUITE_BILLING_DATABASE_URL,
    SUITE_AUTH_DATABASE_URL: source.SUITE_AUTH_DATABASE_URL,
    // The front door's two. `STRIPE_SECRET_KEY` is read only when a checkout or
    // portal session is created, never by the webhook.
    STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY,
    SUITE_APP_ORIGIN: source.SUITE_APP_ORIGIN,
  };
}

export interface BillingSwitchEnvironment {
  SUITE_BILLING_ENABLED: string | undefined;
}

export interface BillingStoreEnvironment {
  SUITE_BILLING_STORE: string | undefined;
}

export type BillingStoreBackend = "memory" | "postgres";

/**
 * The closed-by-default switch. Only the two spellings an operator types on
 * purpose open the door; `0`, `false`, empty and unset all refuse.
 */
export function billingEnabled(env: BillingSwitchEnvironment): boolean {
  const raw = env.SUITE_BILLING_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Only the one deliberate spelling selects Postgres; everything else — unset,
 * `memory`, a typo — keeps the in-memory store, which is the alpha default.
 *
 * DynamoDB was the durable backend until ADR-0069's amendment: the control plane
 * already holds the subscriptions these records derive from, so a second store was
 * a second source of truth for entitlement.
 */
export function billingStoreBackend(env: BillingStoreEnvironment): BillingStoreBackend {
  return env.SUITE_BILLING_STORE?.trim().toLowerCase() === "postgres" ? "postgres" : "memory";
}
