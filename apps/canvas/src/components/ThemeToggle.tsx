import { useEffect, useRef, useState } from "react";
import type { ThemeMode } from "../theme/theme";
import { useThemeStore } from "../theme/useThemeStore";

const OPTIONS: Array<{ mode: ThemeMode; label: string }> = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "Auto" },
];

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`theme-icon theme-icon--${mode}`}
      data-testid="theme-icon"
    >
      <circle className="theme-icon__disc" cx="12" cy="12" r="5" />
      <g className="theme-icon__rays">
        <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" />
      </g>
      <circle className="theme-icon__bite" cx="15.4" cy="9.6" r="4.6" />
    </svg>
  );
}

/**
 * One control, one menu. The icon is a sun in light mode, a crescent in dark,
 * and a half-lit disc for Auto; the transition is skipped when the platform
 * asks for reduced motion.
 */
export function ThemeToggle() {
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);
  const active = OPTIONS.find((option) => option.mode === mode) ?? OPTIONS[2];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (container.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="theme-picker" ref={container}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${active?.label ?? "Auto"}`}
        title={`Theme: ${active?.label ?? "Auto"}`}
        data-testid="theme-toggle"
        data-mode={mode}
        className="theme-picker__button"
        onClick={() => setOpen((value) => !value)}
      >
        <ThemeIcon mode={mode} />
      </button>
      {open ? (
        <div role="menu" aria-label="Color theme" data-testid="theme-menu" className="theme-menu">
          {OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              aria-checked={mode === option.mode}
              data-testid={`theme-${option.mode}`}
              data-checked={mode === option.mode ? "true" : "false"}
              className="theme-menu__item"
              onClick={() => {
                setMode(option.mode);
                setOpen(false);
              }}
            >
              <ThemeIcon mode={option.mode} />
              <span>{option.label}</span>
              {mode === option.mode ? (
                <span aria-hidden="true" className="ml-auto opacity-60">
                  {"\u2713"}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
