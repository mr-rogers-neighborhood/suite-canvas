-- ---------------------------------------------------------------------------
-- 0012 — the Stripe universe a subscription was recorded in
-- ---------------------------------------------------------------------------
--
-- A `subscription` row records the plan, the status and the period, and nothing about
-- which Stripe universe it came from. The two universes share no ids and mean different
-- things by the same row: a subscription created while the deployment was in test mode
-- keeps its `active` status when an operator switches to live, and the entitlement read
-- counted it as paid. The customer then held live sync bought with a test card, and the
-- portal refused them, because a test `cus_…` does not exist in live.
--
-- `billing_mode` is stamped by the licence projection, which already runs on every
-- lifecycle event and knows which mode the deployment was selling in when the event
-- arrived. Nothing else writes it: the plugin's own INSERT and UPDATE do not name the
-- column, so a stamp survives its writes.
--
-- A NULL is a row written before this column existed, and it reads as "unknown" and is
-- honoured. Refusing it would cut off a paying customer until the next webhook touched
-- the row, which is a worse answer than the one this column exists to give.
ALTER TABLE subscription
  ADD COLUMN IF NOT EXISTS billing_mode text
    CHECK (billing_mode IN ('test', 'live'));
