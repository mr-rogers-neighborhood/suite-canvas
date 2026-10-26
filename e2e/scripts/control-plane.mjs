#!/usr/bin/env node
/**
 * The control plane, as the suite runs it: a throwaway Postgres, then the real
 * `apps/control-plane` process on `:1236`.
 *
 * Before accounts, nothing in the suite needed a second server. The relay now
 * verifies a session JWT it cannot mint (ADR-0074), so a spec that syncs has to
 * point at something that can create an account, an organization and a claim —
 * and that something is the product's own control plane, not a stub. What this
 * file adds is only the wiring a developer would otherwise type by hand:
 *
 * - the database, from `postgres.mjs`, so a run never shares rows with the last;
 * - the five environment variables the auth module refuses to start without;
 * - the shutdown that stops the cluster when Playwright closes the process.
 *
 * `SUITE_AUTH_URL` is the *hosted* origin rather than this port, because that is
 * the origin the page shares with `/api/auth` through `scripts/hosted-origin.mjs`.
 * The cookie is scoped there, the JWT's `iss`/`aud` name it, and the relay
 * fetches the matching key set from it.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePostgres, stopPostgres } from "./postgres.mjs";

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(E2E_DIR, "..");

/** The port the control plane binds. Listed in `preflight.mjs`. */
export const CONTROL_PLANE_PORT = 1236;

/**
 * The origin the account service believes it is served from: the hosted origin,
 * not this port. Better Auth signs `iss`/`aud` and scopes its cookie from
 * `SUITE_AUTH_URL`, the relay verifies those two claims, and a page can only send
 * the cookie to an origin it shares — so all three have to name
 * `scripts/hosted-origin.mjs`, which is the deployment's front door.
 */
export const HOSTED_ORIGIN = "http://localhost:5180";

/**
 * A fixed secret is fine here and nowhere else: the cluster is thrown away after
 * the run, nothing listens off loopback, and a per-run value would only make a
 * failing run harder to reproduce. Better Auth refuses anything under 32
 * characters, so this is deliberately long.
 */
const E2E_AUTH_SECRET = "e2e-control-plane-secret-not-a-credential-0001";

const url = await ensurePostgres();

// `tsx` straight from the package's own bin directory, not `pnpm start`: pnpm's
// dependency check can rewrite `pnpm-lock.yaml` on the way in, and a test harness
// that edits the repository it is measuring is not a harness.
const controlPlaneDir = path.join(ROOT, "apps", "control-plane");
const tsx = path.join(controlPlaneDir, "node_modules", ".bin", "tsx");

const child = spawn(tsx, ["src/server.ts"], {
  cwd: controlPlaneDir,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(CONTROL_PLANE_PORT),
    SUITE_CONTROL_PLANE_DATABASE_URL: url,
    SUITE_AUTH_DATABASE_URL: url,
    SUITE_AUTH_ENABLED: "1",
    SUITE_AUTH_SECRET: E2E_AUTH_SECRET,
    SUITE_AUTH_URL: HOSTED_ORIGIN,
    // The suite creates an account per authenticated test; a production limiter
    // would start refusing them halfway through a run. `info` keeps the lines the
    // captured log is for.
    NODE_ENV: "test",
    SUITE_LOG_LEVEL: process.env.SUITE_LOG_LEVEL ?? "info",
  },
});

let closing = false;

/**
 * Stops the cluster first, then the server.
 *
 * The order matters because Playwright gives a web server a short grace period
 * before it kills the process tree, and Postgres is a detached child that
 * outlives a SIGKILLed wrapper. A cluster left listening on the fixed port turns
 * the *next* run's preflight into a failure, so the thing that must not survive
 * is stopped while there is still time to do it.
 */
function shutdown(signal) {
  if (closing) return;
  closing = true;
  stopPostgres();
  child.kill(signal);
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdown(signal));
}

// A wrapper that exits for any other reason still owns the cluster.
process.on("exit", () => {
  if (!closing) stopPostgres();
});

child.on("exit", (code) => {
  if (!closing) {
    closing = true;
    stopPostgres();
  }
  process.exit(code ?? 1);
});
