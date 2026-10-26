import { useEffect, useState } from "react";
import "../styles/feedback.css";

/**
 * What a lazy dialog shows while its chunk loads.
 *
 * `fallback={null}` meant a slow chunk showed nothing at all: a press on a
 * control left the surface looking dead until the module arrived, then the
 * dialog appeared and moved everything. These placeholders hold the space the
 * real thing takes, using the boot skeleton's bar so a slow start reads the same
 * whether it is the app or one dialog.
 *
 * The wait before showing is deliberate. Most chunks resolve inside a frame or
 * two, and a box that appears and vanishes in that time is a flicker rather than
 * feedback; a chunk that is genuinely slow shows it within a fifth of a second.
 *
 * Not exported from `feedback/`: this is shell chrome, and it outlives any one
 * feature that happens to load late.
 */

export interface LoadingPlaceholderProps {
  /** `inline` sits in a row of controls; `dialog` holds the centre of the board. */
  variant?: "inline" | "dialog";
  /** Read out as the element's name, and shown under the bar when it is a dialog. */
  label: string;
  /** Milliseconds to wait before appearing. */
  delayMs?: number;
}

export function LoadingPlaceholder({
  variant = "dialog",
  label,
  delayMs = 200,
}: LoadingPlaceholderProps) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (visible) return;
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, visible]);

  if (!visible) return null;

  return (
    <div
      className="loading-placeholder"
      data-variant={variant}
      data-testid="loading-placeholder"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="loading-placeholder__track">
        <span className="loading-placeholder__fill" aria-hidden="true" />
      </div>
      {variant === "dialog" ? <p className="loading-placeholder__label">{label}</p> : null}
    </div>
  );
}
