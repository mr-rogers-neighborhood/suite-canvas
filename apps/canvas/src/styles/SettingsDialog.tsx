import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { useEscapeLayer } from "../shell/escapeLayers";
import { AppearanceSection } from "./AppearanceSection";
import { SETTINGS_EVENT } from "./settingsEvents";

/**
 * Settings: the home appearance never had.
 *
 * Appearance used to live inside the theme menu, which is a switcher, not a
 * place a preference can grow. This is the room for the settings a reader owns
 * alone (ADR-0071). The document's own styles stay in the Styles list, because
 * those are shared with everyone in the workspace.
 *
 * `data-testid="appearance-dialog"` on the appearance section and the
 * `appearance-*` control ids are the names the e2e suite already uses.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement | null>(null);

  useEscapeLayer(onClose);
  useFocusTrap(panel);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close settings"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        data-testid="settings-dialog"
        className="relative w-[min(440px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Settings</h2>
            <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
              What this screen looks like, on this device.
            </p>
          </div>
          <button
            type="button"
            data-testid="appearance-close"
            aria-label="Close settings"
            className="rounded-md px-1.5 py-0.5 text-[13px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
            onClick={onClose}
          >
            {"\u00d7"}
          </button>
        </div>

        <div className="mt-3">
          <AppearanceSection />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Mounts Settings when the theme menu or the palette asks for it. */
export function SettingsHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SETTINGS_EVENT, show);
    return () => window.removeEventListener(SETTINGS_EVENT, show);
  }, []);

  if (!open) return null;
  return <SettingsDialog onClose={() => setOpen(false)} />;
}
