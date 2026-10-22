/**
 * Stand-in for the shell when the relay says another key owns this workspace.
 * It only needs the theme and the logo: no store, no sync connection, no
 * document. The way back in is an editor link that carries the owner fragment.
 */
export function WorkspaceProtected() {
  return (
    <div
      className="app-canvas flex h-screen w-screen flex-col items-center justify-center gap-4 px-6 text-center"
      data-testid="workspace-protected"
    >
      <img src="/suite-logo-black.svg" alt="Suite" className="h-10 w-10 dark:hidden" />
      <img src="/suite-logo-white.svg" alt="Suite" className="hidden h-10 w-10 dark:block" />
      <div className="max-w-[360px]">
        <h1 className="text-[15px] font-semibold text-[var(--ink)]">
          This workspace is protected.
        </h1>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-muted)]">
          Open the editor link that includes its owner key.
        </p>
      </div>
      <a
        href="/"
        data-testid="workspace-protected-launcher"
        className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
      >
        Open Suite
      </a>
    </div>
  );
}
