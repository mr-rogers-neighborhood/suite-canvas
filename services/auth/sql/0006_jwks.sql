-- ---------------------------------------------------------------------------
-- 0006 — the relay's signing keys
-- ---------------------------------------------------------------------------
--
-- ADR-0074: Better Auth's `jwt()` plugin signs the session token the relay verifies
-- against `/api/auth/jwks`. The plugin keeps its key pairs in its own `jwks` table and
-- mints the first pair on demand, so the table has to exist before the first token is
-- requested — a missing table here fails inside a sign-in, not at boot.
--
-- The private key column is written by the plugin and encrypted with `SUITE_AUTH_SECRET`;
-- nothing in our code reads this table. Names and types are the plugin's own schema,
-- asserted against `getAuthTables()` in `src/pluginSchema.test.ts`.

CREATE TABLE IF NOT EXISTS "jwks" (
  id          text PRIMARY KEY,
  "publicKey" text NOT NULL,
  "privateKey" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz,
  alg         text,
  crv         text
);
