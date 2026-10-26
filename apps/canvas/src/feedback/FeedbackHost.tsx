import { DocumentAnnouncer } from "./DocumentAnnouncer";
import { useFailureToasts } from "./failures";
import { LiveRegion } from "./LiveRegion";
import { ToastLayer } from "./ToastLayer";

/**
 * Everything the feedback layer mounts at the shell root: the two live regions,
 * the store subscriptions that speak document changes, the failure routing, and
 * the toast stack. Rendered once, after the board, so nothing here sits inside
 * the canvas or a card editor.
 */
export function FeedbackHost() {
  useFailureToasts();

  return (
    <>
      <LiveRegion />
      <DocumentAnnouncer />
      <ToastLayer />
    </>
  );
}
