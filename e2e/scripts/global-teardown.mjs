/**
 * Stops the run's Postgres.
 *
 * The control-plane wrapper stops it on SIGTERM too, but Playwright may kill the
 * whole process tree when a run ends abruptly, and a cluster that survives turns
 * the next preflight into "e2e Postgres :54329 is already in use". This is the
 * belt to that braces: a teardown runs on the normal path, whatever the tests did.
 */
import { stopPostgres } from "./postgres.mjs";

export default function globalTeardown() {
  stopPostgres();
}
