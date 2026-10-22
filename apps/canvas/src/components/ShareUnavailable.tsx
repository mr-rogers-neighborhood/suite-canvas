export interface ShareUnavailableProps {
  /** Why the link could not be resolved; shown under the headline. */
  message?: string | null;
}

/**
 * Stand-in for the shell when a `?share=` token is unknown or revoked. It only
 * needs the theme and the logo: no store, no sync connection, no document.
 */
export function ShareUnavailable({ message }: ShareUnavailableProps) {
  return (
    <div
      className="app-canvas flex h-screen w-screen flex-col items-center justify-center gap-4 px-6 text-center"
      data-testid="share-unavailable"
    >
      <img src="/suite-logo-black.svg" alt="Suite" className="h-10 w-10 dark:hidden" />
      <img src="/suite-logo-white.svg" alt="Suite" className="hidden h-10 w-10 dark:block" />
      <div className="max-w-[360px]">
        <h1 className="text-[15px] font-semibold text-[var(--ink)]">
          This link is no longer available.
        </h1>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-muted)]">
          Ask the person who shared it for a new link.
        </p>
        {message ? (
          <p className="mt-2 text-[11px] text-[var(--ink-muted)]" data-testid="share-error">
            {message}
          </p>
        ) : null}
      </div>
      <a
        href="/"
        className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
      >
        Open Suite
      </a>
    </div>
  );
}
