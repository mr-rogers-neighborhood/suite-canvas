-- ---------------------------------------------------------------------------
-- 0009 — every organization is born on the free tier
-- ---------------------------------------------------------------------------
--
-- Nothing wrote `organization_licences` for a new organization. `beforeAddMember`
-- reads that row to answer "may this person join?", so the creator of a brand-new
-- organization was refused their own membership: `seat-refused: licence-missing`.
-- Sign-up worked and creating a workspace did not, and the failed call left an
-- `organization` row with no owner behind it.
--
-- The row cannot be written by the application, either: the plugin creates the
-- organization, calls `beforeAddMember` for its creator, and only then writes the
-- member row, and it offers no transaction to put a licence insert inside. A hook
-- that inserted the row would leave an organization behind whenever the insert
-- itself failed. A trigger on `organization` writes it in the same transaction as
-- the row it describes, so a failure rolls the organization back and the orphan
-- this bug produced cannot happen.
--
-- The numbers are `FREE_LICENCE_TIER` in `src/organizations/freeTier.ts`: one
-- workspace, one seat (the owner), 64 MiB per document, 8 MiB per attachment.
-- `scripts/db-verify.mjs` compares the row this trigger writes with that object, so
-- the two descriptions of the free tier cannot drift without failing a gate.
--
-- `ON CONFLICT DO NOTHING` rather than an upsert, deliberately: a free row is a
-- *default*, and overwriting a licence somebody paid for would be the worse
-- direction to be wrong. A paid subscription replaces this row in place -- it has
-- to, because `organization_licences.organization_id` is the primary key and a
-- second row for one organization is not representable.

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
    1,
    1,
    67108864,
    8388608,
    now() + interval '36525 days'
  )
  ON CONFLICT (organization_id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION organization_provision_free_licence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM provision_free_organization_licence(NEW.id);
  RETURN NULL;
END;
$$;

-- No `CREATE TRIGGER IF NOT EXISTS` before Postgres 14, and a re-run must not stack
-- two triggers, so the drop is part of the statement pair.
DROP TRIGGER IF EXISTS organization_free_licence ON organization;
CREATE TRIGGER organization_free_licence
  AFTER INSERT ON organization
  FOR EACH ROW
  EXECUTE FUNCTION organization_provision_free_licence();

-- Backfill: every organization that predates this migration is in exactly the state
-- this migration exists to end -- no licence row -- so it gets the same free row the
-- trigger would have written. The one the e2e harness left behind is in this set.
SELECT provision_free_organization_licence(id) FROM organization;
