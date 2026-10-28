import type { ModuleStatus } from "./modules/index.js";

/**
 * The `/health` body: a build id, one entry per expected module, and the
 * dependencies those modules cannot work without. Modules let a deployment tell
 * "the control plane is up and billing is missing" from "the control plane is
 * down" — absent is normal (a module another agent has not landed yet), failed is
 * not. Checks are the second question: a process with every module mounted and no
 * database answers requests it cannot complete, so it must not read as healthy.
 */

export interface HealthCheck {
  name: string;
  state: "ok" | "failed";
  /** Why it failed; never a value from the environment. */
  detail?: string;
}

export interface HealthPayload {
  status: "ok" | "degraded";
  buildId: string;
  uptimeMs: number;
  modules: readonly ModuleStatus[];
  checks: readonly HealthCheck[];
}

export function healthPayload(options: {
  buildId: string;
  statuses: readonly ModuleStatus[];
  startedAt: number;
  now: number;
  checks?: readonly HealthCheck[];
}): HealthPayload {
  const checks = options.checks ?? [];
  const degraded =
    options.statuses.some((entry) => entry.state === "failed") ||
    checks.some((check) => check.state === "failed");
  return {
    status: degraded ? "degraded" : "ok",
    buildId: options.buildId,
    uptimeMs: Math.max(0, options.now - options.startedAt),
    modules: options.statuses,
    checks,
  };
}

/** A failed module makes the endpoint fail, so a monitor sees it and a proxy does not. */
export function healthStatus(payload: HealthPayload): number {
  return payload.status === "ok" ? 200 : 503;
}
