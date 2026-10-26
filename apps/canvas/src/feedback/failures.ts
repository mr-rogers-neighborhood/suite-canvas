import { useEffect, useRef } from "react";
import { buildDiagnostics, copyText, safeRoute, useDiagnosticsStore } from "../shell/diagnostics";
import { useDurabilityStore } from "../storage/durability";
import { useCanvasStore } from "../store/useCanvasStore";
import { HYDRATION_ERROR_NAME } from "./hydration";
import { type ToastOptions, toast } from "./toast";

/**
 * Failures that used to have exactly one home — a popover, or the console — and
 * so reached nobody who was not already looking for them.
 *
 * Both subscriptions read stores that already exist: the durability store raises
 * a refused write, and `installErrorRecorder` puts the last uncaught error in the
 * diagnostics store. Nothing here patches IndexedDB or the window again.
 */

export const QUOTA_MESSAGE = "This device is out of storage";
export const LAST_ERROR_MESSAGE = "Something failed";

/** The bundle the storage panel copies, reachable from a toast without opening it. */
export async function copyDiagnostics(): Promise<boolean> {
  const { persist, estimate, quota } = useDurabilityStore.getState();
  const text = buildDiagnostics({
    route: safeRoute(window.location.href),
    storage: { persist, estimate, quota },
    connection: useCanvasStore.getState().status,
    lastError: useDiagnosticsStore.getState().lastError,
  });
  const copied = await copyText(text);
  if (copied) toast.success("Diagnostics copied");
  else toast.failure("Could not copy diagnostics", { detail: "The clipboard was refused." });
  return copied;
}

const DIAGNOSTICS_ACTION: ToastOptions["action"] = {
  label: "Copy diagnostics",
  onAction: () => void copyDiagnostics(),
};

/** Mounted once by the shell; subscribes and toasts, renders nothing. */
export function useFailureToasts(): void {
  const quota = useDurabilityStore((store) => store.quota);
  const lastError = useDiagnosticsStore((store) => store.lastError);
  const quotaAt = useRef<number | null>(null);
  const errorAt = useRef<number | null>(null);

  useEffect(() => {
    if (quota === null || quotaAt.current === quota.at) return;
    quotaAt.current = quota.at;
    toast.failure(QUOTA_MESSAGE, {
      detail: quota.message,
      urgent: true,
      timeout: 12_000,
      action: DIAGNOSTICS_ACTION,
    });
  }, [quota]);

  useEffect(() => {
    if (lastError === null || errorAt.current === lastError.at) return;
    errorAt.current = lastError.at;
    // Reported with its own sentence and consequence.
    if (lastError.name === HYDRATION_ERROR_NAME) return;
    toast.failure(LAST_ERROR_MESSAGE, {
      detail: `${lastError.name}: ${lastError.message}`,
      action: DIAGNOSTICS_ACTION,
    });
  }, [lastError]);
}
