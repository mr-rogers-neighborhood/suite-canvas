import { createPortal } from "react-dom";
import { useAccountStore } from "./useAccountStore";

/**
 * The upgrade prompt a refusal earns (ADR-0075, ADR-0078).
 *
 * It appears because the server refused something with a plan code — a seat, a
 * workspace, a byte of storage — not because a counter guessed. Nothing was lost
 * when it appears: the local copy is intact, so the prompt says that first and
 * only then offers the two ways forward, buying more or living on the free limits.
 *
 * It never blocks: the work under it keeps working, and closing it is one click.
 */
export function UpgradePrompt() {
  const upgrade = useAccountStore((state) => state.upgrade);
  const dismiss = useAccountStore((state) => state.dismissUpgrade);
  const openPanel = useAccountStore((state) => state.openPanel);
  if (upgrade === null) return null;

  return createPortal(
    <div
      data-testid="upgrade-prompt"
      data-code={upgrade.code}
      role="alertdialog"
      aria-label="This needs a higher plan"
      className="fixed bottom-4 right-4 z-[68] w-[min(360px,calc(100vw-2rem))] rounded-xl border border-amber-500/40 bg-[var(--surface)] p-3 shadow-xl"
    >
      <h2 className="text-[13px] font-semibold text-[var(--ink)]">This needs a higher plan</h2>
      <p data-testid="upgrade-message" className="mt-1.5 text-[12px] leading-5 text-[var(--ink)]">
        {upgrade.message}
      </p>
      <p className="mt-1.5 text-[11px] leading-5 text-[var(--ink-muted)]">
        Nothing you made was deleted, and the local copy keeps working.
      </p>
      <div className="mt-2.5 flex items-center justify-end gap-1.5">
        <button
          type="button"
          data-testid="upgrade-dismiss"
          onClick={dismiss}
          className="rounded-md px-2.5 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
        >
          Not now
        </button>
        <button
          type="button"
          data-testid="upgrade-see-plans"
          onClick={() => {
            dismiss();
            openPanel("plan");
          }}
          className="rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface)]"
        >
          See plans
        </button>
      </div>
    </div>,
    document.body,
  );
}
