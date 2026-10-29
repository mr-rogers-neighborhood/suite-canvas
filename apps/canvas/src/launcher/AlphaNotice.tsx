import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { useEscapeLayer } from "../shell/escapeLayers";
import { alphaNoticeSeen, rememberAlphaNotice } from "./alphaNotice";

/**
 * What a reader should know before they start working, on the first visit.
 *
 * The product is alpha and the page has to say so where somebody will read it rather than
 * in a footer or a changelog. Three facts, in the order they matter to a new reader: what
 * is rough, what money buys, and where the work actually lives. The last one is the least
 * obvious and the most expensive to discover late, because a workspace on this deployment
 * is a browser's copy until a subscription puts it in an account.
 *
 * It appears once per browser, and the dismissal is remembered here rather than in the
 * account, which is what makes it appear again on a new machine even for the same person.
 */
export interface AlphaNoticeProps {
  /** Opens the plan surface. Absent when this build has no account service to sell from. */
  onSeePlans?: (() => void) | undefined;
  /** For tests and stories, so the notice can render when storage says it was seen. */
  forceOpen?: boolean | undefined;
}

export function AlphaNotice({ onSeePlans, forceOpen = false }: AlphaNoticeProps) {
  const [dismissed, setDismissed] = useState(() => !forceOpen && alphaNoticeSeen());
  const panel = useRef<HTMLDivElement | null>(null);

  const close = () => {
    rememberAlphaNotice();
    setDismissed(true);
  };

  useEscapeLayer(close, !dismissed);
  useFocusTrap(panel, !dismissed);

  if (dismissed) return null;

  return createPortal(
    <div className="fixed inset-0 z-[71] flex items-center justify-center">
      <button
        type="button"
        aria-label="Dismiss the alpha notice"
        className="absolute inset-0 cursor-default border-0 bg-black/30 backdrop-blur-[2px]"
        onClick={close}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Suite is alpha software"
        tabIndex={-1}
        data-testid="alpha-notice"
        className="relative w-[min(460px,calc(100vw-2rem))] rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-5 text-[12px] leading-5 shadow-2xl ring-1 ring-black/5 dark:ring-white/5"
      >
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--ink)]">
          Suite is alpha software
        </h2>

        <p className="mt-2 text-[var(--ink)]">
          A subscription is early access to sync, collaboration and file uploads. The canvas, the
          cards and export work without one, on this device.
        </p>

        <p className="mt-2 text-[var(--ink-muted)]">
          The source goes public within about two weeks. After that you can run it yourself, and a
          subscription is a way to fund the work rather than the only way to use it.
        </p>

        <p className="mt-2 text-[var(--ink-muted)]">
          <strong className="font-medium text-[var(--ink)]">Your work lives in this browser</strong>{" "}
          until a plan puts it in your account, so clearing site data takes it with it. Export is
          always available and never asks for a plan.
        </p>

        <p className="mt-2 text-[var(--ink-muted)]">
          Payments are real: Stripe handles the card and this deployment never sees it. Nothing is
          charged during the alpha, because a 100% discount is applied at checkout, and no card is
          asked for while the total is zero.
        </p>

        <p className="mt-2 text-[var(--ink-muted)]">
          When something breaks, the feedback bubble in the corner sends it straight here. That is
          the most useful thing you can do with alpha software.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {onSeePlans === undefined ? null : (
            <button
              type="button"
              data-testid="alpha-notice-plans"
              onClick={() => {
                close();
                onSeePlans();
              }}
              className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
            >
              See plans
            </button>
          )}
          <button
            type="button"
            data-testid="alpha-notice-dismiss"
            onClick={close}
            className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-[11px] font-medium text-[var(--surface)]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
