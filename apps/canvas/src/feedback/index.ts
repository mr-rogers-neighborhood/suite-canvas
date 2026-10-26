/**
 * The feedback layer's public surface.
 *
 * Two kinds of caller: the shell mounts `FeedbackHost` and `FeedbackRail`; a
 * lane that owns a command the document runs (or a failure it catches) calls
 * `announceUndo`, `announceRedo` or `reportHydrationFailure`.
 */

export {
  type Announcement,
  announce,
  announceRedo,
  announceUndo,
  REPEAT_WINDOW_MS,
  resetAnnouncerForTests,
  useAnnouncerStore,
} from "./announcer";
export { ConnectionBanner } from "./ConnectionBanner";
export { bannerStateOf, type ConnectionBannerState, usePendingChanges } from "./connection";
export { DocumentAnnouncer } from "./DocumentAnnouncer";
export { FeedbackHost } from "./FeedbackHost";
export { FeedbackRail } from "./FeedbackRail";
export { LAST_ERROR_MESSAGE, QUOTA_MESSAGE, useFailureToasts } from "./failures";
export { HYDRATION_MESSAGE, reportHydrationFailure } from "./hydration";
export { LiveRegion } from "./LiveRegion";
export { useReducedMotion } from "./motion";
export { SaveIndicator } from "./SaveIndicator";
export {
  localPersistenceAvailable,
  SAVE_SETTLE_MS,
  type SaveState,
  saveStateOf,
  useSaveState,
} from "./saveState";
export { ToastLayer } from "./ToastLayer";
export {
  DEFAULT_TIMEOUTS,
  MAX_TOASTS,
  type Toast,
  type ToastAction,
  type ToastOptions,
  type ToastTone,
  toast,
  useToastStore,
} from "./toast";
