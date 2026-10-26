-- ---------------------------------------------------------------------------
-- 0008 — drop the two tables the hand-written billing function owned
-- ---------------------------------------------------------------------------
--
-- `billing_event` held the idempotency claim for a Stripe delivery, and
-- `billing_customer` held the minted licence token. Both jobs moved: the plugin
-- records a delivery by writing the `subscription` row, and the hosted proof is the
-- session JWT rather than a licence token (ADR-0075, ADR-0078).
--
-- Nothing reads them after 0007, and leaving an empty table named
-- `billing_customer` invites somebody to start writing to it again. `IF EXISTS`
-- because a deployment created from the current schema never had them.

DROP TABLE IF EXISTS billing_event;
DROP TABLE IF EXISTS billing_customer;
