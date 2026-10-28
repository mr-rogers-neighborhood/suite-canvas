import type { Pool } from "pg";
import type { HealthCheck } from "./health.js";
import { createPool } from "./pool.js";

/**
 * Live dependencies, asked rather than assumed.
 *
 * A module's health is decided once, at load. A database is decided every time
 * someone asks, which is the whole point: the process outlives its connection. The
 * probe therefore holds its own small pool, asks the cheapest question that proves
 * the round trip (`SELECT 1`), and never throws — a refused connection is an answer.
 *
 * The timeout is the other half. Without one a hung socket would hold `/health` open,
 * and a monitor would see a timeout rather than the reason. It is short because a
 * healthy database answers `SELECT 1` in single-digit milliseconds.
 */

export const DATABASE_CHECK = "database";

const DEFAULT_TIMEOUT_MS = 2_000;

export interface DatabaseProbeOptions {
  url: string;
  timeoutMs?: number;
  /** Test seam: a query function instead of a real pool. */
  query?: (sql: string) => Promise<unknown>;
}

/** One call answers with one check; the pool outlives it so the check stays cheap. */
export interface DatabaseProbe {
  check: () => Promise<HealthCheck>;
  close: () => Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function databaseProbe(options: DatabaseProbeOptions): DatabaseProbe {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let pool: Pool | null = null;
  const query =
    options.query ??
    ((sql: string) => {
      pool ??= createPool({
        connectionString: options.url,
        max: 1,
        connectionTimeoutMillis: timeoutMs,
      });
      return pool.query(sql);
    });

  async function check(): Promise<HealthCheck> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      await Promise.race([query("SELECT 1"), timeout]);
      return { name: DATABASE_CHECK, state: "ok" };
    } catch (error) {
      return { name: DATABASE_CHECK, state: "failed", detail: messageOf(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    check,
    close: async () => {
      const current = pool;
      pool = null;
      if (current !== null) await current.end();
    },
  };
}
