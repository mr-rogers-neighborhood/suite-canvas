import { Section } from "./CardPanelSection";
import type { CardWhere } from "./cardWhere";

const crumbClass =
  "min-w-0 truncate rounded px-0.5 text-[12px] text-[var(--ink)] underline-offset-2 hover:underline";

/** "Where is this card?" — the current board and section, then every other board. */
export function CardPlacementSection({
  where,
  inspector,
  editLayout,
  onFocusCard,
  onFocusSection,
  onRemoveFromBoard,
}: {
  where: CardWhere;
  /** The drawer variant names its own test ids. */
  inspector: boolean;
  editLayout: boolean;
  onFocusCard: (boardId: string) => void;
  onFocusSection: (sectionId: string) => void;
  onRemoveFromBoard: () => void;
}) {
  const current =
    where.entries.find((entry) => entry.isCurrent) ??
    where.entries.find((entry) => entry.isHome) ??
    where.entries[0] ??
    null;
  const others = where.entries.filter((entry) => entry.boardId !== current?.boardId);
  const currentSection = current?.sectionPath.at(-1) ?? null;
  return (
    <Section title="Where">
      {where.unplaced || !current ? (
        <p className="text-[12px] text-[var(--ink-muted)]" data-testid="card-where-empty">
          In the inbox
        </p>
      ) : (
        <ul
          className="space-y-1"
          data-testid={inspector ? "inspector-boards" : "card-where-boards"}
        >
          <li className="flex items-center gap-1 text-[12px]" data-testid="card-where-current">
            <span aria-hidden="true" className="text-[var(--ink-muted)]">
              {current.isHome ? "\u2302" : "\u2197"}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <button
                type="button"
                className={crumbClass}
                onClick={() => onFocusCard(current.boardId)}
              >
                {current.boardName}
              </button>
              <span aria-hidden="true" className="text-[var(--ink-muted)]">
                {"\u203a"}
              </span>
              {currentSection ? (
                current.sectionPath.map((section, index) => {
                  const deepest = index === current.sectionPath.length - 1;
                  return (
                    <span key={section.id} className="flex min-w-0 items-center gap-1">
                      <button
                        type="button"
                        data-testid={
                          deepest && inspector
                            ? "inspector-section"
                            : deepest
                              ? "card-where-section"
                              : undefined
                        }
                        className={`${crumbClass} flex items-center gap-1`}
                        onClick={() => onFocusSection(section.id)}
                      >
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: section.color ?? "var(--ink-muted)" }}
                        />
                        <span className="min-w-0 truncate">{section.name}</span>
                      </button>
                      {deepest ? null : (
                        <span aria-hidden="true" className="text-[var(--ink-muted)]">
                          {"\u203a"}
                        </span>
                      )}
                    </span>
                  );
                })
              ) : (
                <span
                  className="text-[var(--ink-muted)]"
                  data-testid={inspector ? undefined : "card-where-unsorted"}
                >
                  Unsorted
                </span>
              )}
            </span>
            {editLayout ? (
              <button
                type="button"
                className="rounded px-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={onRemoveFromBoard}
              >
                Remove
              </button>
            ) : null}
          </li>
          {others.map((entry) => (
            <li
              key={entry.boardId}
              className="flex items-center gap-1.5 text-[12px]"
              data-testid="card-where-board"
            >
              <span aria-hidden="true" className="text-[var(--ink-muted)]">
                {entry.isHome ? "\u2302" : "\u2197"}
              </span>
              <button
                type="button"
                className={`${crumbClass} flex-1 text-left`}
                onClick={() => onFocusCard(entry.boardId)}
              >
                {entry.boardName}
              </button>
              <button
                type="button"
                className="rounded px-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => onFocusCard(entry.boardId)}
              >
                Go
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
