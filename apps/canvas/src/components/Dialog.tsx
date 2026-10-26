import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "../shell/escapeLayers";

export interface DialogAction {
  label: string;
  onSelect: () => void;
  /** Renders as the primary action. */
  primary?: boolean;
  danger?: boolean;
}

export interface DialogProps {
  title: string;
  description?: string;
  actions: DialogAction[];
  onClose: () => void;
}

/** Small modal used for destructive confirmations. */
export function Dialog({ title, description, actions, onClose }: DialogProps) {
  const panel = useRef<HTMLDivElement | null>(null);

  useEscapeLayer(onClose);
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid="dialog"
        className="relative w-[min(380px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl outline-none"
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? (
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-muted)]">{description}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                action.onSelect();
                onClose();
              }}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                action.danger
                  ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-500/15"
                  : action.primary
                    ? "bg-[var(--ink)] text-[var(--surface)] hover:opacity-90"
                    : "text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
