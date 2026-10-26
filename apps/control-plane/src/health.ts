import type { ModuleStatus } from "./modules/index.js";

/**
 * The `/health` body: a build id and one entry per expected module, so a
 * deployment can tell "the control plane is up and billing is missing" from
 * "the control plane is down". Absent is normal (a module another agent has not
 * landed yet); failed is not.
 */

export interface HealthPayload {
  status: "ok" | "degraded";
  buildId: string;
  uptimeMs: number;
  modules: readonly ModuleStatus[];
}

export function healthPayload(options: {
  buildId: string;
  statuses: readonly ModuleStatus[];
  startedAt: number;
  now: number;
}): HealthPayload {
  const degraded = options.statuses.some((entry) => entry.state === "failed");
  return {
    status: degraded ? "degraded" : "ok",
    buildId: options.buildId,
    uptimeMs: Math.max(0, options.now - options.startedAt),
    modules: options.statuses,
  };
}

/** A failed module makes the endpoint fail, so a monitor sees it and a proxy does not. */
export function healthStatus(payload: HealthPayload): number {
  return payload.status === "ok" ? 200 : 503;
}
