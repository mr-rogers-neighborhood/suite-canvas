import { type FocusEvent, useEffect, useRef, useState } from "react";
import { useUiStore } from "../store/useUiStore";
import "../styles/feedback.css";
import { useReducedMotion } from "./motion";
import { type Toast, useToastStore } from "./toast";

/**
 * The toast stack: bottom centre, above the dock, out of the inspector's column
 * and away from the bottom-right corner where a card's resize grip sits.
 *
 * Nothing here takes focus. A toast arrives while the person is typing, so the
 * layer is `pointer-events: none` and only the toast itself, its action and its
 * dismiss button accept the pointer.
 */

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  // Hover and keyboard focus both pause the clock: a toast that vanishes from
  // under the pointer that was reaching for it is a worse interruption than the
  // news it carried.
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.timeout ?? 0);

  useEffect(() => {
    if (toast.timeout === null || paused) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), Math.max(200, remaining.current));
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(200, remaining.current - (Date.now() - started));
    };
  }, [paused, onDismiss, toast.id, toast.timeout]);

  const handleBlur = (event: FocusEvent<HTMLLIElement>) => {
    // Moving between the action and the dismiss button stays inside the toast.
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setPaused(false);
  };

  return (
    <li
      className="toast"
      data-tone={toast.tone}
      data-testid={`toast-${toast.tone}`}
      data-paused={paused ? "true" : undefined}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlur={handleBlur}
    >
      <span className="toast__marker" aria-hidden="true" />
      <div className="toast__body">
        <p className="toast__message">{toast.message}</p>
        {toast.detail === null ? null : <p className="toast__detail">{toast.detail}</p>}
        {toast.action === null ? null : (
          <button
            type="button"
            className="toast__action"
            data-testid="toast-action"
            onClick={() => {
              toast.action?.onAction();
              onDismiss(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        className="toast__dismiss"
        data-testid="toast-dismiss"
        aria-label="Dismiss notification"
        title="Dismiss"
        onClick={() => onDismiss(toast.id)}
      >
        <span aria-hidden="true">{"\u00d7"}</span>
      </button>
    </li>
  );
}

export function ToastLayer() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  const reduced = useReducedMotion();
  const inspectorOpen = useUiStore((state) => state.inspectorNodeId !== null);

  if (toasts.length === 0) return null;

  return (
    <section
      className="toast-layer"
      data-testid="toast-layer"
      data-reduced={reduced ? "true" : undefined}
      data-inspector={inspectorOpen ? "open" : undefined}
      // A named region rather than a second live region: the announcements ride
      // `LiveRegion`, so a reader hears one sentence, not one per toast.
      aria-label="Notifications"
    >
      <ol className="toast-layer__list">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </ol>
    </section>
  );
}
