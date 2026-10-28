import { useEffect, useRef } from "react";
import { useDurabilityStore } from "../storage/durability";
import {
  createEstimateSampler,
  FILL_RANK,
  type FillStage,
  fillPercent,
  fillRatio,
  fillStage,
} from "../storage/estimateWatch";
import { useCanvasStore } from "../store/useCanvasStore";
import { type ToastOptions, toast } from "./toast";

/**
 * Saying something before the browser runs out, rather than after.
 *
 * The durability store already reports a *refused* write, which is the present tense of
 * this problem. This is the future tense: the origin is filling up, and the browser
 * clears what it likes without asking. The copy is announced once per threshold per
 * crossing — dropping back below `low` and climbing again is new news, sitting at
 * `critical` is not.
 */

export const FILL_LOW_MESSAGE = "This browser is filling up";
export const FILL_CRITICAL_MESSAGE = "This browser is nearly out of space";

export function fillLowDetail(percent: number): string {
  return (
    `${String(percent)}% of the space this browser gives Suite is used. ` +
    "Export a copy, or sign in to keep the work on the relay."
  );
}

export function fillCriticalDetail(percent: number): string {
  return (
    `${String(percent)}% used, so the browser may clear this workspace to make room. ` +
    "Export a copy, or sign in to keep the work on the relay."
  );
}

/** The backup is the one thing that survives a cleanup, so it is the offer. */
async function exportOpenWorkspace(): Promise<void> {
  try {
    const [{ downloadWorkspaceBackup }, { useCanvasStore }, { getSession }] = await Promise.all([
      import("../session/workspaceTransfer"),
      import("../store/useCanvasStore"),
      import("../session/session"),
    ]);
    const workspaceId = getSession().workspaceId;
    if (!workspaceId) return;
    await downloadWorkspaceBackup(workspaceId, useCanvasStore.getState().workspace, workspaceId);
  } catch {
    toast.failure("Could not export a copy", { detail: "The backup was refused or failed." });
  }
}

const EXPORT_ACTION: ToastOptions["action"] = {
  label: "Export a copy",
  onAction: () => void exportOpenWorkspace(),
};

/** Mounted once by the shell; samples as the document grows and toasts on the thresholds. */
export function useStorageFill(): void {
  const estimate = useDurabilityStore((state) => state.estimate);
  const workspace = useCanvasStore((state) => state.workspace);
  const sampler = useRef(createEstimateSampler());
  const announced = useRef<FillStage>("fine");

  useEffect(() => {
    const stop = workspace.doc.subscribeLocalUpdates(() => sampler.current.note());
    // Another tab grows the same origin, and this one only learns of it by asking.
    const onVisible = () => {
      if (document.visibilityState === "visible") sampler.current.note();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workspace]);

  useEffect(() => {
    const ratio = fillRatio(estimate);
    const stage = fillStage(ratio);
    if (stage === "fine") {
      announced.current = "fine";
      return;
    }
    if (FILL_RANK[stage] <= FILL_RANK[announced.current]) return;
    announced.current = stage;
    const percent = fillPercent(ratio ?? 0);
    if (stage === "critical") {
      toast.failure(FILL_CRITICAL_MESSAGE, {
        detail: fillCriticalDetail(percent),
        urgent: true,
        timeout: 12_000,
        action: EXPORT_ACTION,
      });
      return;
    }
    toast.neutral(FILL_LOW_MESSAGE, { detail: fillLowDetail(percent), action: EXPORT_ACTION });
  }, [estimate]);
}
