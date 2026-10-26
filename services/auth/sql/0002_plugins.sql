-- ---------------------------------------------------------------------------
-- 0002 — the columns and tables the plugins of ADR-0067 contribute
-- ---------------------------------------------------------------------------
--
-- Additive only: every statement can run against a database created by 0001, and
-- every column is nullable or defaulted so existing rows stay valid. The names and
-- types below are not recalled — they are asserted against Better Auth's own table
-- output in `src/pluginSchema.test.ts`, which fails if a version bump changes them.
--
-- One plugin adds nothing here on purpose: `lastLoginMethod` remembers the method in
-- a cookie rather than storing login history server-side.

-- --- anonymous: a session that can be claimed rather than owned -----------------
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "isAnonymous" boolean NOT NULL DEFAULT false;

-- --- admin: the people/ops half of the admin panel ------------------------------
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "role"      text,
  ADD COLUMN IF NOT EXISTS "banned"    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "banReason" text,
  ADD COLUMN IF NOT EXISTS "banExpires" timestamptz;

-- Who impersonated whom. Kept on the session so an operator's action is attributable
-- even after the fact (alpha.md §10.2 lists "no audit trail" as a gap).
ALTER TABLE session
  ADD COLUMN IF NOT EXISTS "impersonatedBy" text;

-- --- two-factor: operators and org owners --------------------------------------
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "twoFactorEnabled" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "twoFactor" (
  id                      text PRIMARY KEY,
  secret                  text NOT NULL,
  "backupCodes"           text NOT NULL,
  "userId"                text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  verified                boolean NOT NULL DEFAULT true,
  "failedVerificationCount" integer NOT NULL DEFAULT 0,
  "lockedUntil"           timestamptz
);
CREATE INDEX IF NOT EXISTS twofactor_user_idx ON "twoFactor" ("userId");

-- --- harmony: one person is one seat -------------------------------------------
--
-- Normalization is stored beside the address the person typed, and the unique index
-- is the whole mechanism: `foo+temp@gmail.com` and `foo@gmail.com` normalize to the
-- same value, so the second sign-up is refused rather than billed as a new seat.
-- Nullable, because a row that predates this migration has no normalized form yet;
-- the index is partial so those rows do not collide on NULL.
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "normalizedEmail" text;

CREATE UNIQUE INDEX IF NOT EXISTS user_normalized_email_key
  ON "user" ("normalizedEmail")
  WHERE "normalizedEmail" IS NOT NULL;

-- --- ours: admission -----------------------------------------------------------
--
-- Milliseconds since the epoch, matching every other timestamp this app stores
-- (ADR-0067 §7). Nullable and unstamped by default: an account starts held, and only
-- the admin surface writes this field (`input: false` in the auth config, so a client
-- cannot admit itself).
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "admittedAt" bigint;
