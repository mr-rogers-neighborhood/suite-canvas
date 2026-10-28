/**
 * Process entry point: configuration, then the module table, then the listener.
 *
 * Nothing here knows what a route does. The modules are loaded from
 * `modules/index.ts`, the host mounts them, and `/health` reports what was
 * found — which is what lets this package land before its first module does.
 */
import { validateConfig } from "./config.js";
import { createControlPlane } from "./host.js";
import { createLogger } from "./logging.js";
import { loadModules } from "./modules/index.js";
import { databaseProbe } from "./probes.js";

const logger = createLogger().child({ component: "server" });

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

const loaded = await loadModules({ logger });

// Everything the process itself needs is checked before a socket is bound. A
// bad value exits with one line per problem, so a supervisor restarts it loudly
// instead of serving a control plane that cannot account for anyone.
const boot = validateConfig(
  process.env,
  loaded.modules.map((module) => module.name),
);
if (!boot.ok) {
  for (const problem of boot.problems) {
    logger.error("invalid configuration", {
      variable: problem.variable,
      problem: problem.message,
    });
  }
  logger.error("refusing to start", {
    buildId: boot.config.buildId,
    problems: boot.problems.length,
  });
  process.exit(1);
}
const config = boot.config;

// The database is a dependency of the modules rather than a module, so it is a check:
// every route this process serves is a read or a write, and a process that cannot reach
// Postgres has nothing to say. Health answers 503 while it is unreachable, which is what
// turns the deployment's alarm into a report about the money path.
const probe = config.databaseUrl === null ? null : databaseProbe({ url: config.databaseUrl });

const plane = createControlPlane({
  modules: loaded.modules,
  statuses: loaded.status,
  ...(probe === null ? {} : { checks: async () => [await probe.check()] }),
  buildId: config.buildId,
  logger,
});

let port: number;
try {
  port = await plane.listen(config.port);
} catch (error) {
  logger.error("could not bind the listener", {
    port: config.port,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

logger.info("control plane listening", {
  port,
  buildId: config.buildId,
  database: config.databaseUrl === null ? "not configured" : "configured",
  // Names only: which account switches reached the process, never their values.
  auth: Object.keys(config.auth),
  modules: loaded.status,
});

let closing = false;

/** Stop accepting, drain, exit 0. A second signal is ignored rather than doubling the drain. */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info("shutting down", { signal, port });
  await plane.close();
  await probe?.close();
  logger.info("stopped", { signal, port });
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
