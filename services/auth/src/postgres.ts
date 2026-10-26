import { Pool } from "pg";
import type { AuthDatabase } from "./betterAuth.js";

/**
 * The Postgres seam for the control plane
 * ([ADR-0065](../../../docs/decisions/0065-accounts-own-workspaces.md) §9).
 *
 * Better Auth's own adapter takes a `pg` pool directly, so there is no ORM here and
 * no query builder to learn: the schema is SQL in `sql/`, the driver is `pg`, and
 * this module's whole job is to build one pool and refuse clearly when it cannot.
 *
 * Document bytes never come near this pool. It holds people, organizations,
 * memberships, invitations, licences and workspace *rows* — never a `.loro` snapshot.
 */

/** The one method the repositories use from a pool or client. */
export interface Queryable {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
}

export interface PostgresOptions {
  connectionString: string;
  /** Connections to keep. Better Auth issues a handful of queries per request. */
  max?: number;
  /** Seconds an idle connection may live before the pool closes it. */
  idleTimeoutSeconds?: number;
  /** Seconds to wait for a connection before failing the request. */
  connectionTimeoutSeconds?: number;
}

export interface PostgresDatabase {
  /** The object Better Auth takes as `database`. */
  database: AuthDatabase;
  /** Ends every pooled connection. Called on shutdown, never per request. */
  close: () => Promise<void>;
}

/**
 * What is wrong with a configured connection string, or `null` when it looks usable.
 *
 * Checked before a pool is built, because a malformed URL produces a pool that
 * fails on the first query — which surfaces as a mysterious 500 during a sign-in
 * rather than as a deployment that refuses to start.
 */
export function databaseUrlProblem(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (raw.length === 0) return "is not set";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "is not a URL";
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return `must be a postgres:// URL, not ${parsed.protocol.replace(":", "")}://`;
  }
  if (parsed.hostname.length === 0) return "names no host";
  return null;
}

/** Builds the pool Better Auth talks to. Throws before connecting when the URL is unusable. */
export function postgresDatabase(options: PostgresOptions): PostgresDatabase {
  const problem = databaseUrlProblem(options.connectionString);
  if (problem !== null) {
    throw new Error(`SUITE_AUTH_DATABASE_URL ${problem}`);
  }
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: (options.idleTimeoutSeconds ?? 30) * 1000,
    connectionTimeoutMillis: (options.connectionTimeoutSeconds ?? 5) * 1000,
  });
  return {
    database: pool,
    close: async () => {
      await pool.end();
    },
  };
}
