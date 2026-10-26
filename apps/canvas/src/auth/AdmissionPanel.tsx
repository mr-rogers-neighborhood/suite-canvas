import { createPortal } from "react-dom";
import { ADMISSION_PENDING_MESSAGE } from "./admission";

/**
 * One honest panel for a session that is registered but not yet admitted
 * ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §7).
 *
 * It is not a wall. Everything local is unaffected, and saying that is the point:
 * a person who signs up and meets a locked screen learns the wrong thing about
 * this product. So the panel names what is waiting (the account's shared and
 * billable half), states that local editing, import and export are not affected,
 * gives the server's own sentence, and hands the workspace back in one click.
 *
 * It is reachable again: the header keeps a "Waiting for admission" chip while the
 * account is held, and signing out is offered right here, so this is a state with
 * an exit rather than a dead end.
 */

export interface AdmissionPanelProps {
  onDismiss: () => void;
  onSignOut: () => void;
}

export function AdmissionPanel({ onDismiss, onSignOut }: AdmissionPanelProps) {
  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close admission notice"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onDismiss}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Admission"
        data-testid="admission-panel"
        className="relative w-[min(400px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold">Waiting for admission</h2>
        <p data-testid="admission-message" className="mt-2 text-[13px] leading-5">
          {ADMISSION_PENDING_MESSAGE}
        </p>

        <p className="mt-2 text-[12px] leading-5 text-[var(--ink-muted)]">
          What is waiting is the part that involves other people or a bill: syncing this workspace,
          inviting someone, sharing it, and having it claimed by your account.
        </p>

        <p data-testid="admission-local" className="mt-2 text-[12px] leading-5 text-[var(--ink)]">
          Local editing, import and export are unaffected. This workspace is still yours, in this
          browser, exactly as it was before you signed in.
        </p>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-testid="admission-sign-out"
            onClick={onSignOut}
            className="rounded-md px-3 py-1.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            Sign out
          </button>
          <button
            type="button"
            data-testid="admission-keep-working"
            onClick={onDismiss}
            className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[11px] font-medium text-[var(--surface)] hover:opacity-90"
          >
            Keep working locally
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
