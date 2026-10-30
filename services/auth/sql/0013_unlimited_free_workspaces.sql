-- ---------------------------------------------------------------------------
-- 0013 — free organizations have unlimited workspaces and storage-based quotas
-- ---------------------------------------------------------------------------
--
-- Workspaces are documents/projects, not a metered commodity. Artificial workspace
-- limits (0 on free, 3 on personal) created friction and prevented users from
-- sharing their work.
--
-- This migration updates the free licence provisioning trigger to grant unlimited
-- workspaces (represented by integer max 2147483647), with storage-based quotas:
-- 32 MiB per document, 100 MiB total attachment storage for the organization,
-- and 1 seat for the owner.
--
-- Backfill updates existing free-tier licence rows to these new values.

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
    2147483647,
    1,
    33554432,
    104857600,
    now() + interval '36525 days'
  )
  ON CONFLICT (organization_id) DO NOTHING;
$$;

UPDATE organization_licences
SET workspaces = 2147483647,
    document_bytes = 33554432,
    attachment_bytes = 104857600
WHERE tier = 'free';

