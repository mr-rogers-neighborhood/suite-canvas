import { CanvasMark } from "../chrome/CanvasMark";

export interface StaleShellProps {
  /** The methods this build needs and the shell beside it does not publish. */
  readonly missing?: readonly string[];
}

/**
 * Stand-in page for a window whose shell is from an earlier build.
 *
 * The symptom this removes is silence: an old preload lacks a method this
 * renderer calls, the call is `undefined`, and the window looks functional while
 * doing nothing. The fix is one sentence and no button, because nothing the page
 * can do replaces a restart.
 */
export function StaleShell({ missing = [] }: StaleShellProps) {
  return (
    <div
      className="app-canvas flex h-screen w-screen flex-col items-center justify-center gap-4 px-6 text-center"
      data-testid="stale-shell"
      data-missing={missing.join(" ")}
    >
      <CanvasMark size="lg" />
      <div className="max-w-[360px]">
        <h1 className="text-[15px] font-semibold text-[var(--ink)]">
          This window's shell is out of date.
        </h1>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-muted)]">
          Restart Suite to load the current shell.
        </p>
      </div>
    </div>
  );
}
