import { create } from "zustand";
import { announce } from "./announcer";

/**
 * One toast layer for the whole app.
 *
 * A toast is for something the person did not ask to watch: a save that failed,
 * a copy that landed, a change that could not reach the relay. It never takes
 * focus, it pauses while the pointer or the keyboard is on it, and it is
 * dismissible, because a notification that traps the eye is a bug.
 */

export type ToastTone = "success" | "failure" | "neutral";

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  /** The line under the message: the reason, a path, the size that failed. */
  detail?: string | undefined;
  /** Milliseconds on screen. Defaults per tone; `null` keeps it until dismissed. */
  timeout?: number | null | undefined;
  action?: ToastAction | undefined;
  /**
   * True only for a failure the person has to act on. It is announced through
   * the assertive region; everything else is polite.
   */
  urgent?: boolean | undefined;
}

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
  detail: string | null;
  /** Milliseconds before it dismisses itself, or `null` to stay put. */
  timeout: number | null;
  action: ToastAction | null;
  urgent: boolean;
}

/** Longer than a success, because a failure has to be read and decided on. */
export const DEFAULT_TIMEOUTS: Record<ToastTone, number> = {
  success: 4000,
  neutral: 5000,
  failure: 9000,
};

/** Beyond this the stack covers the board it is reporting on. */
export const MAX_TOASTS = 4;

interface ToastState {
  toasts: Toast[];
  /** True when the toast was added; false when it merged into the one already there. */
  push: (toast: Toast) => boolean;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    // The same failure repeats: a refused write fires on every keystroke, and
    // four copies of one sentence is not four pieces of news.
    const existing = useToastStore
      .getState()
      .toasts.find(
        (candidate) => candidate.message === toast.message && candidate.tone === toast.tone,
      );
    if (existing) {
      set((state) => ({
        toasts: state.toasts.map((candidate) =>
          candidate.id === existing.id
            ? { ...candidate, detail: toast.detail ?? candidate.detail }
            : candidate,
        ),
      }));
      return false;
    }
    set((state) => {
      const next = [...state.toasts, toast];
      return { toasts: next.slice(Math.max(0, next.length - MAX_TOASTS)) };
    });
    return true;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

let sequence = 0;

function pushToast(tone: ToastTone, message: string, options: ToastOptions = {}): string {
  sequence += 1;
  const id = `toast-${sequence}`;
  const detail = options.detail ?? null;
  const added = useToastStore.getState().push({
    id,
    tone,
    message,
    detail,
    timeout: options.timeout === undefined ? DEFAULT_TIMEOUTS[tone] : options.timeout,
    action: options.action ?? null,
    urgent: options.urgent ?? false,
  });
  // A repeat that merged into the visible toast is not news a second time.
  if (added) {
    announce(detail === null ? message : `${message}. ${detail}`, {
      urgent: tone === "failure" && options.urgent === true,
    });
  }
  return id;
}

/**
 * The call surface. Everything that reports to the person goes through these
 * three, so how a tone looks, how long it lives and how it is announced stay in
 * one place.
 */
export const toast = {
  success: (message: string, options?: ToastOptions): string =>
    pushToast("success", message, options),
  failure: (message: string, options?: ToastOptions): string =>
    pushToast("failure", message, options),
  neutral: (message: string, options?: ToastOptions): string =>
    pushToast("neutral", message, options),
  dismiss: (id: string): void => useToastStore.getState().dismiss(id),
  clear: (): void => useToastStore.getState().clear(),
};
