import type { Board } from "@suite/graph";
import { Fragment } from "react";
import { type BoardVisit, useUiStore } from "../store/useUiStore";

/** Steps shown before the current board; anything older folds into one ellipsis. */
const MAX_STEPS = 3;

interface TrailStep {
  boardId: string;
  name: string;
  /** How this board was entered; the first step has no arrival to name. */
  via: BoardVisit["via"] | null;
  current: boolean;
}

type TrailEntry = { kind: "step"; step: TrailStep } | { kind: "fold"; hidden: number };

export interface BoardTrailProps {
  /** Boards the trail may name: the open tabs plus the rest of the workspace. */
  boards: readonly Board[];
  activeBoardId: string | null;
  /** The board switch the tab strip uses, so a step lands exactly as a tab does. */
  onSelect: (boardId: string) => void;
  /** Defaults to the shell's history; stories and tests pass it directly. */
  history?: readonly BoardVisit[];
}

/**
 * The path the reader took, beside the tab strip.
 *
 * `boardHistory` records the boards left behind, so this draws a trail rather
 * than an ancestry: the same board can appear twice, and a step says how the
 * board after it was entered (a tab, or a portal). Nothing here claims a board
 * has one parent. A board that no longer exists is skipped, because a step that
 * cannot be opened is not a place to go back to.
 */
export function BoardTrail({ boards, activeBoardId, onSelect, history }: BoardTrailProps) {
  const storeHistory = useUiStore((state) => state.boardHistory);
  const visits = history ?? storeHistory;
  const names = new Map(boards.map((board) => [board.id, board.name]));

  const path: TrailStep[] = [];
  let arrivedBy: BoardVisit["via"] | null = null;
  for (const visit of visits) {
    const name = names.get(visit.boardId);
    if (name !== undefined)
      path.push({ boardId: visit.boardId, name, via: arrivedBy, current: false });
    arrivedBy = visit.via;
  }
  const currentName = activeBoardId === null ? undefined : names.get(activeBoardId);
  // A trail with nothing behind it says nothing; the tab strip already shows
  // which board is on screen.
  if (activeBoardId === null || currentName === undefined || path.length === 0) return null;

  const head = path[0];
  const folded = path.length > MAX_STEPS && head !== undefined;
  const shownPath = folded ? [head, ...path.slice(-(MAX_STEPS - 1))] : path;
  const entries: TrailEntry[] = [];
  for (const [index, step] of shownPath.entries()) {
    if (folded && index === 1)
      entries.push({ kind: "fold", hidden: path.length - shownPath.length });
    entries.push({ kind: "step", step });
  }
  entries.push({
    kind: "step",
    step: { boardId: activeBoardId, name: currentName, via: arrivedBy, current: true },
  });

  return (
    <nav
      aria-label="Board trail"
      data-testid="board-trail"
      className="flex min-w-0 items-center gap-0.5 text-[12px] leading-none text-[var(--ink-muted)]"
    >
      {entries.map((entry, index) => (
        <Fragment key={entry.kind === "step" ? `${entry.step.boardId}:${index}` : `fold:${index}`}>
          {index > 0 ? (
            <span aria-hidden="true" className="shrink-0 px-0.5 opacity-70">
              {"\u203a"}
            </span>
          ) : null}
          {entry.kind === "fold" ? (
            <span
              aria-hidden="true"
              data-testid="board-trail-fold"
              title={`${entry.hidden} earlier ${entry.hidden === 1 ? "board" : "boards"}`}
              className="px-0.5"
            >
              {"\u2026"}
            </span>
          ) : entry.step.current ? (
            <span
              aria-current="page"
              data-testid={`board-trail-step-${entry.step.boardId}`}
              data-via={entry.step.via ?? undefined}
              title={arrival(entry.step.via)}
              className="min-w-0 max-w-[140px] truncate px-1 py-1 font-medium text-[var(--ink)]"
            >
              {entry.step.name}
            </span>
          ) : (
            <button
              type="button"
              data-testid={`board-trail-step-${entry.step.boardId}`}
              data-via={entry.step.via ?? undefined}
              aria-label={`Back to ${entry.step.name}`}
              title={backLabel(entry.step.name, entry.step.via)}
              className="min-w-0 max-w-[120px] truncate rounded px-1 py-1 transition-colors hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
              onClick={() => onSelect(entry.step.boardId)}
            >
              {entry.step.name}
            </button>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

/** How a board was entered, in the trail's own words. */
function arrival(via: BoardVisit["via"] | null): string | undefined {
  if (via === "portal") return "Entered through a portal";
  if (via === "manual") return "Opened from a tab or the library";
  return undefined;
}

function backLabel(name: string, via: BoardVisit["via"] | null): string {
  const how = arrival(via);
  return how === undefined ? `Back to ${name}` : `Back to ${name} \u00b7 ${how.toLowerCase()}`;
}
