-- ---------------------------------------------------------------------------
-- 0011 — a free organization may hold no workspace
-- ---------------------------------------------------------------------------
--
-- Local and offline use of Suite is free and needs no account, so a hosted account exists
-- to buy *sync*: collaboration, share links and hosted storage. A born-with licence that
-- grants a workspace therefore made the paid tier optional, which is not the product.
--
-- The trigger from 0009 keeps its shape and keeps writing the row in the organization's
-- own transaction — the reason it is a trigger has not changed. Only the numbers move:
-- no workspaces, no document bytes, no attachment bytes. Seats stay at one, because a
-- seat *is* a `member` row and an organization whose owner cannot be a member cannot
-- exist at all.
--
-- `POST /api/workspaces/claim` is the only door from an anonymous workspace to an owned
-- one, and it reads this row, so the ceiling closes that door until a subscription
-- replaces the row. The refusal is `plan-required`, which the app turns into the plan
-- picker rather than a bare 403.
--
-- Backfill is scoped to `tier = 'free'`: an organization that already pays keeps exactly
-- what it bought. A free organization that claimed a workspace before this migration
-- keeps syncing it — `checkWorkspaceAllowance` runs at claim time, not on every join — and
-- that is the safe direction to be wrong in.

CREATE OR REPLACE FUNCTION provision_free_organization_licence(p_organization_id text)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO organization_licences (
    organization_id,
    licence_id,
    tier,
    workspaces,
    seats,
    document_bytes,
    attachment_bytes,
    expires_at
  ) VALUES (
    p_organization_id,
    'free:' || p_organization_id,
    'free',
    0,
    1,
    0,
    0,
    now() + interval '36525 days'
  )
  ON CONFLICT (organization_id) DO NOTHING;
$$;

-- Rows written by 0009 still carry its numbers. Only the free ones move: a paid row is
-- somebody's receipt.
UPDATE organization_licences
SET workspaces = 0,
    document_bytes = 0,
    attachment_bytes = 0
WHERE tier = 'free';
