import type { Logger } from "./log.ts";
import type { BillingStore, LicenceRecord } from "./store.ts";

/**
 * Durable `BillingStore` on the control-plane Postgres, selected with
 * `SUITE_BILLING_STORE=postgres`
 * ([ADR-0069](../docs/decisions/0069-billing-runs-on-the-stripe-plugin.md) amendment).
 *
 * Two tables, because the two jobs are different shapes:
 *
 *   billing_event   one row per processed Stripe event id — the idempotency claim
 *   billing_customer one row per Stripe customer — the `LicenceRecord`
 *
 * **Correctness comes from the write, not from reading first.** `claimEvent` is a
 * single `INSERT ... ON CONFLICT DO NOTHING RETURNING`, so two identical deliveries
 * landing in different Lambda containers produce exactly one claim — the same
 * guarantee the DynamoDB adapter got from a conditional put, expressed in SQL the
 * whole team can read.
 *
 * The driver is injected: this module never imports `pg`, so a deployment on the
 * in-memory store does not load it and the tests need no database.
 */

/** The one method this adapter uses from a pool or client. */
export interface Queryable {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
}

const EVENT_TTL_DAYS = 30;

/**
 * A claim, or nothing.
 *
 * `RETURNING` is what makes this a single round trip: a row comes back only when
 * this statement inserted it, so "already processed" and "processing failed" stay
 * distinguishable without a second read.
 */
export const CLAIM_EVENT_SQL = `
  INSERT INTO billing_event (event_id, claimed_at, expires_at)
  VALUES ($1, now(), now() + make_interval(days => $2))
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id
`;

export const RELEASE_EVENT_SQL = `DELETE FROM billing_event WHERE event_id = $1`;

export const READ_CUSTOMER_SQL = `
  SELECT customer_id, email, tier, price_id, licence, licence_id,
         issued_at, expires_at, subscription_id, last_invoice_id, updated_at
  FROM billing_customer
  WHERE customer_id = $1
`;

/**
 * Upserting the record is deliberate rather than clever: a renewal replaces the
 * token and moves `expires_at`, and there is no field a later event should be
 * forbidden from correcting. The row is the *latest* answer for that customer.
 */
export const WRITE_CUSTOMER_SQL = `
  INSERT INTO billing_customer (
    customer_id, email, tier, price_id, licence, licence_id,
    issued_at, expires_at, subscription_id, last_invoice_id, updated_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (customer_id) DO UPDATE SET
    email = EXCLUDED.email,
    tier = EXCLUDED.tier,
    price_id = EXCLUDED.price_id,
    licence = EXCLUDED.licence,
    licence_id = EXCLUDED.licence_id,
    issued_at = EXCLUDED.issued_at,
    expires_at = EXCLUDED.expires_at,
    subscription_id = EXCLUDED.subscription_id,
    last_invoice_id = EXCLUDED.last_invoice_id,
    updated_at = EXCLUDED.updated_at
`;

/** A row as Postgres returns it — snake_case, and nullable where the record is optional. */
interface CustomerRow {
  customer_id: string;
  email: string;
  tier: string;
  price_id: string;
  licence: string;
  licence_id: string;
  issued_at: string | number;
  expires_at: string | number;
  subscription_id: string | null;
  last_invoice_id: string | null;
  updated_at: string | number;
}

/** Bigint columns arrive as strings through most drivers; the record wants numbers. */
function millis(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`billing row holds a non-numeric time: ${value}`);
  return parsed;
}

function toRecord(row: CustomerRow): LicenceRecord {
  return {
    customerId: row.customer_id,
    email: row.email,
    tier: row.tier,
    priceId: row.price_id,
    licence: row.licence,
    licenceId: row.licence_id,
    issuedAt: millis(row.issued_at),
    expiresAt: millis(row.expires_at),
    updatedAt: millis(row.updated_at),
    ...(row.subscription_id === null ? {} : { subscriptionId: row.subscription_id }),
    ...(row.last_invoice_id === null ? {} : { lastInvoiceId: row.last_invoice_id }),
  };
}

export function postgresStore(client: Queryable, log?: Logger): BillingStore {
  return {
    async claimEvent(eventId) {
      const { rows } = await client.query(CLAIM_EVENT_SQL, [eventId, EVENT_TTL_DAYS]);
      // A row means this statement inserted it; no row means someone else did.
      return rows.length > 0;
    },

    async releaseEvent(eventId) {
      await client.query(RELEASE_EVENT_SQL, [eventId]);
    },

    async getCustomer(customerId) {
      const { rows } = await client.query(READ_CUSTOMER_SQL, [customerId]);
      const row = rows[0] as CustomerRow | undefined;
      return row === undefined ? null : toRecord(row);
    },

    async putCustomer(record) {
      await client.query(WRITE_CUSTOMER_SQL, [
        record.customerId,
        record.email,
        record.tier,
        record.priceId,
        record.licence,
        record.licenceId,
        record.issuedAt,
        record.expiresAt,
        record.subscriptionId ?? null,
        record.lastInvoiceId ?? null,
        record.updatedAt,
      ]);
      log?.("info", "billing customer written", {
        customerId: record.customerId,
        tier: record.tier,
        expiresAt: record.expiresAt,
      });
    },
  };
}

/**
 * Opens the store from a connection string. Kept lazy on the driver for the same
 * reason the DynamoDB adapter was: a deployment on the in-memory store should never
 * load it.
 */
export async function postgresStoreFromEnvironment(
  connectionString: string,
  log?: Logger,
): Promise<BillingStore & { close?: () => Promise<void> }> {
  const driverModule = "pg";
  const { Pool } = (await import(driverModule)) as unknown as {
    Pool: new (config: {
      connectionString: string;
      max?: number;
    }) => Queryable & {
      end: () => Promise<void>;
    };
  };
  // A small pool, held for the life of the container: the handler makes at most a
  // handful of queries per delivery, and a Lambda-per-request pool would be a
  // connection storm against the control plane.
  const pool = new Pool({ connectionString, max: 4 });
  const store = postgresStore(pool, log);
  return Object.assign(store, { close: async () => pool.end() });
}
