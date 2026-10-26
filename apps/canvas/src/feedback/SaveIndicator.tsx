import { useEffect, useRef } from "react";
import "../styles/feedback.css";
import { useDurabilityStore } from "../storage/durability";
import { announce } from "./announcer";
import { type SaveState, useSaveState } from "./saveState";

/**
 * This device's copy, in three words: saved, saving, or not durable.
 *
 * It says nothing about the relay — the title bar's sync dot owns that — so a
 * synced workspace whose writes are being refused reads as "Not saved to this
 * device" here while the dot still says Synced. That combination is the one
 * worth seeing.
 */

const LABEL: Record<SaveState, string> = {
  saved: "Saved on this device",
  saving: "Saving…",
  "not-durable": "Not saved to this device",
};

const NOT_DURABLE_REASON =
  "This browser cannot keep the workspace, so closing the tab loses anything not exported.";

export function SaveIndicator() {
  const state = useSaveState();
  const quota = useDurabilityStore((store) => store.quota);
  const previous = useRef<SaveState | null>(null);

  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    if (state === "not-durable" && was !== "not-durable") announce(LABEL[state]);
  }, [state]);

  const detail = state === "not-durable" ? (quota?.message ?? NOT_DURABLE_REASON) : LABEL[state];

  return (
    <span className="save-indicator" data-testid="save-indicator" data-state={state} title={detail}>
      <span className="save-indicator__dot" aria-hidden="true" />
      {LABEL[state]}
    </span>
  );
}
