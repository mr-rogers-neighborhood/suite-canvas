import { describeError, safeRoute, useDiagnosticsStore } from "../shell/diagnostics";
import { toast } from "./toast";

/**
 * The offline copy failed to hydrate.
 *
 * `useCanvasStore` catches this while its module loads, before any surface
 * exists to show it, which is why the report is a function this layer exports
 * rather than something the store renders itself. The workspace still opens —
 * from the relay, or empty — but the person has to know that the copy on this
 * device is gone rather than merely old.
 *
 * This module imports no store of its own: the owner calls it from inside
 * `useCanvasStore`, so a dependency back into that module would be a cycle.
 */

export const HYDRATION_MESSAGE = "This browser's saved copy could not be opened";

/** Recorded under this name so the generic uncaught-error toast skips it. */
export const HYDRATION_ERROR_NAME = "HydrationError";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function reportHydrationFailure(error: unknown): void {
  useDiagnosticsStore.getState().record({
    ...describeError(error, safeRoute(window.location.href)),
    name: HYDRATION_ERROR_NAME,
  });
  toast.failure(HYDRATION_MESSAGE, {
    detail: `${reason(error)} The workspace opened without it.`,
    urgent: true,
    timeout: 12_000,
  });
}
