import { useEffect, useRef } from "react";
import { announce } from "./announcer";
import { DocumentAnnouncer } from "./DocumentAnnouncer";
import { useFailureToasts } from "./failures";
import { LiveRegion } from "./LiveRegion";
import { type SaveState, useSaveState } from "./saveState";
import { useStorageFill } from "./storageFill";
import { SAVE_LABEL } from "./syncState";
import { ToastLayer } from "./ToastLayer";
import { toast } from "./toast";

/**
 * Everything the feedback layer mounts at the shell root: the two live regions,
 * the store subscriptions that speak document changes, the failure routing, and
 * the toast stack. Rendered once, after the board, so nothing here sits inside
 * the canvas or a card editor.
 *
 * The save state is *observed* here rather than displayed. Its home is the title
 * bar's status control, which is not mounted when that control is closed, so the
 * one moment worth announcing is caught before anyone opens it.
 */
export function FeedbackHost() {
  useFailureToasts();
  useStorageFill();
  useSaveStateAnnouncement();

  return (
    <>
      <LiveRegion />
      <DocumentAnnouncer />
      <ToastLayer />
    </>
  );
}

function useSaveStateAnnouncement() {
  const state = useSaveState();
  const previous = useRef<SaveState | null>(null);

  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    if (state !== "not-durable" || was === "not-durable") return;
    // A live region for a screen reader and a toast for everyone else: this is
    // the one state where closing the tab loses work.
    announce(SAVE_LABEL[state]);
    toast.failure(
      "This browser is not keeping the workspace. Closing the tab loses anything not exported.",
    );
  }, [state]);
}
