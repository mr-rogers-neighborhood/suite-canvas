import { BillingError } from "../errors.ts";
import { billingStoreBackend } from "../handler/env.ts";
import { jsonLogger, type Logger } from "../handler/log.ts";
import { type BillingStore, memoryStore } from "./store.ts";

/** What the store needs from the environment; `BillingEnvironment` satisfies it. */
export interface StoreEnvironment {
  SUITE_BILLING_STORE: string | undefined;
  SUITE_BILLING_DATABASE_URL: string | undefined;
  SUITE_AUTH_DATABASE_URL: string | undefined;
}

/**
 * The store, opened on first use.
 *
 * The driver is imported only when it is selected, so a deployment on the in-memory
 * store never loads `pg` and the tests never need a database. A construction failure is
 * thrown, not swallowed: answering 500 keeps Stripe retrying instead of silently falling
 * back to a store that cannot remember a claim between containers.
 */
export async function billingStoreFor(
  env: StoreEnvironment,
  log: Logger = jsonLogger,
): Promise<BillingStore> {
  if (billingStoreBackend(env) === "memory") return memoryStore();
  const connectionString = (env.SUITE_BILLING_DATABASE_URL ?? env.SUITE_AUTH_DATABASE_URL)?.trim();
  if (connectionString === undefined || connectionString.length === 0) {
    // Named together, because the fallback is what a deployment usually sets.
    throw new BillingError(
      "invalid-config",
      "SUITE_BILLING_STORE=postgres needs SUITE_BILLING_DATABASE_URL (or SUITE_AUTH_DATABASE_URL)",
    );
  }
  const { postgresStoreFromEnvironment } = await import("./postgres.js");
  return postgresStoreFromEnvironment(connectionString, log);
}
