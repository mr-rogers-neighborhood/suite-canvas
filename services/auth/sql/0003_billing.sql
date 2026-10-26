-- ---------------------------------------------------------------------------
-- 0003 — the billing tables, now that the control plane owns them
-- ---------------------------------------------------------------------------
--
-- ADR-0069's amendment deleted the DynamoDB store: subscriptions already live in
-- this database, so a second store made entitlement exist twice. These two tables
-- are the only remaining state the billing function needs, and they sit beside the
-- customers they describe.
--
-- Correctness is in the statements, not the schema: `store-postgres.ts` claims an
-- event with INSERT ... ON CONFLICT DO NOTHING RETURNING, so a duplicate delivery
-- inserts nothing and learns so from the empty result.

-- One row per processed Stripe event. The row existing *is* the claim; the expiry
-- only tidies the table (30 days, well inside Stripe's three-day retry window plus
-- room for a manual replay).
CREATE TABLE IF NOT EXISTS billing_event (
  event_id    text PRIMARY KEY,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_event_expires_idx ON billing_event (expires_at);

-- The latest LicenceRecord for a customer: the token, its tier, and the window it
-- is valid for. Kept as timestamps in milliseconds to match the rest of the app,
-- so nothing has to convert between worlds when a token is re-signed.
CREATE TABLE IF NOT EXISTS billing_customer (
  customer_id      text PRIMARY KEY,
  email            text NOT NULL,
  tier             text NOT NULL,
  price_id         text NOT NULL,
  licence          text NOT NULL,
  licence_id       text NOT NULL,
  issued_at        bigint NOT NULL,
  expires_at       bigint NOT NULL,
  subscription_id  text,
  last_invoice_id  text,
  updated_at       bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_customer_licence_idx ON billing_customer (licence_id);
