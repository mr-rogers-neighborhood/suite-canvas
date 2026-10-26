import { createPortal } from "react-dom";
import { useAccountStore } from "./useAccountStore";

/**
 * The one prompt after an anonymous device signs up (ADR-0076).
 *
 * The server already moved the rows — `onLinkAccount` runs before the anonymous
 * user is deleted — so this is a statement, not a step: there is nothing to
 * confirm, retry or reconcile. It is a prompt only because a silent change of
 * ownership is worse than a sentence, and it appears once.
 */
export function LinkNotice() {
  const linked = useAccountStore((state) => state.linked);
  const dismiss = useAccountStore((state) => state.dismissLinked);
  if (linked === null) return null;

  return createPortal(
    <div
      data-testid="link-notice"
      role="status"
      className="fixed bottom-4 left-4 z-[68] w-[min(380px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-3 shadow-xl"
    >
      <h2 className="text-[13px] font-semibold text-[var(--ink)]">Your work came with you</h2>
      <p
        data-testid="link-notice-message"
        className="mt-1.5 text-[12px] leading-5 text-[var(--ink)]"
      >
        {linked.message}
      </p>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          data-testid="link-notice-dismiss"
          onClick={dismiss}
          className="rounded-md px-2.5 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
        >
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}
