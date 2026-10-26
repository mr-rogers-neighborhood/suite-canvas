/**
 * The feedback layer's public surface.
 *
 * Two kinds of caller: the shell mounts `FeedbackHost`; a lane that owns a
 * command the document runs (or a failure it catches) calls `announceUndo`,
 * `announceRedo` or `reportHydrationFailure`. Nothing here is chrome: the board's
 * status lives in the title bar's one control.
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
export { bannerStateOf, type ConnectionBannerState, usePendingChanges } from "./connection";
export { DocumentAnnouncer } from "./DocumentAnnouncer";
export { FeedbackHost } from "./FeedbackHost";
export { LAST_ERROR_MESSAGE, QUOTA_MESSAGE, useFailureToasts } from "./failures";
export { HYDRATION_MESSAGE, reportHydrationFailure } from "./hydration";
export { LiveRegion } from "./LiveRegion";
export { useReducedMotion } from "./motion";
export {
  localPersistenceAvailable,
  SAVE_SETTLE_MS,
  type SaveState,
  saveStateOf,
  useSaveState,
} from "./saveState";
export {
  NOT_DURABLE_REASON,
  SAVE_LABEL,
  type SyncFacts,
  type SyncPresentation,
  syncPresentation,
} from "./syncState";
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
