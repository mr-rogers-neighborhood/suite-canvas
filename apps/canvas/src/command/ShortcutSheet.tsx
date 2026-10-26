import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { useEscapeLayer } from "../shell/escapeLayers";
import {
  openShortcutSheet,
  SHORTCUT_SHEET_EVENT,
  shortcutGroupLabel,
  shortcutGroups,
} from "./shortcutSheet";

/**
 * Every key the app answers, in one place.
 *
 * The registry has carried a `shortcut` field since it was written and nothing
 * rendered it, so `Mod+Enter`, `Mod+G` and `[` were keys only their authors knew.
 * The rows come from the registry; the board's own keys come with them.
 */
export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement | null>(null);
  const groups = useMemo(() => shortcutGroups(), []);

  useEscapeLayer(onClose);
  useFocusTrap(panel);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close keyboard shortcuts"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        data-testid="shortcut-sheet"
        className="relative w-[min(480px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            data-testid="shortcut-sheet-close"
            aria-label="Close keyboard shortcuts"
            className="rounded-md px-1.5 py-0.5 text-[13px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
            onClick={onClose}
          >
            {"\u00d7"}
          </button>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
          {"\u2318"} is Command on a Mac and Control elsewhere.
        </p>

        <div className="mt-3 max-h-[60vh] space-y-3 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.group} aria-label={shortcutGroupLabel(group.group)}>
              <h3 className="text-[10px] font-medium tracking-wide text-[var(--ink-muted)] uppercase">
                {shortcutGroupLabel(group.group)}
              </h3>
              <dl className="mt-1 space-y-0.5">
                {group.rows.map((row) => (
                  <div key={`${row.group}:${row.keys}`} className="flex items-baseline gap-3">
                    <dt className="w-24 shrink-0">
                      <kbd className="rounded border border-[var(--hairline)] px-1.5 py-0.5 text-[11px] text-[var(--ink)]">
                        {row.keys}
                      </kbd>
                    </dt>
                    <dd
                      className="min-w-0 flex-1 truncate text-[12px] text-[var(--ink-muted)]"
                      data-testid="shortcut-sheet-row"
                    >
                      {row.label}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Mounts the sheet when an `openShortcutSheet` request arrives. */
export function ShortcutSheetHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SHORTCUT_SHEET_EVENT, show);
    return () => window.removeEventListener(SHORTCUT_SHEET_EVENT, show);
  }, []);

  // A way in that nobody can find is not documentation, so the host also
  // answers `?` wherever the focus is not a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "?") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      event.preventDefault();
      openShortcutSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  return <ShortcutSheet onClose={() => setOpen(false)} />;
}
