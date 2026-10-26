/**
 * The two deployment switches, in one module because two readers have to agree:
 * the webhook refuses a delivery and the checkout front door refuses a session
 * under exactly the same spellings. A second copy of `"1" || "true"` is how a
 * deployment ends up with a closed webhook and an open front door.
 *
 * They live here rather than in `handler.ts` so `checkout.ts` can read them
 * without importing the module that imports `checkout.ts`.
 */

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
