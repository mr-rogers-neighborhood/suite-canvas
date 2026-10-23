import "../styles/boot-skeleton.css";

/**
 * The local document is read from IndexedDB before anything is editable. Keep
 * this surface deliberately small: the logo, a progress bar and the theme. It
 * must not mount the canvas or any card editor.
 */
export interface BootSkeletonProps {
  /** The minimum display has elapsed; fade out before unmounting. */
  exiting?: boolean;
}

export function BootSkeleton({ exiting = false }: BootSkeletonProps) {
  return (
    <div
      className="boot-skeleton"
      data-testid="boot-skeleton"
      data-exiting={exiting ? "true" : undefined}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Opening your workspace"
    >
      <div className="boot-skeleton__panel">
        <img src="/suite-logo-black.svg" alt="" className="boot-skeleton__logo dark:hidden" />
        <img src="/suite-logo-white.svg" alt="" className="boot-skeleton__logo hidden dark:block" />
        <span className="boot-skeleton__wordmark" aria-hidden="true">
          Suite
        </span>
        <div
          className="boot-skeleton__progress"
          role="progressbar"
          aria-label="Opening your workspace"
        >
          <span className="boot-skeleton__progress-fill" />
        </div>
        <p className="boot-skeleton__label">Opening your workspace…</p>
      </div>
    </div>
  );
}
