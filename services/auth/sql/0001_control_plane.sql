-- Control plane schema (ADR-0065, amendment 2026-10-25).
--
-- Postgres is for the control plane only: accounts, tenants, members, invites and
-- licence bookkeeping. Document bytes never enter this database (ADR-0065 §9);
-- the relay keeps each `LoroDoc` in its own store, and `workspaces.id` here is
-- only a mirror of a document id that already exists there.
--
-- The Better Auth tables below are the shapes the installed plugin declares
-- (verified against better-auth 1.7.12 by introspecting
-- `organization().schema` and `passkey().schema`, and the core schemas exported
-- from `better-auth/db`). Re-run `npx @better-auth/cli generate` when upgrading
-- Better Auth and diff this file: a missing column fails at runtime, not at
-- build time, and a silently missing `interface/model.js` column is how a passkey
-- login breaks in production only.

-- ---------------------------------------------------------------------------
-- Better Auth core
-- ---------------------------------------------------------------------------

CREATE TABLE "user" (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  email           text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image           text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

-- `activeOrganizationId` is added by the organization plugin onto the session
-- model. It is nullable: a signed-in account that belongs to no organization is
-- a valid state (an unclaimed, anonymous workspace is still usable).
CREATE TABLE session (
  id                      text PRIMARY KEY,
  "userId"                text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token                   text NOT NULL UNIQUE,
  "expiresAt"             timestamptz NOT NULL,
  "ipAddress"             text,
  "userAgent"             text,
  "activeOrganizationId"  text,
  "createdAt"             timestamptz NOT NULL DEFAULT now(),
  "updatedAt"             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_user_id_idx ON session ("userId");
CREATE INDEX session_active_organization_idx ON session ("activeOrganizationId");

CREATE TABLE account (
  id                       text PRIMARY KEY,
  "userId"                 text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "providerId"             text NOT NULL,
  "accountId"              text NOT NULL,
  password                 text,
  "accessToken"            text,
  "refreshToken"           text,
  "idToken"                text,
  "accessTokenExpiresAt"   timestamptz,
  "refreshTokenExpiresAt"  timestamptz,
  scope                    text,
  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedAt"              timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX account_user_id_idx ON account ("userId");

-- Magic-link tokens and any other short-lived verification value.
CREATE TABLE verification (
  id          text PRIMARY KEY,
  identifier  text NOT NULL,
  value       text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON verification (identifier);

-- ---------------------------------------------------------------------------
-- Organizations: the tenant (Better Auth organization plugin)
-- ---------------------------------------------------------------------------

-- An organization holds people, roles, seats and the subscription. It owns many
-- workspaces; `slug` is the tenant's own name, never a document id.
CREATE TABLE organization (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  logo        text,
  metadata    text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- A member is a seat, and the role is organization-wide: it applies to every
-- workspace the organization holds. A per-workspace override is a row we may add
-- later; it is deliberately absent in alpha.
CREATE TABLE member (
  id               text PRIMARY KEY,
  "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  "userId"         text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role             text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  -- Better Auth's plugin dedupes membership in application code, which is a
  -- read-then-write. This constraint is what makes the invite-key path (which
  -- writes the row inside its own transaction) race-proof, so the two writers
  -- cannot create two rows for one person.
  CONSTRAINT member_organization_user_key UNIQUE ("organizationId", "userId")
);
CREATE INDEX member_user_id_idx ON member ("userId");
CREATE INDEX member_organization_idx ON member ("organizationId");

-- The plugin's email-bound invitation: an inviter, an expiry and a status.
CREATE TABLE invitation (
  id               text PRIMARY KEY,
  "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email            text NOT NULL,
  role             text CHECK (role IS NULL OR role IN ('owner', 'admin', 'member')),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'canceled')),
  "expiresAt"      timestamptz NOT NULL,
  "inviterId"      text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitation_organization_idx ON invitation ("organizationId");
CREATE INDEX invitation_email_idx ON invitation (email);

-- Passkeys: one row per credential. `publicKey` is public by definition; the
-- sign counter is what detects a cloned authenticator.
CREATE TABLE passkey (
  id              text PRIMARY KEY,
  name            text,
  "publicKey"     text NOT NULL,
  "userId"        text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "credentialID"  text NOT NULL,
  counter         integer NOT NULL DEFAULT 0,
  "deviceType"    text NOT NULL,
  "backedUp"      boolean NOT NULL DEFAULT false,
  transports      text,
  aaguid          text,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX passkey_user_id_idx ON passkey ("userId");

-- ---------------------------------------------------------------------------
-- Workspaces: one row per document, and the row can never rename the document
-- ---------------------------------------------------------------------------

-- `id` IS the document id. That single fact is the claim promise: claiming a
-- workspace is an UPDATE of `organization_id` on a row whose primary key is the
-- id that already appears in every URL, owner link and share link, so there is
-- nothing to rename and nothing to reissue (ADR-0065 §2, V1-10).
--
-- `organization_id` is nullable on purpose: a workspace may exist in the control
-- plane before anyone owns it (listed by an operator, or created by a future
-- "create while signed in" flow), and NULL is the honest representation of
-- "anonymous".
CREATE TABLE workspaces (
  id              text PRIMARY KEY,
  organization_id text REFERENCES organization(id) ON DELETE CASCADE,
  name            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);
CREATE INDEX workspaces_organization_idx ON workspaces (organization_id)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Invite keys: the shareable invitation (ADR-0065 §3, amendment §6)
-- ---------------------------------------------------------------------------

-- A key is a row because revocation must be an update and a revocation list is
-- a row. Only the SHA-256 hash is stored: a leaked control-plane database hands
-- out no working invitation.
--
-- The key belongs to an organization, because redeeming it inserts a `member`
-- row, and a member row names an organization. `workspace_id` is kept so the
-- person redeeming can be sent straight to the document that prompted the
-- invitation (and so the route can name the workspace it is about).
CREATE TABLE invite_keys (
  id               text PRIMARY KEY,
  organization_id  text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  workspace_id     text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key_hash         text NOT NULL UNIQUE,
  role             text NOT NULL CHECK (role IN ('admin', 'member')),
  created_by       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at       timestamptz,
  max_uses         integer NOT NULL CHECK (max_uses > 0),
  used_count       integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- The counter can never pass the ceiling, even if a future writer forgets the
  -- conditional UPDATE. Belt and braces, because a key that overspends is an
  -- unbounded invitation.
  CONSTRAINT invite_keys_uses_within_max CHECK (used_count <= max_uses)
);
CREATE INDEX invite_keys_organization_idx ON invite_keys (organization_id);
CREATE INDEX invite_keys_workspace_idx ON invite_keys (workspace_id);

-- ---------------------------------------------------------------------------
-- Licence bookkeeping
-- ---------------------------------------------------------------------------

-- One row per organization: which minted licence covers it, and the two numbers
-- the seat check needs. The licence *token* is never stored here — the relay
-- verifies it and the billing service mints it; this table is the projection.
--
-- `seats` has no signed source: `licence.ts` signs `workspaces` and the byte
-- caps, not a seat count. Storing it here and defaulting to 0 is the fail-closed
-- choice — a licence nobody configured admits its owner and no one else.
CREATE TABLE organization_licences (
  organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  licence_id      text NOT NULL,
  tier            text NOT NULL,
  workspaces      integer NOT NULL CHECK (workspaces >= 0),
  seats           integer NOT NULL DEFAULT 0 CHECK (seats >= 0),
  expires_at      timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_licences_licence_idx ON organization_licences (licence_id);

-- ---------------------------------------------------------------------------
-- The claim statement, exactly as `CLAIM_WORKSPACE_SQL` in src/workspaces.ts
-- ---------------------------------------------------------------------------
--
-- Kept here as a function so the semantics are in the database, where a second
-- writer would also have to obey them. `archived_at` is untouched: claiming is
-- about ownership, not resurrection. A row owned by another organization makes
-- the ON CONFLICT ... WHERE fail, so RETURNING yields nothing and the caller
-- reports `workspace-already-claimed`.

CREATE OR REPLACE FUNCTION claim_workspace(
  p_workspace_id   text,
  p_organization_id text,
  p_name           text
) RETURNS TABLE (id text, organization_id text, name text, created_at timestamptz)
LANGUAGE sql
AS $$
  INSERT INTO workspaces (id, organization_id, name)
  VALUES (p_workspace_id, p_organization_id, p_name)
  ON CONFLICT (id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id
    WHERE workspaces.organization_id IS NULL
  RETURNING workspaces.id, workspaces.organization_id, workspaces.name, workspaces.created_at;
$$;

-- ---------------------------------------------------------------------------
-- The redemption transaction, exactly as `InviteKeyRepository.claimAndAddMember`
-- ---------------------------------------------------------------------------
--
-- One function, one transaction: the conditional counter update and the member
-- insert either both commit or neither does. Two simultaneous redemptions of a
-- one-use key cannot both succeed, because the second UPDATE matches no row
-- (`used_count < max_uses` is re-evaluated under the row lock).
--
-- A zero-row update means "revoked, exhausted, or revoked while you were
-- reading" — the caller maps it to `invite-exhausted`, because the cause is the
-- same from the holder's point of view.
--
-- The membership check and the insert are one statement so that the unique
-- constraint, not a read-then-write, decides. An account that is already a member
-- gets no new row and no spent use.

CREATE OR REPLACE FUNCTION redeem_invite_key(
  p_key_id  text,
  p_user_id text
) RETURNS TABLE (
  status          text,   -- 'redeemed' | 'already-member' | 'exhausted'
  invite_id       text,
  organization_id text,
  member_id       text,
  role            text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_key      invite_keys%ROWTYPE;
  v_member   member%ROWTYPE;
  v_existing member%ROWTYPE;
BEGIN
  SELECT * INTO v_key FROM invite_keys WHERE id = p_key_id;
  IF NOT FOUND THEN
    RETURN;  -- unknown key: the caller already answered 'invite-not-found'
  END IF;

  -- Already a member is not a failure and spends no use, so it is answered
  -- before the counter moves.
  SELECT * INTO v_existing
    FROM member
   WHERE "organizationId" = v_key.organization_id AND "userId" = p_user_id;
  IF FOUND THEN
    RETURN QUERY SELECT 'already-member', v_key.id, v_key.organization_id, v_existing.id, v_existing.role;
    RETURN;
  END IF;

  UPDATE invite_keys
     SET used_count = used_count + 1
   WHERE id = p_key_id
     AND revoked_at IS NULL
     AND used_count < max_uses
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING * INTO v_key;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'exhausted', p_key_id, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  INSERT INTO member (id, "organizationId", "userId", role)
  VALUES (gen_random_uuid()::text, v_key.organization_id, p_user_id, v_key.role)
  ON CONFLICT ON CONSTRAINT member_organization_user_key DO NOTHING
  RETURNING * INTO v_member;

  IF NOT FOUND THEN
    -- Lost the race against another redemption by the same person: give the use
    -- back inside the same transaction and answer 'already-member'.
    UPDATE invite_keys SET used_count = used_count - 1 WHERE id = p_key_id;
    SELECT * INTO v_existing
      FROM member
     WHERE "organizationId" = v_key.organization_id AND "userId" = p_user_id;
    RETURN QUERY SELECT 'already-member', v_key.id, v_key.organization_id, v_existing.id, v_existing.role;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'redeemed', v_key.id, v_key.organization_id, v_member.id, v_member.role;
END;
$$;

-- ---------------------------------------------------------------------------
-- Never here
-- ---------------------------------------------------------------------------
-- No card, board, placement, edge or content table exists in this database, and
-- none may be added: the control plane holds identity, the relay holds documents.
