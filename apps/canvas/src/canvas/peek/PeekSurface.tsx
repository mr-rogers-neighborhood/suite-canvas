import type { Target } from "@suite/graph";
import { peekLabel } from "./peekResolver";
import type { PeekState } from "./usePeek";

export interface PeekSurfaceProps {
  /** The open peek, or null when there is none. */
  peek: PeekState | null;
  /** The one route a peek offers: open what it names. */
  onOpen?: ((target: Target) => void) | undefined;
  /** Pointer entering the surface keeps it open; leaving starts the grace again. */
  onEnter?: (() => void) | undefined;
  onLeave?: (() => void) | undefined;
}

/**
 * The read-only card a hover rests on (ADR-0055).
 *
 * It renders in place rather than through a portal so that Tab from the trigger reaches
 * its one button, and it is positioned with `fixed` coordinates from the trigger's rect so
 * a scrolling rail cannot clip it. It is a reading: a name, a kind, one line of context,
 * and a way to open the thing. Editing stays in the inspector.
 *
 * It never takes focus itself. A hover that stole focus would interrupt typing, and a
 * keyboard reader who tabbed to the trigger is already where they meant to be.
 */
export function PeekSurface({ peek, onOpen, onEnter, onLeave }: PeekSurfaceProps) {
  if (!peek) return null;
  const { entity, anchor } = peek;

  return (
    <div
      className="fixed z-50 flex max-w-[280px] flex-col gap-1 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--ink)] shadow-lg"
      data-testid="peek-surface"
      data-handbook-region="peek-surface"
      data-peek-surface=""
      data-target-kind={entity.target.kind}
      data-target-id={entity.target.id}
      role="dialog"
      aria-label={peekLabel(entity)}
      style={anchor ? { left: anchor.x, top: anchor.y } : undefined}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <span className="min-w-0 truncate font-medium" data-testid="peek-label">
        {entity.label}
      </span>
      <span
        className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]"
        data-testid="peek-kind"
      >
        {entity.kindLabel}
      </span>
      {entity.detail ? (
        <span className="min-w-0 truncate text-[var(--ink-muted)]" data-testid="peek-detail">
          {entity.detail}
        </span>
      ) : null}
      {onOpen ? (
        <button
          type="button"
          className="mt-0.5 w-fit rounded-lg px-1.5 py-0.5 text-left text-[var(--ink)] underline decoration-[var(--hairline)] hover:bg-black/5 dark:hover:bg-white/10"
          data-testid="peek-open"
          onClick={() => onOpen(entity.target)}
        >
          Open
        </button>
      ) : null}
    </div>
  );
}
