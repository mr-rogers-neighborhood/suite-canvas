import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { repositoryUrl } from "../repository";
import { useEscapeLayer } from "../shell/escapeLayers";
import { alphaNoticeSeen, rememberAlphaNotice } from "./alphaNotice";

/**
 * What a reader should know before they start working, on the first visit.
 *
 * Three facts, in the order they matter to a new reader: what is rough, what money buys, and where
 * the work actually lives. The last one is the least obvious and the most expensive to discover
 * late, because a workspace here is a browser's copy until a plan puts it in an account.
 *
 * It appears on the launcher, and a dismissal stands for ten minutes (`alphaNotice.ts`): a reload
 * a moment later is not a reason to show it again, and a visit tomorrow is. The dismissal is
 * remembered in the browser rather than in the account, which is what makes it appear on a new
 * machine even for the same person.
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
          A subscription is early access to higher document storage limits, file uploads (storage),
          and the ability to add additional members to your organization (3 for the "Personal" plan,
          20 for the "Organization" plan). The canvas, the cards, share links, import and export
          work without one, on this device, and paying is optional.
        </p>

        <p className="mt-2 text-[var(--ink-muted)]">
          It is open source under the MIT licence, so you can also{" "}
          <a
            data-testid="alpha-notice-repository"
            className="underline underline-offset-2 hover:text-[var(--ink)]"
            href={repositoryUrl()}
            target="_blank"
            rel="noreferrer"
          >
            read the code or run it yourself
          </a>
          . That is free and needs no account.
        </p>

        <p className="mt-2 text-[var(--ink-muted)]">
          <strong className="font-medium text-[var(--ink)]">
            Your work is saved in this browser
          </strong>{" "}
          until you sync it, so clearing site data removes it. Export is always available and never
          asks for a plan.
        </p>

        <p className="mt-2 text-[var(--ink-muted)]">
          Cards are handled by Stripe on its own page. Plans are monthly and cancel from the portal,
          and a discount code, if you have one, is entered there too.
        </p>

        <p className="mt-2 text-[var(--ink-muted)]">
          Obsidian import is experimental and may not work for all vaults. The import is done in the
          browser, and no data is sent to the server.
        </p>

        <p className="mt-2 text-[var(--ink-muted)]">
          When something breaks, the feedback bubble in the corner sends it straight to me. That is
          the most useful thing you can do with alpha software!
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <a
            data-testid="alpha-notice-github"
            className="mr-auto rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
            href={repositoryUrl()}
            target="_blank"
            rel="noreferrer"
          >
            View on GitHub
          </a>
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
