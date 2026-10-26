-- ---------------------------------------------------------------------------
-- 0007 — the subscription table the Stripe plugin owns
-- ---------------------------------------------------------------------------
--
-- ADR-0078 replaced the hand-written webhook with `@better-auth/stripe`. The plugin
-- writes one `subscription` row per Stripe subscription and reads it back for every
-- checkout, portal call and webhook delivery, so the table is not optional: a missing
-- column fails at the first webhook, not at build time.
--
-- The shape below is the plugin's own base schema, read from
-- `@better-auth/stripe@1.7.13` (`src/schema.ts`: `subscription` fields plus the
-- `stripeCustomerId` column it adds to `user` and `organization`). Re-run
-- `npx @better-auth/cli generate` when the plugin is upgraded and diff this file.
--
-- `referenceId` is the organization id, not a user id: a workspace is owned by an
-- organization and seats come from its member rows, so the subscription has to belong
-- to the same thing the workspace does.

CREATE TABLE IF NOT EXISTS subscription (
  id                   text PRIMARY KEY,
  plan                 text NOT NULL,
  "referenceId"        text NOT NULL,
  "stripeCustomerId"   text,
  "stripeSubscriptionId" text,
  status               text NOT NULL DEFAULT 'incomplete',
  "periodStart"        timestamptz,
  "periodEnd"          timestamptz,
  "trialStart"         timestamptz,
  "trialEnd"           timestamptz,
  "cancelAtPeriodEnd"  boolean NOT NULL DEFAULT false,
  "cancelAt"           timestamptz,
  "canceledAt"         timestamptz,
  "endedAt"            timestamptz,
  seats                integer,
  "billingInterval"    text,
  "stripeScheduleId"   text
);

-- The entitlement read filters by reference and prefers a live row, so this index is
-- the one the token mint uses on every request.
CREATE INDEX IF NOT EXISTS subscription_reference_idx ON subscription ("referenceId");
CREATE INDEX IF NOT EXISTS subscription_stripe_subscription_idx ON subscription ("stripeSubscriptionId");

-- Better Auth writes this when a customer is created, and looks a reference up by it
-- when a webhook arrives naming a customer instead of an organization.
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "stripeCustomerId" text;
ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS "stripeCustomerId" text;

CREATE INDEX IF NOT EXISTS user_stripe_customer_idx ON "user" ("stripeCustomerId");
CREATE INDEX IF NOT EXISTS organization_stripe_customer_idx ON organization ("stripeCustomerId");
