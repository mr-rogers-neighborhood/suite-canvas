-- ---------------------------------------------------------------------------
-- 0005 — invitations move to `better-enrollment`, and our parallel one leaves
-- ---------------------------------------------------------------------------
--
-- ADR-0067 §10 records the decision: the plugin is the invitation engine, our
-- `invite_keys` table, `redeem_invite_key()` function and bespoke redemption route are
-- deleted. The §11 amendment is why this migration can exist at all: an invited
-- account may set a password, which is the one thing the plugin's private invites
-- needed and the old "no passwords" rule forbade.
--
-- Additive-first, in the one shape that applies cleanly to a database created by 0001:
-- the new tables are created, then the old objects are dropped. Nothing else in this
-- repository or its migrations references `invite_keys` or `redeem_invite_key()` —
-- checked with grep, and the only remaining mentions are historical ADR prose.
--
-- Names and types are not recalled. They are the output of `getAuthTables()` for the
-- configured instance, asserted in `src/pluginSchema.test.ts`:
--   invite    ← the plugin's `invite` model
--   inviteUse ← the plugin's `inviteUse` model (append-only use log)
--   organization."seatLimit" / "disabledAt" ← added only because the plugin's
--                                              organization options are configured

-- --- organization: the two columns the plugin adds --------------------------
--
-- `seatLimit` is the plugin's own ceiling. It is deliberately **not** how our licence
-- is enforced: `resolveSeatLimit` answers from `organization_licences` at call time, so
-- a licence change needs no write here. The column stays for the plugin's own
-- per-organization override and because its schema declares it.
ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS "seatLimit"  integer,
  ADD COLUMN IF NOT EXISTS "disabledAt" timestamptz;

-- --- invite: one row per invitation ----------------------------------------
--
-- `tokenHash` is the only form of the token at rest (SHA-256 by the plugin's default
-- `hashTokens`), so a leaked control plane hands out no working links. `status` stores
-- only what was *stored*; "expired" is derived from `expiresAt` and never written.
--
-- `mode` records the mode in force when the row was written, which is what makes a row
-- created under a different configuration still interpretable.
CREATE TABLE IF NOT EXISTS "invite" (
  id                        text PRIMARY KEY,
  type                      text NOT NULL CHECK (type IN ('private', 'public')),
  kind                      text NOT NULL DEFAULT 'app'
                              CHECK (kind IN ('app', 'org-join', 'org-create')),
  email                     text,
  name                      text,
  role                      text NOT NULL,
  "tokenHash"               text NOT NULL UNIQUE,
  status                    text NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'cancelled')),
  mode                      text NOT NULL,
  "organizationId"          text REFERENCES organization(id) ON DELETE CASCADE,
  "organizationRole"        text,
  "teamId"                  text,
  "presetSeatLimit"         integer,
  "presetOrganizationName"  text,
  "presetOrganizationSlug"  text,
  -- The shell user a private invite pre-creates. `SET NULL` rather than `CASCADE`: the
  -- plugin deletes inert shells, and an invitation is an audit row that must outlive a
  -- deleted account.
  "preCreatedUserId"        text REFERENCES "user"(id) ON DELETE SET NULL,
  "createdByUserId"         text REFERENCES "user"(id) ON DELETE SET NULL,
  "inviterName"             text NOT NULL,
  "inviterEmail"            text NOT NULL,
  "expiresAt"               timestamptz,
  "maxUses"                 integer CHECK ("maxUses" IS NULL OR "maxUses" > 0),
  "useCount"                integer NOT NULL DEFAULT 0 CHECK ("useCount" >= 0),
  "revokedAt"               timestamptz,
  "revokedByUserId"         text,
  "createdAt"               timestamptz NOT NULL,
  "updatedAt"               timestamptz NOT NULL,
  -- The invariant the deleted `invite_keys` carried, kept where it now belongs: a
  -- counter can never pass its ceiling even if a future writer forgets the conditional
  -- update. Retiring a table is no reason to retire the guarantee.
  CONSTRAINT invite_uses_within_max CHECK ("maxUses" IS NULL OR "useCount" <= "maxUses")
);

CREATE INDEX IF NOT EXISTS invite_email_idx ON "invite" (email);
CREATE INDEX IF NOT EXISTS invite_status_idx ON "invite" (status);
CREATE INDEX IF NOT EXISTS invite_expires_at_idx ON "invite" ("expiresAt");
CREATE INDEX IF NOT EXISTS invite_pre_created_user_idx ON "invite" ("preCreatedUserId");
CREATE INDEX IF NOT EXISTS invite_created_by_idx ON "invite" ("createdByUserId");
-- Seat reservation counts pending invites per organization, which is a two-column
-- question: the composite index is the one that query asks for.
CREATE INDEX IF NOT EXISTS invite_organization_status_idx ON "invite" ("organizationId", status);

-- --- inviteUse: the append-only trail --------------------------------------
--
-- One row per redemption, never updated or deleted except with its invitation. The
-- unique pair is the belt on the plugin's own check: a second redemption by the same
-- person of the same invitation is a race, and a database that refuses it is the one
-- that wins the race deterministically.
CREATE TABLE IF NOT EXISTS "inviteUse" (
  id               text PRIMARY KEY,
  "inviteId"       text NOT NULL REFERENCES "invite"(id) ON DELETE CASCADE,
  "usedByUserId"   text NOT NULL,
  "inviteeEmail"   text NOT NULL,
  "usedAt"         timestamptz NOT NULL,
  CONSTRAINT invite_use_invite_user_key UNIQUE ("inviteId", "usedByUserId")
);
CREATE INDEX IF NOT EXISTS invite_use_invite_idx ON "inviteUse" ("inviteId");

-- --- and ours leaves -------------------------------------------------------
--
-- The function first: it names `invite_keys%ROWTYPE`, and a plpgsql body is only
-- resolved at run time, so dropping the table first would leave a function that exists
-- and fails. Explicit arguments, so a differently-shaped function of the same name
-- from somewhere else is not what gets dropped by accident.
DROP FUNCTION IF EXISTS redeem_invite_key(text, text);
DROP TABLE IF EXISTS invite_keys;
