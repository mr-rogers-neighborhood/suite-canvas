-- ---------------------------------------------------------------------------
-- 0004 — the licence ceilings the projection was missing
-- ---------------------------------------------------------------------------
--
-- `organization_licences` is the control plane's projection of a signed licence
-- (ADR-0065 §7, ADR-0070 §1): which minted licence covers an organization, its tier,
-- the workspace ceiling and the seat count. Two signed fields were never projected,
-- so `postgresLicences` had to hand the seat check `Number.POSITIVE_INFINITY` for
-- both byte ceilings — "unlimited" for an organization that is anything but, and a
-- value no token ever carried.
--
-- `bigint`, not `integer`: these are bytes, and the plans already sell 2 GiB per
-- document and 8 GiB of attachments (`services/billing/testing.ts`), which int4
-- cannot hold.
--
-- Additive and nullable, so a row written before this migration stays valid: NULL
-- means "this projection never recorded the ceiling", which is what the reader says
-- rather than inventing a number. A zero is a legal ceiling (no bytes at all).
ALTER TABLE organization_licences
  ADD COLUMN IF NOT EXISTS document_bytes   bigint
    CHECK (document_bytes IS NULL OR document_bytes >= 0),
  ADD COLUMN IF NOT EXISTS attachment_bytes bigint
    CHECK (attachment_bytes IS NULL OR attachment_bytes >= 0);
