/**
 * A quiet line saying this tab is running an older build, with the one action that
 * fixes it. It never reloads on its own: a document can be mid-edit, and losing a
 * reader's place to save them a click is not a trade worth making.
 */
export function StaleBuildNotice({ onReload }: { onReload: () => void }) {
  return (
    <div
      className="stale-build fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--ink)] shadow-lg"
      data-testid="stale-build-notice"
      role="status"
      style={{ top: "calc(var(--topbar-height, 56px) + 10px)" }}
    >
      <span>A newer build is ready.</span>
      <button
        type="button"
        className="font-medium underline underline-offset-2"
        data-testid="stale-build-reload"
        onClick={onReload}
      >
        Reload
      </button>
    </div>
  );
}
