import type { Board, SectionColor } from "@suite/graph";

/**
 * A board's mark, in the bar and in the list: its icon when it has one, its
 * colour when it has one of those, and its first letter otherwise.
 *
 * One component for both places, because a pinned tab and a switcher row are the
 * same board seen twice — two renderings drifted apart the moment they existed
 * separately (a tab with a dot, a row with none).
 */
const SWATCH: Record<SectionColor, string> = {
  slate: "bg-[var(--section-slate)]",
  blue: "bg-[var(--section-blue)]",
  green: "bg-[var(--section-green)]",
  amber: "bg-[var(--section-amber)]",
  rose: "bg-[var(--section-rose)]",
  violet: "bg-[var(--section-violet)]",
};

export function BoardGlyph({ board }: { board: Board }) {
  if (board.color) {
    return (
      <span
        aria-hidden="true"
        data-testid={`board-glyph-${board.id}`}
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${SWATCH[board.color]}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-testid={`board-glyph-${board.id}`}
      className="w-3 shrink-0 text-center text-[11px] leading-none text-[var(--ink-muted)]"
    >
      {board.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
