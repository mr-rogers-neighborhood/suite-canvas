/**
 * Ends the run in the order its parts depend on each other: the server, then the
 * database under it.
 *
 * Playwright closes web servers *after* this hook, which used to leave two bad
 * options: stop the cluster now and the still-running control plane reports an
 * unhandled `pg` error and exits 1 at the end of every run, or leave it and a
 * killed process tree strands a cluster on the fixed port. So this closes the
 * control plane itself — the same SIGTERM Playwright would send it — waits for the
 * port to free, and only then stops the cluster. The wrapper stops its own cluster
 * on that signal too, so the `stopPostgres` below is the belt to that braces.
 */
import { listeners, portIsBusy, stopListeners } from "./ports.mjs";
import { stopPostgres } from "./postgres.mjs";

/** The control plane's own listener, the one `playwright.config.ts` waits on. */
const CONTROL_PLANE_PORT = 1236;

export default async function globalTeardown() {
  const pids = listeners(CONTROL_PLANE_PORT);
  if (pids.length > 0) {
    const stopped = await stopListeners(pids, CONTROL_PLANE_PORT);
    if (!stopped) {
      console.warn(
        `e2e teardown: the control plane on :${CONTROL_PLANE_PORT} would not stop; stopping the cluster anyway.`,
      );
    }
  }
  if (portIsBusy(1236)) {
    // Nothing else owns the cluster at this point, but stopping it under a server
    // that refused to close is what the wrapper reports as a lost connection.
    console.warn("e2e teardown: the control plane is still listening; leaving Postgres to it.");
    return;
  }
  stopPostgres();
}
