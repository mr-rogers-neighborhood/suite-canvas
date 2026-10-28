import { Pool, type PoolConfig } from "pg";
import { createLogger } from "./logging.js";

/**
 * A pool that cannot take the process down with it.
 *
 * `pg` reports a connection that dies while idle by emitting `error` on the pool. An
 * emitted `error` with no listener is an uncaught exception, so a database restart, a
 * failover or a severed network path kills a control plane that was otherwise fine —
 * and it does so the moment the server goes away, not when the next request runs.
 *
 * The listener is the whole fix. The pool keeps its own connection state, so the next
 * query opens a fresh socket; a request that lands during the gap fails the way it
 * should, and `/health` reports the database as failed until the round trip works again.
 */

const logger = createLogger().child({ component: "postgres" });

export function createPool(config: PoolConfig, onError?: (error: unknown) => void): Pool {
  const pool = new Pool(config);
  pool.on("error", (error: unknown) => {
    if (onError !== undefined) {
      onError(error);
      return;
    }
    logger.warn("idle database client failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return pool;
}
