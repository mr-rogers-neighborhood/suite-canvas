import { Kysely, PostgresDialect } from "kysely";
import { Pool, type PoolClient } from "pg";
import type { AuthDatabase } from "../identity/betterAuth.js";

/**
 * The Postgres seam for the control plane
 * (ADR-0065 §9).
 *
 * One `pg` pool, one Kysely instance over it, and two views of the same connection.
 * Better Auth's adapter is the Kysely one: it is handed a query *builder*
 * (`{ db, type: "postgres" }`), which is what it documents, rather than a pool it has
 * to guess about. Our own repositories and the migration runner keep using raw SQL
 * through `Queryable`, because that SQL is the schema in `sql/` and a builder over it
 * would be a second description of the same tables.
 *
 * Document bytes never come near this pool. It holds people, organizations,
 * memberships, invitations, licences and workspace *rows* — never a `.loro` snapshot.
 */

/** One pooled connection, returned to the pool with `release` when the caller is done. */
export interface QueryConnection extends Queryable {
  release?: () => void;
}

/** The one method the repositories and the migration runner use from a pool or client. */
export interface Queryable {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
  /**
   * One connection, when this target is a pool.
   *
   * The migration runner opens a transaction per file, and `BEGIN` and `COMMIT` on a
   * pool can land on two different connections. A target without `connect` is already
   * one connection (a client, or a test fake), so it is migrated on itself.
   */
  connect?: () => Promise<QueryConnection>;
}

/**
 * A `pg` pool, described as a `Queryable`.
 *
 * This is an adapter, not a cast: `pg`'s `query` is overloaded on the parameter it is
 * given, so narrowing it to the one shape we call is a function with a body — and the
 * one place a row type is decided.
 */
export function poolQueryable(pool: Pool): Queryable {
  return {
    query: async (text, values) => {
      const result =
        values === undefined ? await pool.query(text) : await pool.query(text, [...values]);
      return { rows: result.rows };
    },
    connect: async () => clientQueryable(await pool.connect()),
  };
}

/** The same adapter for a checked-out client, whose `release` returns it to the pool. */
function clientQueryable(client: PoolClient): QueryConnection {
  return {
    query: async (text, values) => {
      const result =
        values === undefined ? await client.query(text) : await client.query(text, [...values]);
      return { rows: result.rows };
    },
    release: () => {
      client.release();
    },
  };
}

/**
 * Better Auth's adapter, built around a Kysely instance.
 *
 * `type: "postgres"` selects the dialect's SQL generation and the capabilities the
 * adapter may use (returning, json, uuid). The default casing (`camel`) is the one
 * `sql/` is written in, so `userId` stays `"userId"`.
 */
export function kyselyDatabase(db: Kysely<unknown>): AuthDatabase {
  return { db, type: "postgres" };
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
  /** The object Better Auth takes as `database`: a Kysely-backed query executor. */
  database: AuthDatabase;
  /** The same pool as raw SQL, for our repositories and the migration runner. */
  queryable: Queryable;
  /** The Kysely handle, so a caller can see what the adapter was built on. */
  kysely: Kysely<unknown>;
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

/** Builds the pool and the adapter over it. Throws before connecting when the URL is unusable. */
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
  const kysely = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  return {
    database: kyselyDatabase(kysely),
    queryable: poolQueryable(pool),
    kysely,
    close: async () => {
      // Kysely ends the pool it was handed, the first time a connection is acquired
      // (`PostgresDriver.destroy`). Ending it again rejects with "Called end on pool
      // more than once", which a unit test that never opened a socket cannot see and a
      // shutdown after one query always hits. `ending` is pg's own flag; there is no
      // public way to ask whether a pool was already ended.
      await kysely.destroy();
      if ((pool as Pool & { ending?: boolean }).ending !== true) await pool.end();
    },
  };
}
